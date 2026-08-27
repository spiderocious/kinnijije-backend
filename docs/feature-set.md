# KinniJije — Feature Set

**What this is:** the whole product written as plain abilities — *the ability of X to do Y*.
No code, no endpoints, no schemas. It is the running list we pick work from, one group at a
time.

**Sources this was derived from:**

- The PRD — `dockito/projects/kinnijije/prd.md`
- The reference backend — `kinnijije/apps/main-backend/src` (9 feature folders, ~40 endpoints)
- The shipped design — 57 scenes in `web/src/features/scenes`, across 8 scene groups
- What a first-timer actually hits, traced screen by screen — see Group 0
- What already exists here — `cookiepot/backend`

**How to read the three status columns:**

Every ability moves through three independent tracks, owned by different parties. An ability
can be finished on one and untouched on the others.

| Column | Track | Done when |
|---|---|---|
| **BE** | Backend | The API exists and works |
| **WEB** | Web | The UI exists and is wired to that API |
| **QA** | Accepted | **You** clicked through it and accepted it — not that an automated test passed |

| Mark | Meaning |
|---|---|
| ✅ | Done |
| 🔄 | In progress |
| ⬜ | Not started |
| — | Not applicable — that track genuinely does not exist for this ability |

---

## The one-liner

> Tell it what is in your kitchen. It tells you what to cook tonight, with Nigerian and
> West African food treated as first-class.

Three rules the whole product bends to. When a decision is unclear, these settle it:

1. **The kitchen is never stock-taken.** The pantry is only ever updated as a side-effect
   of something the cook already did — cooked a meal, shopped a list, photographed a shelf.
   Nobody is ever asked to count.
2. **Every claim shows where it came from.** A verified recipe, an AI-generated one, and a
   guess from general knowledge look different on screen, always.
3. **Nothing is auto-committed.** What the AI read from a photo is reviewed before it
   counts.

---

## Where we are today

**Backend done — the foundation.** Not a product feature, but everything below stands on
it. Every row here is built and smoke-checked on the backend; none of it has a UI yet, and
none of it has been through your own hands.

| BE | WEB | QA | Ability |
|---|---|---|---|
| ✅ | ✅ | ⬜ | The ability of a person to create an account with an email and password |
| ✅ | ✅ | ⬜ | The ability of a person to sign in, stay signed in, and sign out |
| ✅ | ✅ | ⬜ | The ability of a signed-out person to be told to sign in, rather than silently failing |
| ✅ | ⬜ | ⬜ | The ability of a person to change their password, which signs out their other devices |
| ✅ | — | ⬜ | The ability of the system to remember who someone is across visits without them signing in again |
| ✅ | — | ⬜ | The ability of the system to notice a stolen session and end every session for that person |
| ✅ | ⬜ | ⬜ | The ability of a person to see and edit their own profile |
| ✅ | ⬜ | ⬜ | The ability of an admin to see every account, and to search and page through them |
| ✅ | ⬜ | ⬜ | The ability of a moderator to suspend or ban an account, and of the system to cut off that person's access immediately |
| ✅ | ⬜ | ⬜ | The ability of a super admin to change what someone is allowed to do |
| ✅ | — | ⬜ | The ability of the system to refuse an account that is suspended, unverified, or banned — separately from what its role allows |
| ✅ | ✅ | ⬜ | The ability of the system to slow down anyone hammering it, and to tell them how long to wait |
| ✅ | — | ⬜ | The ability of the system to send email |
| ✅ | — | ⬜ | The ability of the team to see what happened on any request, without secrets ever reaching the logs |
| ✅ | — | ⬜ | The ability of the team to check whether the service is alive and whether it should receive traffic |

**Not started on any track — everything that makes it KinniJije.** Every group below.

---

# Group −1 · The plumbing

**Prerequisites, not product.** Nothing here is a screen, and a cook never sees
any of it — but the capture, suggestion and console groups all stand on it, so
it is at the front.

### Files: uploading is separate from processing

The rule: **a file is a thing that exists on its own**, not an argument to an AI
call. Photographing a shelf and reading that photo are two acts, and the photo
outlives the read — which is what makes a gallery, a re-read after a better
prompt, and "what was that answer based on" possible at all.

| BE | WEB | QA | Ability |
|---|---|---|---|
| ✅ | — | ⬜ | The ability of a cook to upload a photo straight to storage without it passing through our servers |
| ✅ | — | ⬜ | The ability of the system to store only the key, never a link that will expire |
| ✅ | — | ⬜ | The ability of every response to carry a fresh, short-lived link built from that key |
| ✅ | — | ⬜ | The ability of the system to confirm with the bucket that a file really arrived, rather than taking the client's word |
| ✅ | ⬜ | ⬜ | The ability of a cook to see everything they have ever uploaded, including the ones that never finished |
| ✅ | ⬜ | ⬜ | The ability of a cook to see their uploads filtered by what they were for |
| ✅ | — | ⬜ | The ability of the system to refuse a file that is too large or of a kind we do not accept |
| ✅ | — | ⬜ | The ability of one cook to never reach another cook's files, even by guessing an id |

### AI: one door, and a deterministic stand-in

Nothing calls OpenAI directly. Features ask an AI *service*, which picks a
provider — so the entire product can run on canned answers with one setting.

| BE | WEB | QA | Ability |
|---|---|---|---|
| ✅ | — | ⬜ | The ability of every feature to ask for AI work without knowing or caring which provider answers |
| ✅ | — | ⬜ | The ability of the team to switch the whole product to canned answers with one setting |
| ✅ | — | ⬜ | The ability of a demo to give the same answer every time, instantly, with no spend |
| ✅ | — | ⬜ | The ability of every AI answer to say which provider produced it, so canned data is never mistaken for a real read |
| ✅ | — | ⬜ | The ability of each thing we ask AI to do to have a stable name, so its canned answer can be found and its cost tracked |
| ✅ | — | ⬜ | The ability of the team to demo a specific outcome — an empty shelf, a failed read — without contriving the input |
| ✅ | — | ⬜ | The ability of an AI outage to fail the one feature that asked, rather than the whole request |
| ✅ | — | ⬜ | The ability of the product to run with no AI key at all, for anyone only working on the interface |

---

# Group 0 · The front door

**Before the app.** What someone sees before they have any of it.

**Scenes:** `landing`

| BE | WEB | QA | Ability |
|---|---|---|---|
| — | ✅ | ⬜ | The ability of a visitor to understand the product from the landing page |
| — | ✅ | ⬜ | The ability of a visitor to see the trust claim proved by a real meal card, not a screenshot |

---

# Group 1 · First run

**Opening the app for the very first time.** Everything here happens before a cook has
typed a single ingredient, and it decides whether they ever do.

**Scenes:** `onboarding` · `auth` · `empty-kitchen` · `permission`

### The first screen

| BE | WEB | QA | Ability |
|---|---|---|---|
| — | ✅ | ⬜ | The ability of a new cook to be told what the app does in one sentence, before being asked for anything |
| — | ✅ | ⬜ | The ability of a new cook to be shown how recipes are labelled — tested by a person, or written by a model — before they trust a single one |
| — | ✅ | ⬜ | The ability of a new cook to get from that screen into their kitchen with one tap |

### Getting in

| BE | WEB | QA | Ability |
|---|---|---|---|
| ⬜ | ⬜ | ⬜ | The ability of a cook to use the app without making an account at all |
| ✅ | ✅ | ⬜ | The ability of a cook to make an account when they want their things kept |
| ⬜ | ⬜ | ⬜ | The ability of a cook who cooked before signing up to keep what they already did |
| ✅ | ✅ | ⬜ | The ability of a returning cook to be recognised without signing in again |

### The first empty kitchen

| BE | WEB | QA | Ability |
|---|---|---|---|
| ⬜ | ⬜ | ⬜ | The ability of a cook with nothing in their kitchen to be pointed at the fastest way to fill it |
| ⬜ | ⬜ | ⬜ | The ability of a cook to skip that and just type, with the skip always visible |
| ⬜ | ⬜ | ⬜ | The ability of a cook to be asked for the camera only when it is about to be used, with the reason given |
| ⬜ | ⬜ | ⬜ | The ability of a cook to say no to the camera and still use everything else |

### What the app knows about your taste

> **Open question — see "Things to settle" below.** The PRD specifies three onboarding
> questions. No shipped scene asks them, yet the suggestion scene already says *"it is
> Nigerian (which you said you like)"*. So the preference is used but never collected.
> These rows are written the way the design implies — learned, not interrogated — and are
> the ones to confirm before Group 0 is built.

| BE | WEB | QA | Ability |
|---|---|---|---|
| ✅ | ✅ | ⬜ | The ability of a cook to start with sensible defaults — Nigerian and West African, any difficulty — without answering anything |
| ✅ | ✅ | ⬜ | The ability of a cook to say which cuisines they want, whenever they choose to |
| ✅ | ✅ | ⬜ | The ability of a cook to say how adventurous they are, whenever they choose to |
| ⬜ | ⬜ | ⬜ | The ability of the app to learn a cook's taste from what they actually save and cook |
| ⬜ | ⬜ | ⬜ | The ability of a cook to see why a meal was suggested to them, in the app's own words |

---

# Group 2 · Cooking tonight

**The signature loop.** Someone opens the app with things on the counter and closes it
knowing what they are cooking. If only one group ever ships, it is this one.

**Scenes:** `kitchen` · `kitchen-empty` · `suggestions` · `suggestions-loading` ·
`suggestions-empty` · `recipe` · `cook` · `favourites`

### Telling it what you have

| BE | WEB | QA | Ability |
|---|---|---|---|
| ⬜ | ⬜ | ⬜ | The ability of a cook to type what they have, and have it understood as a list of ingredients |
| ⬜ | ⬜ | ⬜ | The ability of a cook to be offered ingredient names as they type, weighted toward Nigerian staples |
| ⬜ | ⬜ | ⬜ | The ability of a cook to see what they have entered as a list they can remove things from |
| ⬜ | ⬜ | ⬜ | The ability of a cook to pull in things they used recently, without typing them again |
| ⬜ | ⬜ | ⬜ | The ability of a cook to be told plainly when they have added nothing yet — and why the button is off |
| ⬜ | ⬜ | ⬜ | The ability of the system to treat "scotch bonnet", "atarodo" and "red pepper" as the same thing |

### Getting the three meals

| BE | WEB | QA | Ability |
|---|---|---|---|
| ⬜ | ⬜ | ⬜ | The ability of a cook to get three meals they could cook tonight from what they listed |
| ⬜ | ⬜ | ⬜ | The ability of a cook to see, per meal, how much of it they already have — "uses 5 of your 6 things" |
| ⬜ | ⬜ | ⬜ | The ability of a cook to see how long a meal takes and how hard it is, before opening it |
| ⬜ | ⬜ | ⬜ | The ability of a cook to tell a verified recipe from an AI-suggested one at a glance |
| ⬜ | ⬜ | ⬜ | The ability of a weak match to visibly present itself as the weaker option, rather than competing equally |
| ⬜ | ⬜ | ⬜ | The ability of a cook to ask for three different meals if none of these appeal |
| ⬜ | ⬜ | ⬜ | The ability of a cook to be shown something useful when nothing matches, instead of an empty screen |
| ⬜ | ⬜ | ⬜ | The ability of a cook to watch the engine work, rather than stare at a blank screen |
| ⬜ | ⬜ | ⬜ | The ability of the system to never suggest food from a cuisine the cook said they do not want |
| ⬜ | ⬜ | ⬜ | The ability of the system to respect how adventurous the cook said they are |

### The recipe

| BE | WEB | QA | Ability |
|---|---|---|---|
| ⬜ | ⬜ | ⬜ | The ability of a cook to open a meal and see everything needed to cook it |
| ⬜ | ⬜ | ⬜ | The ability of a cook to see, split apart, what they already have and what they would need to buy |
| ⬜ | ⬜ | ⬜ | The ability of a cook to read the steps in order, with a time estimate on each |
| ⬜ | ⬜ | ⬜ | The ability of a cook to know when a quantity is an estimate rather than a tested measurement |
| ⬜ | ⬜ | ⬜ | The ability of a cook to see where this recipe came from, on the recipe itself |

### Cooking it

| BE | WEB | QA | Ability |
|---|---|---|---|
| ⬜ | ⬜ | ⬜ | The ability of a cook to enter a mode built for a propped-up phone and busy hands |
| ⬜ | ⬜ | ⬜ | The ability of a cook to see one step at a time, readable from across the kitchen |
| — | ⬜ | ⬜ | The ability of a cook to move forward and back through steps without losing their place |
| ⬜ | ⬜ | ⬜ | The ability of a cook to start a timer for a step that needs one |
| — | ⬜ | ⬜ | The ability of a cook's screen to stay awake for the whole cook |
| — | ⬜ | ⬜ | The ability of a cook to leave cook mode only deliberately, never by a stray tap |

### Keeping it

| BE | WEB | QA | Ability |
|---|---|---|---|
| ⬜ | ⬜ | ⬜ | The ability of a cook to save a meal they liked |
| ⬜ | ⬜ | ⬜ | The ability of a cook to find everything they saved in one place |
| ⬜ | ⬜ | ⬜ | The ability of a cook to go from a saved meal straight into cooking it again |
| ⬜ | ⬜ | ⬜ | The ability of a cook to unsave something |

---

# Group 3 · The standing kitchen

**What the app remembers.** The pantry that is never stock-taken — it fills itself from
what the cook already does, and its whole job is to make Group 1 stop asking.

**Scenes:** `kitchen-dashboard` · `stock-location` · `low-stock` · `add-stock` ·
`stock-detail` · `stock-history` · `use-it-up` · `empty-kitchen`

| BE | WEB | QA | Ability |
|---|---|---|---|
| ⬜ | ⬜ | ⬜ | The ability of a cook to see what is in their kitchen without ever having counted it |
| ⬜ | ⬜ | ⬜ | The ability of a cook to see their things grouped by where they actually live — fridge, shelf, freezer |
| ⬜ | ⬜ | ⬜ | The ability of the kitchen to go down on its own when a meal is cooked |
| ⬜ | ⬜ | ⬜ | The ability of the kitchen to go up on its own when a market list is shopped |
| ⬜ | ⬜ | ⬜ | The ability of a cook to correct a count that is wrong — as a correction, never as a chore |
| ⬜ | ⬜ | ⬜ | The ability of a cook to see everything that changed a count, and where each change came from |
| ⬜ | ⬜ | ⬜ | The ability of a cook to be told what is running low — but only what actually blocks a meal they cook often |
| ⬜ | ⬜ | ⬜ | The ability of a cook to see what is about to turn, and what they could cook tonight to use it |
| ⬜ | ⬜ | ⬜ | The ability of a cook to know something is simply untracked, rather than being told it is at zero |
| ⬜ | ⬜ | ⬜ | The ability of a cook with an empty kitchen to be pointed at the camera, with skipping always available |

---

# Group 4 · Filling the kitchen without typing

**How the pantry gets its contents.** Photograph a shelf, upload a receipt, speak it. This
is the make-or-break quality feature in the PRD — and nothing it reads is ever committed
without a human looking at it.

**Scenes:** `shelf-scan` · `upload-receipt` · `extraction-review` · `capture-recovery` ·
`permission`

| BE | WEB | QA | Ability |
|---|---|---|---|
| ⬜ | ⬜ | ⬜ | The ability of a cook to photograph a shelf, fridge or counter and have the food in it recognised |
| ⬜ | ⬜ | ⬜ | The ability of a cook to take several photos in one go and have the results combined |
| ⬜ | ⬜ | ⬜ | The ability of a cook to photograph a market receipt and have the whole shop read off it |
| ⬜ | ⬜ | ⬜ | The ability of a cook to speak what they have and have it understood |
| ⬜ | ⬜ | ⬜ | The ability of a cook to review everything that was read before any of it counts |
| ⬜ | ⬜ | ⬜ | The ability of a cook to fix or drop any single thing that was misread |
| ⬜ | ⬜ | ⬜ | The ability of a cook to be asked for the camera in context, with the reason, and to say no |
| ⬜ | ⬜ | ⬜ | The ability of a cook whose capture failed to be offered typing as an equal path, not a consolation |
| ⬜ | ⬜ | ⬜ | The ability of a cook to have their kitchen photo deleted once it has been read |

---

# Group 5 · The market list

**Closing the loop.** The list is what tops the kitchen back up — and shopping it is what
updates the pantry without anyone counting.

**Scenes:** `market-list` · `market-mode` · `market-empty`

| BE | WEB | QA | Ability |
|---|---|---|---|
| ⬜ | ⬜ | ⬜ | The ability of a cook to see what to buy |
| ⬜ | ⬜ | ⬜ | The ability of a cook to see what each item on the list unblocks |
| ⬜ | ⬜ | ⬜ | The ability of a cook to shop the list one-handed, with a bag in the other |
| ⬜ | ⬜ | ⬜ | The ability of shopping a list to fill the kitchen back up, without any counting |
| ⬜ | ⬜ | ⬜ | The ability of an empty market list to read as the good outcome, with nothing to do |

---

# Group 6 · Asking questions

**Chat, grounded in the actual kitchen.** Not a general assistant — every answer is either
cited to the cook's own kitchen, or explicitly labelled as the weakest kind of source.

**Scenes:** `chat-meal` · `chat-stock` · `chat-substitution` · `chat-about-meal` ·
`chat-history` · `chat-error`

| BE | WEB | QA | Ability |
|---|---|---|---|
| ⬜ | ⬜ | ⬜ | The ability of a cook to ask what they could make, and get an answer drawn from their own kitchen |
| ⬜ | ⬜ | ⬜ | The ability of a cook to ask how much of something they have, and be told what took it down |
| ⬜ | ⬜ | ⬜ | The ability of a cook to ask what to use instead of something they are out of |
| ⬜ | ⬜ | ⬜ | The ability of a cook to ask about the specific recipe in front of them |
| ⬜ | ⬜ | ⬜ | The ability of every answer to show what it was based on |
| ⬜ | ⬜ | ⬜ | The ability of a general-knowledge answer to be labelled as the weakest kind of answer |
| ⬜ | ⬜ | ⬜ | The ability of the assistant to say plainly that it does not know |
| ⬜ | ⬜ | ⬜ | The ability of a cook to find what they asked before |

---

# Group 7 · Noticing patterns

**What the app observed.** Observations with the working shown — never scores, never
streaks, never nagging. It says a true thing and stops.

**Scenes:** `week-summary` · `week-empty` · `should-eat` · `nutrition` · `repeats` ·
`spend` · `milestone`

| BE | WEB | QA | Ability |
|---|---|---|---|
| ⬜ | ⬜ | ⬜ | The ability of a cook to see what they cooked over a week |
| ⬜ | ⬜ | ⬜ | The ability of every observation to show the meals it was drawn from |
| ⬜ | ⬜ | ⬜ | The ability of the app to stay quiet when it has too little to go on, rather than guess |
| ⬜ | ⬜ | ⬜ | The ability of a cook to ask what they should eat and get an observation, then a way to act on it |
| ⬜ | ⬜ | ⬜ | The ability of a cook to see roughly what they ate, clearly labelled as an estimate |
| ⬜ | ⬜ | ⬜ | The ability of a cook to see what they cook most — presented as worth knowing, not as a problem |
| ⬜ | ⬜ | ⬜ | The ability of a cook to see roughly what they spent |
| ⬜ | ⬜ | ⬜ | The ability of a cook to be told they hit a milestone, once, with no points or levels attached |

---

# Group 8 · Planning ahead

**Deciding before standing in the kitchen.** The taste-led door in, and the week ahead.

**Scenes:** `mood` · `constraints` · `week-plan` · `plan-to-market` · `portions`

| BE | WEB | QA | Ability |
|---|---|---|---|
| ⬜ | ⬜ | ⬜ | The ability of a cook to start from what they feel like, instead of from what they have |
| ⬜ | ⬜ | ⬜ | The ability of a cook to pick nothing and still get somewhere |
| ⬜ | ⬜ | ⬜ | The ability of a cook to rule things out — and to see those things actually removed |
| ⬜ | ⬜ | ⬜ | The ability of a cook to plan meals across a week, starting from an empty week |
| ⬜ | ⬜ | ⬜ | The ability of a cook to turn a week's plan into a market list, minus what they already have |
| ⬜ | ⬜ | ⬜ | The ability of a cook to cook for a different number of people and have quantities scale |
| ⬜ | ⬜ | ⬜ | The ability of a scaled recipe to say what it scaled from |

---

# Group 9 · Your account

**Everything about the account that is not first run.**

**Scenes:** `settings` · `offline`

| BE | WEB | QA | Ability |
|---|---|---|---|
| ⬜ | ⬜ | ⬜ | The ability of a cook to change any of their first-run answers later |
| ⬜ | ⬜ | ⬜ | The ability of a cook to choose metric or imperial, with local measures — derica, cup, wrap — always shown alongside |
| ⬜ | ⬜ | ⬜ | The ability of a cook to turn low-stock nudges and the weekly summary on or off |
| ⬜ | ⬜ | ⬜ | The ability of a cook to read plainly what is sent away and how AI is used |
| ⬜ | ⬜ | ⬜ | The ability of a cook to see a setting they are not allowed to change, and why |
| ⬜ | ⬜ | ⬜ | The ability of a cook to delete their account |
| ⬜ | ⬜ | ⬜ | The ability of a cook to open saved recipes with no connection, and to see how old each one is |
| — | ⬜ | ⬜ | The ability of a cook to install the app on their phone |

---

# Group 10 · The counter (admin console)

**Running the product.** The seed recipes are the moat, so the tools that maintain them
matter. Everything expensive or irreversible states its cost or asks first.

**Scenes:** `console-shell` · `console-dashboard` · `console-recipes` ·
`console-recipe-editor` · `console-audit` · `console-prompts` · `console-users` ·
`console-feedback` · `console-feedback-empty` · `console-flags`

### The recipe base

| BE | WEB | QA | Ability |
|---|---|---|---|
| ⬜ | ⬜ | ⬜ | The ability of a curator to see every recipe in one table |
| ⬜ | ⬜ | ⬜ | The ability of a curator to write a recipe by hand |
| ⬜ | ⬜ | ⬜ | The ability of a curator to have AI draft one, then correct it |
| ⬜ | ⬜ | ⬜ | The ability of a curator to keep a recipe as a draft nobody can see |
| ⬜ | ⬜ | ⬜ | The ability of a curator to publish a recipe — and to be asked first, because it goes out to everyone |
| ⬜ | ⬜ | ⬜ | The ability of a curator to pull a published recipe back |
| ⬜ | ⬜ | ⬜ | The ability of a curator to put a photo on a recipe |
| ⬜ | ⬜ | ⬜ | The ability of a curator to delete a recipe |

### Corrections from cooks

| BE | WEB | QA | Ability |
|---|---|---|---|
| ⬜ | ⬜ | ⬜ | The ability of a cook to flag a step or an ingredient that is not quite right |
| ⬜ | ⬜ | ⬜ | The ability of a curator to see every flag beside the exact step it is about |
| ⬜ | ⬜ | ⬜ | The ability of a curator to mark a flag as dealt with |
| ⬜ | ⬜ | ⬜ | The ability of an empty flag queue to read as the good outcome |

### Watching the AI

| BE | WEB | QA | Ability |
|---|---|---|---|
| ⬜ | ⬜ | ⬜ | The ability of the team to see what went into the AI, what came out, and what it cost |
| ⬜ | ⬜ | ⬜ | The ability of the team to edit the instructions given to the AI |
| ⬜ | ⬜ | ⬜ | The ability of the team to see what changed in those instructions before saving |
| ⬜ | ⬜ | ⬜ | The ability of the team to be guarded against breaking those instructions |
| ⬜ | ⬜ | ⬜ | The ability of the team to turn AI generation off entirely without a deploy |
| ⬜ | ⬜ | ⬜ | The ability of each switch to state what turning it off actually does |

### Running it

| BE | WEB | QA | Ability |
|---|---|---|---|
| ⬜ | ⬜ | ⬜ | The ability of the team to see the few numbers that matter, including the one that costs money |
| ⬜ | ⬜ | ⬜ | The ability of the team to find a person and see their account |
| ⬜ | ⬜ | ⬜ | The ability of the team to suspend someone — typed out in full first, because it acts on a person |

---

## Order of work, and why

The groups above are ordered the way a **cook** meets the product. The table below is the
order we **build** in, which is deliberately different — you cannot test a front door that
opens onto an empty room.

Each row is one unit: **backend → API doc → the UI feature → stop, you test.**

| # | Work | Group | Why here |
|---|---|---|---|
| 1 | **Recipes + a seeded base** | 2 | Nothing else has anything to point at. The recipe is the product's core object and the seed is its moat. Read-only, plus the script that loads it. |
| 2 | **Ingredients you type** | 2 | The narrowest way in: type, get understood, nothing else. Settles how "scotch bonnet" and "atarodo" become one thing — which everything downstream depends on. |
| 3 | **Suggestions** | 2 | The signature scene. Once 1 and 2 exist, this is the product working end to end for the first time. |
| 4 | **Recipe view + cook mode** | 2 | Completes the loop: a suggestion becomes a cooked dinner. |
| 5 | **Favourites** | 2 | Small, self-contained, and the first thing that makes the app worth coming back to. |
| 6 | **First run + preferences** | 1 | Suggestions already read the preferences, so this makes #3 honest rather than hardcoded — and it is the first time a real first-timer gets a real first screen. |
| 7 | **The standing kitchen** | 3 | The pantry, filled by cooking and shopping. The first thing that makes the app remember. |
| 8 | **Market list** | 5 | Closes the pantry loop — shopping refills it, without counting. |
| 9 | **Photo and voice capture** | 4 | Highest risk in the PRD, and best attempted once there is a working product to attach it to. |
| 10 | **The console** | 10 | See below — deferred deliberately, not skipped. |
| 11 | **Chat** | 6 | Needs a real kitchen and real recipes to cite before it can be grounded in anything. |
| 12 | **Insights and planning** | 7, 8 | Needs cooking history to exist before it has anything true to say. |
| 13 | **Account + landing** | 9, 0 | The settings screen and the marketing site. Neither blocks anything. |

**Starting point: #1.** It has no dependencies, and every other row needs it.

### Do we need the admin console to seed recipes? No — and here is the evidence

**Short answer: build one endpoint, skip the console.** Seed with a script, defer the
other ~20 admin endpoints and all 10 console screens to #10.

The reference project already solved this, and it is worth copying exactly. It ships
`docs/qas/scripts/seed-recipes.mjs` — a standalone script holding **12 hand-written**
Nigerian recipes that registers an admin, promotes it in the database, then POSTs each
recipe to `/admin/recipes` and publishes it. Two endpoints. No console UI involved.

**Why a script and not the console:**

- The console is ~20 endpoints and 10 screens. Seeding needs **one** endpoint.
- A script is repeatable. Every fresh database, every teammate, every CI run gets the same
  recipes from one command. Typing 50 recipes into a form once is not repeatable, and a
  database dump is not reviewable.
- The recipes are **data in version control**. They get reviewed like code, and a bad
  quantity is a diff.

**Why not skip the endpoint too and write straight to the database:** the reference script
has a comment on exactly this — content is created *through the admin path, not hardcoded
in app code*. Going through the API means the seed is validated by the same rules a curator
would hit, so a recipe that the script can create is one the console will be able to edit
later. Writing directly to Mongo would let malformed recipes in that no real path could
produce.

**On AI-generating the seed.** Use it as a **first draft, never as the seed itself.** The
PRD is blunt about this: AI first drafts get details wrong — *"stir for 2 minutes" when it
should be "stir until the oil floats"* — and AI cook times are systematically underestimated
(the product pads them 30% at display time for that reason). The seed is the product's moat
precisely because it is tested by a person. An AI-written seed is just the generic recipe
API we are trying to beat.

A reasonable middle path: have AI draft the 50, then correct them by hand before they land
in the script. The draft saves typing; the correction is the actual work and cannot be
skipped.

**So for #1:** one `POST /admin/recipes` behind the admin role, plus
`scripts/seed-recipes.ts` carrying the recipes. That is the whole admin surface until #10.

**Why Group 0 is not built first.** First run is the first thing a *cook* sees, but it is
nearly the last thing worth *building* — an onboarding screen that opens into an app with
no recipes in it cannot be tested, and the preferences it collects have nothing to filter
until the suggestion engine exists. Build the loop, then build the door into it. The one
exception is if you want a real first-timer path to click through early, in which case pull
Group 0 forward to #2 and accept that it will be re-tested after #3.

---

## Things to settle before they bite

Flagging these now rather than discovering them mid-build. None block starting on #1.

- **The pantry contradicts the PRD.** The PRD says explicitly: *do not build inventory
  tracking, the friction kills usage.* The design ships a whole standing-kitchen group.
  The design resolves it — the pantry is only ever a side-effect, never stock-taking — and
  that is the newer and better answer. Recorded here so nobody "fixes" it back later.
- **Onboarding: the PRD and the design disagree, and neither is complete.** The PRD
  specifies three skippable questions (cuisines, difficulty, a confirmation). The shipped
  `onboarding` scene is a *single* screen with **no questions at all** — a trust claim
  about recipe provenance, then one button, "Open my kitchen". The `settings` scene does
  not ask for cuisine or difficulty either. Yet the suggestion engine reads both, and the
  `suggestions` scene renders the reason *"it is Nigerian (which you said you like)"*.
  **So a preference the product visibly uses is collected on no screen that exists.**
  Three ways to close it, and this is a product call, not a technical one:
  **(a)** build the PRD's questions into first run, contradicting the one-screen design;
  **(b)** keep first run question-free, start everyone on the Nigerian + West African
  default, and put the pickers in settings for whoever wants them;
  **(c)** keep first run question-free and *learn* taste from what gets saved and cooked,
  with settings as the manual override. **(b) is the smallest step that makes the shipped
  design honest**, and (c) is where it likely wants to end up.

- **Groups 4, 5, 6, 7 are not in the PRD at all.** Chat, insights, planning and the market
  list came from the design work. They are real scope; the PRD is the older document.
- **Sign-in is optional in the design** (`auth` — "you can cook without an account") but
  required in the reference backend. Worth deciding before Group 1 ships, since it changes
  where a session's ingredients live.
- **Roles differ.** We built four (user / moderator / admin / super_admin); the reference
  has two. Ours is a superset, so nothing is blocked — the console just needs to say which
  role each screen requires.
- **The seed is ~50 recipes of real human work.** It is the moat and it is not a
  side-quest. Worth deciding early whether it is written, AI-drafted-then-corrected, or
  both.
- **AI costs real money per call.** The console's audit and kill-switch exist for that
  reason. Until they exist, anything AI-facing should stay behind a flag that defaults off.
