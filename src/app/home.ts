// Home's logic (brief §5): what happens to a line typed or dictated. The local parser reads it first
// (src/domain/parse.ts); one low-risk change applies at once with a receipt and Undo, anything else
// opens the review; a question asks in the card; what the parser can't read goes to the AI with memory when
// one is set up (`routeUnknown`), else to the task sheet. Every applied change-set lands in an exchange, which
// keeps its Undo records, so Undo works from Home and from History, on any device.
import { signal, computed } from '@preact/signals';
import { db, tasks, places, memory, exchanges, addresses, today, settings, hereZone, toast, readOnly, clockNow, createDoc, update, removeDoc, recordWrites, applyUndo, getClock, type WithId } from './store';
import { T, addressesOn } from './model';
import { addSession } from './actions';
import { openNewTask, flows } from './sheets';
import { fieldsOf, type Stored } from '../data/doc';
import { normExchange } from '../data/normalize';
import type { Exchange, ExchangeTurn, Task, UndoDoc } from '../data/schema';
import { parseHome, type HomeParse, type Intent, type ParseContext } from '../domain/parse';
import { parseMinutes } from '../domain/duration';
import { norm, type Named } from '../domain/names';
import { visitPromptFor } from '../domain/offers';
import { planChanges, applyPlanned, isLowRisk } from '../ai/apply';
import { appWriter, snapshot, gen } from '../ai/writer';
import { openChangeReview } from '../ai/Review';
import { aiOn, askChanges } from '../ai/ask';
import { homePrompt } from '../ai/context';
import { openAskAny } from '../ai/ui';
import type { ChangeSet } from '../ai/changeset';
import { t, fmtMin } from '../i18n';

/** An exchange stays open for a follow-up this long after its last turn; after that Home starts clean (brief §5). */
export const OPEN_MS = 10 * 60_000;
/** Exchanges are kept this many days, then emptied and tombstoned. */
export const KEEP_DAYS = 90;
const DAY_MS = 86_400_000;

// ---------- the card ----------
/**
 * What the card shows while an exchange is open and has something to say or ask. Only in memory (a
 * question is worth ten minutes, not a document that syncs); what was applied is in the exchange.
 * With none, the card shows the one nudge (src/views/Home.tsx).
 */
export type HomeCard =
  /** "done the dentist" matched several steps: which one? */
  | { kind: 'pick'; text: string; intent: 'done' | 'move' | 'drop'; candidates: Named[]; at: number }
  /** A step was just ticked done without a timer: how long did it take? The session joins the same Undo. */
  | { kind: 'duration'; task: string; exchange: string; cs: string; at: number }
  /** A change-set waiting for the person's yes in the review ("3 changes · Review"). */
  | { kind: 'review'; cs: ChangeSet; text: string; turn: TurnKind; title: string; at: number }
  /** What an AI said (a clarification, an answer), with an optional button (step 7). */
  | { kind: 'answer'; text: string; action?: { label: string; run: () => void }; at: number };

export const homeCard = signal<HomeCard | null>(null);
/** The card, unless it is older than ten minutes. */
export const cardNow = computed(() => {
  const c = homeCard.value;
  return c && clockNow.value - c.at < OPEN_MS ? c : null;
});
const live = (): HomeCard | null => { const c = homeCard.value; return c && Date.now() - c.at < OPEN_MS ? c : null; };
export const dismissCard = () => { homeCard.value = null; };

// ---------- exchanges ----------
export type TurnKind = Intent | 'changes';

export const lastAt = (ex: Pick<Exchange, 'at' | 'turns'>): number => Date.parse(ex.turns[ex.turns.length - 1]?.at ?? ex.at) || 0;
const hasLive = (ex: Exchange): boolean => ex.changes.some(c => !ex.undone.includes(c));
/** Changes written by an exchange: what its turns say. */
export const changeCount = (ex: Exchange): number => ex.turns.reduce((n, x) => n + (x.n ?? 0), 0);

/** The newest exchange with a turn in the last ten minutes (any source), or one that Home can continue (`src` home). */
export function openExchange(now = clockNow.value, homeOnly = false): WithId<Exchange> | null {
  let best: WithId<Exchange> | null = null;
  for (const ex of exchanges.value.values()) {
    if ((homeOnly && ex.src !== 'home') || now - lastAt(ex) >= OPEN_MS) continue;
    if (!best || lastAt(ex) > lastAt(best)) best = ex;
  }
  return best;
}
/** Read from the database, not the signal, which lags a write by a moment. `mine`: every field was last written by this device. */
async function readExchange(id: string): Promise<(WithId<Exchange> & { mine: boolean }) | null> {
  const d = await db.table_('exchanges').get(id);
  if (!d || d._del) return null;
  const node = ':' + getClock().node;
  return { ...normExchange(fieldsOf(d as Stored<Record<string, unknown>>)), id, mine: Object.values(d._hlc).every(h => h.endsWith(node)) };
}
let lastWritten: string | null = null;
/**
 * The exchange a new turn joins: the newest of this device's with a turn in the last ten minutes and something not undone.
 * Never one another device wrote to: two devices adding turns before they sync would each write the whole `changes` and `undo`, and one would lose the other's.
 */
async function continuing(): Promise<WithId<Exchange> | null> {
  for (const id of new Set([lastWritten, openExchange(Date.now(), true)?.id])) {
    const ex = id ? await readExchange(id) : null;
    // Not one whose every change was undone; one with no change yet (an answer) is still open.
    if (ex?.mine && ex.src === 'home' && (hasLive(ex) || !ex.changes.length) && Date.now() - lastAt(ex) < OPEN_MS) { const { mine: _, ...rest } = ex; return rest; }
  }
  return null;
}

/**
 * Add a turn (and its change-set's Undo records, if any) to the open exchange, or start one. Only Home's own
 * exchanges are continued: one from a link or the inbox (`src`) is always an exchange of its own.
 */
export async function addTurn(turn: ExchangeTurn, applied?: { cs: string; undo: UndoDoc[] }, src: Exchange['src'] = 'home'): Promise<{ exchange: string }> {
  const ex = src === 'home' ? await continuing() : null;
  const changes = applied ? { changes: [...(ex?.changes ?? []), applied.cs], undo: { ...(ex?.undo ?? {}), [applied.cs]: applied.undo } } : {};
  if (ex) {
    await update<Exchange>('exchanges', ex.id, { turns: [...ex.turns, turn], ...changes });
    return { exchange: ex.id };
  }
  const id = await createDoc<Exchange>('exchanges', { at: turn.at, text: turn.text, turns: [turn], changes: [], undo: {}, undone: [], src, ...changes });
  if (src === 'home') lastWritten = id;
  return { exchange: id };
}

/** A change-set that came from outside Home (a one-tap link, the relay's inbox, or a reply pasted into "Paste the reply") and was applied: its own exchange, so History lists it and Undo takes it back. */
export async function recordArrival(cs: ChangeSet, src: 'link' | 'inbox' | 'paste', n: number, undo: UndoDoc[]): Promise<void> {
  await addTurn({ at: new Date().toISOString(), text: cs.note.slice(0, 200) || t(src === 'link' ? 'arrivedLink' : src === 'paste' ? 'arrivedPaste' : 'arrivedInbox'), kind: 'changes', n }, { cs: gen.id('c'), undo }, src);
}

/** The receipt line of an exchange: what one change did, else how many changes. */
export function receiptLine(ex: Exchange): string {
  const applied = ex.turns.filter(x => x.n);
  const only = applied.length === 1 && applied[0]!.n === 1 ? applied[0]! : null;
  const title = only?.reply ?? '';
  if (only && title) {
    if (only.kind === 'add') return t('receiptAdded', { title });
    if (only.kind === 'standing') return t('receiptStanding', { title });
    if (only.kind === 'done') return t('receiptDone', { title });
    if (only.kind === 'move') return t('receiptMoved', { title });
    if (only.kind === 'drop') return t('receiptDropped', { title });
  }
  const n = changeCount(ex);
  return n ? t('receiptChanges', { n }) : ex.turns.find(x => x.kind === 'answer')?.reply ?? '';
}

/** Put back everything the exchange's change-sets wrote, newest first; later edits to the same fields stay. */
export async function undoExchange(id: string): Promise<void> {
  const ex = await readExchange(id);
  if (!ex || readOnly.value) return;
  // All its change-sets at once, so a step one of them made and a later one edited counts as untouched.
  const { kept } = await applyUndo(ex.changes.filter(cs => !ex.undone.includes(cs)).flatMap(cs => ex.undo[cs] ?? []));
  await update<Exchange>('exchanges', id, { undone: [...ex.changes] });
  const c = homeCard.value;
  if (c && ((c.kind === 'duration' && c.exchange === id) || c.kind === 'review')) homeCard.value = null;
  toast(kept ? t('undoneKept', { n: kept }) : t('undoneOk'));
}
export const canUndo = hasLive;

/** Exchanges older than 90 days are emptied (they hold what was typed and the text Undo would put back) and then tombstoned. Safe to repeat. */
export async function pruneExchanges(now = Date.now()): Promise<void> {
  for (const ex of [...exchanges.value.values()]) {
    if (now - lastAt(ex) < KEEP_DAYS * DAY_MS) continue;
    await update<Exchange>('exchanges', ex.id, { text: '', turns: [], changes: [], undo: {}, undone: [] });
    await removeDoc('exchanges', ex.id);
  }
}

// ---------- a line ----------
function parseContext(): ParseContext {
  return {
    today: today.value,
    now: Date.now(),
    dayStart: settings.value.dayStart,
    zone: hereZone.value,
    places: [...places.value.values()].map(p => ({ id: p.id, name: p.name })),
    // Something waited for is not a step to name ("done X"): it is answered with "It happened".
    tasks: [...tasks.value.values()].filter(x => x.kind !== 'event').map(x => ({ id: x.id, title: x.title, status: x.status, template: x.template })),
    notes: [...memory.value.values()].filter(n => !n.private).flatMap(n => [n.name, ...n.aliases]),
  };
}

const FILLER = new Set(['the', 'a', 'an', 'one', 'that', 'this', 'it', 'my', 'le', 'la', 'les', 'l', 'un', 'une', 'celui', 'celle', 'ci', 'mon', 'ma', 'mes', 'of', 'du', 'de', 'des']);
/** Of the candidates a question offered, the one that a follow-up names (every word that matters is in one title: "the bank one"). */
function narrow(candidates: Named[], text: string): Named | null {
  const want = norm(text).split(' ').filter(w => w && !FILLER.has(w));
  if (!want.length) return null;
  const hit = candidates.filter(c => { const have = new Set(norm(c.name).split(' ')); return want.every(w => have.has(w)); });
  return hit.length === 1 ? hit[0]! : null;
}

/**
 * Send a line from Home's input. True when it was taken (the input empties); false when nothing came of
 * it (it stays, to be fixed). A follow-up within ten minutes answers the card's question or joins the
 * open exchange.
 */
export async function submitHome(raw: string): Promise<boolean> {
  const text = raw.trim();
  if (!text || readOnly.value) return false;
  const card = live();
  if (card?.kind === 'pick') {
    const one = narrow(card.candidates, text);
    if (one) return choose(card, one);
  }
  if (card?.kind === 'duration') {
    const m = parseMinutes(text);
    if (m) { await saveDuration(card, m, text); return true; }
  }
  homeCard.value = null;
  const p = parseHome(text, parseContext());
  switch (p.kind) {
    case 'changes': return run(text, p.cs, p.intent, p.title);
    case 'pick': homeCard.value = { kind: 'pick', text, intent: p.intent, candidates: p.candidates, at: Date.now() }; return true;
    case 'sheet': openNewTask(p.prefill); return true;
    case 'unknown': return routeUnknown(text, p);
  }
}

/** The person tapped (or named) one of the candidates: read the same line again with only that step to find. */
export async function choose(card: Extract<HomeCard, { kind: 'pick' }>, pick: Named): Promise<boolean> {
  const ctx = parseContext();
  const p = parseHome(card.text, { ...ctx, tasks: ctx.tasks.filter(x => x.id === pick.id) });
  homeCard.value = null;
  return p.kind === 'changes' ? run(card.text, p.cs, p.intent, p.title) : false;
}

/**
 * Where a line the parser can't read goes (brief §5): to the AI with memory when one is set up, otherwise
 * to the task sheet, filled with what was read.
 */
export async function routeUnknown(text: string, p: Extract<HomeParse, { kind: 'unknown' }>): Promise<boolean> {
  if (p.reason === 'empty') return false;
  if (!aiOn.value) { openNewTask(p.prefill); return true; }
  return askHome(text, p.prefill);
}

/**
 * Ask the AI about a line, with the earlier turns of the open exchange (the last ten minutes). Its reply is a
 * change-set: changes go through `run` (one low-risk change at once, else the review), no change means an
 * answer for the card, and "outside" sends the person to their usual AI with the question ready. A failure is
 * one plain sentence and a button to the sheet; nothing is written.
 */
async function askHome(text: string, prefill: Partial<Task>): Promise<boolean> {
  const turns = (await continuing())?.turns ?? [];
  const { system, user, notes } = homePrompt(text, turns);
  const asking = { kind: 'answer' as const, text: t('homeAsking'), at: Date.now() };
  homeCard.value = asking;
  const r = await askChanges('home', 'quick', system, user, { notes });
  if (homeCard.value === asking) homeCard.value = null;
  if (r.ok) return run(text, r.cs, 'changes', '');
  if (r.error === 'cancelled') return false;
  if (r.error !== 'empty') {
    showAnswer(r.message, { label: t('homeAddAsStep'), run: () => { dismissCard(); openNewTask(prefill); } });
    return true;
  }
  showAnswer(r.message, r.outside ? { label: t('askAnyAi'), run: () => { dismissCard(); openAskAny({ kind: 'today' }, text); } } : undefined);
  await addTurn({ at: new Date().toISOString(), text, kind: 'answer', reply: r.message });
  return true;
}

/** Show an answer on the card (an AI's reply, a clarification); the card clears after ten minutes or on OK. */
export function showAnswer(text: string, action?: { label: string; run: () => void }) {
  homeCard.value = { kind: 'answer', text, action, at: Date.now() };
}

/**
 * Apply a change-set the person's words (or an AI's reply) made: one low-risk change goes in at once, with a
 * receipt and Undo; anything else opens the review, with its Undo recorded and its receipt written once applied.
 */
export async function run(text: string, cs: ChangeSet, turn: TurnKind, title: string): Promise<boolean> {
  const plan = planChanges(cs, snapshot(), gen);
  if (!plan.items.length) { toast(cs.note || t('chgNoneLeft')); return false; }
  const first = cs.changes[0];
  const done = cs.changes.length === 1 && first?.op === 'task.done' ? first.id : null;
  const timed = !!(done && T(done)?.started);
  const record = async (n: number, undo: UndoDoc[]) => {
    homeCard.value = null;
    const id = gen.id('c');
    const { exchange } = await addTurn({ at: new Date().toISOString(), text, kind: turn, reply: title || cs.note || undefined, n }, { cs: id, undo });
    // A step ticked done with no timer running: how long did it take? (With one, its time was saved.)
    if (done && !timed) homeCard.value = { kind: 'duration', task: done, exchange, cs: id, at: Date.now() };
    // A step that feeds an address asks how it was, as when it is ticked on Today.
    const fed = done ? T(done) : undefined, a = fed && visitPromptFor(fed, addresses.value);
    if (fed && a && addressesOn()) flows.visit(a, { stepId: fed.id, day: fed.doneDay ?? today.value });
  };
  if (isLowRisk(cs, plan)) {
    const { result: n, undo } = await recordWrites(() => applyPlanned(plan, () => true, appWriter));
    if (n) await record(n, undo); else toast(t('chgNothing'));
    return true;
  }
  homeCard.value = { kind: 'review', cs, text, turn, title, at: Date.now() };
  return openChangeReview(cs, { request: text, record: true, onApplied: (n, undo) => { if (n) void record(n, undo); } });
}

/** Reopen the review a card holds. */
export function reviewAgain(card: Extract<HomeCard, { kind: 'review' }>) {
  void run(card.text, card.cs, card.turn, card.title);
}

/** The time a step took, saved as typed; it joins the Undo of the exchange that ticked it done. */
export async function saveDuration(card: Extract<HomeCard, { kind: 'duration' }>, minutes: number, said = fmtMin(minutes)): Promise<void> {
  const tk = T(card.task);
  homeCard.value = null;
  if (!tk) return;
  const { undo } = await recordWrites(() => addSession(tk.id, minutes, 'done', 'typed', tk.doneDay ?? today.value));
  const ex = await readExchange(card.exchange);
  if (ex) {
    await update<Exchange>('exchanges', ex.id, {
      undo: { ...ex.undo, [card.cs]: [...(ex.undo[card.cs] ?? []), ...undo] },
      turns: [...ex.turns, { at: new Date().toISOString(), text: said, kind: 'duration', reply: tk.title }],
    });
  }
  toast(t('homeTimeSaved', { t: fmtMin(minutes) }));
}
