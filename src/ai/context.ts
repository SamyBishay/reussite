// What an AI is told (brief §10): the method, the feature's contract, the person's language,
// the person's memory (the profile always, other notes when the request is about them), and compact
// lines for a few relevant steps (at most 25), never the whole list.
import methodEn from '../../docs/METHOD.en.md?raw';
import methodFr from '../../docs/METHOD.fr.md?raw';
import changesetDoc from '../../docs/CHANGESET.md?raw';
import { tasks, projects, places, decisions, memory, settings, today, here, type WithId } from '../app/store';
import { T, isOpen, inPlace, planOf, byPriority, byOrder, estModel, estPoints } from '../app/model';
import { cleanMethod, contractOf, methodSummaryOf } from './method';
import { decisionLines, oneLine as one, stepLine as pureStepLine, STEP_HEADER } from '../domain/lists';
import { appKey, medianRatio } from '../domain/estimates';
import { zoneOfPlace } from '../domain/places';
import { pickNotes, noteBlock, type Note } from '../domain/memory';
import { preferencesPack, preferencesSystem } from '../domain/preferences';
import { lang } from '../i18n';
import { DEFAULT_SETTINGS } from '../data/settings';
import type { Decision, ExchangeTurn, Project } from '../data/schema';

export const MAX_STEPS = 25;

/** The method without the draft notice and evidence placeholders. */
export const method = (l = lang.value): string => cleanMethod(l === 'fr' ? methodFr : methodEn);
/** The opening and the nine rules: the context pack's short summary. */
export const methodSummary = (l = lang.value) => methodSummaryOf(method(l));
export const changesetContract = () => contractOf(changesetDoc);

/**
 * How to answer with the one-tap link instead of the fenced block (docs/CHANGESET.md). `base` is the
 * start of every link for this person: `https://<app>/drop#<space>.<key>.`. Over about 8,000
 * characters the block is still the way, and the person's "Paste the reply" reads it.
 */
export const dropInstruction = (base: string): string =>
  `Give the change-set as one link and no code block: ${base}z.DATA where DATA is the change-set JSON compressed with raw deflate (no zlib or gzip header) and written as base64url without padding. If you cannot compress, give ${base}j.JSON instead, where JSON is the change-set written out and percent-encoded. Write the link on its own line, exactly as above, with no trailing slash and no extra text on that line. If the link would be longer than about 8,000 characters, give the fenced reussite code block instead.`;

const LANG_NAME = { en: 'English', fr: 'French' } as const;
export const answerIn = (l = lang.value) => `Answer in ${LANG_NAME[l]}.`;

// ---------- memory ----------
const byId = (a: Note, b: Note) => (a.id < b.id ? -1 : 1);

/** The profile, written the same way every time (by id) so the prefix it sits in stays byte-identical; empty without one. Never a private note. */
function profileText(): string {
  const ps = [...memory.value.values()].filter(n => n.kind === 'profile' && !n.private).sort(byId);
  return ps.length ? 'About the person, in their own words (note id | kind | name | aliases, then numbered lines):\n\n' + ps.map(noteBlock).join('\n\n') : '';
}

const MEMORY_USE = 'It is what the person told Réussite in their own words: use it to understand them, never to draw conclusions about their health, character or anyone\'s private life.';

/** What memory goes with one request: the text for the user message (empty if none) and the names of every note sent, profile included. */
export interface Memo { text: string; names: string[] }

/**
 * The notes for a request, within the `memoryBudget` setting: the profile (sent in the system prompt) and the
 * notes whose name or alias is in `message` or in the steps involved. Private notes are never picked.
 */
export function memoryFor(message: string, steps: { title: string; project?: string; note?: string }[] = []): Memo {
  const budget = settings.value.memoryBudget;
  const picked = pickNotes({
    notes: memory.value.values(), message, tasks: steps, projects: projects.value.values(),
    budgetTokens: Number.isFinite(budget) && budget >= 0 ? budget : DEFAULT_SETTINGS.memoryBudget,
  });
  const rest = picked.filter(n => n.kind !== 'profile');
  return {
    text: rest.length ? `Memory (note id | kind | name | aliases, then numbered lines). ${MEMORY_USE}\n\n` + rest.map(noteBlock).join('\n\n') : '',
    names: picked.map(n => n.name),
  };
}

/** The stable part of every system prompt (the method, the profile, the person's preferences, the language) and the feature's own part. */
export function systemPrompt(contract: string, l = lang.value): { stable: string; rest: string } {
  const stable = [`You help someone use Réussite, a planning app built on the CBT method below for adults with ADHD. Follow the method and its tone.`, method(l), profileText(), preferencesSystem(settings.value.aiPreferences), answerIn(l)].filter(Boolean).join('\n\n');
  return { stable, rest: `# Your task\n\n${contract.trim()}` };
}

const projName = (id: string) => (id === 'inbox' ? 'Inbox' : projects.value.get(id)?.name ?? id);

/** `id | title | Q1 | due | est | project`, as v1 sent them (the rule is in src/domain/lists.ts). */
export const stepLine = (t: WithId<{ title: string; project: string; due: string | null; est: number | null; status: string }>): string =>
  pureStepLine(T(t.id)!, { today: today.value, urgencyDays: settings.value.urgencyDays, projects: projects.value });
export { STEP_HEADER };
export const stepLines = (ts: { id: string }[], max = MAX_STEPS) => ts.slice(0, max).map(x => stepLine(T(x.id)!)).join('\n');

export function projectLines(max = 30): string {
  const ps = [...projects.value.values()].filter(p => p.status === 'active' || p.status === 'paused').sort(byOrder).slice(0, max);
  return 'Projects (id | name | suit | goal):\n' + ps.map(p => [p.id, one(p.name), p.suit, p.goal ? one(p.goal) : '-'].join(' | ')).join('\n');
}
export function placeLines(): string {
  const ps = [...places.value.values()];
  const by = new Map(ps.map(p => [p.id, p]));
  // An area has its parent's zone and a last column naming the place it belongs to; places without areas read as before.
  const area = (p: (typeof ps)[number]) => (p.parentId && by.has(p.parentId) ? [' | area of ' + by.get(p.parentId)!.id] : []);
  return ps.length ? 'Places (id | name | time zone):\n' + ps.map(p => [p.id, one(p.name), zoneOfPlace(places.value, p.id) ?? p.timeZone].join(' | ') + area(p).join('')).join('\n') : '';
}

/** Today's date, weekday and place: the first line of every context. */
export function header(): string {
  const k = today.value;
  const wd = new Date(k + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
  const pl = here.value === 'any' ? '' : `, in ${places.value.get(here.value)?.name ?? here.value}`;
  return `Today is ${wd} ${k}${pl}. Urgent means due within ${settings.value.urgencyDays} days.`;
}

/**
 * One line of the person's calibration, overall and for the apps named, so an AI's
 * estimates start personal. Add it to any request that asks for estimates.
 */
export function calibrationLine(apps: (string | null | undefined)[] = []): string {
  const m = estModel.value;
  if (!m.ready) return `Calibration: not enough timed steps yet (${m.count}); people usually underestimate, so leave room.`;
  const parts = [`Calibration: real time is about ×${Math.exp(m.g).toFixed(1)} this person's first estimate (${m.count} timed steps)`];
  for (const a of [...new Set(apps.map(appKey).filter(Boolean))]) {
    const pts = estPoints.value.filter(p => appKey(p.app) === a);
    const r = medianRatio(pts.map(p => ({ est0: p.est0, real: p.real })));
    if (r && pts.length >= 2) parts.push(`${a}: ×${r.toFixed(1)} (${pts.length})`);
  }
  return parts.join('; ') + '. Give estimates in minutes, starting-up time included.';
}

/** The open steps most related to `text` (shared words), then by priority; at most `max`. */
export function relevantSteps(text: string, max = MAX_STEPS) {
  const words = new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 2 || /\d/.test(w)));
  const open = [...tasks.value.values()].filter(isOpen);
  const score = (title: string) => title.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => words.has(w)).length;
  return open.map(t => ({ t, s: score(t.title + ' ' + projName(t.project)) })).sort((a, b) => b.s - a.s || byPriority(a.t, b.t)).slice(0, max).map(x => x.t);
}

export type Scope = { kind: 'today' } | { kind: 'matrix' } | { kind: 'project'; id: string } | { kind: 'decision'; id: string };

/** The chosen scope as compact lines. */
export function scopeLines(s: Scope): string {
  const k = today.value;
  if (s.kind === 'today') {
    const plan = planOf(k).map(id => T(id)!).filter(x => !x.template);
    const cand = [...tasks.value.values()].filter(x => isOpen(x) && inPlace(x) && !plan.includes(x)).sort(byPriority);
    return `Today's list:\n${stepLines(plan) || '(empty)'}\n\nOther open steps, most pressing first:\n${stepLines(cand, Math.max(0, MAX_STEPS - plan.length)) || '(none)'}`;
  }
  if (s.kind === 'matrix') {
    const open = [...tasks.value.values()].filter(x => isOpen(x) && inPlace(x)).sort(byPriority);
    return `Open steps, most pressing first (${Math.min(open.length, MAX_STEPS)} of ${open.length}):\n${stepLines(open)}`;
  }
  if (s.kind === 'project') {
    const p = projects.value.get(s.id) as (Project & { id: string }) | undefined;
    if (!p) return '';
    const all = [...tasks.value.values()].filter(x => x.project === s.id && !x.template && x.status !== 'dropped');
    const open = all.filter(x => x.status === 'open').sort(byOrder);
    const smart = p.smart ? Object.entries(p.smart).filter(([, v]) => v).map(([k, v]) => `${k}: ${one(String(v))}`).join('; ') : '';
    return `Project ${p.id}: ${one(p.name)} (${p.status}), due ${p.due ?? '-'}\ngoal: ${p.goal ? one(p.goal) : '-'}${smart ? '\nSMART: ' + smart : ''}\n${all.length - open.length} steps done, ${open.length} open:\n${stepLines(open)}`;
  }
  const d = decisions.value.get(s.id);
  return d ? decisionLines(d) : '';
}

/** "Ask any AI": everything a chatbot needs, ready to paste. */
export function contextPack(s: Scope, question: string, l = lang.value, drop?: string | null): string {
  const apps = s.kind === 'project' ? [...tasks.value.values()].filter(x => x.project === s.id).map(x => x.app) : [];
  const scope = scopeLines(s);
  // The profile and the notes the question or the steps name, as in a request (the same budget); never a private note.
  const picked = pickNotes({ notes: memory.value.values(), message: question + '\n' + scope, projects: projects.value.values(), budgetTokens: settings.value.memoryBudget });
  return [
    'I use Réussite, a planning app built on a CBT method for adults with ADHD. Help me with the question at the end, following the method.',
    '## The method, in short\n\n' + methodSummary(l),
    preferencesPack(settings.value.aiPreferences),
    '## My data\n\n' + [header(), projectLines(), placeLines(), (s.kind === 'decision' ? '' : STEP_HEADER + '\n\n') + scope, calibrationLine(apps)].filter(Boolean).join('\n\n'),
    picked.length && `## What I have told Réussite about me and my people\n\nNote id | kind | name | aliases, then numbered lines. ${MEMORY_USE}\n\n` + picked.map(noteBlock).join('\n\n'),
    '## How to propose changes\n\n' + changesetContract(),
    '## My question\n\n' + question.trim(),
    `${answerIn(l)} ` + (drop
      ? `If you propose changes, end your reply with the change-set. ${dropInstruction(drop)} Never include weights.`
      : 'If you propose changes, end your reply with one fenced code block labelled reussite that holds the change-set. Never include weights.'),
  ].filter(Boolean).join('\n\n');
}

/** The one sentence to paste once into an AI's custom instructions or memory. */
export const dropMemoryLine = (base: string): string => `About my Réussite list: whenever you propose changes to it, answer like this. ${dropInstruction(base)}`;

const MEMORY_RULE = 'Memory lines record only what the person said, in their words. Never write a conclusion about their health, character or anyone\'s private life.';
const OUT_OF_SCOPE = 'You only help with the person\'s list, their memory notes and the method. For anything else (the weather, general knowledge, writing, other apps) return no changes, give one short line in "note" saying that and that their usual AI can help with it, and set "outside": true.';
const ANSWER_IN_NOTE = 'To answer a question about their list, their memory or the method, return no changes and put the answer in "note": short, plain, no preamble.';

/** The list as an AI needs it for one request: today's list, the steps the words point at, the memory they name. */
function listContext(message: string, request: string) {
  const plan = planOf(today.value).map(id => T(id)!).filter(x => x.status === 'open');
  const rel = relevantSteps(message).filter(x => !plan.includes(x));
  const steps = [...plan, ...rel].slice(0, MAX_STEPS);
  const memo = memoryFor(message, steps);
  const user = [header(), projectLines(), placeLines(), `Today's list: ${plan.map(x => x.id).join(', ') || '(empty)'}`, STEP_HEADER + '\n' + stepLines(steps), calibrationLine(steps.map(x => x.app)), memo.text, request].filter(Boolean).join('\n\n');
  return { user, notes: memo.names };
}

/** The command box: the request plus the steps it most likely means and the memory it names. */
export function commandPrompt(text: string): { system: { stable: string; rest: string }; user: string; notes: string[] } {
  const system = systemPrompt(`Turn the person's request into a change-set. Reply with the change-set JSON only, no prose. Use ids from the lines you are given; never invent ids except as "ref" for things you create. If the request is unclear, return no changes and say why in "note". ${MEMORY_RULE}\n\n${changesetContract()}`);
  return { system, ...listContext(text, 'Request:\n' + text.trim()) };
}

/**
 * Home's box (brief §5): a line the local parser couldn't read, with what was said in the last ten minutes. The
 * reply is a change-set; with no changes its `note` is the answer, or, with `outside`, the one line that sends
 * the person to their usual AI.
 */
export function homePrompt(text: string, turns: Pick<ExchangeTurn, 'text' | 'reply' | 'n'>[] = []): { system: { stable: string; rest: string }; user: string; notes: string[] } {
  const system = systemPrompt(`The person typed this in Réussite's box. Reply with the change-set JSON only, no prose. If it asks for a change, give the changes, using ids from the lines you are given and never inventing ids except as "ref" for things you create. ${ANSWER_IN_NOTE} If it is unclear, return no changes and ask one question in "note". ${OUT_OF_SCOPE} ${MEMORY_RULE}\n\n${changesetContract()}`);
  const before = turns.slice(-6).map(x => `Person: ${one(x.text).slice(0, 300)}\n` + (x.reply ? `Réussite: ${one(x.reply).slice(0, 500)}` : x.n ? `Réussite: made ${x.n} change${x.n > 1 ? 's' : ''}` : 'Réussite: (no reply)'));
  // Earlier turns count for the matching too: "and his sister?" still means the note named before.
  const message = [text, ...turns.slice(-6).map(x => x.text + ' ' + (x.reply ?? ''))].join('\n');
  const request = (before.length ? 'Earlier in this conversation:\n' + before.join('\n') + '\n\n' : '') + 'Message:\n' + text.trim();
  return { system, ...listContext(message, request) };
}
