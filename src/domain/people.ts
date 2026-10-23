// A person's page (phase 4b): the open steps that go with them. A step goes with a person when it feeds them
// (`personId`, set in the task sheet) or when its title or note names them, by the one name rule (names.ts) that memory uses.
import type { Task } from '../data/schema';
import { mentions } from './names';

type Step = Pick<Task, 'title' | 'status' | 'template' | 'personId' | 'note' | 'due' | 'at' | 'order'> & { id: string };
export interface PersonStep<T extends Step> { step: T; via: 'linked' | 'named' }

/**
 * The open steps for a person: those that link them, then those that only name them. A standing item is not one (its
 * copies placed on a day are); a step that is done or dropped is not either. Each group is by day, then time, then list order.
 */
export function stepsOfPerson<T extends Step>(person: { id: string; name: string }, tasks: Iterable<T>): PersonStep<T>[] {
  const out: PersonStep<T>[] = [];
  for (const x of tasks) {
    if (x.status !== 'open' || x.template) continue;
    if (x.personId === person.id) out.push({ step: x, via: 'linked' });
    else if (mentions(x.title, person.name) || mentions(x.note || '', person.name)) out.push({ step: x, via: 'named' });
  }
  const key = (x: Step) => (x.due ?? '9999') + ' ' + (x.at ?? '99:99');
  return out.sort((a, b) => (a.via === b.via ? 0 : a.via === 'linked' ? -1 : 1) || (key(a.step) < key(b.step) ? -1 : key(a.step) > key(b.step) ? 1 : (a.step.order || 0) - (b.step.order || 0)));
}
