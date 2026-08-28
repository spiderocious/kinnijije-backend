# Going live

Everything below assumes the code is deployed and the env is set. It is the
list of things that are NOT code — the steps that make recipes, suggestions and
email actually work on a fresh database.

## 1. The database has to be seeded

**This is the one that silently breaks everything.** Suggestions are a matcher
running against seeded meals. With an empty `meals` collection the app works
perfectly and suggests nothing, forever — no error, no empty state that explains
itself, just a kitchen that never has anything to cook.

```
pnpm seed:meals     # 24 Nigerian recipes, upserted on slug — safe to re-run
```

The ingredient catalogue (417 items) is compiled INTO the code, not seeded, so
typeahead and matching work the moment the process starts.

Check it landed: `/admin` → the dashboard should read **24 published, 24 seed**.

## 1a. Seeding into production

The seed script is a normal Node program — it reads `MONGODB_URI` and writes.
It is not dev-only:

```
MONGODB_URI='mongodb+srv://…prod…' pnpm seed:meals
```

Run it from the host's shell if there is one, so the production URI never sits
in a local terminal. It upserts on `slug`, so re-running is safe.

If you would rather move data by hand, the collection is **`meals`** and the
format is JSON, not CSV — `ingredients[]` and `steps[]` are arrays of objects,
which CSV cannot carry. `mongodump`/`mongorestore`, or:

```
mongoexport --uri=… --collection=meals --out=meals.json
mongoimport --uri=… --collection=meals --file=meals.json --upsertFields=slug
```

Two fields matter more than the rest, and a hand-built import must set both:

- **`ingredientKeys`** — the denormalised catalogue ids the matcher reads. Empty
  or wrong means the recipe is never suggested, silently.
- **`status: "published"`** — a draft is invisible to suggestions.

`/admin/recipes/new` is the third option: paste one recipe or an array, and it
resolves the ingredients for you and reports what it could not match.

## 2. Environment

| Variable | Why it matters if wrong |
|---|---|
| `MONGODB_URI` | Nothing starts. |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | **Must be new, long and random per environment.** Reusing the dev secrets means a dev token signs into production. |
| `APP_URL` | Every link in every email. Wrong here and password resets are dead links. |
| `MAIL_FROM` | Must be on a domain verified in Resend, or nothing sends. |
| `RESEND_API_KEY` | Absent means email is `suppressed`, not failed — visible at `/admin/emails`. Production asserts it at boot. |
| `OPENAI_API_KEY` + `AI_PROVIDER` | Absent or `mock` means canned answers. The boot log says **AI IS RUNNING ON CANNED ANSWERS** loudly — read it. |
| `CORS_ORIGINS` | The web app cannot call the API. |

## 3. Email deliverability is DNS, not code

The templates carry `List-Unsubscribe` and a real `Reply-To`, but that only
helps once the domain is verified. In Resend, confirm **SPF, DKIM and DMARC**
are all green for the sending domain. Without DKIM especially, welcome emails
land in spam whatever the copy says.

Send yourself one before launch: `pnpm email:samples` sends every template to
the addresses listed in that script.

## 4. Create the first administrator

`/admin/setup` — once. It generates a password, shows it ONCE, and closes
itself permanently. Copy it before leaving the page; nothing is emailed and only
a hash is stored.

If it is ever lost, the recovery is deleting the admin rows in the database,
which reopens setup. That is deliberate: there is no unauthenticated way to mint
a second administrator.

## 5. Check the scheduled work planted itself

The daily and weekly email sweeps live in the job queue and re-queue their own
successor. At boot, `scheduleDailySweep()` plants the first.

`/admin/jobs`, filtered to **queued** — there should be exactly one
`notify-daily` and one `notify-weekly`. If there are none, the sweeps will never
run; if there are several, something is enqueuing them in a loop.

## 6. Know what is off by default

- **Every notification preference is off.** Nobody opted into being messaged, so
  the daily rundown and weekly summary send to nobody until people turn them on
  in Settings. That is correct, but it means "the email system is broken" and
  "nobody has subscribed" look identical on day one.
- **Every feature flag is on.** `/admin/settings` — the tour and both upload
  paths. Nothing to do unless you want something off.

## 7. Smoke test, in this order

1. Register → welcome email arrives, and is not in spam
2. Onboarding → four steps, lands on the kitchen
3. Add stock by typing → it appears
4. Suggestions → **real meals**, which proves step 1 of this document
5. Photograph a shelf → it reads, and `/admin/ai` logs the call
6. Ask the assistant something → answer cites your actual kitchen
7. Forgot password → link arrives, works once, signs you out everywhere
8. `/admin` → every screen loads, dashboard numbers are non-zero

## What is NOT ready

- **No email verification.** Accounts sit `pending` forever. Nothing important
  gates on it, but "verify your email" does not exist.
- **No outbox.** A failed send is recorded and left; an operator resends by hand
  from `/admin/emails`. Fine at low volume, worth revisiting if failures are
  routine.
- **The job queue is in-process.** Run more than one instance and each runs its
  own worker — the atomic claim stops double-processing, but the scheduled
  sweeps would be planted by whichever booted first. Single instance for now.
