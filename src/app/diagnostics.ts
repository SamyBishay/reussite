// Copy diagnostics (brief §11): a plain-text block a friend can paste into a bug report.
// Never titles, notes, names, addresses, keys or the recovery key: only versions, states,
// counts, times and error text that has been scrubbed (errorlog.ts).
import { db, settings } from './store';
import { getLocal } from '../data/db';
import { SCHEMA_VERSION } from '../data/schema';
import { readErrors, scrub, AI_ERR_KEY } from './errorlog';

export type DiagValue = string | number | boolean | null;
type Provider = () => Promise<Record<string, DiagValue>>;
const registry = new Map<string, Provider>();

/**
 * Let a part of the app add a section ("sync", "push") of simple key: value lines. Values must
 * be states, counts and times only. Registering the same section again replaces it.
 */
export function registerDiagnostics(section: string, provider: Provider) { registry.set(section, provider); }

const FALLBACK: Record<string, string> = { sync: 'off', connector: 'off', push: 'not set up' };

export function browser(ua: string): string {
  const m = /(Edg|OPR|Firefox|FxiOS|CriOS|Chrome|Version)\/([\d.]+)/.exec(ua);
  if (!m) return 'unknown';
  const name = m[1] === 'Edg' ? 'Edge' : m[1] === 'OPR' ? 'Opera' : m[1] === 'FxiOS' ? 'Firefox' : m[1] === 'CriOS' ? 'Chrome' : m[1] === 'Version' ? 'Safari' : m[1]!;
  return name + ' ' + m[2]!.split('.')[0];
}
export function os(ua: string): string {
  const pick = (re: RegExp, n: string) => { const m = re.exec(ua); return m ? n + (m[1] ? ' ' + m[1].replace(/_/g, '.') : '') : ''; };
  return pick(/Android ([\d.]+)/, 'Android') || pick(/(?:iPhone|CPU) OS ([\d_]+)/, 'iOS') || pick(/Mac OS X ([\d_]+)/, 'macOS') || pick(/Windows NT ([\d.]+)/, 'Windows')
    || (/CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : 'unknown');
}

const line = (k: string, v: DiagValue | undefined) => k + ': ' + (v === null || v === undefined ? 'n/a' : String(v));
const clean = (v: DiagValue): DiagValue => (typeof v === 'string' ? scrub(v, 120) : v);

export async function buildDiagnostics(): Promise<string> {
  const nav = typeof navigator === 'undefined' ? ({} as Navigator) : navigator;
  const ua = nav.userAgent ?? '';
  const uad = (nav as Navigator & { userAgentData?: { platform?: string; mobile?: boolean } }).userAgentData;
  const standalone = (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) || (nav as Navigator & { standalone?: boolean }).standalone === true;
  let persisted: boolean | null = null;
  try { persisted = (await nav.storage?.persisted?.()) ?? null; } catch { /* unknown */ }
  const perm = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
  const s = settings.value;
  const ai = (await getLocal<{ code: string; status: number | null; at: string }>(db, AI_ERR_KEY)) ?? null;
  let host = '';
  if (s.aiProvider === 'openai') { try { host = ' (' + new URL(s.aiBaseUrl).host + ')'; } catch { host = ''; } }

  const out: string[] = ['Réussite diagnostics', new Date().toISOString(), ''];
  out.push('[app]', line('version', __APP_VERSION__), line('schema', SCHEMA_VERSION), line('language', s.language));
  out.push('', '[device]', line('browser', browser(ua)), line('os', os(ua)), line('platform', uad?.platform ?? nav.platform), line('mobile', uad?.mobile ?? /Mobi|Android|iPhone/.test(ua)),
    line('installed to Home Screen', standalone), line('notifications', perm), line('storage persisted', persisted));
  out.push('', '[ai]', line('provider', s.aiProvider === 'none' ? 'none' : s.aiProvider + host),
    line('last error', ai ? ai.code + (ai.status ? ' ' + ai.status : '') + ' at ' + ai.at : 'none'));

  for (const name of new Set([...Object.keys(FALLBACK), ...registry.keys()])) {
    out.push('', '[' + name + ']');
    const p = registry.get(name);
    if (!p) { out.push(FALLBACK[name]!); continue; }
    try { for (const [k, v] of Object.entries(await p())) out.push(line(k, clean(v))); } catch (e) { out.push('unavailable: ' + scrub(String((e as Error)?.message ?? e), 120)); }
  }

  const errs = (await readErrors()).slice(-50);
  out.push('', '[errors] last ' + errs.length + ' of 50');
  for (const e of errs) out.push(e.at + ' · ' + e.where + ' · ' + scrub(e.message), ...(e.stack ? [scrub(e.stack, 1500).split('\n').map(l => '  ' + l.trim()).join('\n')] : []));
  return out.join('\n');
}
