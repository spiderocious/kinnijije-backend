# Email

**What sends, when, and why.** Every send is recorded in `email_logs` and visible
at `/admin/emails` — status, the exact HTML that went out, and a resend button.

## The templates

Each maps to a design-system spec under
`design-system/projects/kinnijije-v2/preview/`. The components (`480`–`484`) are
rebuilt as functions in `lib/mail/components.ts` — tables and inline styles, no
CSS variables, no flexbox, nothing that animates or depends on an image.

| Email | Spec | Trigger | Gate |
|---|---|---|---|
| Welcome | **384** | Registration | none — transactional |
| Password reset | 384 shell | Asking for a reset link | none — transactional |
| Password changed | 384 shell | Reset or change completes | none — transactional |
| Account status | 384 shell | Admin suspends or bans | none — transactional |
| The daily rundown | **383** shape | Daily sweep, 07:00 | `daily_digest` |
| Your week | **382** | Weekly sweep, Sunday 18:00 | `weekly_summary` |
| Running low | **380** | Daily sweep | `running_low`, ≤ once a week |
| Use it up | **383** | *built, not yet swept* | `use_it_up` |
| Have you eaten? | **381** | *built, not yet swept* | `have_you_eaten` |
| From an operator | 384 shell | Sent by hand from the console | none |

The two marked *built, not yet swept* have templates and preferences but no
sweep calling them — deliberate, because both need a judgement the daily sweep
does not yet make (383 must have a meal that uses the expiring thing; 381 must
know how long "quiet" has been).

## The switch

`/admin/emails` carries a switch per kind. **Everything is on by default** — a
row in `email_settings` exists only once somebody has touched that kind, so a
new template ships enabled without a migration.

Turning one off changes nothing upstream. The app keeps triggering exactly as it
did; the send is refused at the one place email leaves, recorded as `blocked`
with the reason, and still visible in the log. "Why did nobody get that?" is
answerable either way.

## The daily rundown

Built by `rundown.service.ts` — a mix, deliberately:

- **The meals are chosen by code.** The matcher already knows what somebody can
  actually cook. A model asked to pick would invent dishes and ignore the stock.
  They are split across breakfast / lunch / dinner by cook time.
- **The words are written by a model.** It sees the shortlist, the weather, and
  what is spoiling, and writes one line per meal saying why *that one, today*.
  It cannot add a meal, drop one, or reference an id it was not given.
- If the model fails, the email still sends with our own plainer lines.

Every meal is a link straight into its recipe — the whole card is an anchor,
since an email has no JavaScript to catch a click on a div.

## Rules that live in the service, not the template

A template cannot know how often it has been used, so the specs' rules are
enforced by the callers:

- **380** "at most weekly, and only when it is genuinely blocking a meal they
  make often" — `emailService.sentWithin()` caps the frequency, and the sweep
  refuses to send when nothing it lists is blocking a suggestion.
- **383** "sent only when there is something to do about it" — the template
  takes a `meals` argument and the caller must not pass an empty one.
- **381** "a question, not a reprimand" — the copy counts nothing and encourages
  nothing.
- **382** "descriptive, never a scorecard" — no streaks, no targets, and a week
  with nothing cooked says *"that is only what we can see, not what you ate."*

## Scheduling

There is no cron. The job queue gained a `runAt` field, and two sweep jobs
(`notify-daily`, `notify-weekly`) **re-queue their own successor** when they
finish. `scheduleDailySweep()` at boot plants the first one and is a no-op when
one is already waiting — so restarting the server five times does not produce
five digests.

## What this is NOT

**There is no outbox.** A send that fails is recorded as `failed` and left. The
row is in the log and an operator can resend it from the console, but nothing
retries on its own. That is a stated limit, not an oversight — see
`lib/mail/email.service.ts`.

**Deliverability.** Every non-transactional send carries `List-Unsubscribe` and
`List-Unsubscribe-Post` headers, and a real `Reply-To`. The welcome email was
landing in spam without them — filters read a bulk-shaped message with no way
out as exactly that, whatever we think it is.

**There is no email verification.** Accounts are created `pending` and stay
there. Nothing gates on it except the routes that already required `ACTIVE`.

## Preferences

`lowStockNudges` was one flag covering three very different emails. It is now
five separate ones, because "you are out of rice" and "have you eaten?" are not
the same thing to receive, and lumping them together meant turning off the
useful one to escape the personal one.

All default **off**. Nobody opted into being messaged.
