// What each AI feature sends (brief §10, features 2–6): the method and the feature's contract as
// the system prompt; compact lines for at most 25 steps, and the calibration line whenever the
// AI is asked for estimates.
import { projects, places, settings, today, here, type WithId } from '../app/store';
import { T, dayDoc } from '../app/model';
import { header, projectLines, systemPrompt, stepLine, stepLines, STEP_HEADER, calibrationLine, scopeLines, memoryFor, MAX_STEPS } from './context';
import { PILLARS, type Plan, type PlanInput } from '../domain/planner';
import type { Proposal } from '../domain/propose';
import { lang, fmtMin } from '../i18n';
import type { Decision, SuitId } from '../data/schema';
import type { DecisionAsk } from './features';

/** `notes`: the names of the memory notes in the request (the profile is in the system prompt), for "Show me what's sent". */
type P = { system: { stable: string; rest: string }; user: string; notes: string[] };
const one = (s: string) => s.replace(/\s+/g, ' ').trim();
const join = (xs: (string | number | false | null | undefined)[]) => xs.filter(x => typeof x === 'string' && x).join('\n\n');

const STEP_RULES = 'A step title starts with its first physical action and says where (the app, the place). A starter is the first 2-minute move: so small it cannot fail. Estimates are minutes, starting-up time included; a step over 30 minutes should be split.';
const STEP_JSON = '{"title": "...", "starter": "...", "est": 15}';

// ---------- 2. Plan my day ----------
export function planPrompt(inp: PlanInput, rule: Plan, fixed: { title: string; at: string; dur: number }[]): P {
  const system = systemPrompt(`Improve today's plan, which was made by fixed rules. You may reorder it, pick between candidates, write starters for steps that lack one, and split a step that is too big into smaller steps.
Keep the rules, or your plan is thrown away: at most ${inp.maxWorkSteps} work steps (steps carried from yesterday may go past it by one); exactly one Protect step (role "protect", a Q2 step) when there is one to pick; exactly one standing obligation (role "obligation", only from the obligations listed); carried steps keep role "carried"; use only the ids you are given.
${STEP_RULES}
Reply with JSON only:
{"plan": [{"id": "...", "role": "carried|now|protect|quick|obligation|optional", "at": "HH:MM (obligation only)"}], "starters": [{"id": "...", "starter": "..."}], "split": [{"id": "...", "steps": [${STEP_JSON}]}], "note": "one or two sentences: what you changed and why"}
"split" replaces the step with the steps you list, the first one keeping its id; leave it empty unless a step is too big to start.`);
  const ids = [...inp.carried, ...inp.candidates, ...inp.optional].map(s => s.id).filter((x, i, a) => a.indexOf(x) === i).slice(0, MAX_STEPS);
  const shape = `Today's shape: ${inp.shape.preset} day, starting at ${inp.shape.start}${fixed.length ? '; fixed: ' + fixed.map(f => `${f.at} ${one(f.title)} (${f.dur} min)`).join(', ') : ''}. Work-step limit: ${inp.maxWorkSteps}.`;
  // Fixed-time items are in the plan whatever it says; the AI hears of them in the shape line.
  const planned = rule.items.filter(i => i.role !== 'fixed');
  const roleOf = new Map(planned.map(i => [i.id, i.role + (i.at ? ' ' + i.at : '')]));
  const ruleLines = planned.map(i => `${i.id} | ${roleOf.get(i.id)} | ${one(T(i.id)?.title ?? '')}`).join('\n');
  const starters = ids.map(id => T(id)).filter(x => x && !x.starter).map(x => x!.id);
  const memo = memoryFor('', ids.map(id => T(id)).filter(x => !!x).map(x => x!));
  const user = join([
    header(), shape,
    `Carried from yesterday: ${inp.carried.map(s => s.id).join(', ') || '(none)'}`,
    STEP_HEADER + '\n' + stepLines(ids.map(id => ({ id }))),
    inp.obligations.length && 'Standing obligations (id | title | last done):\n' + inp.obligations.slice(0, 10).map(o => `${o.id} | ${one(T(o.id)?.title ?? '')} | ${o.lastDone ?? 'never'}`).join('\n'),
    'The rule-based plan (id | role | title):\n' + ruleLines,
    starters.length && 'Steps with no starter yet: ' + starters.join(', '),
    calibrationLine(ids.map(id => T(id)?.app)),
    memo.text,
  ]);
  return { system, user, notes: memo.names };
}

// ---------- 3. Break it down ----------
export function breakDownPrompt(id: string): P {
  const tk = T(id)!;
  const p = projects.value.get(tk.project);
  const system = systemPrompt(`Break the step below into 2 to 6 smaller steps, in order: each waits for the one before. The first step is the one to start now.
${STEP_RULES}
Reply with JSON only: {"steps": [${STEP_JSON}], "note": "one sentence"}`);
  const memo = memoryFor('', [tk]);
  const user = join([
    header(),
    STEP_HEADER + '\n' + stepLine(tk),
    p && p.id !== 'inbox' ? `Project: ${one(p.name)}${p.goal ? '; goal: ' + one(p.goal) : ''}` : '',
    tk.starter ? 'Its starter now: ' + one(tk.starter) : '',
    tk.note ? 'Its note: ' + one(tk.note).slice(0, 400) : '',
    calibrationLine([tk.app]),
    memo.text,
  ]);
  return { system, user, notes: memo.names };
}

// ---------- 4. Decision help ----------
const DECISION_TASK: Record<DecisionAsk, string> = {
  problem: 'Draft the problem lines from the person\'s description: what is happening, what should be happening, the gap, constraints, deadline, and what is in their control. Short, concrete, in their words. Reply with JSON only: {"title": "a short question", "problem": {"what": "", "should": "", "gap": "", "constraints": "", "deadline": "", "control": ""}, "note": ""}',
  options: 'Suggest options the list is missing (doing nothing, waiting, a smaller version, combining, asking someone, handing it off are common ones). Do not judge them. Reply with JSON only: {"options": [{"name": "..."}], "note": ""}',
  items: 'Suggest items for the four columns of the named option: pros of doing it, cons of doing it, pros of not doing it, cons of not doing it. Short phrases. Never give weights or scores: weights belong to the person. Reply with JSON only: {"options": [{"name": "the option", "pros": [], "cons": [], "prosNot": [], "consNot": []}], "note": ""}',
  steps: `Draft the steps that carry out the choice, in order, and a SMART goal for the project. ${STEP_RULES} Reply with JSON only: {"steps": [${STEP_JSON}], "goal": "one sentence", "smart": {"specific": "", "measurable": "", "attainable": "", "relevant": "", "dated": ""}, "note": ""}`,
};

export function decisionPrompt(d: WithId<Decision>, what: DecisionAsk, extra = ''): P {
  const system = systemPrompt(DECISION_TASK[what] + '\nNever propose weights: they are the person\'s.');
  const scope = scopeLines({ kind: 'decision', id: d.id });
  const memo = memoryFor(scope + '\n' + extra);
  const user = join([
    header(),
    scope,
    what === 'items' && extra ? 'Option to fill: ' + one(extra) : '',
    what === 'problem' && extra ? 'Their description:\n' + extra.trim() : '',
    what === 'steps' ? calibrationLine() : '',
    memo.text,
  ]);
  return { system, user, notes: memo.names };
}

// ---------- 5. Stuck ----------
export function stuckPrompt(id: string, friction: string): P {
  const tk = T(id)!;
  const system = systemPrompt(`The person is stuck on this step (${friction === 'start' ? 'can\'t start' : friction === 'restart' ? 'can\'t get back into it' : 'keeps drifting off'}). Propose one smaller starter: a first move under 2 minutes, physical and concrete, that cannot fail. Reply with JSON only: {"starter": "...", "note": "one short sentence"}`);
  const memo = memoryFor('', [tk]);
  const user = join([
    header(),
    STEP_HEADER + '\n' + stepLine(tk),
    tk.starter ? 'Starter that didn\'t work: ' + one(tk.starter) : 'No starter yet.',
    tk.resume ? 'Where they stopped: ' + one(tk.resume) : '',
    tk.app ? 'App or place: ' + one(tk.app) : '',
    memo.text,
  ]);
  return { system, user, notes: memo.names };
}

// ---------- 6. Sunday review help ----------
export function reviewPrompt(projectId: string): P {
  const system = systemPrompt(`It is the weekly review. For the project below, propose a one-sentence goal, its SMART lines, and the next 1 to 3 steps if the project has no clear next step. Keep what the person already wrote unless it is vague. ${STEP_RULES}
Reply with JSON only: {"goal": "...", "smart": {"specific": "", "measurable": "", "attainable": "", "relevant": "", "dated": ""}, "next": [${STEP_JSON}], "note": "one sentence"}`);
  const scope = scopeLines({ kind: 'project', id: projectId });
  const memo = memoryFor(scope);
  const user = join([header(), scope, calibrationLine(), memo.text]);
  return { system, user, notes: memo.names };
}


// ---------- 7. The morning conversation ----------
const MORNING_JSON = `{"note": "one or two sentences: the day in a nutshell, and by how much it is over if it is",
 "must": [{"id": "...", "line": "why today, short", "cut": false}],
 "goals": [{"project": "...", "id": "...", "line": "why this project, why this step"}],
 "pillars": [{"suit": "S|D|C|H", "id": "...", "line": "..."}, {"suit": "C", "new": ${STEP_JSON}, "line": "..."}],
 "here": [{"id": "...", "line": "..."}],
 "first": "id of the step to start with",
 "split": [{"id": "...", "steps": [${STEP_JSON}]}]}`;

const MORNING_TASK = `It is the morning. Propose the person's day in five sections. You propose and the person chooses: they keep, swap or skip each item with a tap, so do not ask open questions and do not ask how they feel. Use only the ids you are given, and take each item from the candidates of its section.
1. "must": what has to happen today, from the first section's candidates (the fixed items and the events to check stay whatever you say). Rank them; "line" says why today.
2. "goals": the one or two projects to move today (never more than two), each with the step to start with, taken from that project's steps. "line" says why that project and that step.
3. "pillars": one item for each of the four pillars, in the person's own words for them (given below). Take it from the pillar's candidates, or write a new step ("new") when there is none or a better one is plain from what you know of the person, for example a call to someone they care about, as a first action of 15 minutes or less. Say it in "line" in a short sentence ("For family: call your mother").
4. "here": given where the person is today, what can be done there: take it from the place's candidates.
5. The total: the day's load is given, as planned time against free time. When it is more than the room, say by how much in "note" and put "cut": true on the steps you would leave out first (never a fixed item, and the Protect steps last). Give "first": the step to start with, which must be one you keep.
${STEP_RULES} Only "goals" and "pillars" may have a "new" step; a goal's new step joins that project. Use "split" for a step that is over 30 minutes or has no clear first action: the first of its steps keeps the id and is the one that goes on the day, the others wait for it. Say "pillar", "goal" or the person's own names; never the words "card" or "suit". Short lines, facts, no praise, no guilt, no counts of what was not done.
Reply with JSON only (leave a section out only if it has no candidates):
${MORNING_JSON}`;

const pillarName = (s: SuitId) => settings.value.suits[s]?.short[lang.value] ?? s;

/**
 * The morning conversation's request (Morning point 3): the candidates of `proposeDay` in five sections, the pillars in the person's
 * own words, the room the day has. A later turn (`o.message`) carries what the person kept and skipped and what they said.
 */
export function morningPrompt(p: Proposal, o: { message?: string; kept?: string[]; skipped?: string[]; load?: Proposal['load'] } = {}): P {
  const system = systemPrompt(MORNING_TASK);
  const line = (id: string) => (T(id) ? stepLine(T(id)!) : id);
  const all = [...p.must.map(m => m.id), ...p.mustMore, ...p.goals.flatMap(g => [g.step, ...g.more]), ...p.moreGoals.flatMap(g => [g.step, ...g.more]), ...p.here.ids, ...p.here.more,
    ...PILLARS.flatMap(s => [p.pillars[s].pick, ...p.pillars[s].more, ...p.pillars[s].covered])].filter((x): x is string => !!x);
  const ids = [...new Set(all)];
  const withTime = (id: string) => { const tk = T(id); return line(id) + (tk?.at ? ` | at ${tk.at}` : ''); };
  const sec = (head: string, rows: string[]) => `${head}\n${rows.length ? rows.join('\n') : '(no candidates)'}`;
  const proj = (g: Proposal['goals'][number]) => {
    const pr = projects.value.get(g.project);
    return `${g.project} | ${one(pr?.name ?? g.project)} | goal: ${pr?.goal ? one(pr.goal) : '-'} | due ${pr?.due ?? '-'}\n   first step: ${line(g.step)}${g.more.length ? '\n   then: ' + g.more.map(line).join('\n         ') : ''}`;
  };
  const load = o.load ?? p.load;
  const place = here.value === 'any' ? 'Anywhere (no place set for today)' : places.value.get(here.value)?.name ?? here.value;
  const areas = (dayDoc(today.value)?.areas ?? []).map(a => `${a.half === 'am' ? 'morning' : 'afternoon'} in ${places.value.get(a.placeId)?.name ?? a.placeId}`);
  const memo = memoryFor('', ids.map(id => T(id)).filter((x): x is NonNullable<ReturnType<typeof T>> => !!x));
  const user = join([
    header(),
    `The room the day has: ${fmtMin(load.planned)} planned of ${fmtMin(load.free)} free${load.over ? `, ${fmtMin(load.over)} more than fits` : ''}. The planned time is the first candidate of each section below.`,
    `The person's pillars (use these words): ${PILLARS.map(s => `${s} = ${pillarName(s)}`).join('; ')}.`,
    sec('1. Must happen (id | title | quadrant | due | estimate | project; why):', [
      ...p.must.map(m => `${withTime(m.id)} [${m.why}]`),
      ...(p.mustMore.length ? ['Could replace one of these:', ...p.mustMore.map(line)] : []),
    ]),
    sec('2. Projects to move today, the first one first (id | name | goal | due; then steps in order):', [...p.goals.map(proj), ...(p.moreGoals.length ? ['Other projects that could replace one:', ...p.moreGoals.map(proj)] : [])]),
    sec('3. Pillars: for each, the proposed step first, then others; "covered" are steps of that pillar already in the other sections:', PILLARS.map(s => {
      const c = p.pillars[s];
      return `${s} ${pillarName(s)}: ${[c.pick, ...c.more].filter((x): x is string => !!x).map(line).join(' ;; ') || '(nothing open: write a new step if one is plain)'}${c.covered.length ? ` || covered: ${c.covered.join(', ')}` : ''}`;
    })),
    sec(`4. Where the person is today: ${place}${areas.length ? ' (' + areas.join(', ') + ')' : ''}. Steps that belong there:`, [...p.here.ids.map(line), ...(p.here.more.length ? ['Could replace one of these:', ...p.here.more.map(line)] : [])]),
    calibrationLine(ids.map(id => T(id)?.app)),
    o.message !== undefined && join([
      `The person has chosen so far. Kept: ${o.kept?.join(', ') || '(none)'}. Skipped, so never offer them again: ${o.skipped?.join(', ') || '(none)'}.`,
      `They say: ${o.message.trim()}`,
      'Reply with the full revised proposal in the same JSON, changed only as they ask.',
    ]),
    memo.text,
  ]);
  return { system, user, notes: memo.names };
}
