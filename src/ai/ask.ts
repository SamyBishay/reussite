// The one entry point for AI calls (brief §10). Features call `ask` (or `askChanges`) with a
// zod schema; the reply is JSON-extracted and validated, and invalid output writes nothing.
// "Show me what's sent": before the first call of each kind (or every call, if the person
// asked), the exact request is shown and nothing leaves until they tap Send.
import { computed, effect, signal } from '@preact/signals';
import type { ZodType } from 'zod';
import { db, settings, today } from '../app/store';
import { getLocal, setLocal } from '../data/db';
import { t, type Key } from '../i18n';
import { noteAiError } from '../app/errorlog';
import { buildRequest, masked, send, type AiConfig, type AiRequest, type ErrorKind, type Slot, type System, type Usage } from './adapters';
import { addUsage, capReached, dollars, emptyMonth, type MonthUsage } from './prices';
import { extractJson } from './json';
import { readChangeSet, ChangeSetSchema, type ChangeSet } from './changeset';
import type { AiProvider } from '../data/settings';

export type { Slot, ErrorKind, AiRequest };
export type AskResult<T> = { ok: true; data: T; text: string } | { ok: false; error: ErrorKind; message: string };
export interface AskOptions { signal?: AbortSignal; maxTokens?: number; /** The memory notes that are part of this request, listed in "Show me what's sent". */ notes?: string[]; /** Skip "Show me what's sent" (only for requests that carry nothing personal, like the connection test). */ noPreview?: boolean; fetchFn?: typeof fetch }

/** Which providers have a key on this device; filled the first time a provider is chosen, and by setKey. */
const keyed = signal<Partial<Record<Exclude<AiProvider, 'none'>, boolean>>>({});
/** A provider is chosen and this device has its key: the features that call it show. "Ask any AI" and Paste the reply work without either. */
export const aiOn = computed(() => { const p = settings.value.aiProvider; return p !== 'none' && !!keyed.value[p]; });

const ERR: Record<ErrorKind, Key> = {
  off: 'aiErrOff', noKey: 'aiErrNoKey', noCredit: 'aiErrNoCredit', rateLimit: 'aiErrRateLimit', auth: 'aiErrAuth',
  network: 'aiErrNetwork', invalid: 'aiErrInvalid', refused: 'aiErrRefused', server: 'aiErrServer', cancelled: 'aiErrCancelled', cap: 'aiErrCap',
};
export const errorText = (e: ErrorKind) => t(ERR[e]);
const fail = (error: ErrorKind): { ok: false; error: ErrorKind; message: string } => ({ ok: false, error, message: errorText(error) });

// ---------- the key: device-local only ----------
const keyName = (p: Exclude<AiProvider, 'none'>) => 'aiKey.' + p;
export const getKey = async (p: Exclude<AiProvider, 'none'>) => (await getLocal<string>(db, keyName(p))) ?? '';
export const setKey = async (p: Exclude<AiProvider, 'none'>, key: string) => { await setLocal(db, keyName(p), key.trim()); keyed.value = { ...keyed.peek(), [p]: !!key.trim() }; };
effect(() => {
  const p = settings.value.aiProvider;
  if (p === 'none' || p in keyed.peek()) return;
  void getKey(p).then(k => { if (!(p in keyed.peek())) keyed.value = { ...keyed.peek(), [p]: !!k }; }, () => undefined);
});

export async function config(): Promise<AiConfig | ErrorKind> {
  const s = settings.value;
  if (s.aiProvider === 'none') return 'off';
  const key = await getKey(s.aiProvider);
  if (!key) return 'noKey';
  return { provider: s.aiProvider, baseUrl: s.aiBaseUrl, models: s.aiModels[s.aiProvider], key };
}

// ---------- spend: per device, per month ----------
// Kept in `local` (never synced): what this device's key was used for. Dollars where the call has a price
// (OpenRouter reports one; Anthropic's own API by the table in prices.ts), tokens always.
const monthKey = () => 'aiUsage.' + today.value.slice(0, 7);
export const monthUsage = async (): Promise<MonthUsage> => ({ ...emptyMonth(), ...((await getLocal<MonthUsage>(db, monthKey())) ?? {}) });
/** This month's usage as the settings page shows it; null until loaded. */
export const spent = signal<MonthUsage | null>(null);
export const loadSpent = async () => { spent.value = await monthUsage(); };
let writing: Promise<unknown> = Promise.resolve();
/** Add a call to the month (one at a time, so two calls at once both count). */
function recordUsage(provider: AiConfig['provider'], model: string, u: Usage | undefined): Promise<unknown> {
  writing = writing.then(async () => {
    const m = addUsage(await monthUsage(), u, u ? dollars(provider, model, u) : undefined);
    await setLocal(db, monthKey(), m);
    spent.value = m;
  }).catch(() => undefined);
  return writing;
}

// ---------- "Show me what's sent" ----------
/** The request waiting for Send or Cancel; PreviewHost shows it above any open sheet. `notes` = the memory notes in it. */
export const pending = signal<{ req: AiRequest; kind: string; notes?: string[]; done: (send: boolean) => void } | null>(null);
const SEEN = 'aiSeen';
export async function seenKinds(): Promise<string[]> { return (await getLocal<string[]>(db, SEEN)) ?? []; }
export const forgetSeen = () => setLocal(db, SEEN, []);

/** Show the exact request and wait for the person's answer. */
export function preview(req: AiRequest, kind: string, notes?: string[]): Promise<boolean> {
  return new Promise(res => {
    pending.value?.done(false);
    pending.value = { req: masked(req), kind, notes, done: ok => { pending.value = null; res(ok); } };
  });
}
async function mayShow(req: AiRequest, kind: string, notes?: string[]): Promise<boolean> {
  const seen = await seenKinds();
  if (!settings.value.aiAlwaysShow && seen.includes(kind)) return true;
  const ok = await preview(req, kind, notes);
  if (ok && !seen.includes(kind)) await setLocal(db, SEEN, [...seen, kind]);
  return ok;
}

/**
 * Ask the configured AI. `kind` names the feature (one preview per kind), `slot` picks the
 * model. The reply must be JSON matching `schema`; anything else is `invalid`.
 */
export async function ask<T>(kind: string, slot: Slot, system: System, user: string, schema: ZodType<T>, o: AskOptions = {}): Promise<AskResult<T>> {
  const cfg = await config();
  if (typeof cfg === 'string') return fail(cfg);
  if (capReached(await monthUsage(), settings.value.aiMonthlyCap)) return fail('cap');
  const req = buildRequest(cfg, slot, system, user, o.maxTokens);
  if (!o.noPreview && !(await mayShow(req, kind, o.notes))) return fail('cancelled');
  const r = await send(req, o.fetchFn ?? fetch, o.signal);
  if (r.ok) await recordUsage(cfg.provider, req.model, r.usage);
  if (!r.ok) { void noteAiError(r.error, r.status); if (r.detail) console.warn('AI error', r.status, r.detail); return fail(r.error); }
  const json = extractJson(r.text);
  if (json === undefined) { void noteAiError('invalid'); return fail('invalid'); }
  const v = schema.safeParse(json);
  if (!v.success) { console.warn('AI output rejected', v.error.issues.slice(0, 3)); void noteAiError('invalid'); return fail('invalid'); }
  return { ok: true, data: v.data, text: r.text };
}

/** `outside`: the AI said the request is not about the list, the memory or the method (Home's contract asks for it). */
export type ChangesResult = { ok: true; cs: ChangeSet } | { ok: false; error: ErrorKind | 'empty'; message: string; outside?: boolean };
/** Ask for a change-set (docs/CHANGESET.md). An empty one comes back as `empty`, with the AI's note as the message. */
export async function askChanges(kind: string, slot: Slot, system: System, user: string, o: AskOptions = {}): Promise<ChangesResult> {
  const r = await ask(kind, slot, system, user, ChangeSetSchema, o);
  if (!r.ok) return r;
  const p = readChangeSet(r.data);
  if (p.ok) return p;
  if (p.error === 'empty') return { ok: false, error: 'empty', message: r.data.note?.trim() || t('aiNoChanges'), ...(r.data.outside ? { outside: true } : {}) };
  return fail('invalid');
}
