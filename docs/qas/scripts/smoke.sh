#!/bin/bash
#
# End-to-end smoke test against a RUNNING server and a real MongoDB.
#
#   pnpm build && node dist/server.js &   # or: pnpm dev
#   pnpm seed
#   ./docs/qas/scripts/smoke.sh
#
# Rate limiting is real and in-memory: the login policy is 10/15m per IP and
# registration is 5/h. Running this repeatedly without restarting the server
# will exhaust those buckets and produce spurious 429s — restart the process
# (which resets the buckets) between full runs.
#
API=http://localhost:4000/api/v1
P=0; F=0
pick() { python3 -c "
import sys,json
d=json.load(sys.stdin)
for k in sys.argv[1].split('.'):
    d=d[k]
print(d)" "$1" 2>/dev/null; }
check() { # name expected actual
  if [ "$2" == "$3" ]; then echo "  PASS  $1"; P=$((P+1));
  else echo "  FAIL  $1 (expected $2, got $3)"; F=$((F+1)); fi
}
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
ecode() { curl -s "$@" | pick error.code; }

echo "── health ──"
check "health 200"        200 "$(code http://localhost:4000/health)"
check "ready 200"         200 "$(code http://localhost:4000/health/ready)"

echo "── auth ──"
EMAIL="e2e-$$-$(date +%s)@test.test"
RC=$(code -X POST $API/auth/register -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"Pass123!word\",\"name\":\"E2E\"}")
check "register 201 (or 429 if the 5/h limit is spent)" "yes" "$([ "$RC" == "201" ] || [ "$RC" == "429" ] && echo yes || echo no)"
DC=$(code -X POST $API/auth/register -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"Pass123!word\",\"name\":\"E2E\"}")
check "dup email 409 (or 429)" "yes" "$([ "$DC" == "409" ] || [ "$DC" == "429" ] && echo yes || echo no)"
check "weak pw 422"       422 "$(code -X POST $API/auth/register -H 'Content-Type: application/json' -d '{"email":"x@y.test","password":"weak","name":"X"}')"
check "bad json 400"      400 "$(code -X POST $API/auth/login -H 'Content-Type: application/json' -d '{oops')"
check "404 envelope"      404 "$(code $API/nothing-here)"

WRONGPW=$(ecode -X POST $API/auth/login -H 'Content-Type: application/json' -d '{"email":"root@test.test","password":"Nope12345"}')
LOGIN=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' -d '{"email":"root@test.test","password":"Pass123!word"}')
ROOT=$(echo "$LOGIN" | pick data.tokens.access_token)
RREF=$(echo "$LOGIN" | pick data.tokens.refresh_token)
check "login issues token" "yes" "$([ ${#ROOT} -gt 100 ] && echo yes || echo no)"
check "wrong pw code"     "invalid_credentials" "$WRONGPW"
check "banned login 403"  403 "$(code -X POST $API/auth/login -H 'Content-Type: application/json' -d '{"email":"banned@test.test","password":"Pass123!word"}')"

echo "── authn ──"
check "no token 401"      401 "$(code $API/users/me)"
check "bad token code"    "token_invalid" "$(ecode $API/users/me -H 'Authorization: Bearer garbage')"
check "me 200"            200 "$(code $API/users/me -H "Authorization: Bearer $ROOT")"

echo "── authz: role ──"
USER=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' -d '{"email":"active@test.test","password":"Pass123!word"}' | pick data.tokens.access_token)
MOD=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' -d '{"email":"mod@test.test","password":"Pass123!word"}' | pick data.tokens.access_token)
ADMIN=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@test.test","password":"Pass123!word"}' | pick data.tokens.access_token)
check "user->admin list 403"  403 "$(code $API/users -H "Authorization: Bearer $USER")"
check "admin->list 200"       200 "$(code $API/users -H "Authorization: Bearer $ADMIN")"
TID=$(curl -s "$API/users?status=active&limit=1" -H "Authorization: Bearer $ADMIN" | python3 -c "import sys,json;print(json.load(sys.stdin)['data'][0]['id'])" 2>/dev/null)
check "admin->role change 403" 403 "$(code -X PATCH $API/users/$TID/role -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"role":"admin"}')"
check "mod->status change 200"  200 "$(code -X PATCH $API/users/$TID/status -H "Authorization: Bearer $MOD" -H 'Content-Type: application/json' -d '{"status":"active"}')"

echo "── authz: status gate ──"
SUSP=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' -d '{"email":"suspended@test.test","password":"Pass123!word"}' | pick data.tokens.access_token)
check "suspended can read"     200 "$(code $API/users/me -H "Authorization: Bearer $SUSP")"
check "suspended cannot write" 403 "$(code -X PATCH $API/users/me -H "Authorization: Bearer $SUSP" -H 'Content-Type: application/json' -d '{"name":"No"}')"
check "suspended write code"   "account_suspended" "$(ecode -X PATCH $API/users/me -H "Authorization: Bearer $SUSP" -H 'Content-Type: application/json' -d '{"name":"No"}')"
PEND=$(curl -s -X POST $API/auth/register -H 'Content-Type: application/json' -d "{\"email\":\"pend-$$-$(date +%s)@test.test\",\"password\":\"Pass123!word\",\"name\":\"P\"}" | pick data.tokens.access_token)
check "pending cannot write"   403 "$(code -X PATCH $API/users/me -H "Authorization: Bearer $PEND" -H 'Content-Type: application/json' -d '{"name":"No"}')"

echo "── refresh rotation ──"
R1=$(curl -s -X POST $API/auth/refresh -H 'Content-Type: application/json' -d "{\"refresh_token\":\"$RREF\"}")
NEW=$(echo "$R1" | pick data.tokens.refresh_token)
check "rotates token"     "yes" "$([ "$RREF" != "$NEW" ] && [ ${#NEW} -gt 20 ] && echo yes || echo no)"
check "reuse detected"    "session_revoked" "$(ecode -X POST $API/auth/refresh -H 'Content-Type: application/json' -d "{\"refresh_token\":\"$RREF\"}")"
SL=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' -d '{"email":"pending@test.test","password":"Pass123!word"}')
SR=$(echo "$SL" | pick data.tokens.refresh_token)
SN=$(curl -s -X POST $API/auth/refresh -H 'Content-Type: application/json' -d "{\"refresh_token\":\"$SR\"}" | pick data.tokens.refresh_token)
curl -s -o /dev/null -X POST $API/auth/refresh -H 'Content-Type: application/json' -d "{\"refresh_token\":\"$SR\"}"
check "sibling session killed" "session_revoked" "$(ecode -X POST $API/auth/refresh -H 'Content-Type: application/json' -d "{\"refresh_token\":\"$SN\"}")"

echo "── pagination ──"
PG=$(curl -s "$API/users?limit=2" -H "Authorization: Bearer $ADMIN")
check "meta.has_more"  "True" "$(echo "$PG" | pick meta.has_more)"
CUR=$(echo "$PG" | pick meta.next_cursor)
check "cursor present" "yes" "$([ ${#CUR} -gt 10 ] && echo yes || echo no)"
A=$(echo "$PG" | python3 -c "import sys,json;print(','.join(u['id'] for u in json.load(sys.stdin)['data']))")
B=$(curl -s "$API/users?limit=2&cursor=$CUR" -H "Authorization: Bearer $ADMIN" | python3 -c "import sys,json;print(','.join(u['id'] for u in json.load(sys.stdin)['data']))")
check "pages disjoint" "yes" "$([ "$A" != "$B" ] && echo yes || echo no)"
check "bad cursor tolerated" 200 "$(code "$API/users?cursor=@@garbage@@" -H "Authorization: Bearer $ADMIN")"

echo "── logout ──"
L=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@test.test","password":"Pass123!word"}')
LR=$(echo "$L" | pick data.tokens.refresh_token)
check "logout 204"        204 "$(code -X POST $API/auth/logout -H 'Content-Type: application/json' -d "{\"refresh_token\":\"$LR\"}")"
check "logout idempotent" 204 "$(code -X POST $API/auth/logout -H 'Content-Type: application/json' -d "{\"refresh_token\":\"$LR\"}")"
check "refresh after logout" "token_invalid" "$(ecode -X POST $API/auth/refresh -H 'Content-Type: application/json' -d "{\"refresh_token\":\"$LR\"}")"

echo
echo "════ $P passed, $F failed ════"
[ $F -eq 0 ] || exit 1
