// Rewards (brief §5, "what we take from games"): only real completions get feedback, every
// time, at once, in proportion. No random variety: the pitch only rises with the day's count.
// The completed-step effect takes 0.6 s at most and never blocks the next tap.
import { settings } from './store';

type Kind = 'step' | 'last' | 'project' | 'decision';

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  if (!settings.value.sound) return null;
  try {
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    // Mix with the person's music or podcast instead of pausing it (Safari).
    if (nav.audioSession) nav.audioSession.type = 'ambient';
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch { return null; }
}

/** A pentatonic scale, so the day's rising count always sounds consonant. */
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
const freq = (step: number, base = 523.25) => base * 2 ** (SCALE[Math.min(step, SCALE.length - 1)]! / 12);

function tone(a: AudioContext, f: number, at: number, dur: number, gain: number, type: OscillatorType = 'sine') {
  const o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.value = f;
  const v = gain * Math.max(0, Math.min(1, settings.value.volume ?? 0.6));
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, v), at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(a.destination);
  o.start(at);
  o.stop(at + dur + 0.02);
}

/** A completed step: under 0.3 s, a little higher with each card of the day. */
export function soundStep(n: number) {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime;
  tone(a, freq(Math.max(0, n - 1)), t0, 0.16, 0.22);
  tone(a, freq(Math.max(0, n - 1)) * 2, t0 + 0.06, 0.2, 0.08, 'triangle');
}
/** A card landing in the close-of-day tableau: soft and short. */
export function soundCard(i: number) {
  const a = audio();
  if (!a) return;
  tone(a, freq(i % 6, 392), a.currentTime, 0.09, 0.1, 'triangle');
}
/** One short final chord: the day's last card, the end of the close-of-day show. */
export function soundChord(big = false) {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime;
  [0, 4, 7, big ? 12 : 9].forEach((s, i) => tone(a, 261.63 * 2 ** (s / 12) * 2, t0 + i * 0.05, big ? 0.9 : 0.6, 0.12));
}

const motionOff = () => settings.value.reduceMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;

function flyCard(suit: string, glyph: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'flycard suit-' + suit;
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = '<b></b>';
  el.querySelector('b')!.textContent = glyph;
  document.body.appendChild(el);
  return el;
}

function particles(x: number, y: number, color: string, n: number) {
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i');
    p.className = 'spark';
    p.style.cssText = `left:${x}px;top:${y}px;background:${color}`;
    document.body.appendChild(p);
    const ang = (i / n) * Math.PI * 2, d = 22 + (i % 3) * 8;
    p.animate([{ transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }, { transform: `translate(calc(-50% + ${Math.cos(ang) * d}px), calc(-50% + ${Math.sin(ang) * d}px)) scale(.4)`, opacity: 0 }],
      { duration: 380, easing: 'cubic-bezier(.2,.7,.3,1)' }).onfinish = () => p.remove();
  }
}

/**
 * Play the feedback for a completion. Call it before the write, so the step's card is still
 * on screen to fly from. `n` is the day's card count after this one.
 */
export function celebrate(kind: Kind, taskId: string | null, suit: string, n: number) {
  const s = settings.value;
  if (kind === 'step' || kind === 'last') {
    if (kind === 'last') soundChord(); else soundStep(n);
  } else soundChord(true);
  if (s.celebrations !== 'off') try { navigator.vibrate?.(kind === 'step' ? 12 : [12, 40, 18]); } catch { /* not allowed here */ }
  if (s.celebrations === 'off' || typeof document === 'undefined') return;
  if (kind === 'project' || kind === 'decision') return; // their moment is drawn by the view (bar fill, shelf)
  const src = taskId ? document.querySelector(`[data-task="${CSS.escape(taskId)}"]`) : null;
  const pile = document.querySelector(`.pile[data-suit="${suit}"] .pc`);
  if (!src || !pile) return;
  const a = src.getBoundingClientRect(), b = pile.getBoundingClientRect();
  if (!b.width || b.bottom < 0 || b.top > innerHeight) { // pile off screen (scrolled): pop in place
    src.animate?.([{ transform: 'scale(1)' }, { transform: 'scale(1.03)' }, { transform: 'scale(1)' }], { duration: 220 });
    return;
  }
  const glyph = s.suits[suit as 'S']?.glyph ?? '';
  const el = flyCard(suit, glyph);
  const x0 = Math.round(a.left + Math.min(a.width, 120) / 2 - 23), y0 = Math.round(a.top + Math.min(a.height, 80) / 2 - 32);
  const x1 = Math.round(b.left + b.width / 2 - 23), y1 = Math.round(b.top + b.height / 2 - 32);
  if (motionOff()) {
    el.style.transform = `translate(${x1}px,${y1}px)`;
    el.animate([{ opacity: 0 }, { opacity: 1, offset: 0.4 }, { opacity: 0 }], { duration: 400 }).onfinish = () => el.remove();
    return;
  }
  const last = kind === 'last';
  // Hit stop: a short freeze with a small pop, then the flight to the pile.
  const frames: Keyframe[] = [
    { transform: `translate(${x0}px,${y0}px) scale(1)`, offset: 0 },
    { transform: `translate(${x0}px,${y0}px) scale(1.18)`, offset: last ? 0.08 : 0.12 },
    { transform: `translate(${x0}px,${y0}px) scale(1.18)`, offset: last ? 0.16 : 0.25 },
    ...(last ? [{ transform: `translate(${(x0 + x1) / 2}px,${Math.min(y0, y1) - 40}px) scale(1.7)`, offset: 0.62, easing: 'cubic-bezier(.3,.0,.2,1)' }] : []),
    { transform: `translate(${x1}px,${y1}px) scale(1.06)`, offset: 0.88 },
    { transform: `translate(${x1}px,${y1}px) scale(1)`, offset: 1 },
  ];
  const anim = el.animate(frames, { duration: last ? 1100 : 560, easing: last ? 'linear' : 'cubic-bezier(.3,.7,.2,1)', fill: 'forwards' });
  anim.onfinish = () => {
    el.remove();
    pile.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.12) translateY(2px)' }, { transform: 'scale(.98)' }, { transform: 'scale(1)' }], { duration: last ? 420 : 240, easing: 'ease-out' });
    if (s.celebrations === 'lively') particles(b.left + b.width / 2, b.top + b.height / 2, getComputedStyle(document.documentElement).getPropertyValue('--suit-' + suit) || '#888', last ? 16 : 8);
    if (last) {
      const ring = document.createElement('i');
      ring.className = 'ring';
      ring.style.cssText = `left:${b.left + b.width / 2}px;top:${b.top + b.height / 2}px`;
      document.body.appendChild(ring);
      ring.animate([{ transform: 'translate(-50%,-50%) scale(.3)', opacity: 0.9 }, { transform: 'translate(-50%,-50%) scale(2.6)', opacity: 0 }], { duration: 700, easing: 'ease-out' }).onfinish = () => ring.remove();
    }
  };
}
