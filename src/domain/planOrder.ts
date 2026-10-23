// Where a step goes on a day's list, and the order after a drag. Pure: lists of ids in, lists of ids out.

/**
 * A step added by hand to today goes right after the step in progress (the running timer's step); with
 * nothing running, at the top of what is left (before the first step not yet done); with nothing left, at the end.
 */
export function insertAfterCurrent(plan: readonly string[], id: string, runningId: string | null, isOpen: (id: string) => boolean): string[] {
  const out = plan.filter(x => x !== id);
  const run = runningId ? out.indexOf(runningId) : -1;
  let at = run >= 0 ? run + 1 : out.findIndex(isOpen);
  if (at < 0) at = out.length;
  out.splice(at, 0, id);
  return out;
}

/**
 * The list after the shown steps were put in a new order: the shown ids take each other's places in
 * the list, and anything not shown (timed steps, dropped ones) stays where it was.
 */
export function reorderSubset(plan: readonly string[], shown: readonly string[]): string[] {
  const set = new Set(shown);
  if (set.size !== shown.length || shown.some(id => !plan.includes(id))) return [...plan];
  let i = 0;
  return plan.map(id => (set.has(id) ? shown[i++]! : id));
}

/**
 * New `order` values for steps put in a new sequence: they reuse the same numbers (smallest first), made
 * strictly increasing when some were equal. Returns only the ones that change.
 */
export function reslot(current: readonly { id: string; order?: number }[], sequence: readonly string[]): { id: string; order: number }[] {
  const slots: number[] = [];
  for (const o of current.map(x => x.order || 0).sort((a, b) => a - b)) slots.push(slots.length && o <= slots[slots.length - 1]! ? slots[slots.length - 1]! + 1 : o);
  const was = new Map(current.map(x => [x.id, x.order || 0]));
  return sequence.map((id, i) => ({ id, order: slots[i]! })).filter(x => was.get(x.id) !== x.order);
}
