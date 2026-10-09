// v1's estimate ratio: the median of real time over estimate, across done steps that have both.
// Phase 1 replaces it with the personal-estimate model; it stays for the Log until then.

export interface RatioTask { id: string; status: string; est?: number | null; est0?: number | null }
export interface RatioSession { taskId: string; m: number }

export function minutesByTask(sessions: Iterable<RatioSession>): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of sessions) out.set(s.taskId, (out.get(s.taskId) ?? 0) + (Number(s.m) || 0));
  return out;
}

/** null until there are at least `minN` data points. Uses the frozen estimate when there is one. */
export function ratio(tasks: Iterable<RatioTask>, spent: Map<string, number>, minN = 3): { n: number; v: number | null } {
  const r: number[] = [];
  for (const t of tasks) {
    const est = t.est0 ?? t.est;
    const real = spent.get(t.id) ?? 0;
    if (t.status === 'done' && est && est > 0 && real > 0) r.push(real / est);
  }
  if (r.length < minN) return { n: r.length, v: null };
  r.sort((a, b) => a - b);
  const m = Math.floor(r.length / 2);
  return { n: r.length, v: r.length % 2 ? r[m]! : (r[m - 1]! + r[m]!) / 2 };
}
