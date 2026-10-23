// The big celebration (brief §16): St George strikes the dragon, for the big moments only (the close of the
// day, the day's last card, a finished project). The screen crosses from the person's theme to the other and
// back: from light, the dark rises for the fight and the light returns with the win; from dark, the strike
// breaks through into the light, which fades back to the dark. About 2.5 s; a tap or Escape skips it at once,
// and it never holds the tap after. Lively: the whole fight. Calm and reduced motion: the last frame, faded
// in and out. Off: nothing. CSS and SVG only, transforms and opacity (src/styles/stgeorge.css).
import '../styles/stgeorge.css';

export type Words = { title: string; sub?: string };
export type Mode = 'lively' | 'still';

const DUR = 2500, FADE_IN = 120, FADE_OUT = 320, STILL_HOLD = 1500;

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

const HEART = '<svg viewBox="0 0 400 380" fill="none"><path d="M200 360C110 300 20 230 20 132A90 90 0 0 1 200 80A90 90 0 0 1 380 132C380 230 290 300 200 360Z" style="stroke:var(--heart-line)" stroke-width="5" stroke-linejoin="round"/></svg>';
const DRAGON = '<svg viewBox="0 0 200 200"><path d="M84 60 L66 16 L94 38 L106 6 L116 44 L132 26 L124 66 Z" style="fill:#7A6A9A"/>'
  + '<path d="M150 62C120 40 70 50 52 90C36 126 60 168 104 168C146 168 164 128 146 102C130 80 96 88 94 112C92 130 110 138 122 128" fill="none" style="stroke:var(--rose-deep)" stroke-width="18" stroke-linecap="round"/>'
  + '<path d="M150 62C120 40 70 50 52 90C36 126 60 168 104 168" fill="none" style="stroke:var(--rose)" stroke-width="5" stroke-linecap="round" stroke-dasharray="2 12"/>'
  + '<path d="M144 52 L186 40 L172 60 L188 74 L148 76 Z" style="fill:var(--rose-deep)"/><circle cx="158" cy="58" r="3.5" style="fill:var(--gold)"/>'
  + '<path d="M122 128 L134 140 L126 122 Z" style="fill:var(--rose-deep)"/></svg>';
const KNIGHT = '<svg viewBox="0 0 100 200"><ellipse cx="50" cy="112" rx="46" ry="86" style="fill:var(--rose);opacity:.28"/>'
  + '<rect x="63" y="2" width="6" height="84" rx="2" style="fill:var(--steel);stroke:var(--teal-deep)" stroke-width="1.5"/>'
  + '<rect x="55" y="80" width="22" height="6" rx="2" style="fill:var(--gold-deep)"/>'
  + '<path d="M34 66C14 96 12 146 22 178L42 168L38 112Z" style="fill:var(--navy)"/>'
  + '<path d="M34 64L62 64L66 116L30 116Z" style="fill:var(--gold);stroke:#2B2340" stroke-width="2" stroke-linejoin="round"/>'
  + '<path d="M60 68L68 88" style="stroke:var(--gold)" stroke-width="8" stroke-linecap="round"/>'
  + '<circle cx="48" cy="50" r="12" style="fill:var(--gold);stroke:#2B2340" stroke-width="2"/><path d="M40 48H56" style="stroke:#2B2340" stroke-width="2.5" stroke-linecap="round"/>'
  + '<path d="M44 38C46 26 56 24 60 30" fill="none" style="stroke:var(--rose)" stroke-width="4" stroke-linecap="round"/>'
  + '<rect x="34" y="114" width="12" height="62" rx="4" style="fill:var(--gold);stroke:#2B2340" stroke-width="2"/>'
  + '<rect x="52" y="114" width="12" height="62" rx="4" style="fill:var(--gold);stroke:#2B2340" stroke-width="2"/></svg>';
const SLASH = '<svg viewBox="0 0 300 160"><path d="M10 40C90 150 220 150 290 20C230 110 110 120 10 40Z" style="fill:#FFFFFF"/><path d="M30 52C100 128 200 128 268 40" fill="none" style="stroke:var(--gold)" stroke-width="4" stroke-linecap="round"/></svg>';
const STAR = '<svg viewBox="0 0 200 200"><path d="M100 0L118 70L190 40L132 100L200 130L124 126L130 200L100 136L60 196L76 124L0 118L66 92L18 30L86 70Z" style="fill:#FFF7E0"/><circle cx="100" cy="100" r="26" style="fill:#FFFFFF"/></svg>';

function scene(): string {
  const lines = speedLines().map(l => `<span class="sg-line sg-a" data-r="${l.r}" data-len="${l.len}" style="--a:${l.a.toFixed(1)}deg;animation-delay:${l.delay.toFixed(3)}s"></span>`).join('');
  const streaks = Array.from({ length: 9 }, (_, j) => `<span class="sg-streak sg-a" style="--x:${8 + j * 10.5}%;animation-delay:${((j % 4) * 0.02).toFixed(2)}s"></span>`).join('');
  return '<div class="sg-shake sg-a"><div class="sg-stage">'
    + '<div class="sg-l sg-c sg-disc dark sg-a"></div><div class="sg-l sg-c sg-disc light sg-a"></div>'
    + [1, 2, 3, 4, 5].map(i => `<div class="sg-l sg-c sg-ring r${i} sg-a"></div>`).join('')
    + [1, 2, 3].map(i => `<div class="sg-l sg-c sg-calm k${i} sg-a"></div>`).join('')
    + `<div class="sg-l sg-heart sg-a">${HEART}</div>`
    + `<div class="sg-l sg-c sg-lines">${lines}</div><div class="sg-l sg-streaks">${streaks}</div>`
    + `<div class="sg-l sg-dragon sg-a"><div class="sg-a">${DRAGON}</div></div>`
    + `<div class="sg-l sg-knight sg-a"><div class="sg-a">${KNIGHT}</div></div>`
    + `<div class="sg-l sg-slash sg-a">${SLASH}</div><div class="sg-l sg-star sg-a">${STAR}</div>`
    + '<div class="sg-l sg-words sg-a" role="status" aria-live="polite"><b></b><span></span></div>'
    + '</div><div class="sg-flash sg-a"></div></div>';
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
  const el = document.createElement('div');
  el.className = 'sg from-' + currentMode() + (mode === 'still' ? ' still' : '');
  el.setAttribute('data-testid', 'stgeorge');
  el.innerHTML = scene();
  setWords(el, words);
  // The words are said once; the drawing itself is decorative.
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
