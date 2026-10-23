"""The app's icons from the cut-outs (scripts/dove/cutouts.py), into public/icons.

    python3 -I scripts/dove/icons.py CUT_DIR ICONS_DIR

The dark heart on a transparent ground: icon-512, icon-192, favicon-32 (a tighter crop: the heart's rings
are what reads at 32 px), and the 96 px picture inside icon.svg. The light heart on its own ground (sampled
from the light photograph's canvas), opaque: icon-maskable-512 (inside the safe zone, a circle of 40 % of
the width) and apple-touch-icon (180 px).
"""
import base64
import os
import sys

import cv2
import numpy as np

LIGHT_GROUND = (225, 226, 222)  # BGR: the light photograph's canvas, around the heart


def load(path):
    im = cv2.imread(path, cv2.IMREAD_UNCHANGED).astype(np.float32) / 255
    im[..., :3] *= im[..., 3:4]  # premultiplied, so shrinking never pulls the black of the clear pixels in
    return im


def resize(im, w, h):
    return cv2.resize(im, (w, h), interpolation=cv2.INTER_AREA)


def place(canvas, im, cx, cy):
    """Paint a premultiplied image over a premultiplied canvas, centred at cx, cy."""
    h, w = im.shape[:2]
    x0, y0 = int(round(cx - w / 2)), int(round(cy - h / 2))
    region = canvas[y0:y0 + h, x0:x0 + w]
    region[:] = im + region * (1 - im[..., 3:4])


def write(path, im, colours=256):
    """Unpremultiply and save; with imagequant installed, a 256-colour palette PNG (a third of the size)."""
    out = im.copy()
    a = out[..., 3:4]
    out[..., :3] = np.where(a > 0, out[..., :3] / np.maximum(a, 1e-6), 0)
    px = np.round(np.clip(out, 0, 1) * 255).astype(np.uint8)
    try:
        import imagequant
        from PIL import Image
    except ImportError:
        cv2.imwrite(path, px)
        return
    pil = Image.fromarray(cv2.cvtColor(px, cv2.COLOR_BGRA2RGBA), 'RGBA')
    imagequant.quantize_pil_image(pil, dithering_level=1.0, max_colors=colours, min_quality=70, max_quality=95).save(path, optimize=True)


def fit(im, box):
    h, w = im.shape[:2]
    s = box / max(h, w)
    return resize(im, max(1, round(w * s)), max(1, round(h * s)))


def transparent(im, n, margin):
    c = np.zeros((n, n, 4), np.float32)
    place(c, fit(im, n - 2 * margin), n / 2, n / 2)
    return c


def opaque(im, n, radius):
    """On the light ground, as large as fits in a circle of `radius` (the maskable safe zone)."""
    a = im[..., 3] > 0.1
    ys, xs = np.nonzero(a)
    cy, cx = (ys.min() + ys.max()) / 2, (xs.min() + xs.max()) / 2
    far = np.sqrt((ys - cy) ** 2 + (xs - cx) ** 2).max()
    s = radius / far
    small = resize(im, round(im.shape[1] * s), round(im.shape[0] * s))
    c = np.zeros((n, n, 4), np.float32)
    c[..., :3] = np.array(LIGHT_GROUND, np.float32) / 255
    c[..., 3] = 1
    # centre the heart's bounding box (not the image's) on the canvas
    place(c, small, n / 2 + (small.shape[1] / 2 - cx * s), n / 2 + (small.shape[0] / 2 - cy * s))
    return c


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    cut, out = sys.argv[1], sys.argv[2]
    dark, light = load(os.path.join(cut, 'heart-dark.png')), load(os.path.join(cut, 'heart-light.png'))
    write(os.path.join(out, 'icon-512.png'), transparent(dark, 512, 16))
    write(os.path.join(out, 'icon-192.png'), transparent(dark, 192, 6))
    # 32 px: the whole heart still reads (pink heart, blue rings, the dark eye); a crop of the rings alone does not
    write(os.path.join(out, 'favicon-32.png'), transparent(dark, 32, 0))
    write(os.path.join(out, 'icon-maskable-512.png'), opaque(light, 512, 200))
    write(os.path.join(out, 'apple-touch-icon.png'), opaque(light, 180, 84))
    svg = os.path.join(out, 'icon-96.tmp.png')
    write(svg, transparent(dark, 96, 2))
    with open(svg, 'rb') as f:
        data = base64.b64encode(f.read()).decode()
    os.remove(svg)
    with open(os.path.join(out, 'icon.svg'), 'w') as f:
        f.write('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><title>Réussite</title>'
                f'<image width="96" height="96" href="data:image/png;base64,{data}"/></svg>\n')


if __name__ == '__main__':
    main()
