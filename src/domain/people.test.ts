import { describe, expect, it } from 'vitest';
import { stepsOfPerson } from './people';
import { mentions } from './names';
import { task } from './agenda.fixture';

describe('a person’s page', () => {
  const ibrahim = { id: 'ib', name: 'Ibrahim' };
  const tasks = [
    task('named', { title: 'Call Ibrahim about the flat', due: '2026-10-27' }),
    task('linked', { title: 'Bring the keys', personId: 'ib', due: '2026-10-25' }),
    task('note', { title: 'Pay the deposit', note: 'Ibrahim’s account, see his message', due: '2026-10-26' }),
    task('other', { title: 'Ibrahima’s birthday' }),
    task('done', { title: 'Thank Ibrahim', status: 'done' }),
    task('std', { title: 'See Ibrahim', template: true }),
    task('both', { title: 'Meet Ibrahim at the cafe', personId: 'ib', at: '10:00', due: '2026-10-25' }),
    task('her', { title: 'Call Mona', personId: 'mo' }),
  ];

  it('lists the open steps that link or name them, linked first, each group by day and time', () => {
    const out = stepsOfPerson(ibrahim, tasks);
    expect(out.map(o => o.step.id + ':' + o.via)).toEqual(['both:linked', 'linked:linked', 'note:named', 'named:named']);
  });

  it('leaves out done steps, standing items, other people and a name that only starts with theirs', () => {
    const ids = stepsOfPerson(ibrahim, tasks).map(o => o.step.id);
    for (const gone of ['done', 'std', 'her', 'other']) expect(ids).not.toContain(gone);
  });

  it('uses the one name rule: case, accents and punctuation are ignored, one letter matches nothing', () => {
    expect(mentions('Écrire à d’IBRAHIM', 'ibrahim')).toBe(true);
    expect(mentions('Séjour à Zürich', 'zurich')).toBe(true);
    expect(mentions('Buy a present', 'a')).toBe(false);
    expect(stepsOfPerson({ id: 'x', name: 'Ibrahim Khalil' }, tasks)).toEqual([]);
  });
});
