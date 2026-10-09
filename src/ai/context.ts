// What an AI is told (brief §10): the method, the feature's contract, the person's language,
// and compact lines for a few relevant steps (at most 25), never the whole list.
import methodEn from '../../docs/METHOD.en.md?raw';
import methodFr from '../../docs/METHOD.fr.md?raw';
import changesetDoc from '../../docs/CHANGESET.md?raw';
import { tasks, projects, places, decisions, settings, today, here, type WithId } from '../app/store';
import { T, quad, isOpen, inPlace, planOf, byPriority, byOrder, estModel, estPoints } from '../app/model';
import { appKey, medianRatio } from '../domain/estimates';
import { lang } from '../i18n';
import type { Decision, Project } from '../data/schema';

export const MAX_STEPS = 25;

/** The method without the draft notice and evidence placeholders. */
export function method(l = lang.value): string {
  return (l === 'fr' ? methodFr : methodEn).replace(/^>.*\n(>.*\n)*/m, '').replace(/\s*`\[E[^\]]*\]`/g, '').trim();
}
/** The opening and the nine rules: the context pack's short summary. */
export const methodSummary = (l = lang.value) => method(l).split(/\n## /).slice(0, 2).join('\n## ').replace(/^# .*\n+/, '').trim();
export const changesetContract = () => changesetDoc.trim();

const LANG_NAME = { en: 'English', fr: 'French' } as const;
export const answerIn = (l = lang.value) => `Answer in ${LANG_NAME[l]}.`;

/** System prompt: the method, then the feature's output contract, then the language. */
export function systemPrompt(contract: string, l = lang.value): string {
  return `You help someone use Réussite, a planning app built on the CBT method below for adults with ADHD. Follow the method and its tone.\n\n${method(l)}\n\n# Your task\n\n${contract.trim()}\n\n${answerIn(l)}`;
}

const one = (s: string) => s.replace(/\s+/g, ' ').replace(/\|/g, '/').trim();
const projName = (id: string) => (id === 'inbox' ? 'Inbox' : projects.value.get(id)?.name ?? id);

/** `id | title | Q1 | due | est | project`, as v1 sent them. */
export function stepLine(t: WithId<{ title: string; project: string; due: string | null; est: number | null; status: string }>): string {
  const tk = T(t.id)!;
  const done = t.status === 'done' ? ' (done)' : '';
  return [t.id, one(t.title) + done, 'Q' + quad(tk), t.due ?? '-', t.est ? t.est + 'm' : '-', one(projName(t.project))].join(' | ');
}
export const STEP_HEADER = 'Steps (id | title | quadrant: Q1 now, Q2 plan, Q3 quick, Q4 later | due | estimate | project):';
export const stepLines = (ts: { id: string }[], max = MAX_STEPS) => ts.slice(0, max).map(x => stepLine(T(x.id)!)).join('\n');

export function projectLines(max = 30): string {
  const ps = [...projects.value.values()].filter(p => p.status === 'active' || p.status === 'paused').sort(byOrder).slice(0, max);
  return 'Projects (id | name | suit | goal):\n' + ps.map(p => [p.id, one(p.name), p.suit, p.goal ? one(p.goal) : '-'].join(' | ')).join('\n');
}
export function placeLines(): string {
  const ps = [...places.value.values()];
  return ps.length ? 'Places (id | name | time zone):\n' + ps.map(p => [p.id, one(p.name), p.timeZone].join(' | ')).join('\n') : '';
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

function decisionLines(d: Decision & { id: string }): string {
  const L = [`Decision ${d.id}: ${one(d.title)} (${d.status})`];
  for (const [k, v] of Object.entries(d.problem)) if (v) L.push(`problem.${k}: ${one(v)}`);
  for (const o of d.options) {
    L.push(`option "${one(o.name)}"${o.screened ? ' (screened out: ' + one(o.screened) + ')' : ''}`);
    for (const c of ['pros', 'cons', 'prosNot', 'consNot'] as const) if (o[c].length) L.push(`  ${c}: ${o[c].map(i => one(i.text)).join('; ')}`);
  }
  if (d.chosen) L.push(`chosen: ${one(d.chosen)}; why: ${one(d.why)}; falsifier: ${one(d.falsifier)}; check on ${d.reviewOn ?? '-'}`);
  return L.join('\n');
}

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
export function contextPack(s: Scope, question: string, l = lang.value): string {
  const apps = s.kind === 'project' ? [...tasks.value.values()].filter(x => x.project === s.id).map(x => x.app) : [];
  return [
    'I use Réussite, a planning app built on a CBT method for adults with ADHD. Help me with the question at the end, following the method.',
    '## The method, in short\n\n' + methodSummary(l),
    '## My data\n\n' + [header(), projectLines(), placeLines(), (s.kind === 'decision' ? '' : STEP_HEADER + '\n\n') + scopeLines(s), calibrationLine(apps)].filter(Boolean).join('\n\n'),
    '## How to propose changes\n\n' + changesetContract(),
    '## My question\n\n' + question.trim(),
    `${answerIn(l)} If you propose changes, end your reply with one fenced code block labelled reussite that holds the change-set. Never include weights.`,
  ].join('\n\n');
}

/** The command box: the request plus the steps it most likely means. */
export function commandPrompt(text: string): { system: string; user: string } {
  const plan = planOf(today.value).map(id => T(id)!).filter(x => x.status === 'open');
  const rel = relevantSteps(text).filter(x => !plan.includes(x));
  const steps = [...plan, ...rel].slice(0, MAX_STEPS);
  const system = systemPrompt(`Turn the person's request into a change-set. Reply with the change-set JSON only, no prose. Use ids from the lines you are given; never invent ids except as "ref" for things you create. If the request is unclear, return no changes and say why in "note".\n\n${changesetContract()}`);
  const user = [header(), projectLines(), placeLines(), `Today's list: ${plan.map(x => x.id).join(', ') || '(empty)'}`, STEP_HEADER + '\n' + stepLines(steps), calibrationLine(steps.map(x => x.app)), 'Request:\n' + text.trim()].filter(Boolean).join('\n\n');
  return { system, user };
}
