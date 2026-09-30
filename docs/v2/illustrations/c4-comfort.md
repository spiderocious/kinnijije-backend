# Mood · need comfort

`SLOT C4` · illustration prompt

| | |
|---|---|
| **Goes in** | `design.html` → section 03, `.tiles.c2.big` |
| **Marker** | `<!-- ILLUSTRATION SLOT C4 -->` |
| **Generate at** | 512×512 |
| **Renders at** | 56×56 |
| **Save as** | `web/public/illustrations/c4-comfort.png` |

**The job:** One of four mood faces. Must match the other three exactly in construction.

> **This file is self-contained.** Everything Gemini needs is in the one fenced block
> below — paste it as a single prompt with no extra instructions. The style rules are
> repeated in every file on purpose: a generator has no memory between calls, and the
> shared look is the whole point. See [`_style.md`](_style.md) for why each rule exists.

---

## The prompt

```
A hand-drawn flat illustration of a simple round face showing one emotion, drawn as an icon.

CRITICAL CONSISTENCY
This is one of a set of four faces that appear side by side, so it must match the others
exactly in construction: one plain circle of the same size, centred; eyes at the same
height in the upper third; mouth in the lower third. Only the expression and the single
accessory change between them. Do not vary the head shape, the line weight or the framing.

STYLE
Single-weight hand-drawn ink outline, in cool soft-black #132430 — never pure black.
Rounded line caps and joins, with a slight natural pen wobble. The face is a plain circle,
not a head with hair, ears, a neck, or a body. Flat colour fill inside the circle only.
No gradients, no shading, no drop shadows, no blush, no highlights, no 3D.
Extremely simple: eyes and mouth are single strokes or plain dots, nothing more. No nose,
no eyebrows, no hair, no ears, no glasses, no hands.
Warm and plain, a bit wry. Not kawaii, not an emoji, not a corporate mascot, not 3D.
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

PNG, square canvas, 512×512. The circle centred with even padding, nothing
touching the edges. No text, no lettering, no watermark. No drop
shadow on the background, no glow, no vignette, no reflection under the subject —
the artwork must sit directly on the flat colour.

SUBJECT

A soft, seeking-comfort face. Fill the circle in soft pink (#f9d2e4). Both eyes are small
upward arcs, gentle and a little downturned at the outer edge. The mouth is a small
contented curve.

ACCESSORY: a small simple heart in the lower right INSIDE the circle, filled pale red
(#fdebeb) with a pink outline (#8e3560). Plain two-lobe heart, no shine, no sparkle.
```

---

## Before you accept it

- [ ] Reads clearly at **56×56** — not just at 512px. This is the test that matters.
- [ ] Background is **flat magenta `#FF00FF`**, edge to edge — not a checkerboard,
      not white, not transparent. Nothing touching the canvas edge.
- [ ] No drop shadow, glow or vignette bleeding into the background.
- [ ] No text, lettering, watermark or signature anywhere.
- [ ] Only colours from the palette in [`_style.md`](_style.md). **No yellow.** No pure black.
- [ ] Flat fills — no gradient, no gloss, no drop shadow inside the artwork.
