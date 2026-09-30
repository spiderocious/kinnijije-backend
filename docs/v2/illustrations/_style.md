# The house style

Shared reference for every file in this folder. **You do not need to paste this** — each
illustration file already contains the rules it needs inside its own fenced prompt. This
file exists so the rules have one place to be *changed*, and so each one's reasoning is
recorded.

If you edit a rule here, edit it in the affected prompt files too. They are deliberately
duplicated: a generator has no memory between calls, so a prompt that relies on context
elsewhere produces off-style output.

---

## Read this first — the house style

Everything below shares one visual language, lifted from the app's real icon set
(187 re-stroked koboyo hand-drawn glyphs, rendered via `illustrationFor(name)`).

| Rule | Value |
|---|---|
| **Line** | Single-weight hand-drawn ink outline, ~3px at a 200px render. Slight wobble, as if drawn with a felt pen. Rounded caps and joins. Never tapered, never calligraphic, never sketchy-multiline. |
| **Ink colour** | `#132430` — a cool soft-black. Never pure `#000`. |
| **Fill** | Flat. One colour per shape. No gradients, no blends, no airbrush, no texture. |
| **Shading** | None. No drop shadows inside the artwork, no ambient occlusion, no highlights except a single flat shape where a spec highlight is explicitly asked for. |
| **Background** | Pure transparent. No card, no circle badge, no ground plane unless the prompt names one. |
| **Perspective** | Flat, straight-on, or very slightly above. No dramatic angles, no vanishing points. |
| **Detail level** | Low. Each illustration must read at 44px. If a detail disappears at thumbnail size, leave it out. |
| **Mood** | Warm, plain, competent. A Nigerian home kitchen, not a studio. Never cute-kawaii, never corporate-flat-vector, never 3D, never isometric. |

### The palette — use only these

```
ink          #132430   every outline
paper        #f7fafc   page ground (usually transparent instead)
white        #ffffff   plates, rims, bowls
sky-500      #38b6f0   the action colour — sparingly, for "the app is thinking"
sky-100      #e4f4fe   pale blue fill (fish, cool items)
sky-300      #a8dcf7   steam when the subject is the app itself
dish-fill    #ffe0b0   warm starch — rice, yam, plantain, dough
dish-line    #8a4b1e   warm brown detail on dish-fill shapes
greens-fill  #cbefd2   leaves, beans, vegetables
greens-line  #2c6b45   green detail lines
berry-fill   #f9d2e4   onion, fruit, soft pink
berry-line   #8e3560   pink detail lines
critical-soft #fdebeb  tomato / pepper pale red
critical     #f0605d   pepper red accent
caution-soft #fef3e0   fried plantain, golden food
grape        #8b7cf6   ONLY for "a machine is thinking"
grape-soft   #efecfe   pale purple fill, same rule
```

**Forbidden:** yellow anywhere. Pure black. Pure saturated red or green. Gradients. Gloss.
Drop shadows. Text or lettering of any kind. Watermarks. Human faces, except the four
mood faces in slot C, which are simple circles.

### Output requirements — repeat in every prompt

- Transparent PNG, square canvas.
- Subject centred with even padding; nothing touching the edge.
- 1024×1024 for hero art (slots A, D, E), 512×512 for tiles (slots B, C, F).
- One subject per image. No grids, no variations, no side-by-side alternatives.

---

## Why the duplication is deliberate

Every prompt file repeats the style block, the palette constraint and the output
requirements. That is not an oversight:

- **Image generators are stateless.** A prompt that says "same style as before" has no
  "before" to refer to.
- **The files are used one at a time**, often weeks apart, possibly by different people.
  A prompt that only works when read in order is a prompt that will be used wrong.
- **The shared look is the entire point.** 17 illustrations that are individually good and
  collectively inconsistent are worse than 17 plain ones that match.

## Relationship to meal photography

This folder is **illustration only** — flat, hand-drawn, line-and-fill, generated once by
hand and committed to the repo.

Meal photography is a different thing entirely: photorealistic, generated on demand from
the admin console, reviewed, and stored in R2. Its prompts live in
[`../recipe-photography.md`](../recipe-photography.md) and its pipeline in
[`../image-pipeline.html`](../image-pipeline.html).

> **Never mix the two on one surface.** An illustration beside a photograph of the same
> dish reads as two products. The flow uses drawn art *until* photography exists for a
> meal, then swaps wholesale.
