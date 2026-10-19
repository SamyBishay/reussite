// The one entry point for AI calls (brief §10). Features call `ask` (or `askChanges`) with a
// zod schema; the reply is JSON-extracted and validated, and invalid output writes nothing.
// "Show me what's sent": before the first call of each kind (or every call, if the person
// asked), the exact request is shown and nothing leaves until they tap Send.
import { computed, signal } from '@preact/signals';
import type { ZodType } from 'zod';
import { db, settings } from '../app/store';
import { getLocal, setLocal } from '../data/db';
import { t, type Key } from '../i18n';
import { noteAiError } from '../app/errorlog';
import { buildRequest, masked, send, type AiConfig, type AiRequest, type ErrorKind, type Slot } from './adapters';
import { extractJson } from './json';
import { readChangeSet, ChangeSetSchema, type ChangeSet } from './changeset';
import type { AiProvider } from '../data/settings';

export type { Slot, ErrorKind, AiRequest };
export type AskResult<T> = { ok: true; data: T; text: string } | { ok: false; error: ErrorKind; message: string };
export interface AskOptions { signal?: AbortSignal; maxTokens?: number; /** Skip "Show me what's sent" (only for requests that carry nothing personal, like the connection test). */ noPreview?: boolean; fetchFn?: typeof fetch }

/** A provider is chosen: AI features show. "Ask any AI" works without one. */
export const aiOn = computed(() => settings.value.aiProvider !== 'none');

const ERR: Record<ErrorKind, Key> = {
  off: 'aiErrOff', noKey: 'aiErrNoKey', noCredit: 'aiErrNoCredit', rateLimit: 'aiErrRateLimit', auth: 'aiErrAuth',
  network: 'aiErrNetwork', invalid: 'aiErrInvalid', refused: 'aiErrRefused', server: 'aiErrServer', cancelled: 'aiErrCancelled',
};
export const errorText = (e: ErrorKind) => t(ERR[e]);
const fail = (error: ErrorKind): { ok: false; error: ErrorKind; message: string } => ({ ok: false, error, message: errorText(error) });

// ---------- the key: device-local only ----------
const keyName = (p: Exclude<AiProvider, 'none'>) => 'aiKey.' + p;
export const getKey = async (p: Exclude<AiProvider, 'none'>) => (await getLocal<string>(db, keyName(p))) ?? '';
export const setKey = (p: Exclude<AiProvider, 'none'>, key: string) => setLocal(db, keyName(p), key.trim());

export async function config(): Promise<AiConfig | ErrorKind> {
  const s = settings.value;
  if (s.aiProvider === 'none') return 'off';
  const key = await getKey(s.aiProvider);
  if (!key) return 'noKey';
  return { provider: s.aiProvider, baseUrl: s.aiBaseUrl, models: s.aiModels[s.aiProvider], key };
}

// ---------- "Show me what's sent" ----------
/** The request waiting for Send or Cancel; PreviewHost shows it above any open sheet. */
export const pending = signal<{ req: AiRequest; kind: string; done: (send: boolean) => void } | null>(null);
const SEEN = 'aiSeen';
export async function seenKinds(): Promise<string[]> { return (await getLocal<string[]>(db, SEEN)) ?? []; }
export const forgetSeen = () => setLocal(db, SEEN, []);

/** Show the exact request and wait for the person's answer. */
export function preview(req: AiRequest, kind: string): Promise<boolean> {
  return new Promise(res => {
    pending.value?.done(false);
    pending.value = { req: masked(req), kind, done: ok => { pending.value = null; res(ok); } };
  });
}
async function mayShow(req: AiRequest, kind: string): Promise<boolean> {
  const seen = await seenKinds();
  if (!settings.value.aiAlwaysShow && seen.includes(kind)) return true;
  const ok = await preview(req, kind);
  if (ok && !seen.includes(kind)) await setLocal(db, SEEN, [...seen, kind]);
  return ok;
}

/**
 * Ask the configured AI. `kind` names the feature (one preview per kind), `slot` picks the
 * model. The reply must be JSON matching `schema`; anything else is `invalid`.
 */
export async function ask<T>(kind: string, slot: Slot, system: string, user: string, schema: ZodType<T>, o: AskOptions = {}): Promise<AskResult<T>> {
  const cfg = await config();
  if (typeof cfg === 'string') return fail(cfg);
  const req = buildRequest(cfg, slot, system, user, o.maxTokens);
  if (!o.noPreview && !(await mayShow(req, kind))) return fail('cancelled');
  const r = await send(req, o.fetchFn ?? fetch, o.signal);
  if (!r.ok) { void noteAiError(r.error, r.status); if (r.detail) console.warn('AI error', r.status, r.detail); return fail(r.error); }
  const json = extractJson(r.text);
  if (json === undefined) { void noteAiError('invalid'); return fail('invalid'); }
  const v = schema.safeParse(json);
  if (!v.success) { console.warn('AI output rejected', v.error.issues.slice(0, 3)); void noteAiError('invalid'); return fail('invalid'); }
  return { ok: true, data: v.data, text: r.text };
}

export type ChangesResult = { ok: true; cs: ChangeSet } | { ok: false; error: ErrorKind | 'empty'; message: string };
/** Ask for a change-set (docs/CHANGESET.md). An empty one comes back as `empty`, with the AI's note as the message. */
export async function askChanges(kind: string, slot: Slot, system: string, user: string, o: AskOptions = {}): Promise<ChangesResult> {
  const r = await ask(kind, slot, system, user, ChangeSetSchema, o);
  if (!r.ok) return r;
  const p = readChangeSet(r.data);
  if (p.ok) return p;
  if (p.error === 'empty') return { ok: false, error: 'empty', message: r.data.note?.trim() || t('aiNoChanges') };
  return fail('invalid');
}
