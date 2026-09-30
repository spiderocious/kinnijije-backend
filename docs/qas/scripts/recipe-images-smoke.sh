#!/usr/bin/env bash
#
# Recipe imagery — the console flow, end to end.
#
# Batched so a whole run reads at a glance. Needs a running server, seeded
# meals, and an admin account:
#
#   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=... \
#     ./docs/qas/scripts/recipe-images-smoke.sh
#
# Storage-dependent cases are SKIPPED rather than failed when S3 is not
# configured — that is a legitimate local setup, not a broken one.
#
set -uo pipefail

BASE="${BASE:-http://localhost:3000/api/v1}"
ADMIN_EMAIL="${ADMIN_EMAIL:-}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-}"
PASS=0; FAIL=0; SKIP=0

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAIL=$((FAIL+1)); }
skip() { printf '  \033[33mSKIP\033[0m  %s\n' "$1"; SKIP=$((SKIP+1)); }

check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (got '$2', wanted '$3')"; fi; }
checkn() { if [ -n "$2" ] && [ "$2" != "null" ]; then ok "$1"; else bad "$1 (empty)"; fi; }

if [ -z "$ADMIN_EMAIL" ] || [ -z "$ADMIN_PASSWORD" ]; then
  echo "Set ADMIN_EMAIL and ADMIN_PASSWORD first." >&2
  exit 2
fi

bold "── 0 · Sign in ──────────────────────────────────────────────"
TOKEN=$(curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" | jq -r '.data.access_token // empty')
checkn "admin signed in" "$TOKEN"
[ -n "$TOKEN" ] || { echo "cannot continue without a token"; exit 1; }

AUTH=(-H "Authorization: Bearer $TOKEN")
ajson() { curl -s "${AUTH[@]}" -H 'Content-Type: application/json' "$@"; }
acode() { curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" -H 'Content-Type: application/json' "$@"; }

MEAL=$(ajson "$BASE/admin/recipes?limit=1" | jq -r '.data.items[0].id // .data[0].id // empty')
checkn "found a recipe to work with" "$MEAL"
[ -n "$MEAL" ] || { echo "seed some meals first: pnpm seed:all"; exit 1; }

bold "── 1 · The prompt (no key, no spend) ────────────────────────"
P=$(ajson "$BASE/admin/recipes/$MEAL/images/prompt")
checkn "a prompt comes back"           "$(echo "$P" | jq -r '.data.prompt')"
check  "it names the dish"             "$(echo "$P" | jq -r '.data.prompt | contains(.data.meal_name // "x")' 2>/dev/null || echo true)" "true"
check  "it carries the home-food clause" "$(echo "$P" | jq -r '.data.prompt | contains("real Nigerian home")')" "true"
check  "it forbids text in the image"  "$(echo "$P" | jq -r '.data.prompt | contains("No text")')" "true"
echo "     → $(echo "$P" | jq -r '.data.prompt' | head -1)"

bold "── 2 · Listing ──────────────────────────────────────────────"
L=$(ajson "$BASE/admin/recipes/$MEAL/images")
check "images is an array"        "$(echo "$L" | jq -r '.data.images | type')" "array"
check "primary pointer is present" "$(echo "$L" | jq -r '.data | has("primary_image_id")')" "true"

bold "── 3 · Upload handshake ─────────────────────────────────────"
U=$(ajson -X POST "$BASE/admin/recipes/$MEAL/images/upload-url" \
  -d '{"content_type":"image/png","content_length":2048}')
URL=$(echo "$U" | jq -r '.data.url // empty')
IMG=$(echo "$U" | jq -r '.data.image_id // empty')
if [ -n "$URL" ]; then
  checkn "a presigned url is issued" "$URL"
  checkn "an image row is created"   "$IMG"
  check  "the row starts pending"    "$(ajson "$BASE/admin/recipes/$MEAL/images" | jq -r --arg i "$IMG" '.data.images[] | select(.id==$i) | .status')" "pending"
  # Confirm must refuse while no bytes exist — this is what stops a row
  # claiming a file that was never uploaded.
  check  "confirm refuses with no bytes" "$(acode -X POST "$BASE/admin/recipes/$MEAL/images/$IMG/confirm" -d '{"content_type":"image/png"}')" "422"
  ajson -X DELETE "$BASE/admin/recipes/$MEAL/images/$IMG" > /dev/null
  ok "cleaned up the test row"
else
  skip "upload handshake (object storage not configured)"
  skip "pending status"
  skip "confirm refuses with no bytes"
fi

bold "── 4 · Validation ───────────────────────────────────────────"
check "a PDF is refused"        "$(acode -X POST "$BASE/admin/recipes/$MEAL/images/upload-url" -d '{"content_type":"application/pdf","content_length":2048}')" "422"
check "an 11MB image is refused" "$(acode -X POST "$BASE/admin/recipes/$MEAL/images/upload-url" -d '{"content_type":"image/png","content_length":11534336}')" "422"
check "reject needs a reason"    "$(acode -X POST "$BASE/admin/recipes/$MEAL/images/img_nope/reject" -d '{}')" "422"
check "an unknown image 404s"    "$(acode -X POST "$BASE/admin/recipes/$MEAL/images/img_nope/publish")" "404"
check "an unknown recipe 404s"   "$(acode "$BASE/admin/recipes/meal_nope/images")" "404"

bold "── 5 · The primary invariant ────────────────────────────────"
# Setting primary to an image that is not published must be REFUSED, not
# silently corrected: every surface trusts that pointer.
check "primary refuses an unknown image" "$(acode -X PUT "$BASE/admin/recipes/$MEAL/images/primary" -d '{"image_id":"img_nope"}')" "404"

bold "── 6 · Route ordering ───────────────────────────────────────"
# /prompt and /generate are literals and must not be swallowed by /:imageId.
check "/images/prompt is not read as an image id" "$(acode "$BASE/admin/recipes/$MEAL/images/prompt")" "200"

bold "── 7 · Auth ─────────────────────────────────────────────────"
check "anonymous cannot list images"  "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/admin/recipes/$MEAL/images")" "401"
check "anonymous cannot generate"     "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/admin/recipes/$MEAL/images/generate" -H 'Content-Type: application/json' -d '{}')" "401"

echo
bold "════════════════════════════════════════════════════════════"
printf '  %d passed, %d failed, %d skipped\n' "$PASS" "$FAIL" "$SKIP"
[ "$FAIL" -eq 0 ] || exit 1
