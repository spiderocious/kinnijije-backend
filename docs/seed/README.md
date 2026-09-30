# 100 Nigerian recipes for import

`meals-100.json` — 100 recipes in the exact shape of the `meals` collection,
ready for `mongoimport`. None of them collide with the 24 already seeded.

**You asked to review this properly, so the first section is what to distrust.**

## What I checked, and what I could not

Everything structural is verified by `verify-meals.py`, which reads the real
`catalogue.data.ts`, `units.ts` and `koboyo-data.ts` rather than a copy:

```bash
python3 docs/seed/verify-meals.py
```

It confirms all 116 distinct ingredient ids resolve against the 417 catalogue
entries, every unit is real, every `heroIcon` exists, `ingredientKeys` matches
the ingredient list on every meal, step indices run 1..n, and no slug or `_id`
repeats. That currently passes clean.

**What no script can check is whether the cooking is right.** The quantities,
timings and methods are written from general knowledge of the food, not from
testing any of them in a kitchen. Specifically worth your eye:

- **Timings** are estimates. `kilishi` claims 240 minutes and is really a
  day's work; several soups assume the meat is tender in 25 minutes, which
  depends entirely on the cut and the pot.
- **Quantities** are plausible household amounts, not measured. Palm oil
  volumes especially — I have been generous, in line with how these dishes are
  actually cooked, but you may want them lower.
- **Two dishes are dropped in as substitutions.** `ugba` (fermented oil bean)
  and `ukwa` (African breadfruit) have no catalogue entry, so rather than
  invent an id that would import cleanly and then never match anything, I
  replaced those recipes with **Peppered Snail** and **Goat Meat Pepper Soup**.
  If you want ugba and ukwa, they need catalogue entries first.
- **Regional attribution** may be contestable. `frejon` is tagged Yoruba as a
  Lagos dish; `atama-soup` is filed as an Efik reading of banga. Reasonable
  people disagree about some of these.
- **Potash** is used in nkwobi, isi ewu and abacha to emulsify the palm oil.
  I first wrote these with potash in the method but not the ingredient list,
  which would have made it invisible to matching and to the market list. It is
  now a listed ingredient (`potash`) in all three.

## Import

```bash
mongoimport --uri='mongodb+srv://…prod…' \
  --collection=meals \
  --file=docs/seed/meals-100.json \
  --jsonArray \
  --mode=upsert --upsertFields=slug
```

`--jsonArray` is required — the file is one array. `--mode=upsert
--upsertFields=slug` makes it re-runnable; without it, a second run gives you
200 meals and every suggestion appears twice.

The `_id` values are generated from a fixed seed, so re-running the generator
produces the same ids rather than duplicates.

Dates are Extended JSON (`{"$date": …}`), which `mongoimport` reads correctly.
A hand-written `JSON.parse` + `insertMany` would store them as plain objects
and break anything that sorts or formats them.

## The two fields that fail silently

- **`ingredientKeys`** — the denormalised ids the matcher runs on. Wrong or
  empty means the meal imports fine, appears in `/admin/recipes`, and is never
  suggested to anybody. Nothing is logged.
- **`status: "published"`** — a draft is invisible to suggestions.

Both are correct throughout this file; they are listed because they are what to
check if a recipe ever goes missing.

## Composition

| | |
|---|---|
| Total | 100 |
| Difficulty | 55 easy · 36 medium · 9 involved |
| Cook time | 5–240 min |
| Regional | 17 Yoruba · 16 Igbo · 13 Northern · 5 Efik · 1 Delta · rest general |
| Average | 8.2 ingredients, 4.3 steps |

Every recipe carries `whatMakesItGood` — the one-line reason a person actually
cooks it, in the same voice as the existing 24.

## The full list

| # | slug | name | region | difficulty | time | ingr | steps |
|---|------|------|--------|-----------|------|------|-------|
| 1 | `nsala-soup` | Ofe Nsala (White Soup) | Igbo | medium | 55m | 9 | 5 |
| 2 | `oha-soup` | Oha Soup | Igbo | medium | 60m | 11 | 5 |
| 3 | `edikang-ikong` | Edikang Ikong | Efik | involved | 70m | 12 | 5 |
| 4 | `atama-soup` | Banga Soup with Atama | Efik | medium | 65m | 9 | 4 |
| 5 | `gbegiri` | Gbegiri | Yoruba | medium | 60m | 7 | 4 |
| 6 | `ofe-akwu` | Ofe Akwu (Palm Nut Stew) | Igbo | medium | 55m | 9 | 4 |
| 7 | `ogbono-okra-mix` | Ogbono and Okra Mix | — | easy | 40m | 11 | 5 |
| 8 | `fisherman-soup` | Fisherman Soup | Efik | involved | 50m | 10 | 5 |
| 9 | `groundnut-soup` | Groundnut Soup | Northern | medium | 50m | 9 | 5 |
| 10 | `bitterleaf-soup` | Ofe Onugbu (Bitterleaf Soup) | Igbo | medium | 65m | 11 | 5 |
| 11 | `stew-beef-tomato` | Nigerian Beef Stew | — | easy | 60m | 11 | 5 |
| 12 | `native-jollof` | Native Jollof (Palm Oil Jollof) | Igbo | medium | 65m | 11 | 5 |
| 13 | `coconut-jollof` | Coconut Jollof Rice | — | medium | 60m | 12 | 5 |
| 14 | `native-rice-palm` | Palm Oil Rice (Iwuk Edesi) | Efik | medium | 55m | 10 | 5 |
| 15 | `tuwo-shinkafa` | Tuwo Shinkafa | Northern | easy | 35m | 3 | 4 |
| 16 | `tuwo-masara` | Tuwo Masara | Northern | easy | 30m | 3 | 4 |
| 17 | `amala-ewedu` | Amala and Ewedu | Yoruba | easy | 30m | 7 | 5 |
| 18 | `eba` | Eba | — | easy | 10m | 2 | 3 |
| 19 | `semo-swallow` | Semo | — | easy | 15m | 2 | 3 |
| 20 | `pounded-yam` | Pounded Yam | Yoruba | medium | 40m | 3 | 4 |
| 21 | `fufu-cassava` | Cassava Fufu | — | medium | 30m | 2 | 4 |
| 22 | `peppered-chicken` | Peppered Chicken | — | easy | 45m | 11 | 4 |
| 23 | `asun` | Asun (Peppered Goat) | Yoruba | medium | 60m | 9 | 4 |
| 24 | `nkwobi` | Nkwobi | Igbo | involved | 75m | 8 | 5 |
| 25 | `isi-ewu` | Isi Ewu | Igbo | involved | 80m | 8 | 5 |
| 26 | `ofada-stew-ayamase-alt` | Designer Stew (Ofada Sauce) | Yoruba | involved | 80m | 11 | 5 |
| 27 | `egg-sauce` | Egg Sauce | — | easy | 20m | 7 | 4 |
| 28 | `fried-fish` | Nigerian Fried Fish | — | easy | 30m | 9 | 5 |
| 29 | `catfish-peppersoup-light` | Point and Kill Catfish | — | easy | 35m | 8 | 4 |
| 30 | `gizzard-dodo` | Gizdodo with Gizzard | — | easy | 40m | 10 | 4 |
| 31 | `chicken-peppersoup` | Chicken Pepper Soup | — | easy | 45m | 8 | 4 |
| 32 | `pap-and-akara` | Pap and Akara | — | easy | 35m | 8 | 5 |
| 33 | `ogi-custard` | Custard | — | easy | 15m | 4 | 3 |
| 34 | `puff-puff` | Puff Puff | — | easy | 90m | 7 | 4 |
| 35 | `chin-chin` | Chin Chin | — | easy | 60m | 9 | 5 |
| 36 | `meat-pie` | Nigerian Meat Pie | — | involved | 95m | 11 | 5 |
| 37 | `buns` | Nigerian Buns | — | easy | 40m | 9 | 4 |
| 38 | `boli-groundnut` | Boli and Groundnut | — | easy | 25m | 5 | 3 |
| 39 | `yam-porridge-asaro-plain` | Yam and Vegetable Porridge | — | easy | 40m | 10 | 4 |
| 40 | `beans-porridge` | Beans Porridge | — | easy | 70m | 8 | 4 |
| 41 | `akara-plain` | Akara | — | medium | 45m | 6 | 4 |
| 42 | `miyan-kuka` | Miyan Kuka | Northern | easy | 40m | 9 | 4 |
| 43 | `miyan-taushe` | Miyan Taushe | Northern | medium | 55m | 10 | 5 |
| 44 | `dan-wake` | Dan Wake | Northern | medium | 50m | 8 | 4 |
| 45 | `masa` | Masa | Northern | medium | 90m | 6 | 4 |
| 46 | `kilishi` | Kilishi | Northern | involved | 240m | 8 | 5 |
| 47 | `zobo-drink` | Zobo | — | easy | 40m | 7 | 4 |
| 48 | `kunu-aya` | Kunu Aya (Tigernut Drink) | Northern | easy | 40m | 5 | 4 |
| 49 | `chapman` | Chapman | — | easy | 10m | 6 | 3 |
| 50 | `suya-spice-beef-skewers` | Beef Suya Skewers | Northern | medium | 60m | 9 | 5 |
| 51 | `abacha` | Abacha (African Salad) | Igbo | medium | 45m | 10 | 5 |
| 52 | `macaroni-jollof` | Macaroni Jollof | — | easy | 40m | 11 | 4 |
| 53 | `spaghetti-stir-fry` | Nigerian Spaghetti Stir Fry | — | easy | 35m | 11 | 4 |
| 54 | `yam-pottage-egg` | Boiled Yam and Egg Sauce | — | easy | 30m | 8 | 4 |
| 55 | `plantain-egg` | Fried Plantain and Egg | — | easy | 20m | 7 | 4 |
| 56 | `indomie-egg` | Indomie and Egg | — | easy | 15m | 7 | 4 |
| 57 | `corn-and-ube` | Boiled Corn and Ube | Igbo | easy | 30m | 4 | 3 |
| 58 | `ewa-oil` | Ewa Riro | Yoruba | easy | 65m | 8 | 4 |
| 59 | `frejon` | Frejon | Yoruba | medium | 70m | 5 | 4 |
| 60 | `okra-soup-plain` | Okra Soup with Assorted Meat | — | easy | 40m | 11 | 5 |
| 61 | `white-soup-goat` | Goat Meat White Soup | Igbo | medium | 70m | 9 | 4 |
| 62 | `miyan-agushi` | Miyan Agushi | Northern | medium | 50m | 9 | 5 |
| 63 | `ila-alasepo` | Ila Alasepo | Yoruba | easy | 35m | 10 | 4 |
| 64 | `efo-elegusi` | Efo Elegusi | Yoruba | medium | 55m | 11 | 5 |
| 65 | `ayamase-plain` | Ayamase | Yoruba | involved | 75m | 10 | 5 |
| 66 | `ogbono-plain` | Ogbono Soup | Igbo | easy | 40m | 10 | 5 |
| 67 | `afang-plain` | Afang Soup | Efik | medium | 60m | 12 | 5 |
| 68 | `egusi-plain` | Egusi Soup | Igbo | medium | 55m | 11 | 5 |
| 69 | `vegetable-sauce` | Vegetable Sauce | — | easy | 30m | 9 | 4 |
| 70 | `stewed-beans-corn` | Adalu (Beans and Corn) | Yoruba | easy | 75m | 8 | 4 |
| 71 | `fried-yam-sauce` | Dundu and Pepper Sauce | Yoruba | easy | 35m | 8 | 4 |
| 72 | `moin-moin-plain` | Moin Moin | — | medium | 75m | 9 | 5 |
| 73 | `ewa-agoyin-sauce` | Ewa Agoyin Sauce | Yoruba | medium | 50m | 6 | 5 |
| 74 | `fried-rice-nigerian` | Nigerian Fried Rice | — | medium | 55m | 11 | 5 |
| 75 | `jollof-spaghetti-plain` | Jollof Spaghetti | — | easy | 35m | 11 | 4 |
| 76 | `ofada-rice-plain` | Ofada Rice | Yoruba | easy | 50m | 3 | 4 |
| 77 | `agege-bread-stew` | Agege Bread and Stew | — | easy | 15m | 7 | 3 |
| 78 | `akara-osu` | Akara Osu | Igbo | medium | 50m | 7 | 4 |
| 79 | `okpa` | Okpa | Igbo | medium | 70m | 7 | 5 |
| 80 | `garri-soakings` | Garri Soakings | — | easy | 5m | 5 | 3 |
| 81 | `suya-chicken` | Chicken Suya | Northern | medium | 55m | 8 | 5 |
| 82 | `plantain-porridge-plain` | Plantain Porridge | — | easy | 40m | 10 | 4 |
| 83 | `asaro-plain` | Asaro (Yam Porridge) | Yoruba | easy | 45m | 9 | 4 |
| 84 | `tomato-stew-base` | Basic Tomato Stew Base | — | easy | 45m | 8 | 4 |
| 85 | `pepper-sauce-obe-ata` | Obe Ata Dindin | Yoruba | easy | 40m | 7 | 4 |
| 86 | `coconut-rice-plain` | Coconut Rice | — | easy | 45m | 8 | 4 |
| 87 | `chicken-stew-plain` | Chicken Stew | — | easy | 60m | 11 | 5 |
| 88 | `beef-suya-wrap` | Suya Wrap | — | easy | 25m | 7 | 4 |
| 89 | `fish-stew` | Fish Stew | — | easy | 45m | 10 | 4 |
| 90 | `peppered-snail` | Peppered Snail | — | medium | 50m | 9 | 4 |
| 91 | `kunu-zaki` | Kunu Zaki | Northern | medium | 60m | 5 | 4 |
| 92 | `ofe-owerri` | Ofe Owerri | Igbo | involved | 75m | 13 | 5 |
| 93 | `banga-rice` | Banga Rice | Delta | medium | 60m | 9 | 5 |
| 94 | `garden-egg-sauce` | Garden Egg Sauce | Igbo | easy | 35m | 8 | 4 |
| 95 | `pepper-soup-goat` | Goat Meat Pepper Soup | — | easy | 60m | 9 | 4 |
| 96 | `jollof-beans` | Jollof Beans | — | easy | 75m | 9 | 4 |
| 97 | `scrambled-egg-sausage` | Nigerian Breakfast Eggs | — | easy | 15m | 7 | 4 |
| 98 | `okpa-yam-balls` | Yam Balls | — | medium | 45m | 8 | 4 |
| 99 | `ogi-baba` | Ogi (Fermented Corn Pap) | — | easy | 20m | 4 | 4 |
| 100 | `efo-riro-plain` | Efo Riro | Yoruba | medium | 45m | 12 | 5 |