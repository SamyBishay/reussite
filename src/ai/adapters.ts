// The two provider adapters (brief §10), called straight from the browser: OpenAI-compatible
// chat completions (OpenRouter by default, any base URL) and Anthropic's Messages API.
// Pure apart from the injected fetch, so both are unit-tested with a mock.
import type { AiProvider } from '../data/settings';

export type Slot = 'quick' | 'thinking';
/** Every way a call can fail, each with one plain sentence in en.ts (`aiErr…`). */
export type ErrorKind = 'off' | 'noKey' | 'noCredit' | 'rateLimit' | 'auth' | 'network' | 'invalid' | 'refused' | 'server' | 'cancelled';

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
  system: string;
  user: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
export const MAX_TOKENS = 16000;

const trimSlash = (s: string) => s.trim().replace(/\/+$/, '');

export function buildRequest(cfg: AiConfig, slot: Slot, system: string, user: string, maxTokens = MAX_TOKENS): AiRequest {
  const model = cfg.models[slot];
  if (cfg.provider === 'anthropic') {
    return {
      provider: 'anthropic', url: ANTHROPIC_URL, model, system, user,
      headers: {
        'content-type': 'application/json',
        'x-api-key': cfg.key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] },
    };
  }
  const base = trimSlash(cfg.baseUrl);
  const headers: Record<string, string> = { 'content-type': 'application/json', authorization: 'Bearer ' + cfg.key };
  if (/openrouter\.ai/i.test(base)) headers['x-title'] = 'Reussite';
  return {
    provider: 'openai', url: base + '/chat/completions', model, system, user, headers,
    body: { model, max_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] },
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

export type SendResult = { ok: true; text: string } | { ok: false; error: ErrorKind; status?: number; detail?: string };

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
  return text ? { ok: true, text } : { ok: false, error: 'invalid' };
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
  return text ? { ok: true, text } : { ok: false, error: 'invalid' };
}
