"""Cut the elements out of Hilma af Klint's The Dove (1915, public domain) at the photographs' own resolution.

    python3 -I scripts/dove/cutouts.py DARK.png LIGHT.png OUT_DIR

DARK is the upscaled photograph on the dark ground (1502 px square), LIGHT the one on the light ground
(1051 px square); see docs/dev/dove.md. Writes lossless RGBA PNGs to OUT_DIR; scripts/dove/build.sh turns
them into the app's WebP and icons. Needs numpy, scipy and opencv-python-headless. Every mask is
geometric (an ellipse, a circle, a traced polygon, a threshold) except the dragon's, which was made once
with rembg (birefnet-general) and is kept here as dragon-mask.png, so the result is reproducible.
"""
import os
import sys

import cv2
import numpy as np
from scipy.ndimage import median_filter

HERE = os.path.dirname(os.path.abspath(__file__))
S = 8  # polygons are filled at 8x and shrunk: antialiased edges


def need_size(im, n, name):
    if im is None or im.shape[0] != n or im.shape[1] != n:
        sys.exit(f'{name}: expected the {n} px square photograph (see docs/dev/dove.md)')


def poly_mask(shape, pts):
    m = np.zeros((shape[0] * S, shape[1] * S), np.uint8)
    cv2.fillPoly(m, [np.round(np.asarray(pts, float) * S).astype(np.int32)], 255, lineType=cv2.LINE_AA)
    return cv2.resize(m, (shape[1], shape[0]), interpolation=cv2.INTER_AREA).astype(np.float32) / 255


def ellipse_mask(shape, cx, cy, ax, ay):
    yy, xx = np.mgrid[0:shape[0], 0:shape[1]].astype(np.float32)
    # signed distance (approximate, in px) to the ellipse's edge, then a 1 px ramp
    d = (np.sqrt(((xx - cx) / ax) ** 2 + ((yy - cy) / ay) ** 2) - 1) * min(ax, ay)
    return np.clip(0.5 - d, 0, 1)


def soften(hard, erode=1, sigma=0.7):
    """A thresholded (hard) mask: pulled in by `erode` px so no ground is left on the edge, then a 1-2 px feather."""
    m = (hard > 0.5).astype(np.uint8) * 255
    if erode:
        m = cv2.erode(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * erode + 1, 2 * erode + 1)))
    return cv2.GaussianBlur(m.astype(np.float32) / 255, (0, 0), sigma)


def fill_holes(m):
    h, w = m.shape
    ff = cv2.copyMakeBorder(m, 1, 1, 1, 1, cv2.BORDER_CONSTANT, value=0)
    cv2.floodFill(ff, np.zeros((h + 4, w + 4), np.uint8), (0, 0), 255)
    return m | cv2.bitwise_not(ff[1:-1, 1:-1])


def largest(m):
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m)
    return (lab == 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])).astype(np.uint8) * 255


def save(out, name, im, alpha, pad=2):
    a = np.clip(alpha, 0, 1)
    ys, xs = np.where(a > 0.004)
    y0, y1, x0, x1 = max(ys.min() - pad, 0), min(ys.max() + pad + 1, im.shape[0]), max(xs.min() - pad, 0), min(xs.max() + pad + 1, im.shape[1])
    rgba = np.dstack([im, np.round(a * 255).astype(np.uint8)])[y0:y1, x0:x1]
    rgba[rgba[..., 3] == 0, :3] = 0
    cv2.imwrite(os.path.join(out, name + '.png'), rgba)
    print(f'{name}: {x1 - x0}x{y1 - y0} at {x0},{y0}')


# ---------- the dark photograph ----------

def heart_dark(im):
    """The heart and its rings: everything brighter than the black ground, holes filled, without the cross above
    the notch, the red bar under the tip and the thin horizontal bars either side (an opening removes them)."""
    h, w = im.shape[:2]
    g = cv2.GaussianBlur(cv2.cvtColor(im, cv2.COLOR_BGR2GRAY), (5, 5), 0)
    m = (g > 40).astype(np.uint8) * 255
    cut = np.zeros_like(m)
    cv2.fillPoly(cut, [np.array([(712, 0), (803, 0), (803, 320), (782, 338), (757, 345), (733, 338), (712, 322)])], 255)
    cv2.fillPoly(cut, [np.array([(700, h), (700, 1412), (710, 1412), (750, 1437), (785, 1422), (800, 1416), (800, h)])], 255)
    cv2.fillPoly(cut, [np.array([(200, 955), (279, 955), (290, 980), (297, 1003), (200, 1003)])], 255)
    cv2.fillPoly(cut, [np.array([(1300, 992), (1210, 992), (1206, 1002), (1201, 1020), (1198, 1028), (1300, 1028)])], 255)
    m[cut > 0] = 0
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    m = fill_holes(m)
    body = largest(cv2.morphologyEx(m, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31))))
    m = largest(m & cv2.dilate(body, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))))
    return soften(m)


# The knight, traced by hand on the dark photograph (x, y in its pixels): sword, raised arm, plumed helmet,
# cape, body and legs, without the oval behind him.
KNIGHT = [(762, 420), (766, 420), (767, 532), (784, 532), (785, 537), (768, 537), (768, 545), (770, 550), (774, 570), (775, 590),
          (776, 610), (777, 626), (775, 634), (777, 642), (778, 654), (795, 635), (820, 675), (823, 692), (807, 730), (775, 754),
          (773, 768), (772, 784), (769, 800), (768, 816), (770, 824), (771, 829), (755, 829), (757, 800), (759, 774), (755, 764),
          (745, 770), (735, 780), (727, 800), (721, 818), (717, 829), (703, 829), (707, 818), (715, 800), (719, 776), (725, 764),
          (715, 750), (707, 740), (709, 728), (715, 700), (721, 680), (725, 650), (727, 642), (735, 636), (745, 630), (744, 618),
          (736, 618), (730, 614), (730, 604), (736, 597), (743, 599), (748, 595), (755, 594), (761, 598), (764, 590), (764.6, 570),
          (762, 550), (758.6, 538), (742, 537), (742, 532), (761, 532)]
OVAL = (755.6, 704.3, 71.4, 148.5)  # the knight's oval: centre and half axes (fitted)
DISC = (750.0, 1004.0, 183.0)       # the ring disc the dragon lies on: centre and radius (fitted)
DRAGON_AT = (740, 880)              # where dragon-mask.png sits on the dark photograph


def knight(im):
    return poly_mask(im.shape, KNIGHT)


def knight_oval(im):
    cx, cy, ax, ay = OVAL
    sword = poly_mask(im.shape, [p for p in KNIGHT[:8]] + [(770, 562), (760, 562)])
    return np.maximum(ellipse_mask(im.shape, cx, cy, ax, ay), sword)


def dragon_mask(im):
    m = cv2.imread(os.path.join(HERE, 'dragon-mask.png'), cv2.IMREAD_GRAYSCALE).astype(np.float32) / 255
    full = np.zeros(im.shape[:2], np.float32)
    x, y = DRAGON_AT
    full[y:y + m.shape[0], x:x + m.shape[1]] = m
    return full


def disc(im):
    """The ring disc without the dragon or the knight's feet: each hidden pixel is taken from the same radius at
    another angle, so the brush texture of the ring is kept (the rings are concentric)."""
    cx, cy, r = DISC
    ox, oy, oax, oay = OVAL
    hide = (dragon_mask(im) > 0.02) | (knight(im) > 0.05) | (ellipse_mask(im.shape, ox, oy, oax + 2, oay + 2) > 0)
    hide = cv2.dilate(hide.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))) > 0
    out = im.copy()
    ys, xs = np.where(hide)
    todo = np.ones(len(xs), bool)
    for deg in (137, 223, 101, 259, 180, 61, 299, 31, 329):
        if not todo.any():
            break
        a = np.deg2rad(deg)
        dx, dy = xs - cx, ys - cy
        sx = np.round(cx + dx * np.cos(a) - dy * np.sin(a)).astype(int)
        sy = np.round(cy + dx * np.sin(a) + dy * np.cos(a)).astype(int)
        ok = todo & (sx >= 0) & (sy >= 0) & (sx < im.shape[1]) & (sy < im.shape[0])
        ok[ok] &= ~hide[sy[ok], sx[ok]]
        out[ys[ok], xs[ok]] = im[sy[ok], sx[ok]]
        todo &= ~ok
    # blend the patched pixels in over 2 px so no seam shows
    w = cv2.GaussianBlur(hide.astype(np.float32), (0, 0), 1.2)[..., None]
    out = (out * w + im * (1 - w)).astype(np.uint8)
    out[hide] = out[hide]
    return out, ellipse_mask(im.shape, cx, cy, r - 1, r - 1)


def wreath(im):
    """The gold sun-wreath on the cross, with its white X: bright pixels only, in a circle around it."""
    v = cv2.GaussianBlur(im.max(axis=2).astype(np.float32), (3, 3), 0)
    a = np.clip((v - 75) / 70, 0, 1) * ellipse_mask(im.shape, 762, 172, 100, 100)
    return a


# ---------- the light photograph ----------

# The right edge of the light heart (its pale blue line fades into the ground), traced by hand.
RIGHT = [(600, 10), (650, 7), (700, 7), (750, 14), (800, 34), (850, 69), (900, 129), (940, 199), (965, 259), (980, 320), (988, 400),
         (991, 450), (991, 500), (986, 560), (971, 620), (946, 680), (916, 740), (881, 800), (841, 860), (791, 920), (736, 975),
         (681, 1015), (621, 1043), (570, 1050), (530, 1051)]


def spline(P, n=12):
    P = np.array(P, float)
    out = []
    for i in range(len(P) - 1):
        p0, p1, p2, p3 = P[max(i - 1, 0)], P[i], P[i + 1], P[min(i + 2, len(P) - 1)]
        for t in np.linspace(0, 1, n, endpoint=False):
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(P[-1])
    return np.array(out)


def heart_light(im, cx=527.0, cy=560.0):
    """The left side by its gold line: from a point inside, the outermost coloured pixel along each ray; the right
    side by the traced curve."""
    h, w = im.shape[:2]
    sat = cv2.GaussianBlur(cv2.cvtColor(im, cv2.COLOR_BGR2HSV)[..., 1], (3, 3), 0)
    lab = cv2.GaussianBlur(cv2.cvtColor(im, cv2.COLOR_BGR2LAB), (5, 5), 0).astype(int)
    m = (sat > 50) | (lab[..., 1] > 134) | (lab[..., 2] < 118)
    m = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8)) > 0
    N = 2880
    rs = np.arange(50, 900, 0.5)
    R = np.zeros(N)
    for i in range(N):
        a = 2 * np.pi * i / N
        x, y = cx + np.cos(a) * rs, cy + np.sin(a) * rs
        inside = (x >= 0) & (y >= 0) & (x < w - 1) & (y < h - 1)
        stop = np.argmin(inside) if not inside.all() else len(rs)
        hit = m[y[:stop].astype(int), x[:stop].astype(int)]
        R[i] = rs[:stop][hit].max() if hit.any() else 0
    R = median_filter(R, size=15, mode='wrap')
    ang = 2 * np.pi * np.arange(N) / N
    pts = np.stack([cx + np.cos(ang) * (R + 1), cy + np.sin(ang) * (R + 1)], 1)
    mm = np.zeros((h * S, w * S), np.uint8)
    cv2.fillPoly(mm, [np.round(pts * S).astype(np.int32)], 255, lineType=cv2.LINE_AA)
    mm[:, 600 * S:] = 0
    mm[500 * S:, 530 * S:] = 0
    rp = np.vstack([spline(RIGHT), [(530, h + 2), (530, 500), (600, 500), (600, -2)]])
    cv2.fillPoly(mm, [np.round(rp * S).astype(np.int32)], 255, lineType=cv2.LINE_AA)
    a = cv2.resize(mm, (w, h), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
    return cv2.GaussianBlur(a, (0, 0), 0.6)


def main():
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    dark, light, out = cv2.imread(sys.argv[1]), cv2.imread(sys.argv[2]), sys.argv[3]
    need_size(dark, 1502, 'dark')
    need_size(light, 1051, 'light')
    os.makedirs(out, exist_ok=True)
    save(out, 'heart-dark', dark, heart_dark(dark))
    save(out, 'heart-light', light, heart_light(light))
    save(out, 'knight', dark, knight(dark))
    save(out, 'knight-oval', dark, knight_oval(dark))
    save(out, 'dragon', dark, dragon_mask(dark))
    d, a = disc(dark)
    save(out, 'disc', d, a)
    save(out, 'wreath', dark, wreath(dark))


if __name__ == '__main__':
    main()
