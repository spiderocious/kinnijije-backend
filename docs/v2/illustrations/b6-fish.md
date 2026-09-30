# Fish tile

`SLOT B6` · illustration prompt

| | |
|---|---|
| **Goes in** | `design.html` → section 02, `.tiles.c3` |
| **Marker** | `<!-- ILLUSTRATION SLOT B6 -->` |
| **Generate at** | 512×512 |
| **Renders at** | 44×44 |
| **Save as** | `web/public/illustrations/b6-fish.png` |

**The job:** An ingredient tile. Must read at 44px.

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

A single whole dried or fresh fish seen from the side, horizontal, head to the left. A
simple pointed-oval body, a triangular notched tail on the right, one small triangular
dorsal fin on top and one small fin below. Fill the body in pale blue (#e4f4fe). One small
solid dot for the eye near the head in the outline colour. Two or three very short curved
strokes on the body to suggest gill and scale, no more. No fishing rod, no plate, no water.
```

---

## Before you accept it

- [ ] Reads clearly at **44×44** — not just at 512px. This is the test that matters.
- [ ] Background is **flat magenta `#FF00FF`**, edge to edge — not a checkerboard,
      not white, not transparent. Nothing touching the canvas edge.
- [ ] No drop shadow, glow or vignette bleeding into the background.
- [ ] No text, lettering, watermark or signature anywhere.
- [ ] Only colours from the palette in [`_style.md`](_style.md). **No yellow.** No pure black.
- [ ] Flat fills — no gradient, no gloss, no drop shadow inside the artwork.
