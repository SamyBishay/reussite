// Estimates that learn your pace (brief §5). A pure function of the done steps, run on the
// device. Log space, because ratios multiply: r = ln(real / est0).
import { daysBetween, type DayKey } from './dates';

export const SOURCE_WEIGHT = { timer: 1, corrected: 0.5, typed: 0.5 } as const;
export const OPTS = { halfLife: 60, clip: Math.log(6), minWeight: 5, slopeMin: 15, slopeK: 15, classMin: 3, classK: 5, aiMin: 3 };

export interface Point {
  est0: number;
  real: number;
  /** Source weight before decay: 1 for timer, 0.5 for corrected or typed (mixed: minute-weighted). */
  w0: number;
  doneDay: DayKey;
  app?: string | null;
  project?: string | null;
  suit: string;
  by?: 'me' | 'ai' | null;
}

interface Fitted extends Point { r: number; w: number; x: number; e: number }

export interface Model {
  ready: boolean;
  /** Weighted count of data points (decay and source weights applied); the cold start needs 5. */
  weight: number;
  count: number;
  g: number;
  gAi: number | null;
  slope: number;
  xbar: number;
  pts: Fitted[];
}

export interface StepLike { est: number | null | undefined; app?: string | null; project?: string | null; suit: string; estBy?: 'me' | 'ai' | null }

export interface Prediction {
  value: number;
  lo: number;
  hi: number;
  factor: number;
  basis: { kind: 'app' | 'project' | 'suit' | 'all'; key: string; n: number };
}

const clip = (v: number, c = OPTS.clip) => Math.max(-c, Math.min(c, v));
const wmean = (xs: { v: number; w: number }[]) => {
  const sw = xs.reduce((a, b) => a + b.w, 0);
  return sw > 0 ? xs.reduce((a, b) => a + b.v * b.w, 0) / sw : 0;
};
export const appKey = (a: string | null | undefined) => (a ? a.trim().toLowerCase() : '');
/** Durations shown to the person: 5-minute steps, never under 5. */
export const round5 = (m: number) => Math.max(5, Math.round(m / 5) * 5);

/** Weighted percentile: the first value whose cumulative weight reaches p of the total. */
export function wpercentile(xs: { v: number; w: number }[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a.v - b.v);
  const total = s.reduce((a, b) => a + b.w, 0);
  let cum = 0;
  for (const x of s) { cum += x.w; if (cum >= p * total - 1e-9) return x.v; }
  return s[s.length - 1]!.v;
}

export function fit(points: Point[], today: DayKey, o = OPTS): Model {
  const all: Fitted[] = points
    .filter(p => p.est0 > 0 && p.real > 0 && p.w0 > 0)
    .map(p => {
      const age = Math.max(0, daysBetween(p.doneDay, today));
      return { ...p, r: clip(Math.log(p.real / p.est0), o.clip), w: p.w0 * 0.5 ** (age / o.halfLife), x: Math.log(p.est0), e: 0 };
    });
  const mine = all.filter(p => p.by !== 'ai');
  const ai = all.filter(p => p.by === 'ai');
  const weight = mine.reduce((a, p) => a + p.w, 0);
  const g = wmean(mine.map(p => ({ v: p.r, w: p.w })));
  let slope = 0, xbar = 0;
  if (mine.length >= o.slopeMin) {
    xbar = wmean(mine.map(p => ({ v: p.x, w: p.w })));
    let sxy = 0, sxx = 0;
    for (const p of mine) { sxy += p.w * (p.x - xbar) * (p.r - g); sxx += p.w * (p.x - xbar) ** 2; }
    if (sxx > 1e-9) slope = (sxy / sxx) * (mine.length / (mine.length + o.slopeK));
  }
  for (const p of mine) p.e = p.r - g - slope * (p.x - xbar);
  const aiWeight = ai.reduce((a, p) => a + p.w, 0);
  const gAi = aiWeight >= o.aiMin ? wmean(ai.map(p => ({ v: p.r, w: p.w }))) : null;
  return { ready: weight >= o.minWeight - 1e-9, weight, count: mine.length, g, gAi, slope, xbar, pts: mine };
}

/** The personal estimate for a step, or null during the cold start or without an estimate. */
export function predict(m: Model, s: StepLike, o = OPTS): Prediction | null {
  if (!m.ready || !s.est || s.est <= 0) return null;
  const x = Math.log(s.est);
  const size = m.slope * (x - m.xbar);
  const app = appKey(s.app);
  const by = (k: 'app' | 'project' | 'suit', key: string) => m.pts.filter(p => (k === 'app' ? appKey(p.app) : k === 'project' ? p.project ?? '' : p.suit) === key);
  let kind: Prediction['basis']['kind'] = 'all', key = '', cls = m.pts;
  const tryClass = (k: 'app' | 'project' | 'suit', v: string | null | undefined, min: number) => {
    if (kind !== 'all' || !v) return;
    const c = by(k, v);
    if (c.length >= min) { kind = k; key = v; cls = c; }
  };
  tryClass('app', app, o.classMin);
  tryClass('project', s.project, o.classMin);
  tryClass('suit', s.suit, 1);
  const n = cls.length;
  const resid = cls.map(p => ({ v: p.e, w: p.w }));
  const classOffset = kind === 'all' ? 0 : wmean(resid) * (n / (n + o.classK));
  const base = (s.estBy === 'ai' && m.gAi != null ? m.gAi : m.g) + size;
  const factor = Math.exp(base + classOffset);
  const value = round5(s.est * factor);
  const lo = Math.min(value, round5(s.est * Math.exp(base + wpercentile(resid, 0.25))));
  const hi = Math.max(value, round5(s.est * Math.exp(base + wpercentile(resid, 0.75))));
  return { value, lo, hi, factor, basis: { kind, key, n } };
}

/** Median of real / estimate. */
export function medianRatio(xs: { est0: number; real: number }[]): number | null {
  const r = xs.filter(x => x.est0 > 0 && x.real > 0).map(x => x.real / x.est0).sort((a, b) => a - b);
  if (!r.length) return null;
  const m = Math.floor(r.length / 2);
  return r.length % 2 ? r[m]! : (r[m - 1]! + r[m]!) / 2;
}

/** Whose estimates land closer: the median distance from 1× in log space (smaller is closer). */
export function closeness(xs: { est0: number; real: number }[]): number | null {
  const d = xs.filter(x => x.est0 > 0 && x.real > 0).map(x => Math.abs(Math.log(x.real / x.est0))).sort((a, b) => a - b);
  if (!d.length) return null;
  const m = Math.floor(d.length / 2);
  return d.length % 2 ? d[m]! : (d[m - 1]! + d[m]!) / 2;
}
