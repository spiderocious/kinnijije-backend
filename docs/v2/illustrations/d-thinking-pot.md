# The thinking pot

`SLOT D` · illustration prompt

| | |
|---|---|
| **Goes in** | `design.html` → section 04, `.blobwrap` |
| **Marker** | `<!-- ILLUSTRATION SLOT D -->` |
| **Generate at** | 1024×1024 |
| **Renders at** | 104×104 |
| **Save as** | `web/public/illustrations/d-thinking-pot.png` |

**The job:** Show that a machine is working. The ONE illustration allowed to use grape.

> **This file is self-contained.** Everything Gemini needs is in the one fenced block
> below — paste it as a single prompt with no extra instructions. The style rules are
> repeated in every file on purpose: a generator has no memory between calls, and the
> shared look is the whole point. See [`_style.md`](_style.md) for why each rule exists.

---

## The prompt

```
A hand-drawn flat illustration of a cooking pot that is thinking, drawn in purple.

SUBJECT
A wide shallow cooking pot seen straight-on, the same construction as a normal pot: a
rounded body, a separate white rim band (#ffffff) across the top. The pot body is filled
pale lavender (#efecfe) and — unusually — its outline is drawn in deep purple (#3f2e9e)
rather than black, because this pot represents the app's own thinking.

Inside the pot, three round pieces peek over the rim, filled in medium purple (#8b7cf6) and
pale purple (#cfc6fb), plain flat circles at slightly different heights.

Rising from the pot, three short curly steam wisps in medium purple (#8b7cf6), the same
hand-drawn curl as ordinary steam. The wisps should feel light and active, as if something
is working below.

No hob, no ground line, no background, no question mark, no gears, no lightbulb, no robot
imagery of any kind. The purple is the only signal that a machine is involved.

STYLE
Single-weight hand-drawn ink outline, about 3px at this size, rounded caps and joins, with
a slight natural pen wobble. Flat colour fills only, one per shape. No gradients, no
shading, no drop shadows, no highlights, no glow, no texture, no 3D. Straight-on flat
perspective. Low detail — must read at 104 pixels.
Calm and busy, not frantic. Not kawaii, not corporate flat-vector, not 3D.

COLOUR — use only these
Outline #3f2e9e. Pot body #efecfe. Rim #ffffff. Steam #8b7cf6.
Contents #8b7cf6 and #cfc6fb.
No black outline on this one. No yellow, no gradients, no glow.

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

- [ ] Reads clearly at **104×104** — not just at 1024px. This is the test that matters.
- [ ] Background is **flat magenta `#FF00FF`**, edge to edge — not a checkerboard,
      not white, not transparent. Nothing touching the canvas edge.
- [ ] No drop shadow, glow or vignette bleeding into the background.
- [ ] No text, lettering, watermark or signature anywhere.
- [ ] Only colours from the palette in [`_style.md`](_style.md). **No yellow.** No pure black.
- [ ] Flat fills — no gradient, no gloss, no drop shadow inside the artwork.
