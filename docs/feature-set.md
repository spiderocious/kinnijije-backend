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
4. **No request ever waits on a model.** AI work is handed to a job and answered
   immediately; the interface polls or streams. A request that blocks on a model
   is a request that times out.
5. **Every model answer is checked before it is believed.** A reply that does not
   fit the shape we asked for is rejected, not patched up.

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
| ✅ | ✅ | ⬜ | The ability of a person to change their password, which signs out their other devices |
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
| ✅ | ✅ | ⬜ | The ability of a cook to upload a photo straight to storage without it passing through our servers |
| ✅ | — | ⬜ | The ability of the system to store only the key, never a link that will expire |
| ✅ | — | ⬜ | The ability of every response to carry a fresh, short-lived link built from that key |
| ✅ | — | ⬜ | The ability of the system to confirm with the bucket that a file really arrived, rather than taking the client's word |
| ✅ | ✅ | ⬜ | The ability of a cook to see everything they have ever uploaded, including the ones that never finished |
| ✅ | ⬜ | ⬜ | The ability of a cook to see their uploads filtered by what they were for |
| ✅ | — | ⬜ | The ability of the system to refuse a file that is too large or of a kind we do not accept |
| ✅ | — | ⬜ | The ability of one cook to never reach another cook's files, even by guessing an id |

### Background work: nothing waits on AI

**The rule: an API call never blocks on a model.** Every request returns at once
with a job id; the interface polls or streams until the work is done. A request
that waits on a model is a request that times out.

The job system is **generic and knows nothing about AI** — AI is simply its first
consumer. Kept separate deliberately, so moving to Redis or BullMQ later is a
swap of one implementation rather than a rewrite of every feature that queues
work.

| BE | WEB | QA | Ability |
|---|---|---|---|
| ✅ | — | ⬜ | The ability of any slow work to be handed off and answered immediately, rather than holding a request open |
| ✅ | — | ⬜ | The ability of every job to carry an id that says what kind of work it is, not just that it is work |
| ⬜ | ⬜ | ⬜ | The ability of a person to watch a job's progress as it happens |
| ⬜ | ⬜ | ⬜ | The ability of a person to be told plainly when a job failed, and why |
| ⬜ | ⬜ | ⬜ | The ability of a person to retry a job that failed, without starting over |
| ⬜ | ⬜ | ⬜ | The ability of a person to cancel work that is still running |
| ⬜ | ⬜ | ⬜ | The ability of a person to see everything currently queued or running |
| ⬜ | ⬜ | ⬜ | The ability of a person to look at what a finished job actually produced |
| ✅ | — | ⬜ | The ability of a job to survive a restart, rather than vanishing with the process |
| ✅ | — | ⬜ | The ability of the queue to be swapped for a real one later without touching a single feature that uses it |

### The ingredient catalogue

One constants file the whole product reads from — autosuggest, units, icons,
expiry and rough cost all come from the same rows, so they cannot disagree.

| BE | WEB | QA | Ability |
|---|---|---|---|
| ✅ | ✅ | ⬜ | The ability of the app to know several hundred Nigerian and West African ingredients by name |
| ✅ | ✅ | ⬜ | The ability of every ingredient to belong to a group, so it can be pictured even when it has no icon of its own |
| ✅ | ✅ | ⬜ | The ability of every ingredient to carry its own icon where one exists |
| ✅ | ✅ | ⬜ | The ability of every ingredient to know how it is measured — rice in kilograms, eggs in pieces |
| ✅ | — | ⬜ | The ability of an ingredient to be measured the way Nigerians actually measure it — congo, derica, tin — and converted between them |
| ✅ | ✅ | ⬜ | The ability of a cook to add their own unit, and have it remembered for them alone |
| ✅ | — | ⬜ | The ability of every ingredient to know roughly how long it keeps |
| ✅ | — | ⬜ | The ability of every ingredient to carry a rough cost, so a market list can total itself |
| ✅ | ✅ | ⬜ | The ability of a cook to enter something that is not in the catalogue at all |

### What we demand of every AI answer

| BE | WEB | QA | Ability |
|---|---|---|---|
| ✅ | — | ⬜ | The ability of every AI answer to be checked against a strict shape, and rejected outright if it does not fit |
| ✅ | — | ⬜ | The ability of every prompt sent to a model to be recorded in full, with the model and provider that answered it |
| ✅ | — | ⬜ | The ability of the team to see how confident, clear and unambiguous each answer was |
| ✅ | — | ⬜ | The ability of the team to collect the model's own suggestion for improving the prompt that produced it |
| ✅ | ✅ | ⬜ | The ability of an AI answer to say what it assumed, so a cook can correct a wrong assumption |
| ✅ | ✅ | ⬜ | The ability of an AI answer to raise a warning or an error only when there genuinely is one |
| ✅ | — | ⬜ | The ability of a cheap, fast model to be used for cheap, fast checks rather than the expensive one |

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

### What the app knows about your taste

> **Settled.** Onboarding collects cuisines and difficulty, skippable, defaulting
> to Nigerian + West African. Settings can change them later. The suggestion
> engine treats cuisine as a hard filter, so these answers are load-bearing
> rather than decorative.

| BE | WEB | QA | Ability |
|---|---|---|---|
| ✅ | ✅ | ⬜ | The ability of a cook to start with sensible defaults — Nigerian and West African, any difficulty — without answering anything |
| ✅ | ✅ | ⬜ | The ability of a cook to say which cuisines they want, whenever they choose to |
| ✅ | ✅ | ⬜ | The ability of a cook to say how adventurous they are, whenever they choose to |
| ⬜ | ⬜ | ⬜ | The ability of the app to learn a cook's taste from what they actually save and cook |
| ⬜ | ⬜ | ⬜ | The ability of a cook to see why a meal was suggested to them, in the app's own words |

---

# Group 2 · Cooking tonight

**The main feature.** From what is in the kitchen to a cooked meal — three ways
in: deterministic suggestions, an AI conversation, or an AI recommendation.

**Scenes:** `kitchen` · `kitchen-empty` · `suggestions` · `suggestions-loading` ·
`suggestions-empty` · `recipe` · `cook` · `favourites` · `chat-meal` ·
`chat-substitution` · `chat-error` · `chat-history` · `chat-about-meal`

### Getting to "what should I cook"

| BE | WEB | QA | Ability |
|---|---|---|---|
| ⬜ | ⬜ | ⬜ | The ability of a cook to be prompted to find something to cook, from both the dashboard and the stock page |
| ⬜ | ⬜ | ⬜ | The ability of a cook to choose between a worked-out suggestion and asking the AI |

### Suggestions — worked out, not generated

No model involved. The kitchen is matched against the seeded meals, so the
answer is explainable and free.

| BE | WEB | QA | Ability |
|---|---|---|---|
| ✅ | ✅ | ⬜ | The ability of a cook to get the five meals closest to what they actually have |
| ✅ | ✅ | ⬜ | The ability of a cook to see, per meal, what they have enough of |
| ✅ | ✅ | ⬜ | The ability of a cook to see what they have but probably not enough of |
| ✅ | ✅ | ⬜ | The ability of a cook to see what is missing outright |
| ✅ | ✅ | ⬜ | The ability of a cook to see which meals need only one or two things they could go and buy |
| ⬜ | ⬜ | ⬜ | The ability of a cook to be shown something useful when nothing matches, instead of an empty screen |
| ✅ | ✅ | ⬜ | The ability of a cook to watch the matching happen, rather than stare at a blank screen |

### What a meal's page tells you

| BE | WEB | QA | Ability |
|---|---|---|---|
| ✅ | ✅ | ⬜ | The ability of a cook to open a meal and see what it actually is |
| ✅ | ✅ | ⬜ | The ability of a cook to read what makes the dish good — why anyone cooks it |
| ✅ | ✅ | ⬜ | The ability of a cook to see, split apart, what they have and what they would need |
| ✅ | ✅ | ⬜ | The ability of a cook to see how this meal relates to what they have been eating lately |
| ✅ | ✅ | ⬜ | The ability of a cook to be told why this is a good thing to cook after the last thing they cooked |
| ✅ | ✅ | ⬜ | The ability of a cook to read the steps in order, with a time estimate on each |
| ✅ | ✅ | ⬜ | The ability of a cook to know when a quantity is an estimate rather than a tested measurement |
| ✅ | ✅ | ⬜ | The ability of a cook to tell a verified recipe from an AI-written one at a glance |

### Asking the AI instead

| BE | WEB | QA | Ability |
|---|---|---|---|
| ✅ | ✅ | ⬜ | The ability of a cook to just talk to the app about what to eat |
| ✅ | — | ⬜ | The ability of every question to carry the cook's kitchen with it, without them repeating it |
| ✅ | — | ⬜ | The ability of every question to carry what they have been eating, what they like, and what time it is |
| ✅ | — | ⬜ | The ability of every question to carry the weather where they are |
| ✅ | ✅ | ⬜ | The ability of an answer to come back as plain words when the question deserves plain words |
| ✅ | ✅ | ⬜ | The ability of an answer to come back as meals they can tap into when the question is about food |
| ✅ | ✅ | ⬜ | The ability of a cook to tap a meal in a reply and open it like any other meal |
| ✅ | ✅ | ⬜ | The ability of a cook to tell an AI-invented meal from one the app actually has |
| ✅ | ✅ | ⬜ | The ability of a cook to start cooking a meal the app has, and only read about one it does not |
| ✅ | ✅ | ⬜ | The ability of the assistant to say plainly that it does not know |
| ✅ | ✅ | ⬜ | The ability of a cook to find what they asked before |
| ✅ | ✅ | ⬜ | The ability of a cook to be kept to cooking — the assistant is not a general chatbot |
| ✅ | ✅ | ⬜ | The ability of a cook to tell the assistant to add something, and have it actually added rather than merely offered |
| ✅ | ✅ | ⬜ | The ability of the assistant to change only the kitchen of the person it is talking to, never anybody else's |
| ✅ | ✅ | ⬜ | The ability of the assistant to be told an action was impossible, and say so instead of claiming it worked |
| ✅ | ✅ | ⬜ | The ability of a cook to see exactly what the assistant did, item by item, including what it could not do |
| ✅ | ✅ | ⬜ | The ability of a half-finished batch to name which parts were skipped and why |
| ✅ | — | ⬜ | The ability of the assistant to be handed the outcome of its own actions and answer again knowing what really happened |
| ✅ | — | ⬜ | The ability of an action to be refused when the request names something that does not exist |
| ✅ | — | ⬜ | The ability of the number of things the assistant does at once to be capped |

### AI recommendations

| BE | WEB | QA | Ability |
|---|---|---|---|
| ✅ | ✅ | ⬜ | The ability of a cook to ask for recommendations and get the same laid-out result as a worked-out suggestion |
| ✅ | ✅ | ⬜ | The ability of those recommendations to be limited to meals the app really has, so every one can be cooked |

### Cooking it

| BE | WEB | QA | Ability |
|---|---|---|---|
| ✅ | ✅ | ⬜ | The ability of a cook to start cooking from a meal's page |
| ✅ | ✅ | ⬜ | The ability of a cook to be warned before starting if they are missing something |
| ✅ | ✅ | ⬜ | The ability of a cook to go ahead anyway, because they know their kitchen better than we do |
| — | ⬜ | ⬜ | The ability of a cook to enter a mode built for a propped-up phone and busy hands |
| — | ⬜ | ⬜ | The ability of a cook to see one step at a time, readable from across the kitchen |
| — | ⬜ | ⬜ | The ability of a cook to move forward and back through steps without losing their place |
| ✅ | ✅ | ⬜ | The ability of a cook to start a timer for a step that needs one |
| — | ⬜ | ⬜ | The ability of a cook's screen to stay awake for the whole cook |
| — | ⬜ | ⬜ | The ability of a cook to leave cook mode only deliberately, never by a stray tap |
| ✅ | ✅ | ⬜ | The ability of cooking a meal to take its ingredients out of the kitchen, without anyone counting |

### Keeping it

| BE | WEB | QA | Ability |
|---|---|---|---|
| ✅ | ✅ | ⬜ | The ability of a cook to favourite a meal |
| ✅ | ✅ | ⬜ | The ability of a cook to find everything they favourited in one place |
| ✅ | ✅ | ⬜ | The ability of a cook to go from a favourite straight into cooking it again |
| ✅ | ✅ | ⬜ | The ability of a cook to unfavourite something |

### Telling it what you have

| BE | WEB | QA | Ability |
|---|---|---|---|
| ✅ | ✅ | ⬜ | The ability of a cook to open the app and land on their kitchen, with what they last said still there |
| ✅ | ✅ | ⬜ | The ability of a cook's kitchen to save itself as they edit it, without a save button |
| ✅ | ✅ | ⬜ | The ability of a cook to photograph a shelf and have the picture kept, so it can be read once reading is switched on |
| — | ✅ | ⬜ | The ability of a cook to be told plainly which ways in are not ready yet, rather than shown a button that does nothing |
| ✅ | ✅ | ⬜ | The ability of a cook to type what they have, and have it understood as a list of ingredients |
| ✅ | ✅ | ⬜ | The ability of a cook to see what they have entered as a list they can remove things from |
| ✅ | ✅ | ⬜ | The ability of a cook to pull in things they used recently, without typing them again |
| — | ✅ | ⬜ | The ability of a cook to be told plainly when they have added nothing yet — and why the button is off |

---

# Group 3 · The standing kitchen

**What the app remembers.** The pantry, its dashboard, and the ways stock gets
into it. Never stock-taken — it fills from what the cook already does.

**Scenes:** `kitchen-dashboard` · `stock-location` · `low-stock` · `add-stock` ·
`stock-detail` · `stock-history` · `use-it-up` · `empty-kitchen`

### The dashboard — what a signed-in cook opens

| BE | WEB | QA | Ability |
|---|---|---|---|
| ✅ | ✅ | ⬜ | The ability of a cook to open the app and see their kitchen at a glance — what is in, what is low, what to use soon, what they could make |
| ✅ | ✅ | ⬜ | The ability of a cook to see what is worth doing something about, rather than a list of everything |
| ⬜ | ⬜ | ⬜ | The ability of a cook to see what the app noticed about their cooking, with the working shown |
| ⬜ | ⬜ | ⬜ | The ability of a cook with an empty kitchen to be offered a photo or a few by hand — and to skip both |
| ⬜ | ⬜ | ⬜ | The ability of a cook to be reminded that skipping is fine, because suggestions work without a pantry |
| ⬜ | ⬜ | ⬜ | The ability of a cook to reach "what should I cook" from the dashboard itself |

### Seeing the stock

| BE | WEB | QA | Ability |
|---|---|---|---|
| ✅ | ✅ | ⬜ | The ability of a cook to see their things grouped by where they live — fridge, shelf, freezer |
| ✅ | ✅ | ⬜ | The ability of a cook to open one thing and see everything that changed its count |
| ✅ | ✅ | ⬜ | The ability of a cook to see what is about to turn, based on when it arrived and how long it keeps |
| ✅ | ✅ | ⬜ | The ability of a cook to see what is running low — only what blocks a meal they cook often |
| ✅ | ✅ | ⬜ | The ability of a cook to know something is simply untracked, rather than being told it is at zero |
| ✅ | ✅ | ⬜ | The ability of a cook to see everything that ever changed their kitchen, and where each change came from |

### Adding stock — choosing how

| BE | WEB | QA | Ability |
|---|---|---|---|
| ✅ | ✅ | ⬜ | The ability of a cook to choose how they add stock — by hand, by photo, or from a receipt |
| ✅ | ✅ | ⬜ | The ability of a cook to be told this is for correcting something, not a chore they owe |

### Adding by hand

| BE | WEB | QA | Ability |
|---|---|---|---|
| ⬜ | ⬜ | ⬜ | The ability of a cook to be shown, on an empty box, that typing is how they start |
| ✅ | ✅ | ⬜ | The ability of a cook to see suggestions as they type, the way a search box behaves |
| ✅ | ✅ | ⬜ | The ability of a cook to tap a suggestion and have it added, without finishing the word |
| ✅ | ✅ | ⬜ | The ability of a cook to see the last few things they added, the moment they tap the box |
| ✅ | ✅ | ⬜ | The ability of a cook to add something the app has never heard of |
| ✅ | ✅ | ⬜ | The ability of a cook to finish adding and move on in one action |

### Confirming what was added

| BE | WEB | QA | Ability |
|---|---|---|---|
| ✅ | ✅ | ⬜ | The ability of a cook to see everything they added, one row each, before it counts |
| ✅ | ✅ | ⬜ | The ability of a cook to raise or lower a count without typing a number |
| ✅ | ✅ | ⬜ | The ability of every row to arrive with the right unit already chosen |
| ✅ | ✅ | ⬜ | The ability of a cook to switch to another way of measuring the same thing |
| ✅ | ✅ | ⬜ | The ability of a cook to invent a unit, and have it offered to them from then on |

### The same flow, reused

| BE | WEB | QA | Ability |
|---|---|---|---|
| ✅ | ✅ | ⬜ | The ability of any part of the app that needs a list of ingredients to reuse this one flow, rather than growing its own |

### Keeping it up to date without counting

| BE | WEB | QA | Ability |
|---|---|---|---|
| ✅ | ✅ | ⬜ | The ability of the kitchen to go down on its own when a meal is cooked |
| ✅ | ✅ | ⬜ | The ability of the kitchen to go up on its own when a market list is shopped |
| ✅ | ✅ | ⬜ | The ability of a cook to correct a count that is wrong — as a correction, never as a chore |

---

# Group 4 · Filling the kitchen from a photo

**How the pantry fills without typing.** A photo of a shelf, or a market
receipt. Every read is checked, nothing is auto-committed, and no request ever
waits on the model.

**Scenes:** `shelf-scan` · `upload-receipt` · `extraction-review` ·
`capture-recovery` · `permission`

### Taking the photos

| BE | WEB | QA | Ability |
|---|---|---|---|
| ✅ | ✅ | ⬜ | The ability of a cook to pick several photos at once, up to five |
| ✅ | ✅ | ⬜ | The ability of a cook to see each photo as a preview the moment it is picked |
| ⬜ | ⬜ | ⬜ | The ability of a cook to open any photo full size to check it is the right one |
| ✅ | ✅ | ⬜ | The ability of a cook to drop a photo before it is read |
| ⬜ | ⬜ | ⬜ | The ability of a cook to be asked for the camera only when it is about to be used, with the reason given |
| ⬜ | ⬜ | ⬜ | The ability of a cook to say no to the camera and still use everything else |

### Checking it is even a photo of food

| BE | WEB | QA | Ability |
|---|---|---|---|
| ✅ | ✅ | ⬜ | The ability of the app to tell quickly and cheaply whether a photo shows food at all |
| ✅ | ✅ | ⬜ | The ability of a cook to be told a photo is unusable before waiting for a full read |
| ✅ | ✅ | ⬜ | The ability of a cook to watch each photo being checked, rather than staring at a blank screen |
| ✅ | — | ⬜ | The ability of that check to run on a small fast model, because it is a cheap question |

### Reading what is there

| BE | WEB | QA | Ability |
|---|---|---|---|
| ✅ | ✅ | ⬜ | The ability of a cook to have the food in their photos listed back to them |
| ✅ | ✅ | ⬜ | The ability of a cook to photograph a market receipt and have the whole shop read off it |
| ✅ | ✅ | ⬜ | The ability of every read to arrive with quantities and units already filled in |
| ✅ | ✅ | ⬜ | The ability of a cook to see what the reading assumed, so they can correct a wrong assumption |
| ✅ | ✅ | ⬜ | The ability of a cook to be shown a problem with the reading only when there genuinely is one |
| ✅ | ✅ | ⬜ | The ability of a cook to review and fix everything that was read, before any of it counts |
| ✅ | ✅ | ⬜ | The ability of a read list to land in the same confirm screen as a hand-typed one |
| ⬜ | ⬜ | ⬜ | The ability of a cook whose capture failed to be offered typing as an equal path, not a consolation |
| ✅ | — | ⬜ | The ability of a kitchen photo to be kept with its reading, so a bad read can be checked later |

---

# Group 5 · The market list

**Closing the loop.** The list is what tops the kitchen back up — and ticking it
off is what updates the pantry without anyone counting.

**Scenes:** `market-list` · `market-mode` · `market-empty`

| BE | WEB | QA | Ability |
|---|---|---|---|
| ✅ | ✅ | ⬜ | The ability of a cook to see what to buy, with a rough total |
| ✅ | ✅ | ⬜ | The ability of a cook to add anything to the list themselves |
| ✅ | ✅ | ⬜ | The ability of a cook to take something off the list |
| ✅ | ✅ | ⬜ | The ability of a cook to tick something as bought |
| ✅ | ✅ | ⬜ | The ability of anything ticked as bought to appear in the kitchen, without being counted in twice |
| ✅ | ✅ | ⬜ | The ability of every item to be pictured, worked out from its name even when it is not one we know |
| ✅ | ✅ | ⬜ | The ability of a cook to see what each item unblocks — which meals it makes cookable |
| ⬜ | ⬜ | ⬜ | The ability of a cook to shop the list one-handed, with a bag in the other |
| ✅ | ✅ | ⬜ | The ability of an empty market list to read as the good outcome, with nothing to do |

---

# Group 6 · Knowing the moment

**Context the assistant gets for free.** None of this is a screen — it is what
makes an answer feel like it knows you, rather than a generic recipe search.

**Scenes:** none — this feeds `chat-meal` · `chat-stock` · `chat-substitution` ·
`chat-about-meal` · `chat-history` · `chat-error`, which live in Group 2

| BE | WEB | QA | Ability |
|---|---|---|---|
| ✅ | ✅ | ⬜ | The ability of a cook to say where they are, so answers can suit the weather |
| ✅ | — | ⬜ | The ability of the app to know the weather in each place its cooks live, refreshed through the day |
| ✅ | — | ⬜ | The ability of the app to look that up once per place per hour, rather than once per person per question |
| ✅ | — | ⬜ | The ability of an answer to account for the time of day without being told |
| ✅ | — | ⬜ | The ability of an answer to account for what the cook has eaten recently |
| ⬜ | ⬜ | ⬜ | The ability of a cook to ask how much of something they have, and be told what took it down |
| ⬜ | ⬜ | ⬜ | The ability of a cook to ask what to use instead of something they are out of |
| ⬜ | ⬜ | ⬜ | The ability of a general-knowledge answer to be labelled as the weakest kind of answer |
| ⬜ | ⬜ | ⬜ | The ability of every answer to show what it was based on |

---

# Group 7 · Your week

**A real run-down of the week, not a scoreboard.** Observations with the working
shown — never points, never streaks, never nagging.

**Scenes:** `week-summary` · `week-empty` · `should-eat` · `nutrition` ·
`repeats` · `spend` · `milestone`

| BE | WEB | QA | Ability |
|---|---|---|---|
| ✅ | ✅ | ⬜ | The ability of a cook to see what they cooked across the week, day by day |
| ✅ | ✅ | ⬜ | The ability of every observation to show the meals it was drawn from |
| ✅ | ✅ | ⬜ | The ability of the app to stay quiet when it has too little to go on, rather than guess |
| ✅ | ✅ | ⬜ | The ability of a cook to see what they cook most — presented as worth knowing, not as a problem |
| ✅ | ✅ | ⬜ | The ability of a cook to see roughly what they ate, clearly labelled as an estimate |
| ✅ | ✅ | ⬜ | The ability of a cook to see roughly what they spent |
| ⬜ | ⬜ | ⬜ | The ability of a cook to ask what they should eat and get an observation, then a way to act on it |
| ⬜ | ⬜ | ⬜ | The ability of a cook to be told they hit a milestone, once, with no points or levels attached |
| ✅ | ✅ | ⬜ | The ability of a cook to read what the AI made of their week, laid out rather than written as an essay |
| ✅ | — | ⬜ | The ability of that reading to be worked out at most once an hour, and only when something actually changed |
| ✅ | ✅ | ⬜ | The ability of the dashboard to carry the same kind of noticing, without opening the week |

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

**Settings that actually do something.** Every switch here changes real
behaviour — a toggle that saves nothing is worse than no toggle.

**Scenes:** `settings` · `offline`

| BE | WEB | QA | Ability |
|---|---|---|---|
| ✅ | ✅ | ⬜ | The ability of a cook to change which cuisines they want, and see suggestions change |
| ✅ | ✅ | ⬜ | The ability of a cook to change how adventurous they are |
| ✅ | ✅ | ⬜ | The ability of a cook to choose metric or imperial, with local measures — derica, congo, tin — always shown alongside |
| ✅ | ✅ | ⬜ | The ability of a cook to manage the units they invented, and drop one they no longer use |
| ✅ | ✅ | ⬜ | The ability of a cook to change where they are, so the weather that shapes answers is right |
| ✅ | ✅ | ⬜ | The ability of a cook to turn low-stock nudges and the weekly summary on or off |
| ✅ | ✅ | ⬜ | The ability of a cook to read plainly what is sent away and how AI is used |
| ⬜ | ⬜ | ⬜ | The ability of a cook to change their password |
| ⬜ | ⬜ | ⬜ | The ability of a cook to sign out |
| ✅ | ✅ | ⬜ | The ability of a cook to delete their account |
| ⬜ | ⬜ | ⬜ | The ability of a cook to open saved recipes with no connection, and to see how old each one is |
| ⬜ | ⬜ | ⬜ | The ability of a cook to install the app on their phone |

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

Flagging these now rather than discovering them mid-build.

- **The seed is the moat, and it is real work.** The deterministic suggestion
  engine matches the kitchen against seeded meals — with no seed there is nothing
  to match, so it is a blocker for Group 2 rather than a nice-to-have. AI may
  draft them; a person must correct them before they ship.
- **AI costs real money per call.** The photo check runs on a small fast model
  deliberately. Until the console's audit and kill-switch exist, anything
  AI-facing should stay behind a flag that can be turned off without a deploy.
- **Weather needs a provider and a key.** The per-city hourly cache keeps the
  cost near zero, but the account still has to exist.
- **Location is asked at signup**, which adds a field to a flow that is currently
  three questions. Worth deciding whether it is required or skippable.
- **The job queue is in-process by design.** Jobs live in Mongo so they survive a
  restart, but they run in the API process — one machine's worth of throughput.
  It is deliberately behind an interface so Redis or BullMQ is a swap, not a
  rewrite.
- **Cost and shelf life in the catalogue are estimates**, placed to make the
  feature work end to end. They are meant to be corrected, not trusted.
- **Roles differ from the reference backend.** We have four
  (user / moderator / admin / super_admin) where it had two. Ours is a superset,
  so nothing is blocked — the console just needs to say which role each screen
  requires.
