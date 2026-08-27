# cookiepot / backend

Node + Express + TypeScript API. MongoDB for storage, Winston for logs, Resend
for email.

## Quick start

```bash
# MongoDB on 27017
mongod --dbpath ~/data/mongodb --logpath ~/data/mongolog/mongod.log --fork

cp .env.example .env
pnpm install
pnpm seed        # seven accounts, one per role and status
pnpm dev         # http://localhost:4000
```

`RESEND_API_KEY` can stay empty locally — the mailer logs the message instead of
sending it, so the whole auth flow works without a Resend account.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | tsx watch, hot reload |
| `pnpm build` | `tsc -b` then `tsc-alias` |
| `pnpm start` | run the built output |
| `pnpm typecheck` | `tsc -b --noEmit` |
| `pnpm lint` | eslint, every rule an error |
| `pnpm seed` | idempotent seed accounts |

`tsc-alias` is not optional. `tsc` type-checks the `paths` aliases but never
rewrites the emitted specifier, so without it the built output cannot resolve
`@lib/...` at runtime.

## Layout

```
src/
  app.ts                  buildApp() — middleware order is load-bearing, see comments
  server.ts               boot, production assertions, graceful shutdown
  env.ts                  zod-parsed once, fails loudly

  features/<name>/        the unit of work is a feature, not a layer
    *.routes.ts           register(app) — owns its own middleware order
    *.controller.ts       thin: call service, map result
    *.service.ts          business logic; returns ServiceResult<T>, never sees req
    *.repo.ts             data access only
    *.model.ts            mongoose schema
    *.schema.ts           zod request validation

  lib/                    response, errors, tokens, ids, pagination, db, logger,
                          mail, ratelimit
  shared/                 constants, middleware, messages, types
```

## The rules that matter here

- **Services never throw for a domain failure.** They return `ServiceResult<T>`.
  The controller converts a failure into a throw via `bail()`, so one middleware
  owns every error rendering.
- **Services never see `req`.** Request identity travels in `AsyncLocalStorage`.
- **Never `res.json()` in a handler.** Everything goes through `ResponseUtil`,
  which is also where whole-body concerns (bigint, undefined stripping) live.
- **Never an inline response string.** Copy resolves from the message registry.
- **Route order is load-bearing.** `/users/me` is registered before
  `/users/:userId`, or the literal path is swallowed. Comments say so at each
  spot; do not alphabetise the routers.
- **`authenticate` is attached per route, not via `router.use()`.** A
  router-level `use` runs for unmatched paths too, which turned unknown
  `/api/v1/*` routes into a 401 instead of a 404.
- **NodeNext resolution** — import specifiers spell `.js` even in `.ts` source.

Full API surface, permission matrix, and known gaps:
[`docs/qas/backend-qa-handoff.md`](docs/qas/backend-qa-handoff.md).
