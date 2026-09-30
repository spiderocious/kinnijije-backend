# The hero dish

`SLOT E` · illustration prompt

| | |
|---|---|
| **Goes in** | `design.html` → section 05, `.verdict .plate` |
| **Marker** | `<!-- ILLUSTRATION SLOT E -->` |
| **Generate at** | 1024×1024 |
| **Renders at** | 168×124 |
| **Save as** | `web/public/illustrations/e-hero-dish.png` |

**The job:** The payoff image. The most finished illustration in the flow.

> **This file is self-contained.** Everything Gemini needs is in the one fenced block
> below — paste it as a single prompt with no extra instructions. The style rules are
> repeated in every file on purpose: a generator has no memory between calls, and the
> shared look is the whole point. See [`_style.md`](_style.md) for why each rule exists.

---

## The prompt

```
A hand-drawn flat illustration of a plated Nigerian meal: mashed beans with fried plantain.

SUBJECT
A wide white oval plate seen from slightly above, so it reads as an ellipse — filled white
(#ffffff) with a clean dark outline. The plate is the base of the composition and sits
across the lower half.

On the left two-thirds of the plate, a generous rounded mound of mashed beans (ewa agoyin):
a soft dome shape filled warm brown-orange, a muted #ffe0b0 deepened with a translucent
warm brown so it is clearly darker than the plate behind it. Scattered across the mound,
five small oval beans drawn as thin outlined ellipses in warm brown (#8a4b1e), each tilted
at a different angle — suggesting texture without becoming a pattern.

On the right third, two slices of fried plantain (dodo) overlapping each other, drawn as
plain ellipses filled pale gold (#fef3e0) with the standard dark outline, each tilted at a
slightly different angle so they read as two separate slices lying on the plate.

Rising from the beans, three short curly steam wisps in warm brown (#8a4b1e) at reduced
opacity, so the food reads as hot and just served.

No cutlery, no napkin, no table, no garnish, no background, no bowl behind the plate.

STYLE
Single-weight hand-drawn ink outline, about 3px at this size, in cool soft-black #132430 —
never pure black. Rounded caps and joins, slight natural pen wobble. Flat colour fills only,
one flat colour per shape — the beans may use one flat darker tone, but no gradient and no
blending. No shading, no drop shadows, no highlights, no gloss, no steam glow, no texture
overlay, no 3D.
Seen from slightly above, flat and straight-on otherwise. Appetising but plain: real home
food, generously served. Not a glossy restaurant photo, not kawaii, not corporate
flat-vector, not 3D-rendered.

IMPORTANT: this will be placed on a warm pale orange background (#ffe0b0), so the food must
stay clearly distinguishable from that colour — keep the plate white and the beans
noticeably darker than pale orange.

COLOUR — use only these
Outline #132430. Plate #ffffff. Beans a deepened warm brown-orange over #ffe0b0, with
#8a4b1e detail. Plantain #fef3e0. Steam #8a4b1e at low opacity.
No yellow, no pure black, no gradients, no gloss.

OUTPUT
Fill the ENTIRE background with ONE FLAT SOLID COLOUR: pure magenta #FF00FF.
The background must be a single uniform block of that exact colour, edge to edge,
behind and around the artwork. Nothing else in the image may use magenta or any
pink close to it.

Do NOT draw a checkerboard. Do NOT draw a grey-and-white squares pattern to
represent transparency. Do NOT make the background transparent, white, grey or
gradient. A literal flat magenta fill is what is wanted — it is removed
automatically afterwards, so it will never be seen.

PNG, square canvas, 1024×1024. The plate centred with even padding, nothing
touching the edges. No text, no lettering, no watermark. No drop
shadow on the background, no glow, no vignette, no reflection under the subject —
the artwork must sit directly on the flat colour.
```

---

## Notes

The example below is **ewa agoyin with dodo**. The same prompt structure serves any hero
dish; swap the SUBJECT paragraph and keep everything else.

## Variants worth generating

Same prompt, new SUBJECT paragraph. The verdict screen picks by `heroIcon` / `slug`, so a
missing variant falls back to the koboyo glyph and nothing breaks.

| Dish | Subject swap |
|---|---|
| **Jollof rice** | A mound of orange-red rice (`#fdebeb` deepened, grains as short `#8a4b1e` strokes) with two plantain slices and one piece of chicken. |
| **Efo riro** | A white bowl of dark leafy green stew (`#cbefd2` deepened, `#2c6b45` leaf edges) with pale chunks of fish and meat showing through. |
| **Pepper soup** | A shallow white bowl of thin reddish broth (`#fdebeb`) with two pale fish pieces breaking the surface and three steam wisps. |
| **Amala & ewedu** | A smooth dark brown swallow mound (`#8a4b1e` fill) beside a pool of pale green ewedu (`#cbefd2`), on one white plate. |
| **Moi moi** | Two wedges of steamed bean pudding, `#ffe0b0` deepened, one leaf wrapper edge in `#cbefd2` peeled back beneath. |
| **Akara & pap** | Four round golden-brown fritters (`#fef3e0`) on a plate beside a small white cup of pale cream pap. |


## Before you accept it

- [ ] Reads clearly at **168×124** — not just at 1024px. This is the test that matters.
- [ ] Background is **flat magenta `#FF00FF`**, edge to edge — not a checkerboard,
      not white, not transparent. Nothing touching the canvas edge.
- [ ] No drop shadow, glow or vignette bleeding into the background.
- [ ] No text, lettering, watermark or signature anywhere.
- [ ] Only colours from the palette in [`_style.md`](_style.md). **No yellow.** No pure black.
- [ ] Flat fills — no gradient, no gloss, no drop shadow inside the artwork.
