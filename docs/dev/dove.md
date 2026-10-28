# The Dove's cut-outs

The app icon, the onboarding mark and St George's celebration use Hilma af Klint's own pictures, cut out of two photographs of *The Dove* (1915, public domain; credited in Settings → About), not redrawings.

## The photographs

Two upscaled photographs (Upscayl, standard model), kept out of the repository:

- **dark**: the struggle, on a black ground, 1502 px square: the heart with its blue rings, the cross with its gold sun-wreath, the knight in his oval, the dragon on the white disc.
- **light**: the calm after the victory, on a pale ground, 1051 px square: the same heart, opened (gold left edge, pink right half), green rings.

The masks are fitted to these exact pixels, so the script refuses another size.

## What is cut, and how (`scripts/dove/cutouts.py`)

| Piece | From | Mask |
| --- | --- | --- |
| `heart-dark` | dark | everything brighter than the ground, holes filled, the cross above the notch, the red bar under the tip and the side bars cut off (polygons and an opening) |
| `heart-light` | light | left side: the outermost coloured pixel on rays from a point inside; right side (its pale line fades into the ground): a curve traced by hand |
| `knight` | dark | a polygon traced by hand (sword, raised arm, plume, cape, legs), without his oval |
| `knight-oval` | dark | the oval (a fitted ellipse) and the sword; made, not shipped |
| `dragon` | dark | `scripts/dove/dragon-mask.png`, made once with rembg (`birefnet-general`) and kept, so no model is needed again |
| `disc` | dark | a fitted circle; the dragon, the knight's feet and the oval's foot are painted over from the same radius at another angle (the rings are concentric), so the brush texture stays |
| `wreath` | dark | the bright pixels (gold and the white X) in a circle around it |

Hard masks are pulled in by 1 px and feathered by about 1 px (no ground left on the edge, no jaggies); polygons are filled at 8 × and shrunk.

## Regenerating

```sh
python3 -m venv /tmp/dove && /tmp/dove/bin/pip install numpy scipy opencv-python-headless pillow imagequant
PY=/tmp/dove/bin/python scripts/dove/build.sh path/to/dark.png path/to/light.png
```

`build.sh` runs the cut-outs into a temporary folder, then `scripts/dove/icons.py` (the icons, into `public/icons`) and ImageMagick (WebP, into `src/assets/dove`). Without `imagequant` the icons are full-colour PNGs, about three times larger.

- **Icons** (precached): the dark heart on a transparent ground for `icon-192`, `icon-512`, `favicon-32` (the whole heart still reads at 32 px; a crop of the rings alone did not) and `icon.svg` (a 96 px PNG inside, for the manual's pages and browsers that take an SVG); the dark heart on the dark ground (#0B0C10), opaque, for `icon-maskable-512` (inside the safe zone: a circle of 40 % of the width) and `apple-touch-icon`. About 200 KB in all.
- **Celebration** (`heart-dark`, `heart-light`, `knight`, `dragon`, `disc`, `wreath`, about 310 KB) and the onboarding mark (`mark-dark`, `mark-light`, about 22 KB): WebP, imported with `new URL(…, import.meta.url)` so they are hashed files in `assets/`. They are not in the precache (its patterns take no `.webp`); the service worker keeps each the first time it is fetched (`src/sw.ts`, cache `dove`, a new version replaces the old one).

## When the celebration's pictures are fetched

`preloadStGeorge()` (src/app/stgeorge.ts) fetches and decodes them once. It is called when today's list has one open card left (`watchBigMoments`, src/app/celebrate.ts) and when the close of the day starts. If a big moment comes before they are in (a project finished with cards still on the list, a first run offline), the same timeline plays with drawn rings in place of the figures, and the pictures are fetched for the next time.

## Where the figures stand

The celebration places the dragon and the knight on the disc where the painting has them, in parts of the disc's box (`.sg-arena` in `src/styles/stgeorge.css`, from the cut-outs' positions printed by `cutouts.py`). Re-cutting with other masks may move them; check the frames (see below).

## Checking

Freeze a frame in the dev server's console: `const m = await import('/src/app/stgeorge.ts'); await m.preloadStGeorge(); m.playStGeorge({ title: 'List played' }, 'lively'); for (const a of document.getAnimations()) { a.pause(); a.currentTime = 1100; }` (the hit is at 1.04 s to 1.2 s).
