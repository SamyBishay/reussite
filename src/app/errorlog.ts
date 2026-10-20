// On-device error log (brief §11): the last 50 errors, kept in `local` (never synced), with
// anything that looks like the person's own text scrubbed. Read by Copy diagnostics.
import { db, tasks, projects, places, decisions, stays, memory, exchanges, settings } from './store';
import { getLocal, setLocal } from '../data/db';

export interface LoggedError { at: string; message: string; stack: string; where: string }
export const LOG_KEY = 'errorLog';
export const AI_ERR_KEY = 'aiLastError';
const MAX = 50, MSG = 300, STACK = 1500;
const HIDDEN = '‹…›';
// Values that are structure, not the person's words.
const PLAIN = new Set(['open', 'done', 'dropped', 'task', 'decision', 'draft', 'decided', 'reviewing', 'closed', 'active', 'paused', 'none', 'true', 'false', 'null', 'timer', 'typed', 'corrected', 'start', 'restart', 'normal', 'afternoon', 'hour', 'rest']);

function collect(v: unknown, out: Set<string>, depth = 0) {
  if (depth > 6 || v == null) return;
  if (typeof v === 'string') {
    const s = v.trim();
    if (s.length >= 3 && !PLAIN.has(s.toLowerCase()) && !/^[\d\-:T.Z+/ ]+$/.test(s)) out.add(s);
  } else if (Array.isArray(v)) for (const x of v) collect(x, out, depth + 1);
  else if (typeof v === 'object') for (const x of Object.values(v)) collect(x, out, depth + 1);
}

/** Every string of the person's data (and names in settings), longest first. */
function secrets(): string[] {
  const out = new Set<string>();
  for (const m of [tasks, projects, places, decisions, stays]) {
    for (const d of m.value.values()) {
      const { id: _id, ...rest } = d as Record<string, unknown>;
      collect(rest, out);
    }
  }
  // Memory and what was typed on Home: the words only, not the kinds, ids and undo records around them.
  for (const n of memory.value.values()) collect([n.name, n.description, n.aliases, n.lines.map(l => l.text)], out);
  for (const e of exchanges.value.values()) collect([e.text, e.turns.map(t => [t.text, t.reply])], out);
  collect(settings.value.credit, out);
  collect(settings.value.suits, out);
  return [...out].sort((a, b) => b.length - a.length);
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Hide the person's text in `s`, drop URL queries, and cap the length. Ids are kept. */
export function scrub(s: string, max = MSG, known: string[] = secrets()): string {
  let out = String(s ?? '').replace(/(https?:\/\/[^\s?#)'"]+)[?#][^\s)'"]*/g, '$1');
  for (const k of known) out = out.replace(new RegExp(esc(k), 'gi'), HIDDEN);
  return out.length > max ? out.slice(0, max) + '…' : out;
}

let chain: Promise<void> = Promise.resolve();

/** Record an error: `where` names the place in the app (a short code, no personal text). */
export function logError(e: unknown, where: string): Promise<void> {
  const known = secrets();
  const err = e as { message?: unknown; stack?: unknown } | null;
  const entry: LoggedError = {
    at: new Date().toISOString(),
    message: scrub(typeof e === 'string' ? e : String(err?.message ?? e), MSG, known),
    stack: scrub(String(err?.stack ?? ''), STACK, known),
    where: scrub(where, 60, known),
  };
  chain = chain.then(async () => {
    try {
      const cur = (await getLocal<LoggedError[]>(db, LOG_KEY)) ?? [];
      await setLocal(db, LOG_KEY, [...cur, entry].slice(-MAX));
    } catch { /* the log must never throw */ }
  });
  return chain;
}

export async function readErrors(): Promise<LoggedError[]> {
  await chain;
  return (await getLocal<LoggedError[]>(db, LOG_KEY)) ?? [];
}

/** Remember the last AI failure's code (a plain word and an HTTP status), device-only. */
export function noteAiError(code: string, status?: number): Promise<void> {
  return setLocal(db, AI_ERR_KEY, { code, status: status ?? null, at: new Date().toISOString() }).catch(() => undefined);
}

let wired = false;
/** Capture uncaught errors and rejected promises. Call once at startup. */
export function startErrorLog() {
  if (wired || typeof window === 'undefined') return;
  wired = true;
  window.addEventListener('error', ev => { void logError(ev.error ?? ev.message, 'window'); });
  window.addEventListener('unhandledrejection', ev => { void logError(ev.reason, 'promise'); });
}
