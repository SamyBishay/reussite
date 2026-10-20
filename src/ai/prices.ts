// What a call cost, and the month's total on this device. Pure.
// Dollars come from two places only: the `cost` OpenRouter reports for the call, and, for Anthropic's own
// API, the table below. Any other provider or model shows tokens, never a guess.
import type { Usage } from './adapters';

/** US dollars per million tokens. */
export interface Price { in: number; out: number; read: number; write: number; /** Above this many prompt tokens the price changes: no dollars are given. */ maxPrompt?: number }

/**
 * The prices of the Claude API model table (the claude-api skill, table cached 2026-10-06, read again 2026-10-20).
 * Cache reads are a tenth of the input price (Opus 5.5: a twentieth, $0.20) and five-minute cache writes
 * 1.25 times it, the skill's rule, which is the TTL the requests use. Haiku 5.5 is listed for prompts up to
 * 100K tokens, so a bigger one is not priced.
 */
export const PRICES: Record<string, Price> = {
  'claude-haiku-5-5': { in: 0.10, out: 0.50, read: 0.01, write: 0.125, maxPrompt: 100_000 },
  'claude-sonnet-5-5': { in: 2, out: 10, read: 0.20, write: 2.5 },
  'claude-opus-5-5': { in: 4, out: 20, read: 0.20, write: 5 },
};

/** The dollars a call cost: what the provider reported, else the table's price for an Anthropic model, else undefined. */
export function dollars(provider: 'openai' | 'anthropic', model: string, u: Usage): number | undefined {
  if (u.cost !== undefined) return u.cost;
  if (provider !== 'anthropic') return undefined;
  const p = PRICES[model];
  if (!p || (p.maxPrompt && u.input + u.cacheRead + u.cacheWrite > p.maxPrompt)) return undefined;
  return (u.input * p.in + u.output * p.out + u.cacheRead * p.read + u.cacheWrite * p.write) / 1e6;
}

/** One month on this device: tokens always, dollars for the `priced` calls that had a price. */
export interface MonthUsage { calls: number; priced: number; input: number; output: number; cacheRead: number; cacheWrite: number; usd: number }
export const emptyMonth = (): MonthUsage => ({ calls: 0, priced: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, usd: 0 });

export function addUsage(m: MonthUsage, u: Usage | undefined, usd: number | undefined): MonthUsage {
  return {
    calls: m.calls + 1, priced: m.priced + (usd === undefined ? 0 : 1), usd: m.usd + (usd ?? 0),
    input: m.input + (u?.input ?? 0), output: m.output + (u?.output ?? 0), cacheRead: m.cacheRead + (u?.cacheRead ?? 0), cacheWrite: m.cacheWrite + (u?.cacheWrite ?? 0),
  };
}

/** The monthly limit is in dollars, so it counts the calls that have a price. No limit (null) never stops anything. */
export const capReached = (m: MonthUsage, cap: number | null | undefined): boolean => typeof cap === 'number' && cap >= 0 && m.usd >= cap;

/** All the tokens of the month: the prompt (cached or not) and the answers. */
export const monthTokens = (m: MonthUsage): number => m.input + m.cacheRead + m.cacheWrite + m.output;
