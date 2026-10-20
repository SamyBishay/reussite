// The tools, against a list written by a simulated app device through the real relay.
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { openFromText } from '../../src/sync/crypto';
import { decodeBatch } from '../../src/sync/wire';
import { SCHEMA_VERSION } from '../../src/data/schema';
import type { ChangeBatch } from '../../src/sync/protocol';
import { newApp, signIn, switchOn, tool, type App } from './connector';

const TODAY = new Date().toISOString().slice(0, 10);
const day = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const task = (title: string, o: Record<string, unknown> = {}) => ({
  title, project: 'p1', suit: 'S', kind: 'task', urgent: false, important: true, due: null, est: 10, est0: null, estBy: 'me', status: 'open', doneDay: null, doneAt: null,
  started: null, resume: null, carried: 0, where: 'any', template: false, note: '', order: 1, created: '2026-10-01T00:00:00.000Z', src: 'page', ...o,
});

let app: App;
let access: string;
const batches = async () => (await env.DB.prepare('SELECT COUNT(*) AS n FROM batches WHERE space = ?').bind(app.keys.spaceId).first<{ n: number }>())!.n;
const batchBodies = async () => {
  const rows = await env.DB.prepare('SELECT blob, device FROM batches WHERE space = ? ORDER BY seq').bind(app.keys.spaceId).all<{ blob: string; device: string }>();
  return Promise.all(rows.results.map(async r => ({ device: r.device, batch: decodeBatch(await openFromText(app.keys, r.blob)) })));
};

beforeAll(async () => {
  app = await newApp('app00001');
  const d = app.device;
  d.add('meta', 'settings', { dayStart: '00:00', urgencyDays: 21 });
  d.add('places', 'pl1', { name: 'Paris', timeZone: 'Europe/Paris', order: 0 });
  d.add('projects', 'p1', { name: 'Move out', suit: 'C', where: 'any', goal: 'Keys back by November', goalBy: null, due: null, order: 1, status: 'active', smart: { specific: 'Hand over the flat', measurable: '', attainable: '', relevant: '', dated: '30 Nov' } });
  d.add('projects', 'p2', { name: 'Choir', suit: 'H', where: 'any', goal: null, goalBy: null, due: null, order: 2, status: 'active' });
  d.add('tasks', 't1', task('Call the agency about the keys', { due: day(2), starter: 'Open Phone', est: 15 }));
  d.add('tasks', 't2', task('Call the dentist', { urgent: true }));
  d.add('tasks', 't3', task('Pay the rent', { due: day(1), project: 'p2', est: 5 }));
  d.add('tasks', 't4', task('Écrire à Hélène', { est: 20 }));
  d.add('tasks', 't5', task('Old thing', { status: 'done', doneDay: day(-3), est0: 10, est: 10 }));
  d.add('tasks', 't6', task('Choir rehearsal', { at: '19:00', dur: 90, due: TODAY }));
  d.add('sessions', 's1', { taskId: 't5', d: day(-3), m: 14, why: 'done', at: '2026-10-16T10:00:00.000Z', source: 'timer' });
  d.add('days', TODAY, { date: TODAY, plan: ['t1', 't3'], launches: [{ t: '09:30', k: 'start' }, { t: '14:00', k: 'restart' }], first: null, checkin: null, closed: null, summary: null });
  d.add('days', day(-1), { date: day(-1), plan: ['t2', 't4'], launches: [], first: null, checkin: null, closed: null, summary: null });
  const line = (id: string, text: string) => ({ id, text, at: '2026-10-01T00:00:00.000Z', by: 'me' });
  d.add('memory', 'm0', { kind: 'profile', name: 'Me', aliases: [], lines: [line('l1', 'Works best in the morning')], private: false, updated: '2026-10-02T00:00:00.000Z' });
  d.add('memory', 'm1', { kind: 'person', name: 'Ibrahim', aliases: ['Ibra'], lines: [line('l1', 'Likes tea'), line('l2', 'Works nights')], private: false, updated: '2026-10-03T00:00:00.000Z' });
  d.add('memory', 'm2', { kind: 'place', name: 'Hill House', aliases: [], lines: [line('l1', 'Room 602 is the choir room')], private: false, updated: '2026-10-04T00:00:00.000Z' });
  d.add('memory', 'm3', { kind: 'person', name: 'Zelda Secret', aliases: ['Zed'], lines: [line('l1', 'Hidden fact about tea')], private: true, updated: '2026-10-05T00:00:00.000Z' });
  d.add('tasks', 't7', task('Send Ibrahim the rehearsal dates', { project: 'p2' }));
  d.add('tasks', 't8', task('Ibrahim birthday gift', { status: 'done', doneDay: day(-2), est0: 10 }));
  d.add('decisions', 'd1', { title: 'Stay or move?', problem: { what: 'Rent went up' }, options: [{ id: 'o1', name: 'Stay', pros: [{ id: 'i1', text: 'cheap', w: 4 }], cons: [], prosNot: [], consNot: [] }], status: 'draft', chosen: null, taskIds: ['t2'] });
  await app.sync();
  access = (await signIn((await switchOn(app)).body.code)).access;
});

describe('reading', () => {
  it('today: the place, the list in order, launch points, fixed times, carried steps', async () => {
    const r = await tool(access, 'today');
    expect(r.isError).toBe(false);
    expect(r.text).toContain('Next step:\nt1 | Call the agency about the keys');
    expect(r.text).toContain('starter: Open Phone');
    expect(r.text.indexOf('1. t1')).toBeLessThan(r.text.indexOf('2. t3'));
    expect(r.text).toMatch(/estimated 20m/);
    expect(r.text).toContain('Launch points: 09:30 start, 14:00 restart');
    expect(r.text).toContain('Fixed times:\n19:00 (1h30) t6 | Choir rehearsal');
    expect(r.text).toContain("Carried from yesterday, not on today's list yet (2)");
  });

  it('get_day: any date, with what was done', async () => {
    const r = await tool(access, 'get_day', { date: day(-3) });
    expect(r.text).toContain('Done: 1 step, 14m worked.');
    expect(r.text).toContain('t5 | Old thing (done)');
    expect((await tool(access, 'get_day', { date: 'tomorrow' })).isError).toBe(true);
  });

  it('query_tasks: by quadrant, project, status, due range, text; accents and case ignored', async () => {
    const q1 = await tool(access, 'query_tasks', { quadrant: 1 });
    expect(q1.text).toContain('t2 | Call the dentist | Q1');
    expect(q1.text).not.toContain('t4');
    const proj = await tool(access, 'query_tasks', { project: 'choir' });
    expect(proj.text).toContain('t3 | Pay the rent');
    expect(proj.text).not.toContain('t1 |');
    expect((await tool(access, 'query_tasks', { status: 'done' })).text).toContain('t5 | Old thing (done)');
    expect((await tool(access, 'query_tasks', { due_from: day(1), due_to: day(1) })).text).toMatch(/^1 step match/);
    expect((await tool(access, 'query_tasks', { text: 'ecrire helene' })).text).toContain('t4 | Écrire à Hélène');
    expect((await tool(access, 'query_tasks', { text: 'zzz' })).text).toBe('No steps match.');
    expect((await tool(access, 'query_tasks', { project: 'nope' })).isError).toBe(true);
  });

  it('query_tasks never returns more than 50 lines', async () => {
    const big = await newApp('app00002');
    for (let i = 0; i < 80; i++) big.device.add('tasks', 'b' + i, task('Step ' + i, { order: i }));
    await big.sync();
    const tok = (await signIn((await switchOn(big)).body.code)).access;
    const r = await tool(tok, 'query_tasks', { limit: 50 });
    expect(r.text).toContain('80 steps match, showing the first 50');
    expect(r.text.split('\n').filter(l => l.startsWith('b'))).toHaveLength(50);
    expect((await tool(tok, 'query_tasks', { limit: 500 })).isError).toBe(true);
  });

  it('get_task: the step with its sessions, by id or by title', async () => {
    const byId = await tool(access, 'get_task', { id: 't5' });
    expect(byId.text).toContain('Sessions (1, 14m in all):\n' + day(-3) + ' | 14m | timer | done');
    expect((await tool(access, 'get_task', { id: 'écrire à hélène' })).text).toContain('t4 | Écrire à Hélène');
    const amb = await tool(access, 'get_task', { id: 'Call' });
    expect(amb.isError).toBe(true);
    expect(amb.text).toContain('t1 | Call the agency');
    expect(amb.text).toContain('t2 | Call the dentist');
    expect((await tool(access, 'get_task', { id: 'ghost' })).isError).toBe(true);
  });

  it('get_project and get_decision', async () => {
    const p = await tool(access, 'get_project', { id: 'Move out' });
    expect(p.text).toContain('Project p1: Move out (active, suit C)');
    expect(p.text).toContain('goal: Keys back by November');
    expect(p.text).toContain('SMART: specific: Hand over the flat; dated: 30 Nov');
    expect(p.text).toContain('t1 | Call the agency');
    const d = await tool(access, 'get_decision', { id: 'd1' });
    expect(d.text).toContain('Decision d1: Stay or move? (draft)');
    expect(d.text).toContain('pros: cheap');
    expect(d.text).toContain('t2 | Call the dentist');
    expect((await tool(access, 'get_decision', { id: 'stay or' })).text).toContain('Decision d1');
  });

  it('get_method: the method and the change-set format, in either language', async () => {
    const en = await tool(access, 'get_method');
    expect(en.text).toContain('task.create');
    expect(en.text).toContain('Never give weights');
    expect(en.text).not.toContain('## Examples');
    const fr = await tool(access, 'get_method', { language: 'fr' });
    expect(fr.text).not.toBe(en.text);
    expect(fr.text.length).toBeGreaterThan(2000);
  });
});

describe('read_memory', () => {
  it('with nothing asked: the profile in full and the index of the other notes, no private note', async () => {
    const r = await tool(access, 'read_memory');
    expect(r.isError).toBe(false);
    expect(r.text).toContain('m0 | profile | Me | -\n1. Works best in the morning');
    expect(r.text).toContain('m1 | person | Ibrahim | Ibra');
    expect(r.text).toContain('m2 | place | Hill House | -');
    expect(r.text).not.toContain('Likes tea'); // the index lists, it does not read
    expect(r.text).not.toMatch(/Zelda|Zed|Hidden|m3/);
  });

  it('by name or by alias: the note in the app\'s format, with its open steps only', async () => {
    for (const who of ['Ibrahim', 'ibra', 'm1', "Ibrahim's week"]) {
      const r = await tool(access, 'read_memory', { name: who });
      expect(r.isError).toBe(false);
      expect(r.text).toContain('m1 | person | Ibrahim | Ibra\n1. Likes tea\n2. Works nights');
      expect(r.text).toContain('t7 | Send Ibrahim the rehearsal dates');
      expect(r.text).not.toContain('birthday gift'); // done
      expect(r.text).not.toContain('Hill House');
    }
  });

  it('by query: the notes named in it, or with all its words in a line', async () => {
    expect((await tool(access, 'read_memory', { query: 'what does ibrahim have on this week?' })).text).toContain('1. Likes tea');
    const byLine = await tool(access, 'read_memory', { query: 'choir room' });
    expect(byLine.text).toContain('m2 | place | Hill House | -\n1. Room 602 is the choir room');
  });

  it('never a private note: not by id, name, alias, a word in a line, or a query, and no hint that it exists', async () => {
    for (const a of [{ name: 'Zelda Secret' }, { name: 'm3' }, { name: 'zed' }, { name: 'Zelda' }, { query: 'Zed said hello' }, { query: 'hidden fact' }]) {
      const r = await tool(access, 'read_memory', a);
      expect(r.isError).toBe(false);
      expect(r.text).not.toMatch(/Zelda|Zed\b|Hidden|m3/);
      expect(r.text).toContain('No memory note matches');
      expect(r.text).toContain('m1 | person | Ibrahim'); // the index of what can be asked for
    }
    // the same word in a line of a note that may be read still finds that note, not the private one
    const tea = await tool(access, 'read_memory', { query: 'tea' });
    expect(tea.text).toContain('1. Likes tea');
    expect(tea.text).not.toContain('Hidden');
  });

  it('a memory change comes back as a diff and a confirmation id, and writes nothing', async () => {
    const before = await batches();
    const r = await tool(access, 'apply_changes', { changes: [{ op: 'memory.add', note: 'Ibra', text: 'Plays oud' }] });
    expect(r.isError).toBe(false);
    expect(r.text).toMatch(/"confirm": "c\w+"/);
    expect(r.text).toContain('Remember, in the note "Ibrahim"');
    expect(await batches()).toBe(before);
  });
});

describe('a quick edit', () => {
  it('"R: choir Monday 19:00, Hill House 602" takes one call and the app pulls it', async () => {
    const before = await batches();
    const r = await tool(access, 'apply_changes', { changes: [{ op: 'task.create', set: { title: 'Choir, Hill House 602', project: 'Choir', due: day(3), at: '19:00', dur: 90 } }] });
    expect(r.isError).toBe(false);
    expect(r.text).toContain('Done: one low-risk change, applied at once.');
    expect(r.text).toMatch(/Add step "Choir, Hill House 602"/);
    expect(r.text).toMatch(/Undo id: u\w+/);
    expect(await batches()).toBe(before + 1);

    const pulled = await app.sync();
    expect(pulled.pulled).toBeGreaterThan(0);
    const made = [...(app.device.docs.get('tasks')?.values() ?? [])].find(t => t.title === 'Choir, Hill House 602')!;
    expect(made).toMatchObject({ at: '19:00', dur: 90, due: day(3), project: 'p2', src: 'ai', by: 'ai', status: 'open', suit: 'H' });
    // Written under its own node id, like any device.
    expect(made._hlc.title).toMatch(/:connector$/);
    const last = (await batchBodies()).at(-1)!;
    expect(last.device).toBe('connector');
    expect(last.batch.v).toBe(SCHEMA_VERSION);
  });

  it('ticking a step done by its title, and moving a date, also apply at once', async () => {
    const done = await tool(access, 'apply_changes', { changes: [{ op: 'task.done', id: 'pay the rent' }] });
    expect(done.text).toContain('Done: one low-risk change');
    expect(done.text).toContain('Mark done: "Pay the rent"');
    const moved = await tool(access, 'apply_changes', { changes: [{ op: 'task.update', id: 'Écrire à', set: { due: day(5) } }] });
    expect(moved.text).toContain('Change step "Écrire à Hélène" (due - → ' + day(5) + ')');
    await app.sync();
    expect(app.device.get('tasks', 't3')).toMatchObject({ status: 'done', doneDay: TODAY, est0: 5 });
    expect(app.device.get('tasks', 't4')).toMatchObject({ due: day(5) });
  });

  it('an edit made on the app afterwards wins over the older connector field, and the other way round', async () => {
    app.device.edit('tasks', 't2', { note: 'from the app' });
    await tool(access, 'apply_changes', { changes: [{ op: 'task.update', id: 't2', set: { due: day(4) } }] });
    await app.sync();
    expect(app.device.get('tasks', 't2')).toMatchObject({ note: 'from the app', due: day(4) });
    const after = await tool(access, 'get_task', { id: 't2' });
    expect(after.text).toContain('note: from the app');
  });
});

describe('anything bigger waits for a yes', () => {
  const set = (id: string) => [
    { op: 'task.drop', id: 't2' },
    { op: 'task.update', id, set: { due: day(9), est: 40 } },
    { op: 'task.create', set: { title: 'Open Mail and text Alex', project: 'p1' } },
  ];

  it('returns the diff and a confirmation id, and writes nothing', async () => {
    const before = await batches();
    const r = await tool(access, 'apply_changes', { changes: set('t1') });
    expect(r.isError).toBe(false);
    expect(r.text).toContain("needs the person's yes");
    expect(r.text).toContain('1. Drop "Call the dentist"');
    expect(r.text).toMatch(/2\. Change step "Call the agency about the keys" \(due .* → \d{4}-\d{2}-\d{2}; est 15 → 40\)/);
    expect(r.text).toContain('3. Add step "Open Mail and text Alex"');
    expect(r.text).toMatch(/\{"confirm": "c\w+"\}/);
    expect(await batches()).toBe(before);
    await app.sync();
    expect(app.device.get('tasks', 't2')!.status).toBe('open');
  });

  it('applies only when called again with that id, once', async () => {
    const r = await tool(access, 'apply_changes', { changes: set('t1') });
    const id = /"confirm": "(c\w+)"/.exec(r.text)![1]!;
    const before = await batches();
    const done = await tool(access, 'apply_changes', { confirm: id });
    expect(done.isError).toBe(false);
    expect(done.text).toContain('3 changes, confirmed');
    expect(await batches()).toBe(before + 1);
    await app.sync();
    expect(app.device.get('tasks', 't2')!.status).toBe('dropped');
    expect(app.device.get('tasks', 't1')).toMatchObject({ due: day(9), est: 40 });
    const again = await tool(access, 'apply_changes', { confirm: id });
    expect(again.isError).toBe(true);
    expect(again.text).toContain('unknown or has expired');
    expect(await batches()).toBe(before + 1);
  });

  it('a confirmation lasts an hour and belongs to its space', async () => {
    const r = await tool(access, 'apply_changes', { changes: [{ op: 'task.drop', id: 't4' }] });
    const id = /"confirm": "(c\w+)"/.exec(r.text)![1]!;
    const other = await newApp('app00003');
    other.device.add('tasks', 'x1', task('Other'));
    await other.sync();
    const otherToken = (await signIn((await switchOn(other)).body.code)).access;
    expect((await tool(otherToken, 'apply_changes', { confirm: id })).isError).toBe(true);
    await env.DB.prepare('UPDATE connector_pending SET expires = ? WHERE id = ?').bind(Date.now() - 1, id).run();
    const late = await tool(access, 'apply_changes', { confirm: id });
    expect(late.isError).toBe(true);
    await app.sync();
    expect(app.device.get('tasks', 't4')!.status).toBe('open');
  });

  it('the stored change-set is encrypted', async () => {
    const r = await tool(access, 'apply_changes', { changes: [{ op: 'task.drop', id: 't4' }, { op: 'task.drop', id: 't1' }] });
    const id = /"confirm": "(c\w+)"/.exec(r.text)![1]!;
    const row = await env.DB.prepare('SELECT blob FROM connector_pending WHERE id = ?').bind(id).first<{ blob: string }>();
    expect(row!.blob).not.toContain('task.drop');
    expect(JSON.stringify(await openFromText(app.keys, row!.blob))).toContain('task.drop');
  });
});

describe('titles instead of ids', () => {
  async function small() {
    const x = await newApp('app0000' + Math.floor(Math.random() * 90 + 10));
    x.device.add('projects', 'p1', { name: 'Move out', suit: 'C', where: 'any', goal: null, goalBy: null, due: null, order: 1, status: 'active' });
    x.device.add('tasks', 'a1', task('Call'));
    x.device.add('tasks', 'a2', task('Call the bank'));
    x.device.add('tasks', 'a3', task('Dentist appointment'));
    x.device.add('tasks', 'a4', task('Call the plumber', { status: 'done', doneDay: TODAY }));
    x.device.add('tasks', 'a5', task('Pack boxes'));
    x.device.add('tasks', 'a6', task('Pack books'));
    await x.sync();
    return { x, tok: (await signIn((await switchOn(x)).body.code)).access };
  }
  const nBatches = async (x: App) => (await env.DB.prepare('SELECT COUNT(*) AS n FROM batches WHERE space = ?').bind(x.keys.spaceId).first<{ n: number }>())!.n;

  it('an ambiguous title returns the candidates and writes nothing', async () => {
    const { x, tok } = await small();
    const before = await nBatches(x);
    const r = await tool(tok, 'apply_changes', { changes: [{ op: 'task.done', id: 'Pack' }] });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('Nothing was written.');
    expect(r.text).toContain('"Pack" matches 2 steps');
    expect(r.text).toMatch(/a5 \| Pack boxes/);
    expect(r.text).toMatch(/a6 \| Pack books/);
    expect(await nBatches(x)).toBe(before);
  });

  it('an exact title beats a longer one that starts the same way; a unique prefix of whole words is enough', async () => {
    const { tok } = await small();
    expect((await tool(tok, 'apply_changes', { changes: [{ op: 'task.done', id: 'call' }] })).text).toContain('Mark done: "Call"');
    expect((await tool(tok, 'apply_changes', { changes: [{ op: 'task.done', id: 'Dentist' }] })).text).toContain('Mark done: "Dentist appointment"');
    expect((await tool(tok, 'apply_changes', { changes: [{ op: 'task.done', id: 'Dent' }] })).isError).toBe(true);
    const none = await tool(tok, 'apply_changes', { changes: [{ op: 'task.done', id: 'Nothing like it' }] });
    expect(none.isError).toBe(true);
    expect(none.text).toContain('No step with the id or title "Nothing like it"');
  });

  it('names a project, a step to wait for, and a step on the day\'s list', async () => {
    const { x, tok } = await small();
    const r = await tool(tok, 'apply_changes', { changes: [
      { op: 'task.create', set: { title: 'Open Mail and ask for the date', project: 'move', after: ['Dentist'] } },
      { op: 'day.update', date: TODAY, add: ['Pack boxes'], first: 'Pack boxes' },
    ] });
    expect(r.text).toContain("needs the person's yes");
    const id = /"confirm": "(c\w+)"/.exec(r.text)![1]!;
    expect((await tool(tok, 'apply_changes', { confirm: id })).isError).toBe(false);
    await x.sync();
    const made = [...x.device.docs.get('tasks')!.values()].find(t => t.title === 'Open Mail and ask for the date')!;
    expect(made).toMatchObject({ project: 'p1', after: ['a3'], suit: 'C' });
    expect(x.device.get('days', TODAY)).toMatchObject({ plan: ['a5'], first: { id: 'a5', title: 'Pack boxes' } });
  });

  it('an unknown project is an error, not a silent inbox', async () => {
    const { tok } = await small();
    const r = await tool(tok, 'apply_changes', { changes: [{ op: 'task.create', set: { title: 'x', project: 'Nonexistent' } }] });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('No project with the id or title "Nonexistent"');
  });
});

describe('invalid change-sets', () => {
  it('write nothing and say what is wrong, all at once', async () => {
    const before = await batches();
    const r = await tool(access, 'apply_changes', { changes: [
      { op: 'task.update', id: 't1', set: { due: 'Friday' } },
      { op: 'explode' },
      { op: 'task.done', id: 't1' },
    ] });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('Nothing was written.');
    expect(r.text).toMatch(/Change 1 \(task\.update\): set\.due/);
    expect(r.text).toMatch(/Change 2 \(explode\)/);
    expect(await batches()).toBe(before);
  });

  it('a wrong version, an empty list and too many changes', async () => {
    expect((await tool(access, 'apply_changes', { v: 2, changes: [{ op: 'task.drop', id: 't1' }] })).text).toContain('version 1');
    expect((await tool(access, 'apply_changes', { changes: [] })).isError).toBe(true);
    expect((await tool(access, 'apply_changes', {})).isError).toBe(true);
    const many = Array.from({ length: 81 }, () => ({ op: 'task.drop', id: 't1' }));
    expect((await tool(access, 'apply_changes', { changes: many })).text).toContain('At most 80');
  });

  it('an unknown id writes nothing, even beside a valid change', async () => {
    const before = await batches();
    const r = await tool(access, 'apply_changes', { changes: [{ op: 'task.done', id: 't3' }, { op: 'task.drop', id: 'nope-nope' }] });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('No step with the id or title "nope-nope"');
    expect(await batches()).toBe(before);
  });

  it('a change that does nothing is said so, not written', async () => {
    const before = await batches();
    const r = await tool(access, 'apply_changes', { changes: [{ op: 'task.done', id: 't5' }] });
    expect(r.isError).toBe(false);
    expect(r.text).toContain('Nothing to change.');
    expect(await batches()).toBe(before);
  });
});
