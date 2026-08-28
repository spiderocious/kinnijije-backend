# Testing guide

**Date:** 2026-08-27
**State:** Backend 60 endpoints · 13 features · Web 15 screens
**Build:** Backend typecheck ✅ lint ✅ build ✅ · Web typecheck ✅ build ✅
**Tested by me:** nothing. That is your column.

---

## Start it up

```bash
# 1. MongoDB
mongod --dbpath ~/data/mongodb --logpath ~/data/mongolog/mongod.log --fork

# 2. Backend — seeds 7 accounts AND 24 Nigerian recipes
cd backend
cp .env.example .env          # only if you have not already
pnpm install
pnpm seed:all
pnpm dev                      # :4000

# 3. Web
cd ../web
pnpm install
pnpm dev                      # :5173
```

**Accounts** (all `Pass123!word`): `root@` super_admin · `admin@` admin ·
`mod@` moderator · `active@` user/active · `pending@` user/pending ·
`suspended@` · `banned@` — all `@test.test`.

**AI:** with `OPENAI_API_KEY` set it calls the real thing. Empty, and it serves
canned answers from `src/lib/ai/mock-data/` — deterministic, instant, free.
Set `AI_PROVIDER=mock` to force canned even with a key.

**Postman:** `docs/api/api-doc-complete.json` — all 60 endpoints.

---

## The happy path, once

1. `/` → **Get started** → register a new account
2. Onboarding: 3 slides → pick cuisines → type 3–4 ingredients → **Open my kitchen**
3. Kitchen dashboard → **What should I cook?**
4. Open a meal → **Start cooking** → step through → **Done — I cooked this**
5. Check `/stock` — the ingredients should have gone down
6. `/market` → add something → tick it bought → check `/stock` again — it should be there

If all six work, the core loop is intact.

---

# Now try to break it

Each section is something I deliberately built a defence for. If the defence
holds, say so; if it does not, that is a real bug.

## 1 · Stock merging and units

**The defence:** adding the same thing twice MERGES rather than making two rows.

| Try | Should happen | Why it would break |
|---|---|---|
| Add "Rice" 2 congo, then "rice" 1 congo | ONE row, 3 congo | Case-insensitive unique index. If you get two rows the collation is wrong |
| Add rice in `congo`, then the same rice in `kg` | One row, converted (3 congo = 1 kg) | Unit conversion on merge |
| Add rice in `bag` when the row is in `kg` | Merges but does NOT invent a weight | A "bag" has no fixed size — a converted number here would be a lie |
| Add the same item from two browser tabs at once | Still one row | The unique index catches the race the read-then-write would lose |
| Set a quantity to 0 | Row stays, shows as out | 0 is "I have none", not "delete this" |
| Cook a meal needing 3kg rice when you have 1kg | Goes to 0, never negative | Clamped — they had more than they told us |

**Force it:** add 50 ingredients, then cook three meals that share them. Check
`/stock/history` — every single change should have a source (`manual`, `cooked`,
`market`, `correction`). A movement with no source means something wrote to
stock behind the service's back.

## 2 · Market → stock, the double-count trap

**The defence:** `movedToStockAt` means ticking moves stock exactly once.

| Try | Should happen |
|---|---|
| Tick bought → un-tick → tick again | Stock goes up ONCE, not twice or three times |
| Tick bought, then delete the item | Stock keeps what was added — they did buy it |
| Un-tick something bought | It does NOT come out of stock |
| Add "Palm oil" twice to the list | Quantity bumps; one row |
| Re-add something already ticked | Comes back onto the list, un-ticked |

**Force it:** tick five things rapidly, then reload `/stock`. Counts must match
exactly what you ticked. Any doubling is the guard failing.

## 3 · The suggestion matcher

**The defence:** deterministic — same stock, same answer, every time.

| Try | Should happen |
|---|---|
| Empty kitchen → `/suggestions` | Meals still return, all showing everything missing |
| Add rice, tomatoes, onions, pepper, oil, stock cubes | Jollof should climb near the top |
| Add ONE ingredient | Low scores, but no crash and no empty screen |
| Set cuisines to Asian + Mediterranean only in settings | **Nigerian meals must vanish** — the cuisine filter is hard |
| Set difficulty to "Keep it easy" | Only easy meals |
| Add an ingredient with a Yoruba name (`atarodo`, `ugwu`, `epa`) | Matches the same catalogue item as the English name |
| Refresh `/suggestions` repeatedly | Identical order — nothing random |

**Force it:** put exactly the ingredients for one meal in, minus one. That meal
should show `nearly_there` and name the single missing thing.

## 4 · Jobs, cancellation and retry

**The defence:** cooperative cancel, lease-based reclaim, retry resets attempts.

| Try | Should happen |
|---|---|
| Start a photo read, cancel while queued | Cancels immediately |
| Start one, cancel while running | Flags it; stops at the next checkpoint, not mid-call |
| Retry a cancelled job | Runs again from scratch |
| Retry a SUCCEEDED job | **Refused** — 409, re-running would duplicate its effect |
| Cancel a finished job | **Refused** — 409, nothing to cancel |
| Kill the backend mid-job, restart it | The job is reclaimed and re-run, not stranded as "running" |
| Ask for another user's job by id | 404 — never their data |

**Force it:** queue five reads at once. Only three should run (concurrency cap);
the rest queue and drain. Watch `GET /jobs`.

## 5 · AI validation — the important one

**The defence:** a reply that does not fit its schema is REJECTED, not patched.

| Try | Should happen |
|---|---|
| Delete `src/lib/ai/mock-data/chat.answer.json`, restart, ask a question | Clean error message, no crash, no half-rendered reply |
| Corrupt that file (`{"nonsense": true}`), ask again | Same — rejected at the zod boundary |
| Check `db.ai_logs.find()` after either | A row with `parsed: false` and a `parseError` |
| Ask chat something unrelated ("write me some code") | `kind: refusal` — it is a cooking assistant |
| Ask "what can I cook" with an empty kitchen | Honest answer, no invented ingredients |

**Force it:** in chat, ask for a dish you know is not seeded (e.g. "sushi").
The reply's meal must come back with `is_ours: false` and **no Start cooking
button**. If it offers to cook something with no recipe, the id verification is
broken.

**Check the logs:** `db.ai_logs.findOne()` should carry the full prompt, model,
provider, tokens, and a `metrics` object with `outputConfidence`, `clarity`,
`ambiguity` and `tuneSuggestion`. None of that should ever appear in a response.

## 6 · Photo extraction

| Try | Should happen |
|---|---|
| Upload a selfie | Verdict `not_food`, marked unusable, told why |
| Upload a screenshot | `not_food` |
| Upload a photo of a cooked plate | `food_but_not_useful` — food, but nothing to inventory |
| Upload a very dark photo | `unreadable`, with an actionable reason |
| Upload 6 photos | Sixth refused — five is the cap |
| Upload a 20MB file | Refused at 15MB |
| Upload a `.pdf` renamed to `.jpg` | Refused on content type |
| Start a read, close the tab, reopen | The job carried on; poll it and the result is there |

**Force it:** upload one good shelf photo and one selfie together. The good one
should still be read; the bad one flagged. A single bad photo must not sink the
batch.

## 7 · Auth and permissions

| Try | Should happen |
|---|---|
| `suspended@` signs in | Can sign in, can READ, **every write 403s** |
| `banned@` signs in | Refused at login entirely |
| A brand-new (pending) account | Can onboard, can add stock, **cannot cook** |
| Sign in on two tabs, sign out of one | Other tab keeps working until its token expires |
| Take a refresh token, use it, then use it AGAIN | `session_revoked` — reuse detection kills every session |
| Sign out normally, then try the old refresh token | `token_invalid`, NOT `session_revoked` — a logout is not theft |
| Hit login 11 times wrong | 11th is 429 with a real `Retry-After` |
| 5 wrong passwords on ONE account | Locked 15 min — the correct password is refused too |
| `active@` opens `/users` | 403 `insufficient_role` |
| `admin@` tries to change a role | 403 — only super_admin |
| `root@` tries to change their OWN role | 403 — self-demotion locks you out |

**Force it:** open the app in two tabs signed in as the same person, and let
several queries 401 at once. There must be exactly ONE refresh — five concurrent
refreshes would trip reuse detection and sign you out. This is the single
nastiest bug class in the whole app, and there is a shared in-flight promise
guarding it.

## 8 · Route ordering

Every one of these is a literal that sits before a parameterised route. If any
returns 404, the ordering broke:

`/stock/dashboard` · `/stock/suggest` · `/stock/history` · `/stock/units` ·
`/meals/suggest` · `/meals/favourites` · `/market/bought` · `/users/me` ·
`/onboarding/complete` · `/jobs/:id/stream` · `/jobs/:id/cancel`

## 9 · The week

| Try | Should happen |
|---|---|
| Fresh account, open `/week` | "Too early" — under 4 meals it says nothing |
| Cook 4+ meals, open `/week` | Numbers appear; tap Refresh for the AI reading |
| Tap Refresh twice in a row | Second says nothing changed — no second model call |
| Cook another meal, tap Refresh | Recomputes — the fingerprint changed |
| Check every observation | **Each must carry evidence.** One without is a guess |

## 10 · Edge cases I specifically handled

Worth confirming, since each is a real defence:

- **Empty everything** — every screen has a real empty state; the market's is
  the *good* outcome and deliberately has no CTA
- **A meal with an ingredient not in the catalogue** — still matches by name
- **A custom ingredient** ("ponmo from my aunt") — gets a group icon, not a blank
- **Very long names** — capped at 80 chars, truncated in the UI, no overflow
- **Quantity 0.5** — steppers floor at 0.5, never zero or negative
- **A recipe with only optional ingredients missing** — still fully makeable
- **Deleting your account** — stock, market, chat, history, favourites all go
- **Offline mid-upload** — the file row stays `pending` and shows in the gallery
- **Presigned URL expiry** — re-open a file after an hour; the URL is re-signed

---

## 11 · The assistant acting on your kitchen (tool calling)

The assistant does not *propose* — it **does**, then reports. By the time a reply
appears on screen the work has already run and the model has been shown its own
results. There is no "Yes, do it" button any more, by design.

Try to break the authorisation boundary first, because that is the part that matters:

- Ask it to *"add rice to Feranmi's kitchen"*, or any name but your own. It has no way
  to name another person — `ownerId` is passed in from your session and is never read
  from model output. It should add to **your** kitchen or refuse.
- Ask it to add something that does not exist: *"add 3 congo of unobtainium"*. Expect a
  receipt saying it did not happen, with a reason — not a cheerful "added!".
- Ask for many things at once: *"add rice, beans, garri, palm oil, maggi, salt, pepper,
  onion, tomato and fish"*. The batch is capped at 6 calls. Watch what it says about the
  ones it did not do.
- Ask for a half-possible batch: *"add rice and add 5 kg of xyzzy"*. One should land, one
  should fail, and the receipt should name **which** — that is the `partial` list.
- Ask it to remove something you do not have. Expect a stated failure, not silence.
- After any of these, open the stock and market screens. **What the receipts claim must
  match what is really there.** A receipt saying "added" over an unchanged kitchen is the
  worst possible bug here, and the round-trip exists to prevent it.
- Turn the network off mid-request. The actions may already have run; the second model
  pass is what fails. You should still get a plain summary of what happened rather than
  a lost outcome.

Check the logs too: `ai provider selected` prints at boot. If it says `mock`, nothing is
reaching a model and every answer is canned — the log line says so loudly on purpose.

## 12 · The product tour

It runs once per device, on first arrival at the kitchen. To force it open again,
visit **`/kitchen?tour=true`** — that ignores the seen-check entirely and always
runs. (`?tour=1` works too.) Clearing `localStorage.removeItem('kj.tour_seen')`
still works if you want to test the genuine first-run path.

The flag is stripped from the URL when the tour ends, so returning to the kitchen
afterwards does not relaunch it — but visiting the flagged URL again always does.

It WALKS between screens — kitchen, market, the add-stock flow — so the things to
break are navigation and measurement:

- Press **Back** through every step. It should walk backwards through the screens,
  not just the cards.
- Press **Skip** on each step in turn, reset the key, and check each one dismisses.
  Escape should do the same.
- Click the dimmed area. That skips too.
- Resize the window mid-tour, and scroll while a step is open. The ring should stay
  on its target — it re-measures on both.
- Do it on a narrow phone viewport AND a wide desktop one. The sidebar step has no
  target on a phone and the tab bar has none on desktop; whichever is missing should
  fall back to a centred card rather than pointing at nothing.
- Watch the spoon. A card BELOW its target points up; a card above it points down.
  The bottom tab bar should always get a card above it, pointing down.
- Let the tour reach the add-stock steps, then hit browser Back. The flow's own
  guards are still active — `?step=confirm` with no drafts bounces to entry.
- Start the tour, then navigate away by hand mid-step. It follows its own script,
  so expect it to pull you back to the next step's screen.

## 13 · Polling and rate limits

Every client interval now lives in `web/src/shared/constants/polling.ts`. Watching a
job backs off — 800ms for the first 5s, 2s to 15s, 4s to 45s, 8s after — so a fast
read still feels fast while a slow one stops hammering.

- Read a photo and watch the network tab. Requests to `/jobs/:id` should visibly
  space out the longer it runs, not tick at a fixed rate.
- Upload five photos at once. Each check polls on the same backoff; previously this
  was five concurrent pollers at a fixed 900ms, which was the app's heaviest
  request source.
- Leave a read running past two minutes (or stop the worker). It should give up with
  "That read did not finish" rather than polling forever.
- Send more than five chat messages in an hour. This used to hit a limit meant for
  password-reset emails; the AI policy now allows 60/hour.

Limits were tripled where polling or ordinary use touches them, and deliberately
NOT raised for login, registration, or password reset — nothing polls those, and
tightness is the whole point there.

## 14 · Packaged goods

A jar of Bournvita used to come back `not_food` — "This is a packaged product, not
raw ingredients". That was the gatekeeper prompt refusing exactly the things a real
kitchen holds. Photograph these on their own and every one should pass:

- Bournvita, Milo, Ovaltine, a tin of Peak or Dano
- Indomie, a carton of juice, a bottle of water, a pack of Lipton
- Sardines, Geisha, Blue Band, Golden Morn

What should STILL be refused, and why:

- A plated, cooked meal → `food_but_not_useful`. There is food, but no stock to read.
- A building, a screenshot, a person → `not_food`.
- A blurred or dark shelf → `unreadable`.

The prompt now splits its tie-breaking: on QUALITY questions (blurred? dark?) it
still chooses the less usable verdict, but on CONTENT questions (is this the kind
of thing a kitchen holds?) it chooses the more usable one — refusing somebody's
real groceries is worse than passing a doubtful photo, because they cannot argue
with it.

Brand names survive extraction where the brand IS the everyday word — a cook asks
for Bournvita, not "malted chocolate beverage powder". Where the brand is just a
maker of a generic thing, it is dropped ("tomato paste", not "Gino").

## 15 · The schema that was eating good answers

A photo of yam came back "we could not read those photos". The AI log said why:

    ingredients.from_photo | notes: Required
    { "items": [ { "name": "isu", ... } ], "metrics": { ... } }

The model read it perfectly — `isu`, yam in Yoruba, exactly as the prompt teaches.
It was thrown away because it had no `notes` key, and `notes` was required even
though every field inside it is optional and the prompt says to omit what you have
nothing to say about. Same for a Bournvita jar read as "Bournvita".

Chat failed the same way for a different reason: the model nested its whole answer
under `"meal_list"` — its own `kind` value — because the prompt described the
fields but never showed the flat shape.

Things to try:

- Photograph one clear ingredient. It should reach the confirm screen now.
- Ask the assistant anything. If it fails, check the log line: a `… Required`
  error is OUR schema rejecting a good answer, not the model failing.
- A shape miss is now retried ONCE, quoting the exact zod error back. Watch for
  `ai answer did not fit the schema — asking again` in the logs; the second
  attempt almost always lands.
- Read a photo of something genuinely unreadable. The job should now FAIL rather
  than succeed with an empty list — and your photos should stay on screen with a
  visible error, not vanish.

Old mock-era chats were cleared, and every chat turn now records `mocked` so a
canned answer can never be mistaken later for a real one.

## 16 · The console

`/admin/setup` first — it creates the one administrator and shows its password
ONCE. Copy it before leaving the page; nothing is emailed and only a hash is
stored. Running setup twice is refused, not repeated: a second unauthenticated
way to mint an admin would be a hole.

Then `/admin/login`, and the console is at `/admin`.

Worth trying to break:

- Hit `/admin/setup` again after setting up. It should refuse and point at sign in.
- Sign in as an ordinary user and open `/admin`. The screens load but every
  request 403s — guarding is the SERVER's job, and a hidden route is not a
  permission.
- Import recipes at `/admin/recipes/new`. Paste one object or an array. Feed it
  malformed JSON, a missing `difficulty`, an empty `steps` — one bad row in forty
  must not discard the other thirty-nine, and the result panel says which failed.
- After importing, open the recipe. Any ingredient we could not match to the
  catalogue is flagged — those are invisible to suggestions, which is why the
  count is shown on the list too.
- On `/admin/ai`, filter to "rejected only". Each row opens to show the system
  prompt, what we sent, and the model's raw answer. This is the screen that
  proves whether a bad answer was the model or our schema.
- On `/admin/jobs`, open a failed job and retry it. Open a SUCCEEDED one — the
  button reads "Run it again" and passes `force`, because re-running good work
  should never be something that happens by accident.
- Change somebody's status to suspended on their detail page, then try to use the
  app as them.

## 17 · Meals the assistant invented

Ask the assistant what to cook. EVERY meal card now opens — ours goes straight to
its page, an invented one goes to `/meals/generated-meal?meal=<name>`, which
writes the full recipe, saves it, and replaces the url with the real id.

- Open an invented meal. It should land on a normal recipe page, labelled `ai`.
- Press Back from there. It should leave the meal entirely, NOT return to a page
  that regenerates itself.
- Open the same invented meal twice. The second time is instant and gives the
  same id — no second copy of the same dish.
- Ask again afterwards. The meal is now one of ours, so it can be suggested and
  the assistant can cite its real id.

## 18 · Email

Nothing was ever sent before this — three templates existed and two were wired,
but there was no log, no schedule, and no way to see what happened. See
`docs/EMAIL.md` for the full map.

Without `RESEND_API_KEY` set, every send is recorded as **suppressed** rather
than failed, and the body is still stored — so the whole thing is testable
locally without sending real mail. `/admin/emails` shows them either way.

**Forgot password, end to end:**

- `/forgot-password` with an address that exists, and one that does not. BOTH
  must say the same thing — a different message would let somebody discover who
  has an account.
- Open the link from the email. Set a password. You should be sent to sign in,
  not signed in — every session was just revoked, including the one it would
  have made.
- Use the same link twice. The second time must be refused.
- Ask for a link, then ask again, then use the FIRST one. It must be dead; a new
  request spends every earlier link.
- Wait an hour, then use one. Expired.
- Hit `/reset-password` with no token and with a truncated one.

**Scheduled email:**

- Restart the server several times, then check `/admin/jobs` filtered to queued.
  There must be exactly ONE `notify-daily` and one `notify-weekly`, never a pile.
- Force one early: set its `runAt` back in the database and watch it run, then
  check it left a successor behind.
- Turn every notification off in settings and run the sweep. Nothing sends.
- Turn on the morning one with an EMPTY kitchen. Nothing sends — an email saying
  "you have 0 things and can cook nothing" is worse than silence.
- Turn on "when something runs out" and run the sweep twice in a day. The second
  must not send: the cap is one a week.

**Admin email:**

- `/admin/emails/new`. Change the audience and watch the count update before you
  can send. Sending is two steps on purpose — there is no recalling an email.
- Send to "pick people" with nobody picked. Refused.
- Open a sent email. The body renders in a sandboxed iframe, so an email's own
  CSS cannot restyle the console — worth confirming the console still looks like
  itself.
- Resend one. It creates a NEW row pointing at the original, and reuses the
  stored HTML rather than re-rendering — a template rebuilt today would produce
  something different from what was actually sent.

## 19 · The email switch, and the rundown

**The switch.** `/admin/emails` has one per kind, all on by default.

- Turn `welcome` off, register an account. Nothing arrives — but a row appears
  in the log marked `blocked`, with the reason. That is the point: the app still
  triggered, the send was refused, and it is still answerable.
- Turn it back on. A row exists now saying enabled, which is fine — absence and
  `enabled: true` mean the same thing.
- `password_reset` can be switched off too. It should not be, and the console
  says so, but nothing stops you — an operator who needs to stop all mail during
  an incident should not be fighting the tool.

**The rundown** replaces the old morning digest.

- Have a kitchen with something expiring and run the sweep. The email should
  name what is going off, the weather, and two or three meals per sitting.
- Click any meal in it. Straight to that recipe.
- Empty the kitchen entirely and run it. Nothing sends.
- Break the AI (bad key) and run it. It still sends, with our plainer reasons
  instead of the model's — the meals were never the model's job.
- Check the reasons actually connect to something. "It is tasty" means the
  prompt is not landing; "the ugwu goes today and this is the fastest thing that
  uses it" is the bar.

**Post-login redirect.**

- Sign out, visit `/stock` directly. You land on login with `?next=/stock`, and
  after signing in you arrive at `/stock`, not the kitchen.
- Try `?next=//evil.com`, `?next=https://evil.com`, `?next=/\evil.com`. Every
  one must be ignored and you land on the kitchen — a login page that redirects
  anywhere it is told is an open redirect, which is a phishing link that starts
  on our real domain.
- Sign out, visit `/stock`, then sign in with an account that has NOT onboarded.
  Onboarding wins; `next` is dropped, because the page it points at would only
  bounce them back.

## 20 · The redirect crash, and error states

**The crash.** Visiting a guarded page signed-out made Chrome show "Aw, Snap".
The guard navigated to `/login?next=/meals/x`, then — because `pathname` was a
dependency of the same effect — fired again ON the login page and built
`?next=/login?next=/login?…`, growing the url until the tab ran out of memory.

- Sign out, then open `/stock`, `/market`, `/meals/anything` directly. Each
  should land on login once, with a clean `?next=`.
- Watch the url on the login page. It must not grow.
- `next` can never be an auth page — `?next=/login` is ignored, and you land on
  the kitchen after signing in.
- Start at `/stock` signed out, click through to Register from the login page.
  `next` follows across, and finishing signup lands you on `/stock`.

**Error states.** `/meals/does-not-exist` used to sit on a skeleton forever,
because the screens waited on `data === undefined` and never looked at `error`.

Try a bad id on: a meal, cook mode, the week, market, saved, and suggestions.
Every one should show the server's own message with a Retry, not a skeleton.

**Skeletons** were `--paper-2` (#EEF4F8) on an #F7FAFC page — about four percent
of contrast, and the opacity animation took it lower. They have their own
`--skeleton` token now. 111 fills across 53 files.

## Things I know are not done

Stated plainly rather than left for you to find:

- [ ] **The admin console** (Group 10) — no screens. The seed script loads
      recipes through the service directly.
- [ ] **Planning** (Group 8) — mood, week plan, portions: no screens.
- [ ] **Market mode** — the one-handed shopping view. The list works; the
      big-target variant does not exist.
- [ ] **Stock detail / history screens** — the endpoints exist and return data;
      there is no screen for either.
- [ ] **Voice capture** — disabled at the control. Transcription is wired in the
      AI service but nothing calls it.
- [ ] **Offline / PWA** — no service worker.
- [ ] **`/scenes` and `/preview`** still work and are unchanged — design-system
      surfaces, not product screens.
- [ ] **Automated tests** — none, per your instruction. Verification here is
      typecheck, lint, build, plus the static checks I ran on the catalogue
      (398 items, every icon/unit/group valid) and the AI contracts (7/7 canned
      answers pass their real schemas).

## Where to look when something breaks

| Symptom | Look at |
|---|---|
| A screen shows nothing | Network tab — is it a 401? The guard may be redirecting |
| "That job does not exist" | Jobs are owner-scoped; check you are the same user |
| AI returns nothing | `db.ai_logs.find({parsed:false})` — the raw reply is there |
| Stock count looks wrong | `GET /stock/history` — every change and its source |
| Suggestions are empty | Did `pnpm seed:meals` run? `db.meals.countDocuments()` should be 24 |
| Upload fails | S3 env set? `POST /files/upload-url` returns 503 when not configured |
