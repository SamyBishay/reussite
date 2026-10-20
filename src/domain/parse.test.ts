import { describe, expect, it } from 'vitest';
import { findTime, parseHome, PLAIN_WORDS, type HomeParse, type ParseContext } from './parse';
import { readChangeSet } from '../ai/changeset';
import { isLowRisk, planChanges, type Snapshot } from '../ai/apply';
import type { Task } from '../data/schema';

// 2026-10-20 is a Tuesday. The clocks change in Paris on Sunday 25 October.
const ctx: ParseContext = {
  today: '2026-10-20',
  places: [{ id: 'pl1', name: 'Home' }, { id: 'pl2', name: 'City Library' }],
  tasks: [
    { id: 't1', title: 'Call the dentist about the cleaning', status: 'open' },
    { id: 't2', title: 'Pay the rent', status: 'open' },
    { id: 't3', title: 'Play games with Alex', status: 'open' },
    { id: 't4', title: 'Call the agency', status: 'open' },
    { id: 't5', title: 'Choir, Hill House 602', status: 'open', template: true },
    { id: 't6', title: 'Water the plants', status: 'done' },
    { id: 't7', title: 'Open Mail and reply to the landlord', status: 'open' },
  ],
};
const run = (text: string, c: ParseContext = ctx): HomeParse => parseHome(text, c);

/** The `set` of the one task.create the line makes. */
function made(text: string, c: ParseContext = ctx): Record<string, unknown> {
  const r = run(text, c);
  if (r.kind !== 'changes') throw new Error(text + ' → ' + r.kind);
  expect(r.cs.changes).toHaveLength(1);
  const ch = r.cs.changes[0]!;
  if (ch.op !== 'task.create') throw new Error(text + ' → ' + ch.op);
  return ch.set as Record<string, unknown>;
}
const only = (text: string) => { const r = run(text); if (r.kind !== 'changes') throw new Error(text + ' → ' + r.kind); return r.cs.changes[0]!; };

describe('the key phrases', () => {
  it('choir every Monday 19:00 at Hill House 602 is one standing obligation', () => {
    const r = run('choir every Monday 19:00 at Hill House 602');
    expect(r).toMatchObject({ kind: 'changes', intent: 'standing', title: 'Choir, Hill House 602' });
    expect((r as { cs: { changes: unknown[] } }).cs.changes).toEqual([{ op: 'task.create', set: { title: 'Choir, Hill House 602', template: true, weekdays: [1], at: '19:00' } }]);
  });
  it('R: call the bank tomorrow, 10 min is one step due tomorrow with an estimate of 10', () => {
    expect(made('R: call the bank tomorrow, 10 min')).toEqual({ title: 'Call the bank', due: '2026-10-21', est: 10 });
  });
  it('chorale tous les lundis 19h à Hill House 602 is the same in French', () => {
    expect(made('chorale tous les lundis 19h à Hill House 602')).toEqual({ title: 'Chorale, Hill House 602', template: true, weekdays: [1], at: '19:00' });
  });
});

describe('dates', () => {
  it.each([
    ['call the bank tomorrow', '2026-10-21'],
    ['call the bank tmrw', '2026-10-21'],
    ['appeler la banque demain', '2026-10-21'],
    ['appeler la banque demain matin', '2026-10-21'],
    ['appeler la banque après-demain', '2026-10-22'],
    ['call the bank the day after tomorrow', '2026-10-22'],
    ['email Alex today', '2026-10-20'],
    ["envoyer le dossier aujourd'hui", '2026-10-20'],
    ['envoyer le dossier aujourd’hui', '2026-10-20'],
    ['email Alex tonight', '2026-10-20'],
    ['send photos friday', '2026-10-23'],
    ['envoyer les photos vendredi', '2026-10-23'],
    ['envoyer les photos pour le vendredi', '2026-10-23'],
    ['send photos on tuesday', '2026-10-27'],
    ['send photos next monday', '2026-10-26'],
    ['envoyer photos lundi prochain', '2026-10-26'],
    ['send photos by fri', '2026-10-23'],
    ['send photos on sun', '2026-10-25'],
    ['pay rent 26/10', '2026-10-26'],
    ['pay rent 5/11', '2026-11-05'],
    ['pay rent 10/26', '2026-10-26'],
    ['pay rent 26.10.2026', '2026-10-26'],
    ['pay rent 26 oct', '2026-10-26'],
    ['payer le loyer le 26 octobre', '2026-10-26'],
    ['pay rent October 26th', '2026-10-26'],
    ['paperasse 1er novembre', '2026-11-01'],
    ['paperasse 3 déc.', '2026-12-03'],
    ['renew passport 3 March', '2027-03-03'],
    ['renew passport 20 oct', '2026-10-20'],
    ['renew passport 3 mars 2028', '2028-03-03'],
    ['file taxes 2026-12-01', '2026-12-01'],
    ['call the bank in 3 days', '2026-10-23'],
    ['appeler la banque dans 2 semaines', '2026-11-03'],
    ['appeler la banque dans 2 mois', '2026-12-20'],
  ])('%s → due %s', (text, due) => {
    expect(made(text).due).toBe(due);
  });
  it('takes the date out of the title', () => {
    expect(made('send the photos on tuesday').title).toBe('Send the photos');
    expect(made('pay rent for the 26 oct').title).toBe('Pay rent');
    expect(made('payer le loyer pour le 26/10').title).toBe('Payer le loyer');
  });
  it('leaves a date that is not one in the title', () => {
    expect(made('rename 31/02 files')).toEqual({ title: 'Rename 31/02 files' });
    expect(made('call mum mon')).toEqual({ title: 'Call mum mon' });
  });
  it('reads a weekday the same way across the clock change', () => {
    const c = { ...ctx, today: '2026-10-24' }; // Saturday; the clocks go back overnight
    expect(made('call the bank tomorrow', c).due).toBe('2026-10-25');
    expect(made('call the bank monday', c).due).toBe('2026-10-26');
    expect(made('call the bank in 2 days', c).due).toBe('2026-10-26');
    expect(made('call the bank in 1 month', c).due).toBe('2026-11-24');
    expect(made('call the bank saturday', c).due).toBe('2026-10-31');
  });
});

describe('times and lengths', () => {
  it.each([
    ['dentist 14:30', '14:30'],
    ['dentist at 14:30', '14:30'],
    ['dentist 2:30 pm', '14:30'],
    ['dentist at 7pm', '19:00'],
    ['dentist at 7 p.m.', '19:00'],
    ['dentist 12am', '00:00'],
    ['dentist 12 pm', '12:00'],
    ['dentist 9:15am', '09:15'],
    ['dentist à 19h', '19:00'],
    ['dentist 19h30', '19:30'],
    ['dentist 19 h 30', '19:30'],
    ['dentist vers 8h', '08:00'],
    ['dentist à 2h', '02:00'],
    ['dentist 6h', '06:00'],
    ['lunch noon', '12:00'],
    ['déjeuner à midi', '12:00'],
  ])('%s → at %s, due today', (text, at) => {
    const s = made(text);
    expect(s.at).toBe(at);
    expect(s.due).toBe('2026-10-20');
  });
  it('is not a time: a length, or a number', () => {
    expect(made('read 1h')).toEqual({ title: 'Read', est: 60 });
    expect(made('read 2h30')).toEqual({ title: 'Read', est: 150 });
    expect(made('read for 5h')).toEqual({ title: 'Read', est: 300 });
    expect(made('lire pendant 6h')).toEqual({ title: 'Lire', est: 360 });
    expect(made('book 25 chairs')).toEqual({ title: 'Book 25 chairs' });
    expect(made('Hill House 602')).toEqual({ title: 'Hill House 602' });
  });
  it.each([
    ['read 20 min', 20],
    ['read 20 mins', 20],
    ['lire 45 minutes', 45],
    ['lire 45 mn', 45],
    ['write the report 1h30', 90],
    ['write the report 1 h 30', 90],
    ['write the report for 2 hours', 120],
    ['write the report 1.5 hours', 90],
    ['write the report 2 heures', 120],
    ['write the report 1h 15 min', 75],
    ['write the report about 10 min', 10],
  ])('%s → est %i', (text, est) => {
    const s = made(text);
    expect(s.est).toBe(est);
    expect(s.title).toBe(text.startsWith('lire') ? 'Lire' : text.startsWith('write') ? 'Write the report' : 'Read');
  });
  it('gives a length to a timed item as its duration', () => {
    expect(made('dentist 14:30 for 45 min')).toEqual({ title: 'Dentist', due: '2026-10-20', at: '14:30', dur: 45 });
    expect(made('meeting 14:00-15:30 tomorrow')).toEqual({ title: 'Meeting', due: '2026-10-21', at: '14:00', dur: 90 });
    expect(made('réunion de 14h à 15h30')).toEqual({ title: 'Réunion', due: '2026-10-20', at: '14:00', dur: 90 });
    expect(made('meeting from 9:00 to 9:30')).toMatchObject({ at: '09:00', dur: 30 });
  });
  it('puts a time with no date that has passed today on the next day, by the day-start rule', () => {
    const paris = (iso: string) => Date.parse(iso); // Paris is UTC+2 until the 25th
    const at = (now: string, dayStart = '04:00', today = '2026-10-20') => ({ ...ctx, today, now: paris(now), dayStart, zone: 'Europe/Paris' });
    // 20:00 on the 20th: 9:00 was this morning, so it is tomorrow; 21:00 is still today
    expect(made('call mum 9:00', at('2026-10-20T18:00:00Z'))).toMatchObject({ due: '2026-10-21', at: '09:00' });
    expect(made('call mum 21:00', at('2026-10-20T18:00:00Z'))).toMatchObject({ due: '2026-10-20', at: '21:00' });
    // 00:30 on the 21st with the day starting at 04:00 is still the 20th: 9:00 is later this calendar day, the 21st
    expect(made('call mum 9:00', at('2026-10-20T22:30:00Z'))).toMatchObject({ due: '2026-10-21', at: '09:00' });
    // a time before the day starts belongs to the end of today (02:00 the next calendar day): not passed at 20:00
    expect(made('take the bins out 2:00', at('2026-10-20T18:00:00Z'))).toMatchObject({ due: '2026-10-20', at: '02:00' });
    // a date said is kept, passed or not
    expect(made('call mum 9:00 today', at('2026-10-20T18:00:00Z'))).toMatchObject({ due: '2026-10-20' });
  });
  it('findTime, for the task sheet', () => {
    expect(findTime('Dentist 14:30')).toMatchObject({ at: '14:30' });
    expect(findTime('Choir, Hill House 602 at 7pm')).toMatchObject({ at: '19:00' });
    expect(findTime('rendez-vous à 9h30 chez le médecin')).toMatchObject({ at: '09:30' });
    expect(findTime('read for 1h')).toBeNull();
    expect(findTime('call in 10 min')).toBeNull();
    expect(findTime('Hill House 602')).toBeNull();
    expect(findTime('')).toBeNull();
    const r = findTime('lunch 12:00-13:30');
    expect(r).toMatchObject({ at: '12:00', dur: 90 });
  });
});

describe('places', () => {
  it('a place the person has becomes where', () => {
    expect(made('reply to the landlord at home')).toEqual({ title: 'Reply to the landlord', where: 'pl1' });
    expect(made('return books at the city library tomorrow')).toEqual({ title: 'Return books', where: 'pl2', due: '2026-10-21' });
    expect(made('rendre les livres à la city library')).toEqual({ title: 'Rendre les livres', where: 'pl2' });
  });
  it('another place stays in the title, after a time', () => {
    expect(made('dentist 14:30 at Hill House')).toMatchObject({ title: 'Dentist, Hill House', at: '14:30' });
    expect(made('look at the report 14:00')).toMatchObject({ title: 'Look at the report' });
    expect(made('look at the report')).toEqual({ title: 'Look at the report' });
    expect(made('meeting at the office 10:00')).toMatchObject({ title: 'Meeting at the office' });
  });
  it('a place name is not read as a regex', () => {
    const c = { ...ctx, places: [{ id: 'x', name: 'St. (Mary) [c]+' }, { id: 'y', name: '' }] };
    expect(made('call at St. Mary c', c)).toEqual({ title: 'Call', where: 'x' });
    expect(() => run('call at (((', c)).not.toThrow();
  });
});

describe('standing obligations and repeats', () => {
  it.each([
    ['yoga mondays and thursdays 18:30', [1, 4], '18:30'],
    ['yoga les lundis et jeudis à 18h30', [1, 4], '18:30'],
    ['yoga every Tuesday and Thursday at 7pm', [2, 4], '19:00'],
    ['yoga each mon, wed 8:00', [1, 3], '08:00'],
    ['yoga chaque mardi 8h', [2], '08:00'],
    ['yoga tous les mardis et vendredis 8h', [2, 5], '08:00'],
    ['yoga every day 9:00', [1, 2, 3, 4, 5, 6, 7], '09:00'],
    ['yoga tous les jours à 9h', [1, 2, 3, 4, 5, 6, 7], '09:00'],
    ['yoga every saturday 9:00', [6], '09:00'],
  ])('%s → standing', (text, weekdays, at) => {
    const s = made(text);
    expect(s).toMatchObject({ title: 'Yoga', template: true, weekdays, at });
  });
  it('a length goes on the standing item as dur; a place as where', () => {
    expect(made('choir every Monday 19:00 for 90 min at home')).toEqual({ title: 'Choir', template: true, weekdays: [1], at: '19:00', dur: 90, where: 'pl1' });
  });
  it('a repeat with no time opens the sheet with the Repeats field filled', () => {
    expect(run('water the plants every 3 days')).toEqual({ kind: 'sheet', prefill: { title: 'Water the plants', repeat: { every: 3, unit: 'day', from: 'due' }, due: '2026-10-20' } });
    expect(run('pay rent every month')).toMatchObject({ kind: 'sheet', prefill: { title: 'Pay rent', repeat: { every: 1, unit: 'month' } } });
    expect(run('arroser les plantes toutes les 2 semaines')).toMatchObject({ kind: 'sheet', prefill: { repeat: { every: 2, unit: 'week' } } });
    expect(run('take the pill chaque jour')).toMatchObject({ kind: 'sheet', prefill: { repeat: { every: 1, unit: 'day' } } });
    expect(run('water the plants every Sunday')).toEqual({ kind: 'sheet', prefill: { title: 'Water the plants', repeat: { every: 1, unit: 'week', from: 'due', weekdays: [7] }, due: '2026-10-25' } });
    expect(run('water the plants every Monday and Tuesday')).toMatchObject({ kind: 'sheet', prefill: { repeat: { weekdays: [1, 2] }, due: '2026-10-26' } });
  });
  it('a repeat the schedule cannot hold keeps its time on the sheet', () => {
    expect(run('review every 2 weeks 19:00')).toMatchObject({ kind: 'sheet', prefill: { title: 'Review', at: '19:00', repeat: { every: 2, unit: 'week' } } });
    expect(run('yoga every Monday 19:00 from 26/10')).toMatchObject({ kind: 'sheet', prefill: { at: '19:00', due: '2026-10-26' } });
  });
});

describe('plain lines and prefixes', () => {
  it('a short line is a step for the Inbox, with nothing else set', () => {
    expect(made('call the dentist')).toEqual({ title: 'Call the dentist' });
    expect(made('  Buy milk.  ')).toEqual({ title: 'Buy milk' });
    expect(made('acheter du lait')).toEqual({ title: 'Acheter du lait' });
  });
  it('strips R:, add and remind me to', () => {
    expect(made('r: call mum')).toEqual({ title: 'Call mum' });
    expect(made('R : call mum')).toEqual({ title: 'Call mum' });
    expect(made('add buy milk')).toEqual({ title: 'Buy milk' });
    expect(made('ajouter: acheter du lait')).toEqual({ title: 'Acheter du lait' });
    expect(made('remind me to call mum tomorrow')).toEqual({ title: 'Call mum', due: '2026-10-21' });
    expect(made('rappelle-moi de payer le loyer vendredi')).toEqual({ title: 'Payer le loyer', due: '2026-10-23' });
  });
  it('lets go of a word left hanging', () => {
    expect(made('send the photos by tomorrow')).toEqual({ title: 'Send the photos', due: '2026-10-21' });
    expect(made('envoyer les photos pour demain')).toEqual({ title: 'Envoyer les photos', due: '2026-10-21' });
    expect(made('tomorrow: call the bank')).toEqual({ title: 'Call the bank', due: '2026-10-21' });
  });
  it('a title of more than eight words is not a plain line', () => {
    const eight = 'one two three four five six seven eight';
    expect(PLAIN_WORDS).toBe(8);
    expect(made(eight)).toEqual({ title: 'One two three four five six seven eight' });
    const r = run('Open Doctolib and book the dentist for a cleaning appointment next month');
    expect(r).toEqual({ kind: 'unknown', reason: 'long', prefill: { title: 'Open Doctolib and book the dentist for a cleaning appointment next month' } });
    expect(run('Open Doctolib and book the dentist for a cleaning appointment tomorrow')).toMatchObject({ kind: 'unknown', reason: 'long', prefill: { due: '2026-10-21' } });
  });
  it('only a time or a date opens the sheet with no title', () => {
    expect(run('19:00')).toEqual({ kind: 'sheet', prefill: { title: '', at: '19:00', due: '2026-10-20' } });
    expect(run('tomorrow')).toEqual({ kind: 'sheet', prefill: { title: '', due: '2026-10-21' } });
  });
});

describe('done, move and drop', () => {
  const op = (text: string) => only(text);
  it('done', () => {
    expect(op('done call the dentist')).toEqual({ op: 'task.done', id: 't1' });
    expect(op('Done: call the dentist')).toEqual({ op: 'task.done', id: 't1' });
    expect(op('call the agency done')).toEqual({ op: 'task.done', id: 't4' });
    expect(op('✓ pay the rent')).toEqual({ op: 'task.done', id: 't2' });
    expect(op('fait pay the rent')).toEqual({ op: 'task.done', id: 't2' });
  });
  it('done, yesterday', () => {
    expect(op('done pay the rent yesterday')).toEqual({ op: 'task.done', id: 't2', day: '2026-10-19' });
    expect(op('pay the rent fini hier')).toEqual({ op: 'task.done', id: 't2', day: '2026-10-19' });
  });
  it('finds a step by words that are not its start', () => {
    expect(op('done reply to the landlord')).toEqual({ op: 'task.done', id: 't7' });
    expect(op('drop the games')).toEqual({ op: 'task.drop', id: 't3' });
    expect(op('supprimer games')).toEqual({ op: 'task.drop', id: 't3' });
    expect(op('abandon pay the rent')).toEqual({ op: 'task.drop', id: 't2' });
    expect(op('drop the dentist')).toEqual({ op: 'task.drop', id: 't1' });
  });
  it('move', () => {
    expect(op('move rent to Friday')).toEqual({ op: 'task.update', id: 't2', set: { due: '2026-10-23' } });
    expect(op('reporter rent à vendredi')).toEqual({ op: 'task.update', id: 't2', set: { due: '2026-10-23' } });
    expect(op('déplacer rent au 26/10')).toEqual({ op: 'task.update', id: 't2', set: { due: '2026-10-26' } });
    expect(op('rent → friday')).toEqual({ op: 'task.update', id: 't2', set: { due: '2026-10-23' } });
    expect(op('rent -> demain')).toEqual({ op: 'task.update', id: 't2', set: { due: '2026-10-21' } });
    expect(op('move rent to tomorrow 10:00')).toEqual({ op: 'task.update', id: 't2', set: { due: '2026-10-21', at: '10:00' } });
    expect(op('push call the agency to the day after tomorrow')).toEqual({ op: 'task.update', id: 't4', set: { due: '2026-10-22' } });
    expect(op('postpone call the agency to monday')).toEqual({ op: 'task.update', id: 't4', set: { due: '2026-10-26' } });
  });
  it('a move to something that is not a day is just a line', () => {
    expect(made('move boxes to the garage')).toEqual({ title: 'Move boxes to the garage' });
  });
  it('several matches ask which', () => {
    expect(run('done call')).toEqual({ kind: 'pick', intent: 'done', candidates: [{ id: 't1', name: 'Call the dentist about the cleaning' }, { id: 't4', name: 'Call the agency' }] });
    expect(run('drop call')).toMatchObject({ kind: 'pick', intent: 'drop' });
    expect(run('move call to friday')).toMatchObject({ kind: 'pick', intent: 'move' });
  });
  it('nothing matches: not for the parser', () => {
    expect(run('done walking the dog')).toEqual({ kind: 'unknown', reason: 'nomatch', prefill: { title: 'done walking the dog' } });
    expect(run('drop the kids at school')).toMatchObject({ kind: 'unknown', reason: 'nomatch' });
    expect(run('move zzz to friday')).toMatchObject({ kind: 'unknown', reason: 'nomatch' });
  });
  it('never reaches a standing obligation, a done step or a dropped one', () => {
    for (const text of ['done choir', 'drop choir', 'move choir to friday', 'done hill house', 'drop water the plants']) {
      expect(run(text), text).toMatchObject({ kind: 'unknown', reason: 'nomatch' });
    }
  });
});

describe('what is not for the parser', () => {
  it.each([
    ['what does Ibrahim have on', 'question'],
    ['what do I have today?', 'question'],
    ['qui est Ibrahim', 'question'],
    ['quand est la chorale ?', 'question'],
    ['pourquoi le loyer', 'question'],
    ['is the rent paid?', 'question'],
    ['how do I file the form', 'question'],
    ['call the bank; email Alex', 'several'],
    ['call the bank\nemail Alex', 'several'],
    ['call the bank and then email Alex', 'several'],
    ['appeler la banque puis écrire à Alex', 'several'],
    ['Ibrahim is back at work', 'memory'],
    ['Ibrahim est malade', 'memory'],
    ['Marie a un chat', 'memory'],
    ['', 'empty'],
    ['   ', 'empty'],
    ['...', 'empty'],
    ['R:', 'empty'],
  ])('%s → %s', (text, reason) => {
    expect(run(text)).toMatchObject({ kind: 'unknown', reason });
  });
  it('a question or a statement opens the sheet with the words as they were', () => {
    expect(run('what does Ibrahim have on')).toEqual({ kind: 'unknown', reason: 'question', prefill: { title: 'what does Ibrahim have on' } });
  });
  it('a line starting with the name of a note and a verb is a statement', () => {
    const c = { ...ctx, notes: ['Choir', 'Hill House', 'Al'] };
    expect(run('choir is on mondays now', c)).toMatchObject({ reason: 'memory' });
    expect(run('choir est le lundi', c)).toMatchObject({ reason: 'memory' });
    expect(run('choir tomorrow', c)).toMatchObject({ kind: 'changes' });
    expect(run('Al is away', c)).toMatchObject({ reason: 'memory' });
  });
});

describe('what planChanges does with it', () => {
  const task = (id: string, o: Partial<Task> = {}): Task & { id: string } => ({
    id, title: 'Step ' + id, project: 'inbox', suit: 'S', kind: 'task', urgent: false, important: true, due: null, est: null, est0: null, estBy: null,
    status: 'open', doneDay: null, doneAt: null, started: null, resume: null, carried: 0, where: 'any', template: false, note: '', order: 1, created: '', ...o,
  });
  const snap: Snapshot = {
    today: ctx.today,
    tasks: new Map(ctx.tasks.map(t => [t.id, task(t.id, { title: t.title, status: t.status as Task['status'], template: !!t.template })])),
    projects: new Map([['inbox', { id: 'inbox', name: 'Inbox', suit: 'S', where: 'any', goal: null, goalBy: null, due: null, order: 9, status: 'active' }]]),
    days: new Map(), decisions: new Map(),
    places: new Map(ctx.places.map((p, i) => [p.id, { id: p.id, name: p.name, timeZone: 'Europe/Paris', order: i }])),
    stays: new Map(), memory: new Map(),
  };
  const gen = { id: (p: string) => p + 'x', now: () => '2026-10-20T10:00:00.000Z', zone: 'Europe/Paris' };
  const plan = (text: string) => {
    const r = run(text);
    if (r.kind !== 'changes') throw new Error(text + ' → ' + r.kind);
    // The change-set also reads as one from JSON: the schema keeps every field.
    const back = readChangeSet(JSON.parse(JSON.stringify({ v: 1, changes: r.cs.changes })));
    expect(back.ok && back.cs.changes).toEqual(r.cs.changes);
    const p = planChanges(r.cs, snap, gen);
    return { r, p, low: isLowRisk(r.cs, p) };
  };

  it.each([
    'choir every Monday 19:00 at Hill House 602', 'R: call the bank tomorrow, 10 min', 'chorale tous les lundis 19h à Hill House 602',
    'dentist 14:30 at home', 'call the bank', 'done call the dentist', 'move rent to Friday', 'drop the games', 'read 1h tomorrow',
  ])('accepts %s as exactly one change', text => {
    const { p } = plan(text);
    expect(p.items).toHaveLength(1);
    expect(p.skipped).toBe(0);
  });
  it('an add, a done and a move are low-risk; a drop is not', () => {
    expect(plan('call the bank tomorrow').low).toBe(true);
    expect(plan('choir every Monday 19:00').low).toBe(true);
    expect(plan('done call the dentist').low).toBe(true);
    expect(plan('move rent to Friday').low).toBe(true);
    expect(plan('move rent to Friday 10:00').low).toBe(true);
    expect(plan('drop the games').low).toBe(false);
  });
  it('writes a standing obligation with its days, time and place', () => {
    const op = plan('choir every Monday 19:00 at Hill House 602').p.items[0]!.ops[0]!;
    expect(op).toMatchObject({ t: 'task', fields: { title: 'Choir, Hill House 602', template: true, weekdays: [1], at: '19:00' } });
  });
  it('marks what the person typed as theirs, not an AI\'s', () => {
    const { fields } = plan('read 20 min').p.items[0]!.ops[0] as { fields: Record<string, unknown> };
    expect(fields).toMatchObject({ title: 'Read', est: 20, estBy: 'me', by: 'me', src: 'home' });
    const ai = readChangeSet({ v: 1, changes: [{ op: 'task.create', set: { title: 'Read', est: 20 } }] });
    if (!ai.ok) throw new Error('bad');
    expect((planChanges(ai.cs, snap, gen).items[0]!.ops[0] as { fields: Record<string, unknown> }).fields).toMatchObject({ estBy: 'ai', by: 'ai', src: 'ai' });
  });
  it('a standing obligation is not a target: planChanges would skip an update or a drop of it', () => {
    const cs = readChangeSet({ v: 1, changes: [{ op: 'task.drop', id: 't5' }, { op: 'task.update', id: 't5', set: { due: '2026-10-23' } }] });
    if (!cs.ok) throw new Error('bad');
    expect(planChanges(cs.cs, snap, gen).items).toHaveLength(1); // the drop goes through…
    expect(run('drop choir')).toMatchObject({ kind: 'unknown' }); // …which is why the parser never offers it
  });
});

describe('it is deterministic', () => {
  it('gives the same result twice and does not touch its input', () => {
    const c = JSON.parse(JSON.stringify(ctx)) as ParseContext;
    const a = run('choir every Monday 19:00 at Hill House 602', c);
    expect(run('choir every Monday 19:00 at Hill House 602', c)).toEqual(a);
    expect(c).toEqual(ctx);
  });
  it('reads French and English the same whatever the app is in', () => {
    expect(made('call the bank demain à 10h')).toMatchObject({ due: '2026-10-21', at: '10:00' });
    expect(made('appeler la banque tomorrow at 10am')).toMatchObject({ due: '2026-10-21', at: '10:00' });
  });
});
