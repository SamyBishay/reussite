// Chains (brief §16): steps that wait for one another (`after`) are one card. The head is the first open step
// that waits for nothing open; only it shows in lists, and the steps that wait nest under it. Computed from
// `after` alone: nothing is stored. Pure, one pass over the open steps, shared by the app (src/app/model.ts, one
// computed signal) and by the connector in the relay Worker.
import type { Task } from '../data/schema';
import { listOf, type TaskW } from './lists';

export interface Chain {
  /** The head's id: a chain is named by its head. */
  id: string;
  /** Head first, then the steps that wait, in the order they unfold (each under the step it waits for). */
  members: readonly string[];
  /** For each waiting member, the step it is shown under: of the steps it waits for, the deepest in the chain. */
  parent: ReadonlyMap<string, string>;
  /** How many links down each waiting member is (the head is 0). */
  depth: ReadonlyMap<string, number>;
  /** The earliest due date of any member (the head's too), or null. */
  due: string | null;
  /** Steps waiting after the head: `members.length - 1`. */
  after: number;
}

export interface ChainIndex {
  /** Chains with at least two members, by head id. */
  chains: ReadonlyMap<string, Chain>;
  /** Every member of a chain (the head too) to its chain's id. A step in no chain is absent. */
  of: ReadonlyMap<string, string>;
}

export const NO_CHAINS: ChainIndex = { chains: new Map(), of: new Map() };

type Node = Pick<Task, 'status' | 'after' | 'order' | 'due' | 'template'>;
const open = (t: Node | undefined): boolean => !!t && t.status === 'open' && !t.template;

/** A step waiting for another open step in a chain, so not shown on its own. */
export const isWaiting = (ix: ChainIndex, id: string): boolean => {
  const c = ix.of.get(id);
  return c !== undefined && c !== id;
};
/** The chain a step heads. */
export const headOfChain = (ix: ChainIndex, id: string): Chain | undefined => ix.chains.get(id);
/** The chain a step is in, as head or as a waiting member. */
export const chainOf = (ix: ChainIndex, id: string): Chain | undefined => {
  const c = ix.of.get(id);
  return c === undefined ? undefined : ix.chains.get(c);
};
/** The date that drives a chain's head: its own, or the chain's if that comes first. */
export const effectiveDue = (ix: ChainIndex, id: string, own: string | null | undefined): string | null => {
  const c = ix.chains.get(id)?.due ?? null;
  return c && (!own || c < own) ? c : own ?? null;
};

/**
 * The chains of a set of steps. Only open steps count (done and dropped ones, ids that are not there and the
 * ids of tombstoned steps are no wait); a step waiting for itself waits for nothing. A step that waits for two
 * is shown under the later of them (deepest, then last in order). A cycle has no first step: its first
 * member by order is taken as the head, so every open step ends up in exactly one chain.
 */
export function chainIndex(tasks: ReadonlyMap<string, Node & { id: string }>): ChainIndex {
  // Steps that take part: those that wait for an open step, and those an open step waits for.
  const waits = new Map<string, string[]>();
  const users = new Map<string, string[]>();
  const nodes: (Node & { id: string })[] = [];
  for (const t of tasks.values()) {
    if (!open(t)) continue;
    const w = [...new Set(listOf(t.after))].filter(id => id !== t.id && open(tasks.get(id)));
    if (!w.length) continue;
    waits.set(t.id, w);
    for (const id of w) (users.get(id) ?? users.set(id, []).get(id)!).push(t.id);
  }
  if (!waits.size) return NO_CHAINS;
  const seen = new Set<string>();
  for (const id of [...waits.keys(), ...users.keys()]) if (!seen.has(id)) { seen.add(id); nodes.push(tasks.get(id)!); }
  const byKey = (a: string, b: string) => (tasks.get(a)!.order || 0) - (tasks.get(b)!.order || 0) || (a < b ? -1 : a > b ? 1 : 0);
  nodes.sort((a, b) => byKey(a.id, b.id));

  const pending = new Map<string, number>();
  const depth = new Map<string, number>();
  const parent = new Map<string, string>();
  const head = new Map<string, string>();
  const queue: string[] = [];
  for (const n of nodes) {
    const c = waits.get(n.id)?.length ?? 0;
    pending.set(n.id, c);
    if (!c) queue.push(n.id);
  }
  const done = new Set<string>();
  let at = 0;
  const run = () => {
    while (at < queue.length) {
      const id = queue[at++]!;
      if (done.has(id)) continue;
      done.add(id);
      const w = waits.get(id) ?? [];
      let best: string | undefined;
      for (const p of w) if (done.has(p) && (best === undefined || depth.get(p)! > depth.get(best)! || (depth.get(p) === depth.get(best) && byKey(p, best) > 0))) best = p;
      if (best === undefined) { depth.set(id, 0); head.set(id, id); }
      else { depth.set(id, depth.get(best)! + 1); parent.set(id, best); head.set(id, head.get(best)!); }
      for (const u of users.get(id) ?? []) {
        if (done.has(u)) continue;
        const left = pending.get(u)! - 1;
        pending.set(u, left);
        if (left <= 0) queue.push(u);
      }
    }
  };
  run();
  // What is left waits in a cycle (or on one): take the first member of a cycle as a head and go on.
  for (const n of nodes) {
    if (done.has(n.id)) continue;
    const path: string[] = [], pos = new Map<string, number>();
    let cur = n.id;
    for (;;) {
      pos.set(cur, path.length);
      path.push(cur);
      const next = (waits.get(cur) ?? []).find(p => !done.has(p))!;
      if (pos.has(next)) { path.splice(0, pos.get(next)!); break; }
      cur = next;
    }
    const first = path.reduce((a, b) => (byKey(b, a) < 0 ? b : a));
    depth.set(first, 0); head.set(first, first); done.add(first);
    for (const u of users.get(first) ?? []) if (!done.has(u)) { const left = pending.get(u)! - 1; pending.set(u, left); if (left <= 0) queue.push(u); }
    run();
  }

  // Group by head; unfold each chain depth first, siblings in order.
  const kids = new Map<string, string[]>();
  for (const n of nodes) { const p = parent.get(n.id); if (p) (kids.get(p) ?? kids.set(p, []).get(p)!).push(n.id); }
  const chains = new Map<string, Chain>();
  const of = new Map<string, string>();
  for (const n of nodes) {
    if (head.get(n.id) !== n.id || !kids.has(n.id)) continue;
    const members: string[] = [];
    const stack = [n.id];
    while (stack.length) {
      const id = stack.pop()!;
      members.push(id);
      const k = kids.get(id);
      if (k) for (let i = k.length - 1; i >= 0; i--) stack.push(k[i]!);
    }
    let due: string | null = null;
    const par = new Map<string, string>(), dep = new Map<string, number>();
    for (const id of members) {
      of.set(id, n.id);
      const d = tasks.get(id)!.due;
      if (d && (!due || d < due)) due = d;
      if (id !== n.id) { par.set(id, parent.get(id)!); dep.set(id, depth.get(id)!); }
    }
    dep.set(n.id, 0);
    chains.set(n.id, { id: n.id, members, parent: par, depth: dep, due, after: members.length - 1 });
  }
  return { chains, of };
}

/**
 * The steps that become heads when `id` stops being open (done or dropped), in the chain's order: they take its
 * place. Empty when `id` heads no chain.
 */
export function nextHeads(tasks: ReadonlyMap<string, TaskW>, id: string): string[] {
  const c = chainIndex(tasks).chains.get(id);
  const t = tasks.get(id);
  if (!c || !t) return [];
  const after = chainIndex(new Map(tasks).set(id, { ...t, status: 'done' }));
  return c.members.filter(m => m !== id && !isWaiting(after, m));
}
