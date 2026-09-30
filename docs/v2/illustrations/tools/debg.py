#!/usr/bin/env python3
"""
Strip the background from a generated illustration and write a clean RGBA PNG.

Two modes, chosen automatically per file:

  keyed      the prompt's flat magenta #FF00FF background. Exact, fast, lossless
             at the edges. This is what the prompts in this folder now ask for.

  checker    Gemini painted a grey/white "transparency" checkerboard instead of
             producing real alpha. Handled by connected-region analysis, because
             a plain colour match would punch through white artwork (a pot rim,
             a swallow ball) that happens to share the checker's tone.

Both modes de-fringe: a JPEG source leaves a pale halo hugging every stroke that
is invisible on white and obvious on dark, so partial-alpha pixels take their
colour from the nearest solid pixel rather than keeping leftover background.

Usage
  python3 debg.py IN.png [IN2.jpg ...] -o OUTDIR
  python3 debg.py ~/Downloads/Gemini_*.jpeg -o web/public/illustrations
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

KEY_RGB = (255, 0, 255)          # what the prompts ask for
KEY_TOLERANCE = 60               # generous: models drift off an exact hex
QUANTISE_COLOURS = 64            # flat art needs few; JPEG noise inflates it


def _load(path: Path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGB")).astype(int)


def _looks_keyed(a: np.ndarray) -> bool:
    """Is a meaningful share of the border close to the key colour?"""
    d = np.abs(a - np.array(KEY_RGB)).max(2)
    border = np.concatenate([d[0, :], d[-1, :], d[:, 0], d[:, -1]])
    return float((border < KEY_TOLERANCE).mean()) > 0.5


def _mask_keyed(a: np.ndarray) -> np.ndarray:
    """True where the pixel is background."""
    return np.abs(a - np.array(KEY_RGB)).max(2) < KEY_TOLERANCE


def _mask_checker(a: np.ndarray) -> np.ndarray:
    """
    True where the pixel is painted-checkerboard background.

    A region counts as background when it touches the border, OR when it is
    almost entirely made of the two checker tones (~200 grey, ~240-248 white).
    The second test is what clears pockets fully enclosed by artwork — the holes
    inside a pot's handles — which a border flood-fill alone can never reach.
    """
    mx, mn = a.max(2), a.min(2)
    sat, val = mx - mn, mx
    bglike = (sat < 26) & (val >= 140)

    lab, n = ndimage.label(bglike)
    if n == 0:
        return np.zeros(a.shape[:2], bool)

    border = set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1])
    border.discard(0)

    kill = np.zeros(n + 1, bool)
    boxes = ndimage.find_objects(lab)
    for i in range(1, n + 1):
        if i in border:
            kill[i] = True
            continue
        sl = boxes[i - 1]
        m = lab[sl] == i
        if m.sum() < 40:            # tiny enclosed specks are artwork detail
            continue
        g = a[sl][m].mean(1)
        checkerish = (((g > 188) & (g < 214)) | ((g > 232) & (g < 254))).mean()
        if checkerish > 0.75:
            kill[i] = True
    return kill[lab]


def _alpha_from(bg: np.ndarray, erode: int) -> np.ndarray:
    a = (~bg).astype(np.uint8) * 255
    if erode:
        keep = ndimage.binary_erosion(a > 0, np.ones((3, 3)), iterations=erode)
        a = np.where(keep, 255, 0).astype(np.uint8)
    a = ndimage.gaussian_filter(a, 0.7)
    # Firm the ramp so edges are crisp rather than a wide soft fade.
    return np.clip((a.astype(int) - 40) * 1.6, 0, 255).astype(np.uint8)


def _defringe(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """Give partial-alpha pixels the colour of the nearest solid pixel."""
    solid = alpha > 200
    if not solid.any():
        return rgb
    idx = ndimage.distance_transform_edt(~solid, return_distances=False, return_indices=True)
    near = rgb[tuple(idx)]
    edge = (alpha > 0) & (alpha <= 200)
    out = rgb.copy()
    out[edge] = near[edge]
    return out


def process(src: Path, outdir: Path, size: int | None) -> tuple[str, int]:
    a = _load(src)
    keyed = _looks_keyed(a)
    # A keyed background is an exact colour match, so it needs far less erosion
    # than a JPEG checkerboard whose edges are smeared by compression.
    bg = _mask_keyed(a) if keyed else _mask_checker(a)
    alpha = _alpha_from(bg, erode=1 if keyed else 2)
    rgb = _defringe(a.astype(np.uint8), alpha)

    im = Image.fromarray(np.dstack([rgb, alpha]), "RGBA")
    im = im.crop(im.getbbox() or (0, 0, im.width, im.height))   # trim to content

    if size:
        im.thumbnail((size, size), Image.LANCZOS)
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        canvas.paste(im, ((size - im.width) // 2, (size - im.height) // 2))
        im = canvas

    # Flat art quantises to a small palette with no visible loss; a JPEG source
    # can otherwise carry ~40k colours of pure noise into a 400KB PNG.
    im = im.quantize(colors=QUANTISE_COLOURS, dither=Image.NONE).convert("RGBA")

    outdir.mkdir(parents=True, exist_ok=True)
    dst = outdir / (src.stem + ".png")
    im.save(dst, optimize=True)
    return ("keyed" if keyed else "checker"), dst.stat().st_size


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("inputs", nargs="+", type=Path)
    p.add_argument("-o", "--outdir", type=Path, required=True)
    p.add_argument("--size", type=int, default=None,
                   help="square canvas to fit into, e.g. 1024 or 512 (default: keep trimmed size)")
    args = p.parse_args()

    failures = 0
    for src in args.inputs:
        if not src.is_file():
            print(f"  !  {src}: not a file", file=sys.stderr)
            failures += 1
            continue
        try:
            mode, nbytes = process(src, args.outdir, args.size)
            print(f"  ok {src.name:<44} {mode:<8} {nbytes // 1024:>4} KB")
        except Exception as exc:                      # noqa: BLE001 - report and continue
            print(f"  !  {src.name}: {exc}", file=sys.stderr)
            failures += 1
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
