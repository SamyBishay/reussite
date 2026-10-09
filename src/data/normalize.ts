// Read any stored decision as the v2 shape (brief §9). v1 decisions had a free-text problem
// and items as [text, weight]; both still read. Unknown fields are kept.
import { normItems, COLUMNS, type Option } from '../domain/decision';
import type { Decision, Problem } from './schema';

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
