# Illustrations — "Decide First"

One file per illustration. Each is **self-contained**: open it, copy the single fenced
block, paste it into Gemini, done. No file depends on another being read first.

- [`_style.md`](_style.md) — the shared house style and palette. Reference only; the rules
  are already inlined in every prompt.

## The set

| # | File | Subject | Generate | Renders | Where it goes |
|---|---|---|---|---|---|
| **A** | [`a-hero-pot.md`](a-hero-pot.md) | The hero pot | 1024² | 200×168 | Landing screen |
| **B1** | [`b1-rice.md`](b1-rice.md) | Rice | 512² | 44×44 | Kitchen tile |
| **B2** | [`b2-beans.md`](b2-beans.md) | Beans | 512² | 44×44 | Kitchen tile |
| **B3** | [`b3-yam.md`](b3-yam.md) | Yam | 512² | 44×44 | Kitchen tile |
| **B4** | [`b4-tomato.md`](b4-tomato.md) | Tomato | 512² | 44×44 | Kitchen tile |
| **B5** | [`b5-onion.md`](b5-onion.md) | Onion | 512² | 44×44 | Kitchen tile |
| **B6** | [`b6-fish.md`](b6-fish.md) | Fish | 512² | 44×44 | Kitchen tile |
| **C1** | [`c1-drained.md`](c1-drained.md) | Face · drained | 512² | 56×56 | Mood screen |
| **C2** | [`c2-hurry.md`](c2-hurry.md) | Face · in a hurry | 512² | 56×56 | Mood screen |
| **C3** | [`c3-up-for-it.md`](c3-up-for-it.md) | Face · up for it | 512² | 56×56 | Mood screen |
| **C4** | [`c4-comfort.md`](c4-comfort.md) | Face · need comfort | 512² | 56×56 | Mood screen |
| **D** | [`d-thinking-pot.md`](d-thinking-pot.md) | The thinking pot | 1024² | 104×104 | Loading state |
| **E** | [`e-hero-dish.md`](e-hero-dish.md) | The hero dish | 1024² | 168×124 | Verdict screen |
| **F1** | [`f1-solid.md`](f1-solid.md) | Weight · solid | 512² | 36×36 | Preference tile |
| **F2** | [`f2-light.md`](f2-light.md) | Weight · light | 512² | 36×36 | Preference tile |
| **F3** | [`f3-soupy.md`](f3-soupy.md) | Weight · soupy | 512² | 36×36 | Preference tile |
| **F4** | [`f4-swallow.md`](f4-swallow.md) | Weight · swallow | 512² | 36×36 | Preference tile |

## If you only generate three

Do **A**, **D** and **E**. They are large, static, carry no interactive state, and are
where generated art clearly beats the inline SVG placeholders already in `design.html`.

The B, C and F tiles are a different matter — see below.

## The background, and why it is magenta

Every prompt asks for a **flat magenta `#FF00FF`** background — not a transparent one.
That looks backwards, so the reason is worth stating.

Asking Gemini for a "transparent background" is what produces the failure: it has no way
to emit an alpha channel, so it **draws a picture of transparency** — a grey-and-white
checkerboard — and hands back a JPEG. You then have a painted pattern to undo instead of
a background to drop.

A flat key colour avoids the whole problem. `#FF00FF` appears nowhere in the Sky Kitchen
palette (the nearest colour is 124 channel-units away), so removal is an exact match with
no risk of biting into the artwork. It is never seen by anyone.

## Integration

1. Generate. You get a magenta-backed image.
2. **Strip the background:**
   ```sh
   python3 tools/debg.py ~/Downloads/Gemini_*.jpeg \
       -o ../../../../web/public/illustrations --size 1024
   ```
   Use `--size 512` for the B, C and F tiles. The script auto-detects whether a file is
   magenta-keyed or an older checkerboard one, so it is safe to run over a mixed batch.
3. Rename to match the **Save as** line in the slot's own file (`a-hero-pot.png` etc.).
4. Replace the inline `<svg>` at the matching `<!-- ILLUSTRATION SLOT X -->` comment in
   `design.html` with an `<img>` at the same rendered dimensions.
5. **Check at final size before accepting.** A B, C or F asset that does not read at
   36–56px is a failed asset, however good it looks at 512px.

### What `tools/debg.py` does

- **Detects the mode per file** — flat key, or painted checkerboard.
- **Protects enclosed artwork.** A plain colour match would punch through a white pot rim
  or a white swallow ball, which share the checker's tone. Connected-region analysis keeps
  anything fully enclosed by ink, and still clears pockets inside handle loops.
- **De-fringes.** A JPEG source leaves a pale halo on every stroke — invisible on white,
  obvious on dark. Partial-alpha pixels take colour from the nearest solid pixel.
- **Trims and quantises.** Flat art carries ~40k colours of JPEG noise; 64 colours is
  visually identical and roughly six times smaller.

## When to keep the inline SVG instead

The placeholders already in `design.html` are shippable. Prefer them where:

- **The tile is state-driven.** B, C and F tiles inherit `currentColor`, so a picked tile
  turns sky-blue along with the rest of the tile. A raster PNG cannot do this and will
  look wrong in the selected state.
- **The item already has a koboyo glyph.** 187 exist, and `illustrationFor(name)` covers
  unknown items by falling back to the group icon. A generated one-off that does not match
  the set is a regression, not an upgrade.

## Not in this folder

**Recipe photography** — photorealistic dish images generated from the admin console,
reviewed by a person, stored in R2. Different medium, different pipeline, different prompts:

- [`../recipe-photography.md`](../recipe-photography.md) — the prompts
- [`../image-pipeline.html`](../image-pipeline.html) — the system design
