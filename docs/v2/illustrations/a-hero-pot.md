# The hero pot

`SLOT A` · illustration prompt

| | |
|---|---|
| **Goes in** | `design.html` → section 01, `.heroart` |
| **Marker** | `<!-- ILLUSTRATION SLOT A -->` |
| **Generate at** | 1024×1024 |
| **Renders at** | 200×168 |
| **Save as** | `web/public/illustrations/a-hero-pot.png` |

**The job:** Say "we answer the question what do I cook" in one image, before any text is read.

> **This file is self-contained.** Everything Gemini needs is in the one fenced block
> below — paste it as a single prompt with no extra instructions. The style rules are
> repeated in every file on purpose: a generator has no memory between calls, and the
> shared look is the whole point. See [`_style.md`](_style.md) for why each rule exists.

---

## The prompt

```
A hand-drawn flat illustration of an open cooking pot with a question mark rising out of it
as steam.

SUBJECT
A wide, shallow cooking pot seen straight-on, slightly above eye level so a little of the
contents shows. The pot body is a warm pale orange (#ffe0b0) with a clean white rim
(#ffffff) sitting across the top like a separate band. Two simple curved handles, one on
each side, drawn as open loops in outline only. Inside the pot, three round pieces of food
peek over the rim: one pale green circle (#cbefd2), one pale red circle (#fdebeb), one pale
blue circle (#a8dcf7) — each a plain flat circle with a thin darker outline, suggesting
vegetables without being identifiable.

THE KEY IDEA
Rising from the pot, three short curly steam wisps in pale blue (#a8dcf7), and among them a
single large question mark drawn in the same hand-drawn pen line, in medium blue (#1798d6).
The question mark should look like it is made of steam — same curl, same weight as the
wisps — so it reads as the pot itself asking the question. It is the focal point: make it
prominent and clearly legible.

Below the pot, one short straight horizontal line in muted grey-blue (#9cb0bd) suggesting a
hob surface. Nothing else — no stove, no kitchen, no background.

STYLE
Single-weight hand-drawn ink outline, about 3px at this size, in cool soft-black #132430 —
never pure black. Rounded line caps and joins. A slight natural wobble in the line, like a
felt-tip pen, not a ruler. Flat colour fills only: one flat colour per shape. No gradients,
no shading, no drop shadows, no highlights, no texture, no 3D. Straight-on flat perspective.
Low detail — it must still read clearly at 200 pixels wide.

Warm, plain and competent in mood. A real home kitchen pot, not a cartoon. Not kawaii, not
corporate flat-vector, not isometric, not 3D-rendered.

COLOUR — use only these
Outline #132430. Pot body #ffe0b0. Rim #ffffff. Steam and the question mark #a8dcf7 and
#1798d6. Food circles #cbefd2, #fdebeb, #a8dcf7. Hob line #9cb0bd.
No yellow anywhere. No pure black. No gradients.

OUTPUT
Fill the ENTIRE background with ONE FLAT SOLID COLOUR: pure magenta #FF00FF.
The background must be a single uniform block of that exact colour, edge to edge,
behind and around the artwork. Nothing else in the image may use magenta or any
pink close to it.

Do NOT draw a checkerboard. Do NOT draw a grey-and-white squares pattern to
represent transparency. Do NOT make the background transparent, white, grey or
gradient. A literal flat magenta fill is what is wanted — it is removed
automatically afterwards, so it will never be seen.

PNG, square canvas, 1024×1024. Subject centred with even padding, nothing
touching the edges. No text, no lettering, no watermark, no numbers. No drop
shadow on the background, no glow, no vignette, no reflection under the subject —
the artwork must sit directly on the flat colour.
```

---

## Notes

---

## Before you accept it

- [ ] Reads clearly at **200×168** — not just at 1024px. This is the test that matters.
- [ ] Background is **flat magenta `#FF00FF`**, edge to edge — not a checkerboard,
      not white, not transparent. Nothing touching the canvas edge.
- [ ] No drop shadow, glow or vignette bleeding into the background.
- [ ] No text, lettering, watermark or signature anywhere.
- [ ] Only colours from the palette in [`_style.md`](_style.md). **No yellow.** No pure black.
- [ ] Flat fills — no gradient, no gloss, no drop shadow inside the artwork.
