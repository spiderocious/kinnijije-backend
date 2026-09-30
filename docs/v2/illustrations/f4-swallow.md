# Weight · swallow

`SLOT F4` · illustration prompt

| | |
|---|---|
| **Goes in** | `design.html` → section 03, right column `.tiles.c2.wide` |
| **Marker** | `<!-- ILLUSTRATION SLOT F4 -->` |
| **Generate at** | 512×512 |
| **Renders at** | 36×36 |
| **Save as** | `web/public/illustrations/f4-swallow.png` |

**The job:** A category tile — the shape of a plate, never a specific dish.

> **This file is self-contained.** Everything Gemini needs is in the one fenced block
> below — paste it as a single prompt with no extra instructions. The style rules are
> repeated in every file on purpose: a generator has no memory between calls, and the
> shared look is the whole point. See [`_style.md`](_style.md) for why each rule exists.

---

## The prompt

```
A hand-drawn flat illustration of a single food item, drawn as a simple icon.

STYLE
Single-weight hand-drawn ink outline, in cool soft-black #132430 — never pure black.
Rounded line caps and joins, with a slight natural pen wobble. Flat colour fill, one colour
per shape. No gradients, no shading, no drop shadows, no highlights, no texture, no 3D.
Straight-on flat perspective. VERY low detail: this renders at 44 pixels, so any detail
that would vanish at thumbnail size must be left out entirely.
Warm and plain in mood. Real food in a Nigerian home kitchen. Not kawaii, not corporate
flat-vector, not isometric, not 3D.
No yellow anywhere, no pure black, no gradients.

OUTPUT
Fill the ENTIRE background with ONE FLAT SOLID COLOUR: pure magenta #FF00FF.
The background must be a single uniform block of that exact colour, edge to edge,
behind and around the artwork. Nothing else in the image may use magenta or any
pink close to it.

Do NOT draw a checkerboard. Do NOT draw a grey-and-white squares pattern to
represent transparency. Do NOT make the background transparent, white, grey or
gradient. A literal flat magenta fill is what is wanted — it is removed
automatically afterwards, so it will never be seen.

PNG, square canvas, 512×512. Subject centred with even padding, nothing
touching the edges. No text, no lettering, no watermark. No drop
shadow on the background, no glow, no vignette, no reflection under the subject —
the artwork must sit directly on the flat colour.

SUBJECT

A smooth round ball of swallow (fufu, amala or eba) resting on a shallow oval plate, seen
straight-on. The plate is a flat ellipse filled pale grey-blue (#e7eef4); the ball is a
plain circle filled white (#ffffff), sitting on top and slightly overlapping the plate's
upper edge. One short shallow curve inside the ball to suggest its soft rounded form.
No soup, no bowl, no hand, no fingers.
```

---

## Before you accept it

- [ ] Reads clearly at **36×36** — not just at 512px. This is the test that matters.
- [ ] Background is **flat magenta `#FF00FF`**, edge to edge — not a checkerboard,
      not white, not transparent. Nothing touching the canvas edge.
- [ ] No drop shadow, glow or vignette bleeding into the background.
- [ ] No text, lettering, watermark or signature anywhere.
- [ ] Only colours from the palette in [`_style.md`](_style.md). **No yellow.** No pure black.
- [ ] Flat fills — no gradient, no gloss, no drop shadow inside the artwork.
