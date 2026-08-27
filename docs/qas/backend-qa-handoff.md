# Backend QA Handoff — Foundation (auth, users, roles, statuses, rate limiting)

**Date:** 2026-08-27
**Build:** Typecheck ✅ · Lint ✅ · Build ✅ · Smoke 31/31 ✅
**Base URL:** `http://localhost:4000/api/v1`
**Auth header:** `Authorization: Bearer <access_token>`

---

## Running it

```bash
# MongoDB must be listening on 27017.
mongod --dbpath ~/data/mongodb --logpath ~/data/mongolog/mongod.log --fork

cd backend
cp .env.example .env
pnpm install
pnpm seed          # seven accounts, one per role/status
pnpm dev           # or: pnpm build && pnpm start
./docs/qas/scripts/smoke.sh
```

No Resend key is needed locally. With `RESEND_API_KEY` empty the mailer logs the
message instead of sending it, so the full auth flow runs without an account and
without a stray real email.

---

## Seed Users

All use password `Pass123!word`.

| Email | Role | Status |
|---|---|---|
| root@test.test | super_admin | active |
| admin@test.test | admin | active |
| mod@test.test | moderator | active |
| active@test.test | user | active |
| pending@test.test | user | pending |
| suspended@test.test | user | suspended |
| banned@test.test | user | banned |

---

## Endpoints

| Method | Path | Auth | Role | Status gate | Rate limit |
|---|---|---|---|---|---|
| GET | `/health` | — | — | — | global |
| GET | `/health/ready` | — | — | — | global |
| POST | `/auth/register` | — | — | — | 5/h per IP |
| POST | `/auth/login` | — | — | — | 10/15m per IP **and** per email |
| POST | `/auth/refresh` | — | — | — | 60/15m per IP |
| POST | `/auth/logout` | — | — | — | 30/m per IP |
| POST | `/auth/change-password` | ✅ | any | active, pending | 5/h |
| GET | `/users/me` | ✅ | any | active, pending, suspended | 120/m |
| PATCH | `/users/me` | ✅ | any | **active only** | 30/m |
| GET | `/users` | ✅ | admin+ | active | 200/m |
| GET | `/users/:userId` | ✅ | admin+ | active | 200/m |
| PATCH | `/users/:userId/status` | ✅ | moderator+ | active | 200/m |
| PATCH | `/users/:userId/role` | ✅ | **super_admin** | active | 200/m |

A global 300/m per-IP limit sits in front of everything as a backstop.

---

## The two permission axes

Role and status gate **independently**, and that is the point: a suspended admin
is still an admin and must still be refused.

- **Role** — `requireRole(ADMIN)` means "admin or above", by rank, so adding a
  role above admin does not require revisiting every route.
- **Status** — defaults to active-only. A route a `pending` user may still reach
  opts in explicitly, which makes every exception visible at the route.

| Status | Can hold a session | Can read own profile | Can write |
|---|---|---|---|
| pending | yes | yes | no — `account_pending_verification` |
| active | yes | yes | yes |
| suspended | yes | yes | no — `account_suspended` |
| banned | **no** — refused at login | — | — |
| deleted | **no** — refused at login | — | — |

Status transitions are validated against a map in `shared/constants/roles.ts`.
An illegal move (e.g. `deleted → suspended`) is a 422, not a silent write.
Moving a user out of a session-eligible status revokes their sessions on the
spot rather than waiting for the access token to expire.

---

## Error envelope

```json
{
  "error": {
    "code": "account_suspended",
    "message": "Your account is suspended, so that action is unavailable.",
    "severity": 40,
    "field_errors": { "email": ["Enter a valid email address"] },
    "rejection_reason": "status_suspended_blocked"
  }
}
```

- **`code`** — branch on this, and only this. It is the contract.
- **`message`** — display verbatim. Resolved from a registry; free to change.
- **`severity`** — dashboards only. Clients ignore it.
- **`field_errors`** — validation failures only. **All** invalid fields, not the first.
- **`rejection_reason`** — operator diagnostic. **Not contract**; never branch on it.

Severity bands: 10 body-validation · 20 suspicious-validation · 30 auth ·
40 forbidden · 50 not-found · 60 conflict · 70 business-rule · 80 rate-limited ·
90 upstream · 100 server-fault.

`insufficient_role` is band 20 rather than 40 deliberately — a client asking for
an endpoint its role cannot reach is a client bug or probing, not a user typo.

---

## Sessions

Access JWT (15 min) + opaque refresh token (30 days), rotated on every use.

- The refresh token is stored **hashed** (SHA-256). A database dump yields no
  usable sessions.
- **Reuse detection:** presenting a token that was already rotated away means
  two parties hold it. Every session for that user is revoked.
- A logout, password change, or ban revokes with a *reason*, so an ordinary
  sign-out is **not** treated as theft — otherwise signing out on one device
  would sign the user out everywhere and page someone.

| What happened | `code` on next refresh |
|---|---|
| token rotated away, then replayed | `session_revoked` |
| sibling session killed by that incident | `session_revoked` |
| logged out normally | `token_invalid` |
| password changed | `token_invalid` |
| account banned mid-session | `account_banned` |

---

## Rate limiting

Token bucket, not fixed window — a fixed window allows a double-rate burst
across the boundary. Every response carries `X-RateLimit-Limit`,
`X-RateLimit-Remaining` and `X-RateLimit-Reset`; a 429 also carries a real
`Retry-After` in seconds.

Login is limited **twice**: by IP and by email. IP rotation alone should not buy
unlimited guesses against one account. The two limiters carry distinct scopes —
without that they compute the same key and drain one bucket at twice the rate.

Separately, 5 consecutive failed logins lock the account for 15 minutes. That
counter lives on the user document, not in the limiter, so it survives a restart.

**Storage is in-memory**, behind a `RateLimitStore` interface. Counters are
per-process, so with more than one instance each enforces the limit separately.
Swapping in Redis is one new file implementing that interface plus one line in
`lib/ratelimit/index.ts`; no callsite changes.

---

## Logging

Winston. Every line carries the request id from `AsyncLocalStorage`, so a
client-reported failure is findable by that id alone. Request and response
bodies are both logged, capped at 2 000 characters.

Redaction is on the logger, not the callsites. Verified: zero occurrences of any
plaintext password or hash across a full smoke run.

```
→ request  {"method":"POST","path":"/api/v1/auth/login",
            "body":{"email":"ad***@test.test","password":"[REDACTED]"}}
← response {"status":200,"duration_ms":49.13,
            "body":{"data":{"tokens":{"access_token":"[REDACTED]"}}}}
```

Response bodies are logged in full in development, and on errors only in
production, where a successful body is bulk with little diagnostic value.

---

## Known gaps / not built

These are deliberate omissions, not oversights:

- [ ] **Email verification** — accounts are created `pending` and the gate works,
      but there is no verify-token endpoint yet. Promote via
      `PATCH /users/:id/status` for now.
- [ ] **Forgot-password flow** — change-password (authenticated) exists; the
      OTP-based reset does not.
- [ ] **Idempotency keys** — the conventions call for `Idempotency-Key` on
      mutating POSTs. Nothing here moves money, so it was not built; it becomes
      necessary the moment something does.
- [ ] **Automated tests** — none. Verification is the live-server smoke script
      at `docs/qas/scripts/smoke.sh` (31 assertions). No unit/integration tier
      exists; standing one up is its own task.
- [ ] **Transactional outbox** — email is dispatched best-effort and not
      awaited, so a send that fails after a committed write is logged and
      dropped. Durable delivery needs an outbox and a worker.
- [ ] **Redis** — see rate limiting above.
