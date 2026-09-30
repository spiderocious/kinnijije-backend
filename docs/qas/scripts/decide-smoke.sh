#!/usr/bin/env bash
#
# Decide First — the public, unauthenticated flow, end to end.
#
# Batched on purpose: every case prints PASS/FAIL on one line so a whole run is
# readable at a glance, and the interesting bodies are echoed underneath. Needs
# a server already running and meals already seeded:
#
#   pnpm seed:all && pnpm dev          # in another terminal
#   BASE=http://localhost:4000/api/v1 ./docs/qas/scripts/decide-smoke.sh
#
# ORDER IS LOAD-BEARING: DECIDE_ANON allows 8 an hour per IP, so the validation
# cases run FIRST, while the bucket still has room. Running them after the
# happy path meant they all came back 429 and the suite reported four failures
# that were entirely its own fault.
#
# A refused request still costs a token, so a full run needs a fresh bucket:
# restart the server (the limiter is in process memory) between runs.
#
set -uo pipefail

BASE="${BASE:-http://localhost:4000/api/v1}"
PASS=0; FAIL=0

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; FAIL=$((FAIL+1)); }

# check <name> <actual> <expected>
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (got '$2', wanted '$3')"; fi; }
# checkn <name> <actual> — passes when non-empty and not "null"
checkn() { if [ -n "$2" ] && [ "$2" != "null" ]; then ok "$1"; else bad "$1 (empty)"; fi; }

post() { curl -s -X POST "$BASE/decide" -H 'Content-Type: application/json' -d "$1"; }
code() { curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/decide" -H 'Content-Type: application/json' -d "$1"; }

bold "── 1 · Options ──────────────────────────────────────────────"
OPT=$(curl -s "$BASE/decide/options")
check "200 and kitchen groups present" "$(echo "$OPT" | jq -r '.data.kitchen | length > 0')" "true"
check "moods are the four we expect"   "$(echo "$OPT" | jq -r '.data.moods | length')" "4"
check "weights are the six we expect"  "$(echo "$OPT" | jq -r '.data.weights | length')" "6"
check "three time budgets"             "$(echo "$OPT" | jq -r '.data.minutes | length')" "3"
check "every kitchen tile has an icon" "$(echo "$OPT" | jq -r '[.data.kitchen[].items[] | select(.icon == null)] | length')" "0"
check "cacheable"                      "$(curl -s -D- -o /dev/null "$BASE/decide/options" | grep -ci 'cache-control')" "1"

bold "── 2 · Validation (first: the bucket is only 8 an hour) ───────────────────────────────────────────"
check "mood is required"            "$(code '{"weight":"rice"}')" "422"
check "weight is required"          "$(code '{"mood":"fast"}')" "422"
check "an unknown mood is refused"  "$(code '{"mood":"peckish","weight":"rice"}')" "422"
check "an odd time budget refused"  "$(code '{"mood":"fast","weight":"rice","minutes":37}')" "422"
check "41 kitchen items refused"    "$(code "{\"mood\":\"fast\",\"weight\":\"rice\",\"kitchen_items\":[$(printf '"x",%.0s' $(seq 1 40))\"x\"]}")" "422"
check "minutes defaults when absent" "$(post '{"mood":"proper","weight":"rice"}' | jq -r '.data.verdict != null')" "true"

bold "── 3 · A full decision ──────────────────────────────────────"
FULL='{"kitchen_items":["rice","tomato","onion","palm oil"],"mood":"fast","weight":"rice","minutes":40,"city":"Lagos"}'
R=$(post "$FULL")
checkn "a meal is named"            "$(echo "$R" | jq -r '.data.verdict.name')"
checkn "it carries a why"           "$(echo "$R" | jq -r '.data.verdict.why')"
check  "provenance is declared"     "$(echo "$R" | jq -r '.data.verdict != null and (.data.provenance == "ai_framed" or .data.provenance == "deterministic")')" "true"
check  "cook time is within budget" "$(echo "$R" | jq -r '.data.verdict.cook_time_minutes <= 40')" "true"
check  "match has have/missing"     "$(echo "$R" | jq -r '.data.verdict.match | has("have") and has("missing")')" "true"
check  "alternates capped at two"   "$(echo "$R" | jq -r '.data.alternates | length <= 2')" "true"
check  "pool is sent for free re-ranks" "$(echo "$R" | jq -r '.data.pool != null')" "true"
check  "no recipe steps leak"       "$(echo "$R" | jq -r '.data.verdict | has("steps")')" "false"
echo "     → $(echo "$R" | jq -rc '{name:.data.verdict.name, why:.data.verdict.why, provenance:.data.provenance}')"

bold "── 4 · Rejections are honoured ──────────────────────────────"
FIRST=$(post '{"kitchen_items":["rice"],"mood":"proper","weight":"rice"}' | jq -r '.data.verdict.meal_id')
R=$(post "{\"kitchen_items\":[\"rice\"],\"mood\":\"proper\",\"weight\":\"rice\",\"rejected\":[\"$FIRST\"]}")
SECOND=$(echo "$R" | jq -r '.data.verdict.meal_id')
if [ "$FIRST" != "$SECOND" ]; then ok "a refused meal is not offered again"; else bad "refused meal came back ($FIRST)"; fi

bold "── 5 · Empty kitchen still decides ──────────────────────────"
R=$(post '{"kitchen_items":[],"kitchen_skipped":true,"mood":"tired","weight":"soupy"}')
checkn "still names a meal" "$(echo "$R" | jq -r '.data.verdict.name')"
# A mood shortens the budget but must never collapse it: clamping `fast` to a
# flat 25 left ONE meal in the catalogue and produced a noodle stir-fry for
# somebody who asked for something solid. The ceiling is asserted as "inside
# what they asked for", not as a fixed number.
check  "tired stays within the chosen budget" "$(echo "$R" | jq -r '.data.verdict.cook_time_minutes <= 40')" "true"

bold "── 6 · Rate limiting (DECIDE_ANON = 8/hour, by IP) ──────────"
echo "     spending the bucket…"
LAST=""
for i in $(seq 1 12); do LAST=$(code '{"mood":"proper","weight":"solid"}'); done
check "the bucket eventually refuses" "$LAST" "429"
H=$(curl -s -D- -o /dev/null -X POST "$BASE/decide" -H 'Content-Type: application/json' -d '{"mood":"proper","weight":"solid"}')
check "Retry-After is sent"        "$(echo "$H" | grep -ci '^retry-after')" "1"
check "X-RateLimit-Remaining sent" "$(echo "$H" | grep -ci '^x-ratelimit-remaining')" "1"
RA=$(echo "$H" | grep -i '^retry-after' | tr -d '\r' | awk '{print $2}')
if [ -n "$RA" ] && [ "$RA" -gt 0 ] 2>/dev/null; then ok "Retry-After is a real wait (${RA}s)"; else bad "Retry-After not a positive number"; fi
check "options stays usable while decide is limited" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/decide/options")" "200"

echo
bold "════════════════════════════════════════════════════════════"
printf '  %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
