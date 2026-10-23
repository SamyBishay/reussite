// The big celebration (brief §16): St George strikes the dragon, for the big moments only (the close of the
// day, the day's last card, a finished project). The figures are Hilma af Klint's own, cut out of The Dove
// (1915) at the photographs' resolution (src/assets/dove, scripts/dove, docs/dev/dove.md): the knight leaps,
// winds up and strikes, the screen freezes on the hit, the painted rings burst outwards and the dragon is
// thrown; the heart of the painting closes the scene. The screen crosses from the person's theme to the other
// and back: from light, the dark rises for the fight and the light returns with the win; from dark, the
// strike breaks through into the light, which fades back to the dark. About 2.5 s; a tap, Escape, Enter or
// Space skips it at once, and it never holds the tap after. Lively: the whole fight. Calm and reduced motion:
// the last frame, faded in and out. Off: nothing. Transforms and opacity only (src/styles/stgeorge.css).
// The pictures are fetched only when a big moment is near (`preloadStGeorge`); until they are in, the same
// timeline plays with drawn rings instead of the figures.
import '../styles/stgeorge.css';

export type Words = { title: string; sub?: string };
export type Mode = 'lively' | 'still';

const DUR = 2500, FADE_IN = 120, FADE_OUT = 320, STILL_HOLD = 1500;

const SRC = {
  heartDark: new URL('../assets/dove/heart-dark.webp', import.meta.url).href,
  heartLight: new URL('../assets/dove/heart-light.webp', import.meta.url).href,
  knight: new URL('../assets/dove/knight.webp', import.meta.url).href,
  dragon: new URL('../assets/dove/dragon.webp', import.meta.url).href,
  disc: new URL('../assets/dove/disc.webp', import.meta.url).href,
  wreath: new URL('../assets/dove/wreath.webp', import.meta.url).href,
};

let loading: Promise<boolean> | null = null;
let ready = false;
const kept: HTMLImageElement[] = []; // decoded pictures stay in memory while the app is open

/** Are the pictures in (decoded), so the next celebration shows the figures? */
export const stGeorgeReady = () => ready;

/**
 * Fetch and decode the pictures, once (a failure lets a later call try again). Called when a big moment is
 * near: the day's list has one card left, the close of the day starts. The service worker keeps them.
 */
export function preloadStGeorge(): Promise<boolean> {
  if (ready) return Promise.resolve(true);
  if (typeof Image === 'undefined') return Promise.resolve(false);
  loading ??= Promise.all(Object.values(SRC).map(src => {
    const im = new Image();
    im.decoding = 'async';
    im.src = src;
    kept.push(im);
    return im.decode().then(() => true, () => false);
  })).then(all => {
    ready = all.every(Boolean);
    if (!ready) { loading = null; kept.length = 0; }
    return ready;
  });
  return loading;
}

/** Which ground the screen starts from: the theme in use now. */
export function currentMode(root: HTMLElement = document.documentElement): 'light' | 'dark' {
  const forced = root.getAttribute('data-theme');
  if (forced === 'light' || forced === 'dark') return forced;
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** The speed lines, evenly spread (no randomness): angle in degrees, distance and length as parts of the stage. */
export function speedLines(n = 34): { a: number; r: number; len: number; delay: number }[] {
  return Array.from({ length: n }, (_, i) => ({ a: i * (360 / n) + (i % 3) * 3.1, r: (16 + (i * 37) % 14) / 100, len: (18 + (i * 53) % 26) / 100, delay: (i % 5) * 0.012 }));
}

/**
 * The painted disc cut into rings that burst outwards at the strike, from the eye to the rim: inner and outer
 * edge as parts of the radius (they tile it exactly), how far each flies, and its delay (the outer ones first).
 */
export function rings(): { from: number; to: number; burst: number; delay: number }[] {
  const edges = [0, 0.3, 0.52, 0.74, 1];
  return edges.slice(1).map((to, i) => ({ from: edges[i]!, to, burst: 1.5 + i * 0.55, delay: (edges.length - 2 - i) * 0.03 }));
}

/** The sparks thrown from the hit (evenly spread, no randomness): angle in degrees, distance as a part of the arena. */
export function sparks(n = 16): { a: number; d: number }[] {
  return Array.from({ length: n }, (_, i) => ({ a: i * (360 / n) + (i % 2) * 9, d: (38 + (i * 29) % 34) / 100 }));
}

const SLASH = '<svg viewBox="0 0 300 160"><path d="M10 40C90 150 220 150 290 20C230 110 110 120 10 40Z" style="fill:#FFFFFF"/><path d="M30 52C100 128 200 128 268 40" fill="none" style="stroke:#F3E3B0" stroke-width="4" stroke-linecap="round"/></svg>';
const STAR = '<svg viewBox="0 0 200 200"><path d="M100 0L118 70L190 40L132 100L200 130L124 126L130 200L100 136L60 196L76 124L0 118L66 92L18 30L86 70Z" style="fill:#FFF7E0"/><circle cx="100" cy="100" r="26" style="fill:#FFFFFF"/></svg>';
const GLINT = '<svg viewBox="0 0 40 40"><path d="M20 0L23 17L40 20L23 23L20 40L17 23L0 20L17 17Z" style="fill:#FFFFFF"/></svg>';
const img = (src: string, cls = '') => `<img ${cls ? `class="${cls}" ` : ''}src="${src}" alt="" draggable="false" decoding="sync">`;

function scene(bare: boolean): string {
  const lines = speedLines().map(l => `<span class="sg-line sg-a" data-r="${l.r}" data-len="${l.len}" style="--a:${l.a.toFixed(1)}deg;animation-delay:${l.delay.toFixed(3)}s"></span>`).join('');
  const streaks = Array.from({ length: 9 }, (_, j) => `<span class="sg-streak sg-a" style="--x:${8 + j * 10.5}%;animation-delay:${((j % 4) * 0.02).toFixed(2)}s"></span>`).join('');
  const drawn = [1, 2, 3, 4, 5].map(i => `<div class="sg-l sg-c sg-ring r${i} sg-a"></div>`).join('')
    + [1, 2, 3].map(i => `<div class="sg-l sg-c sg-calm k${i} sg-a"></div>`).join('');
  const arena = bare ? '' : '<div class="sg-l sg-arena">'
    + rings().map((r, i) => `<div class="sg-ann sg-a${i === 0 ? ' eye' : ''}" style="--burst:${r.burst};animation-delay:${r.delay}s;`
      + `-webkit-mask-image:${ringMask(r.from, r.to)};mask-image:${ringMask(r.from, r.to)}">${img(SRC.disc)}</div>`).join('')
    + `<div class="sg-dragon"><div class="sg-a">${img(SRC.dragon)}</div></div>`
    + `<div class="sg-knight"><div class="sg-ghost g1 sg-a">${img(SRC.knight)}</div><div class="sg-ghost g2 sg-a">${img(SRC.knight)}</div>`
    + `<div class="sg-kn sg-a">${img(SRC.knight)}<div class="sg-glint sg-a">${GLINT}</div></div></div>`
    + `<div class="sg-slash sg-a">${SLASH}</div><div class="sg-star sg-a">${STAR}</div><div class="sg-wreath sg-a">${img(SRC.wreath)}</div>`
    + `<div class="sg-sparks">${sparks().map(s => `<span class="sg-spark sg-a" style="--a:${s.a}deg;--d:${s.d * 100}cqw"></span>`).join('')}</div>`
    + '</div>';
  const hearts = bare ? '' : `<div class="sg-l sg-heart l sg-a">${img(SRC.heartLight)}</div><div class="sg-l sg-heart d sg-a">${img(SRC.heartDark)}</div>`;
  return '<div class="sg-shake sg-a"><div class="sg-stage">'
    + '<div class="sg-l sg-c sg-disc dark sg-a"></div><div class="sg-l sg-c sg-disc light sg-a"></div>'
    + '<div class="sg-cam sg-a">'
    + (bare ? drawn : '')
    + `<div class="sg-l sg-c sg-lines">${lines}</div><div class="sg-l sg-streaks">${streaks}</div>`
    + arena + '</div>'
    + hearts
    + '<div class="sg-l sg-words sg-a" role="status" aria-live="polite"><b></b><span></span></div>'
    + '</div><div class="sg-flash sg-a"></div></div>';
}

/** A ring of the disc: a mask that keeps from `from` to `to` (parts of the radius), with a half-pixel-soft edge. */
function ringMask(from: number, to: number): string {
  const p = (x: number) => (x * 100).toFixed(1) + '%';
  return from === 0
    ? `radial-gradient(circle closest-side,#000 ${p(to - 0.004)},transparent ${p(to)})`
    : `radial-gradient(circle closest-side,transparent ${p(from - 0.004)},#000 ${p(from)},#000 ${p(to - 0.004)},transparent ${p(to)})`;
}

let current: { el: HTMLElement; end: () => void } | null = null;

/** Is the celebration on screen? */
export const celebrating = () => !!current;

/**
 * Play the celebration with these words. When one is already playing, its words change and it goes on.
 * Returns false when nothing was played (no document).
 */
export function playStGeorge(words: Words, mode: Mode): boolean {
  if (typeof document === 'undefined') return false;
  if (current) { setWords(current.el, words); return true; }
  const bare = !ready;
  if (bare) void preloadStGeorge(); // the next one has the figures
  const el = document.createElement('div');
  el.className = 'sg from-' + currentMode() + (mode === 'still' ? ' still' : '') + (bare ? ' bare' : '');
  el.setAttribute('data-testid', 'stgeorge');
  el.innerHTML = scene(bare);
  setWords(el, words);
  // The words are said once; the pictures are decorative.
  for (const c of el.querySelectorAll('.sg-l:not(.sg-words), .sg-flash')) c.setAttribute('aria-hidden', 'true');
  document.body.appendChild(el);
  const stage = el.querySelector<HTMLElement>('.sg-stage')!;
  const w = stage.getBoundingClientRect().width || 360;
  for (const l of el.querySelectorAll<HTMLElement>('.sg-line')) {
    l.style.setProperty('--r', Number(l.dataset.r) * w + 'px');
    l.style.setProperty('--len', Number(l.dataset.len) * w + 'px');
  }
  let gone = false, timer = 0;
  const end = (fast = false) => {
    if (gone) return;
    gone = true;
    clearTimeout(timer);
    removeEventListener('keydown', onKey, true);
    el.classList.add('leaving');
    if (current?.el === el) current = null;
    const a = el.animate?.([{ opacity: 1 }, { opacity: 0 }], { duration: fast ? 140 : FADE_OUT, easing: 'ease-out', fill: 'forwards' });
    if (a) a.onfinish = () => el.remove(); else el.remove();
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); end(true); } };
  // A tap skips: the overlay leaves at once and lets the next tap through.
  el.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); end(true); });
  el.addEventListener('click', e => e.stopPropagation());
  addEventListener('keydown', onKey, true);
  current = { el, end: () => end(true) };
  el.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: mode === 'still' ? 500 : FADE_IN, easing: 'ease-out' });
  if (mode === 'lively') {
    void el.offsetWidth;
    el.classList.add('play');
  }
  timer = window.setTimeout(() => end(), mode === 'still' ? 500 + STILL_HOLD : DUR);
  return true;
}

/** Stop it now (a test, or the app leaving the screen). */
export function stopStGeorge() { current?.end(); }

function setWords(el: HTMLElement, w: Words) {
  el.querySelector('.sg-words b')!.textContent = w.title;
  el.querySelector('.sg-words span')!.textContent = w.sub ?? '';
}
