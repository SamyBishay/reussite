// What a write answer must say so that an AI cannot miss it (docs/dev/connector.md, "Warnings"): a day's list
// that already held steps the change-set does not mention, steps taken off a day's list that still carry the day
// as their due date, steps due soon that end up on no list, and a timed step put on a list other than its day's.
// Read from the plan before anything is written, so the diff and the "Done" answer say the same.
import { asRef, type Plan } from '../../../src/ai/apply';
import type { ChangeSet } from '../../../src/ai/changeset';
import type { Task } from '../../../src/data/schema';
import { addDays } from '../../../src/domain/dates';
import { isOpen, oneLine, planOf, rawPlan } from '../../../src/domain/lists';
import type { View } from './view';

const MAX_NAMED = 6;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "today", "tomorrow", else "Wed 2026-11-04". */
export function dayName(v: View, k: string): string {
  if (k === v.today) return 'today';
  if (k === addDays(v.today, 1)) return 'tomorrow';
  return `${DOW[new Date(k + 'T12:00:00Z').getUTCDay()]} ${k}`;
}

type Eff = Pick<Task, 'title' | 'status' | 'due' | 'at' | 'template' | 'kind'>;

export function writeWarnings(cs: ChangeSet, plan: Plan, v: View): string[] {
  const d = v.data;
  const tomorrow = addDays(v.today, 1);

  // The steps as they will be: the stored ones with this change-set's patches, and the ones it creates (by their ref).
  const eff = new Map<string, Eff>();
  const touched = new Set<string>();
  const get = (id: string): Eff | undefined => eff.get(id) ?? (v.tasks.get(id) as Eff | undefined);
  const title = (id: string): string => oneLine(get(id)?.title ?? plan.refTitles.get(id) ?? id);
  let anon = 0;
  for (const it of plan.items) for (const op of it.ops) {
    if (op.t === 'task') {
      const key = op.ref ? asRef(op.ref) : `new:${anon++}`;
      eff.set(key, { title: op.fields.title, status: 'open', due: op.fields.due ?? null, at: op.fields.at ?? null, template: !!op.fields.template, kind: op.fields.kind ?? 'task' });
      touched.add(key);
    } else if (op.t === 'update' && op.c === 'tasks') {
      const cur = get(op.id);
      if (cur) { eff.set(op.id, { ...cur, ...(op.patch as Partial<Eff>) }); touched.add(op.id); }
    } else if (op.t === 'finish') {
      const cur = get(op.id);
      if (cur) eff.set(op.id, { ...cur, status: 'done' });
    } else if (op.t === 'drop') {
      const cur = get(op.id);
      if (cur) eff.set(op.id, { ...cur, status: 'dropped' });
    }
  }
  const live = (id: string) => { const t = get(id); return !!t && t.status === 'open' && !t.template && t.kind !== 'event'; };

  // Each touched day's list, before and after.
  const lists = new Map<string, { before: string[]; after: string[] }>();
  for (const it of plan.items) for (const op of it.ops) {
    if (op.t !== 'day' || !Array.isArray(op.patch.plan)) continue;
    lists.set(op.k, { before: lists.get(op.k)?.before ?? rawPlan(v.days, op.k), after: op.patch.plan });
  }
  const listed = new Set<string>();
  for (const [k, day] of v.days) for (const id of lists.get(k)?.after ?? (Array.isArray(day.plan) ? day.plan : [])) listed.add(id);
  for (const [k, l] of lists) if (!v.days.has(k)) for (const id of l.after) listed.add(id);

  const out: string[] = [];
  const named = (ids: string[], tag: (id: string) => string = () => '') => {
    const shown = ids.slice(0, MAX_NAMED).map(id => title(id) + tag(id)).join('; ');
    return ids.length > MAX_NAMED ? `${shown}; and ${ids.length - MAX_NAMED} more` : shown;
  };

  // 1. A day's list written with `add` over steps it does not mention.
  const mentioned = new Map<string, Set<string>>();
  const adds = new Set<string>();
  for (const c of cs.changes) {
    if (c.op !== 'day.update') continue;
    const m = mentioned.get(c.date) ?? new Set<string>();
    for (const id of [...(c.plan ?? []), ...(c.add ?? []), ...(c.remove ?? []), ...(c.first ? [c.first] : [])]) m.add(id);
    mentioned.set(c.date, m);
    if (c.add?.length && !c.plan) adds.add(c.date);
  }
  for (const k of adds) {
    const stay = planOf(d, k).filter(id => isOpen(d.tasks.get(id)) && !mentioned.get(k)!.has(id));
    if (stay.length) out.push(`Warning: already on ${dayName(v, k)}'s list before this: ${named(stay)}. Keep them, or send \`plan\` with the whole list to replace it.`);
  }

  // 2. Steps taken off a day's list that keep that day as their due date.
  const stillDue = new Set<string>();
  for (const [k, l] of lists) {
    const now = new Set(l.after);
    const ids = l.before.filter(id => !now.has(id) && live(id) && get(id)!.due === k);
    ids.forEach(id => stillDue.add(id));
    if (ids.length) out.push(`Warning: off ${dayName(v, k)}'s list but still due ${dayName(v, k)}: ${named(ids)}. Clear \`due\` if they should leave the day.`);
  }

  // 3. Steps made or changed here, due tomorrow or earlier (or timed with no day), that no day's list holds.
  //    A timed step due on a day shows among that day's fixed times, so it is not named.
  const lonely = new Map<string, string[]>();
  for (const id of touched) {
    const t = get(id);
    if (!t || !live(id) || listed.has(id) || stillDue.has(id)) continue;
    const key = t.due && t.due <= tomorrow && !t.at ? t.due : !t.due && t.at ? '' : null;
    if (key !== null) lonely.set(key, [...(lonely.get(key) ?? []), id]);
  }
  for (const [k, ids] of [...lonely].sort(([a], [b]) => a.localeCompare(b))) {
    out.push(k
      ? `Warning: due ${dayName(v, k)} but on no list: ${named(ids)}. The person may want them on that day's list.`
      : `Warning: a time but no day, and on no list: ${named(ids, id => ` (${get(id)!.at})`)}.`);
  }

  // 4. A timed step due on a later day put on an earlier day's list: its time and its due date are the later day's (calendar, reminders), so it shows on both.
  for (const [k, l] of lists) {
    const before = new Set(l.before);
    const ids = l.after.filter(id => !before.has(id) && live(id) && get(id)!.at && get(id)!.due && get(id)!.due! > k);
    if (ids.length) out.push(`Warning: on ${dayName(v, k)}'s list but fixed for a later day: ${named(ids, id => ` (${dayName(v, get(id)!.due!)} ${get(id)!.at})`)}. It will show on both days. Change its due date if it belongs here, or leave it off this list.`);
  }
  return out;
}
