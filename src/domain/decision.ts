// Balances décisionnelles (brief §9, METHOD "Decisions"): four columns per option, weights 1–5.
// Score = (pros of doing + cons of not doing) − (cons of doing + pros of not doing).

export type Column = 'pros' | 'cons' | 'prosNot' | 'consNot';
export const COLUMNS: Column[] = ['pros', 'cons', 'prosNot', 'consNot'];
export interface Item { id: string; text: string; w: number; by?: 'me' | 'ai'; mirrorOf?: string | null }
export interface Option { id: string; name: string; screened?: string | null; pros: Item[]; cons: Item[]; prosNot: Item[]; consNot: Item[]; [extra: string]: unknown }

const clampW = (w: unknown) => Math.max(1, Math.min(5, Math.round(Number(w) || 1)));
/** An item that only mirrors another counts once: the mirror adds nothing. */
const sum = (xs: Item[] | undefined) => (xs ?? []).reduce((a, i) => a + (i.mirrorOf ? 0 : clampW(i.w)), 0);

export function score(o: Pick<Option, Column>): number {
  return sum(o.pros) + sum(o.consNot) - sum(o.cons) - sum(o.prosNot);
}

/** Options still in play, best first. */
export function ranked<O extends Option>(options: O[]): { option: O; score: number }[] {
  return options.filter(o => !o.screened).map(option => ({ option, score: score(option) })).sort((a, b) => b.score - a.score);
}

/** The top two are within 10%: ask which you'd regret less. */
export function tooClose(scores: number[]): boolean {
  const s = [...scores].sort((a, b) => b - a);
  if (s.length < 2) return false;
  const [a, b] = [s[0]!, s[1]!];
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return scale === 0 ? true : (a - b) / scale <= 0.1;
}

/** v1 stored items as [text, weight]; v2 as objects. Accept both. */
export function normItems(xs: unknown, prefix: string): Item[] {
  if (!Array.isArray(xs)) return [];
  return xs.map((x, i) => {
    if (Array.isArray(x)) return { id: prefix + i, text: String(x[0] ?? ''), w: clampW(x[1]), by: 'me' as const };
    if (typeof x === 'string') return { id: prefix + i, text: x, w: 3, by: 'me' as const };
    const o = (x ?? {}) as Partial<Item>;
    return { ...o, id: String(o.id ?? prefix + i), text: String(o.text ?? ''), w: clampW(o.w) } as Item;
  });
}
