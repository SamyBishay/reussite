// The two provider adapters (brief §10), called straight from the browser: OpenAI-compatible
// chat completions (OpenRouter by default, any base URL) and Anthropic's Messages API.
// Pure apart from the injected fetch, so both are unit-tested with a mock.
import type { AiProvider } from '../data/settings';

export type Slot = 'quick' | 'thinking';
/** Every way a call can fail, each with one plain sentence in en.ts (`aiErr…`). */
export type ErrorKind = 'off' | 'noKey' | 'noCredit' | 'rateLimit' | 'auth' | 'network' | 'invalid' | 'refused' | 'server' | 'cancelled' | 'cap';

/**
 * The system prompt: one string, or two parts. `stable` has the same bytes in every feature (the method,
 * the profile, the language), so a provider that caches a prefix can reuse it; `rest` is what this feature adds.
 */
export type System = string | { stable: string; rest: string };
export const systemText = (s: System): string => (typeof s === 'string' ? s : s.stable + '\n\n' + s.rest);

/** What one call used, as the provider reported it. `input` is the prompt's uncached tokens; `cost` is dollars, when reported. */
export interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number; cost?: number }

export interface AiConfig {
  provider: Exclude<AiProvider, 'none'>;
  baseUrl: string;
  models: { quick: string; thinking: string };
  key: string;
}

/** Exactly what goes over the wire. `shown` is the same with the key masked, for "Show me what's sent". */
export interface AiRequest {
  provider: AiConfig['provider'];
  url: string;
  model: string;
  /** The whole system prompt as text (the preview shows this); `body` may split it in two blocks. */
  system: string;
  user: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
export const MAX_TOKENS = 16000;

const trimSlash = (s: string) => s.trim().replace(/\/+$/, '');

const CACHE = { type: 'ephemeral' } as const;

export function buildRequest(cfg: AiConfig, slot: Slot, sys: System, user: string, maxTokens = MAX_TOKENS): AiRequest {
  const model = cfg.models[slot];
  const system = systemText(sys);
  if (cfg.provider === 'anthropic') {
    // Two blocks, the first marked for caching: it ends the prefix every feature shares.
    const blocks = typeof sys === 'string' ? sys : [{ type: 'text', text: sys.stable, cache_control: CACHE }, { type: 'text', text: sys.rest }];
    return {
      provider: 'anthropic', url: ANTHROPIC_URL, model, system, user,
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: { model, max_tokens: maxTokens, system: blocks, messages: [{ role: 'user', content: user }] },
    };
  }
  const base = trimSlash(cfg.baseUrl);
  const headers: Record<string, string> = { 'content-type': 'application/json', authorization: 'Bearer ' + cfg.key };
  const openrouter = /openrouter\.ai/i.test(base);
  if (openrouter) headers['x-title'] = 'Reussite';
  // OpenRouter passes cache_control on to Anthropic models; anything else gets the stable part first, in one string.
  const content = typeof sys !== 'string' && openrouter && /^anthropic\//.test(model) ? [{ type: 'text', text: sys.stable, cache_control: CACHE }, { type: 'text', text: sys.rest }] : system;
  return {
    provider: 'openai', url: base + '/chat/completions', model, system, user, headers,
    body: { model, max_tokens: maxTokens, messages: [{ role: 'system', content }, { role: 'user', content: user }] },
  };
}

/** The request with the key masked: what the preview shows. */
export function masked(r: AiRequest): AiRequest {
  const h = { ...r.headers };
  for (const k of ['x-api-key', 'authorization']) if (h[k]) h[k] = h[k]!.startsWith('Bearer ') ? 'Bearer ••••' : '••••';
  return { ...r, headers: h };
}

/** Map an HTTP failure to one of the plain errors. */
export function classify(status: number, body: string): ErrorKind {
  const b = body.toLowerCase();
  const money = /credit|insufficient_quota|billing|balance/.test(b);
  if (status === 402) return 'noCredit';
  // OpenAI says "no credit" with a 429 (insufficient_quota); Anthropic with a 400.
  if (status === 429) return money ? 'noCredit' : 'rateLimit';
  if (status === 401 || status === 403) return 'auth';
  if (status >= 400 && status < 500 && money) return 'noCredit';
  return 'server';
}

export type SendResult = { ok: true; text: string; usage?: Usage } | { ok: false; error: ErrorKind; status?: number; detail?: string };

/** Send the request and return the model's text. Never throws. */
export async function send(r: AiRequest, fetchFn: typeof fetch = fetch, signal?: AbortSignal): Promise<SendResult> {
  let res: Response;
  try {
    res = await fetchFn(r.url, { method: 'POST', headers: r.headers, body: JSON.stringify(r.body), signal });
  } catch (e) {
    return { ok: false, error: (e as Error)?.name === 'AbortError' ? 'cancelled' : 'network', detail: String((e as Error)?.message ?? e) };
  }
  let raw = '';
  try { raw = await res.text(); } catch { return { ok: false, error: 'network' }; }
  if (!res.ok) return { ok: false, error: classify(res.status, raw), status: res.status, detail: raw.slice(0, 300) };
  let j: Record<string, unknown>;
  try { j = JSON.parse(raw) as Record<string, unknown>; } catch { return { ok: false, error: 'invalid', status: res.status, detail: raw.slice(0, 300) }; }
  return r.provider === 'anthropic' ? readAnthropic(j) : readOpenAI(j);
}

function readAnthropic(j: Record<string, unknown>): SendResult {
  if (j.type === 'error') return { ok: false, error: classify(400, JSON.stringify(j.error ?? '')), detail: JSON.stringify(j.error) };
  if (j.stop_reason === 'refusal') return { ok: false, error: 'refused' };
  const blocks = Array.isArray(j.content) ? (j.content as { type?: string; text?: string }[]) : [];
  const text = blocks.filter(b => b.type === 'text' && typeof b.text === 'string').map(b => b.text).join('');
  return text ? { ok: true, text, ...usageOf(anthropicUsage(j.usage)) } : { ok: false, error: 'invalid' };
}

const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0);
const usageOf = (usage: Usage | undefined) => (usage ? { usage } : {});

/** Anthropic: `input_tokens` counts only what was not read from or written to the cache. */
function anthropicUsage(u: unknown): Usage | undefined {
  if (!u || typeof u !== 'object') return undefined;
  const o = u as Record<string, unknown>;
  return { input: num(o.input_tokens), output: num(o.output_tokens), cacheRead: num(o.cache_read_input_tokens), cacheWrite: num(o.cache_creation_input_tokens) };
}

/**
 * OpenAI shape (OpenRouter too): `prompt_tokens` counts everything, cached or not, so the cache figures are taken out of it.
 * OpenRouter's `cost` is dollars charged; it is in every reply (the old `usage: {include: true}` is deprecated).
 */
function openAIUsage(u: unknown): Usage | undefined {
  if (!u || typeof u !== 'object') return undefined;
  const o = u as Record<string, unknown>;
  const d = (o.prompt_tokens_details ?? {}) as Record<string, unknown>;
  const cacheRead = num(d.cached_tokens), cacheWrite = num(d.cache_write_tokens);
  const cost = typeof o.cost === 'number' && Number.isFinite(o.cost) && o.cost >= 0 ? o.cost : undefined;
  return { input: Math.max(0, num(o.prompt_tokens) - cacheRead - cacheWrite), output: num(o.completion_tokens), cacheRead, cacheWrite, ...(cost === undefined ? {} : { cost }) };
}

function readOpenAI(j: Record<string, unknown>): SendResult {
  // OpenRouter can answer 200 with an error object.
  if (j.error && typeof j.error === 'object') {
    const e = j.error as { code?: unknown; message?: unknown };
    const code = Number(e.code);
    return { ok: false, error: classify(Number.isFinite(code) ? code : 500, String(e.message ?? '')), detail: String(e.message ?? '') };
  }
  const ch = Array.isArray(j.choices) ? (j.choices[0] as { message?: { content?: unknown; refusal?: unknown }; finish_reason?: string } | undefined) : undefined;
  const c = ch?.message?.content;
  const text = typeof c === 'string' ? c : Array.isArray(c) ? c.map(p => (typeof p === 'string' ? p : (p as { text?: string })?.text ?? '')).join('') : '';
  if (!text && ch?.message?.refusal) return { ok: false, error: 'refused' };
  return text ? { ok: true, text, ...usageOf(openAIUsage(j.usage)) } : { ok: false, error: 'invalid' };
}
