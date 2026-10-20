// Read any stored decision as the v2 shape (brief §9). v1 decisions had a free-text problem
// and items as [text, weight]; both still read. Unknown fields are kept.
import { normItems, COLUMNS, type Option } from '../domain/decision';
import { MEMORY_KINDS, type Decision, type Exchange, type ExchangeTurn, type MemoryKind, type MemoryLine, type MemoryNote, type Problem, type UndoDoc } from './schema';

const PROBLEM_KEYS: (keyof Problem)[] = ['what', 'should', 'gap', 'constraints', 'deadline', 'control'];
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function normProblem(p: unknown): Problem {
  const out = Object.fromEntries(PROBLEM_KEYS.map(k => [k, ''])) as unknown as Problem;
  if (typeof p === 'string') out.what = p;
  else if (isObj(p)) for (const k of PROBLEM_KEYS) out[k] = str(p[k]);
  return out;
}

export function normOptions(xs: unknown): Option[] {
  if (!Array.isArray(xs)) return [];
  return xs.filter(isObj).map((o, i) => {
    const id = str(o.id) || 'o' + i;
    const out: Option = { ...o, id, name: str(o.name), screened: typeof o.screened === 'string' ? o.screened : null, pros: [], cons: [], prosNot: [], consNot: [] };
    for (const c of COLUMNS) out[c] = normItems(o[c], id + c[0] + (c.endsWith('Not') ? 'n' : ''));
    return out;
  });
}

export function normDecision(raw: Record<string, unknown>): Decision {
  const options = normOptions(raw.options);
  const chosen = typeof raw.chosen === 'string' && raw.chosen ? raw.chosen : null;
  const chosenId = typeof raw.chosenId === 'string' ? raw.chosenId : chosen ? options.find(o => o.name === chosen)?.id ?? null : null;
  const status = (['draft', 'decided', 'reviewing', 'closed'] as const).find(s => s === raw.status) ?? (chosen ? 'decided' : 'draft');
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  return {
    ...raw,
    title: str(raw.title),
    projectId: typeof raw.projectId === 'string' ? raw.projectId : null,
    taskId: typeof raw.taskId === 'string' ? raw.taskId : null,
    problem: normProblem(raw.problem),
    options,
    status,
    listClosedAt: typeof raw.listClosedAt === 'string' ? raw.listClosedAt : null,
    chosen,
    chosenId,
    why: str(raw.why),
    mustBeTrue: str(raw.mustBeTrue),
    falsifier: str(raw.falsifier),
    date: typeof raw.date === 'string' ? raw.date : null,
    reviewOn: typeof raw.reviewOn === 'string' ? raw.reviewOn : null,
    taskIds: arr<string>(raw.taskIds),
    newFacts: arr(raw.newFacts),
    reviews: arr(raw.reviews),
    history: arr(raw.history),
  };
}

/** Read any stored memory note with every field filled. Lines without an id get a stable one from their position. */
export function normNote(raw: Record<string, unknown>): MemoryNote {
  const lines: MemoryLine[] = (Array.isArray(raw.lines) ? raw.lines : []).filter(isObj).map((l, i) => ({
    ...l,
    id: str(l.id) || 'l' + i,
    text: str(l.text),
    at: str(l.at),
    by: l.by === 'ai' ? 'ai' : 'me',
  }));
  return {
    ...raw,
    kind: (MEMORY_KINDS as readonly unknown[]).includes(raw.kind) ? (raw.kind as MemoryKind) : 'topic',
    name: str(raw.name),
    aliases: (Array.isArray(raw.aliases) ? raw.aliases : []).filter((a): a is string => typeof a === 'string'),
    lines,
    private: raw.private === true,
    updated: str(raw.updated),
  };
}

/** Read any stored exchange with every field filled. */
export function normExchange(raw: Record<string, unknown>): Exchange {
  const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const undo: Record<string, UndoDoc[]> = {};
  if (isObj(raw.undo)) for (const [k, v] of Object.entries(raw.undo)) undo[k] = Array.isArray(v) ? (v as UndoDoc[]) : [];
  return {
    ...raw,
    at: str(raw.at),
    text: str(raw.text),
    turns: (Array.isArray(raw.turns) ? raw.turns : []).filter(isObj).map(t => ({ ...t, at: str(t.at), text: str(t.text), kind: str(t.kind) }) as ExchangeTurn),
    changes: strs(raw.changes),
    undo,
    undone: strs(raw.undone),
    src: raw.src === 'link' || raw.src === 'inbox' ? raw.src : 'home',
  };
}
