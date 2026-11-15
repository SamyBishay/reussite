import { describe, expect, it } from 'vitest';
import { parseHome, type HomeParse } from './parse';
import { CORPUS, CORPUS_CTX, type Card, type Want } from './parse.corpus';

type Set = Record<string, unknown>;
const noteOf = (id: string) => CORPUS_CTX.tasks.find(t => t.id === id)?.note ?? '';

/** What a parse comes to, in the corpus's words. */
function shapeOf(p: HomeParse): Want {
  if (p.kind === 'pick') return { pick: p.candidates.map(c => c.id) };
  if (p.kind === 'sheet') return { sheet: true };
  if (p.kind === 'unknown') return { unknown: p.reason };
  if (p.kind === 'act') return p.act === 'pause' ? { timer: 'pause' } : p.act === 'start' ? { timer: 'start', id: p.id! } : { spent: p.id!, min: p.min! };
  const each = p.cs.changes.map((ch): Want => {
    if (ch.op === 'task.done') return { done: ch.id, ...(ch.day ? { day: ch.day } : {}) };
    if (ch.op === 'task.drop') return { drop: ch.id };
    if (ch.op === 'task.update') {
      const set = ch.set as Set;
      if (typeof set.note === 'string') { const old = noteOf(ch.id); return { note: ch.id, text: set.note.slice(old.length).replace(/^\n+/, '') }; }
      return { move: ch.id, due: String(set.due), ...(set.at ? { at: String(set.at) } : {}) };
    }
    if (ch.op !== 'task.create') throw new Error('unexpected ' + ch.op);
    const set = ch.set as Set;
    if (set.template) return { standing: { t: String(set.title), at: String(set.at), weekdays: set.weekdays as number[], ...(set.dur ? { dur: Number(set.dur) } : {}), ...(set.until ? { until: String(set.until) } : {}), ...(set.where ? { where: String(set.where) } : {}) } };
    const card: Card = { t: String(set.title) };
    for (const k of ['due', 'dueAt', 'at', 'where', 'nudge'] as const) if (set[k]) card[k] = String(set[k]);
    for (const k of ['dur', 'est'] as const) if (set[k]) card[k] = Number(set[k]);
    if (set.urgent) card.urgent = true;
    if (set.important) card.important = true;
    if (set.kind === 'event') card.waiting = true;
    card.suit = (set.suit as Card['suit']) ?? null;
    card.project = (set.project as string | undefined) ?? null;
    card.first = (set.starter as Card['first']) ?? null;
    return { add: [card] };
  });
  if (each.length === 1) return each[0]!;
  return each.every(w => 'add' in w) ? { add: each.flatMap(w => (w as { add: Card[] }).add) } : { all: each };
}

/** The corpus says a card's suit, project and first move only where the line is about them: elsewhere they are not compared. */
function strip(want: Want, got: Want): Want {
  if ('all' in got && 'all' in want) return { all: got.all.map((g, i) => (want.all[i] ? strip(want.all[i]!, g) : g)) };
  if (!('add' in got) || !('add' in want)) return got;
  return { add: got.add.map((g, i) => {
    const w = want.add[i];
    const out: Card = { ...g };
    for (const k of ['suit', 'project', 'first'] as const) if (!w || !(k in w)) delete out[k];
    return out;
  }) };
}

describe('the corpus: lines a person types or dictates, and what each becomes', () => {
  const failed: { cat: string; line: string; want: Want; got: Want }[] = [];
  const byCat = new Map<string, [number, number]>();
  for (const cs of CORPUS) {
    let got: Want;
    try { got = strip(cs.want, shapeOf(parseHome(cs.line, CORPUS_CTX))); } catch (e) { got = { unknown: ('threw: ' + String(e)) as never }; }
    const ok = JSON.stringify(sorted(got)) === JSON.stringify(sorted(cs.want));
    const row = byCat.get(cs.cat) ?? [0, 0];
    byCat.set(cs.cat, [row[0] + (ok ? 1 : 0), row[1] + 1]);
    if (!ok) failed.push({ cat: cs.cat, line: cs.line, want: cs.want, got });
  }
  it('every line is read as the corpus says', () => {
    const total = CORPUS.length, pass = total - failed.length;
    const table = [...byCat].map(([c, [p, n]]) => `${c.padEnd(9)} ${String(p).padStart(3)}/${n}`).join('\n');
    const lines = failed.map(f => `[${f.cat}] ${JSON.stringify(f.line)}\n    want ${JSON.stringify(f.want)}\n    got  ${JSON.stringify(f.got)}`).join('\n');
    if (process.env.CORPUS_SCORE) console.log(`\nCorpus: ${pass}/${total}\n${table}\n\n${lines}`);
    expect(failed.map(f => f.line), `Corpus: ${pass}/${total}\n${table}\n\n${lines}\n`).toEqual([]);
  });
  it('has no line twice in a category, and at least 300 lines', () => {
    const seen = new Set<string>();
    for (const cs of CORPUS) { const k = cs.cat + '|' + cs.line; expect(seen.has(k), k).toBe(false); seen.add(k); }
    expect(CORPUS.length).toBeGreaterThanOrEqual(300);
  });
});

/** Keys in one order, so that two shapes compare as text. */
function sorted(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sorted);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v as object).sort().map(k => [k, sorted((v as Record<string, unknown>)[k])]));
  return v;
}
