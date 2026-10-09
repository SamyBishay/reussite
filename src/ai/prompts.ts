// What each AI feature sends (brief §10, features 2–6): the method and the feature's contract as
// the system prompt; compact lines for at most 25 steps, and the calibration line whenever the
// AI is asked for estimates.
import { projects, type WithId } from '../app/store';
import { T } from '../app/model';
import { header, projectLines, systemPrompt, stepLine, stepLines, STEP_HEADER, calibrationLine, scopeLines, MAX_STEPS } from './context';
import type { Plan, PlanInput } from '../domain/planner';
import type { Decision } from '../data/schema';
import type { DecisionAsk } from './features';

type P = { system: string; user: string };
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
  const roleOf = new Map(rule.items.map(i => [i.id, i.role + (i.at ? ' ' + i.at : '')]));
  const ruleLines = rule.items.map(i => `${i.id} | ${roleOf.get(i.id)} | ${one(T(i.id)?.title ?? '')}`).join('\n');
  const starters = ids.map(id => T(id)).filter(x => x && !x.starter).map(x => x!.id);
  const user = join([
    header(), shape,
    `Carried from yesterday: ${inp.carried.map(s => s.id).join(', ') || '(none)'}`,
    STEP_HEADER + '\n' + stepLines(ids.map(id => ({ id }))),
    inp.obligations.length && 'Standing obligations (id | title | last done):\n' + inp.obligations.slice(0, 10).map(o => `${o.id} | ${one(T(o.id)?.title ?? '')} | ${o.lastDone ?? 'never'}`).join('\n'),
    'The rule-based plan (id | role | title):\n' + ruleLines,
    starters.length && 'Steps with no starter yet: ' + starters.join(', '),
    calibrationLine(ids.map(id => T(id)?.app)),
  ]);
  return { system, user };
}

// ---------- 3. Break it down ----------
export function breakDownPrompt(id: string): P {
  const tk = T(id)!;
  const p = projects.value.get(tk.project);
  const system = systemPrompt(`Break the step below into 2 to 6 smaller steps, in order: each waits for the one before. The first step is the one to start now.
${STEP_RULES}
Reply with JSON only: {"steps": [${STEP_JSON}], "note": "one sentence"}`);
  const user = join([
    header(),
    STEP_HEADER + '\n' + stepLine(tk),
    p && p.id !== 'inbox' ? `Project: ${one(p.name)}${p.goal ? '; goal: ' + one(p.goal) : ''}` : '',
    tk.starter ? 'Its starter now: ' + one(tk.starter) : '',
    tk.note ? 'Its note: ' + one(tk.note).slice(0, 400) : '',
    calibrationLine([tk.app]),
  ]);
  return { system, user };
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
  const user = join([
    header(),
    scopeLines({ kind: 'decision', id: d.id }),
    what === 'items' && extra ? 'Option to fill: ' + one(extra) : '',
    what === 'problem' && extra ? 'Their description:\n' + extra.trim() : '',
    what === 'steps' ? calibrationLine() : '',
  ]);
  return { system, user };
}

// ---------- 5. Stuck ----------
export function stuckPrompt(id: string, friction: string): P {
  const tk = T(id)!;
  const system = systemPrompt(`The person is stuck on this step (${friction === 'start' ? 'can\'t start' : friction === 'restart' ? 'can\'t get back into it' : 'keeps drifting off'}). Propose one smaller starter: a first move under 2 minutes, physical and concrete, that cannot fail. Reply with JSON only: {"starter": "...", "note": "one short sentence"}`);
  const user = join([
    header(),
    STEP_HEADER + '\n' + stepLine(tk),
    tk.starter ? 'Starter that didn\'t work: ' + one(tk.starter) : 'No starter yet.',
    tk.resume ? 'Where they stopped: ' + one(tk.resume) : '',
    tk.app ? 'App or place: ' + one(tk.app) : '',
  ]);
  return { system, user };
}

// ---------- 6. Sunday review help ----------
export function reviewPrompt(projectId: string): P {
  const system = systemPrompt(`It is the weekly review. For the project below, propose a one-sentence goal, its SMART lines, and the next 1 to 3 steps if the project has no clear next step. Keep what the person already wrote unless it is vague. ${STEP_RULES}
Reply with JSON only: {"goal": "...", "smart": {"specific": "", "measurable": "", "attainable": "", "relevant": "", "dated": ""}, "next": [${STEP_JSON}], "note": "one sentence"}`);
  const user = join([header(), scopeLines({ kind: 'project', id: projectId }), calibrationLine()]);
  return { system, user };
}

