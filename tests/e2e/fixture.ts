// A synthetic v1 export, dated relative to today, with nothing personal in it.
const iso = (n: number) => { const x = new Date(); x.setHours(12); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
// The app's day starts at 05:00; tests don't run between midnight and 05:00 reliably, so shift then.
const shift = new Date().getHours() < 5 ? -1 : 0;
const d = (n: number) => iso(n + shift);

let i = 0;
function T(o: Record<string, unknown>) {
  i++;
  return ['t' + i, {
    title: 'Open Mail and reply to the landlord', project: 'p1', suit: 'D', kind: 'task', urgent: false, important: true, due: null,
    est: 15, estBy: 'samy', spent: 0, sessions: [], status: 'open', doneDay: null, doneAt: null, started: null, resume: null,
    carried: 0, where: 'home', template: false, note: '', order: i, created: '2026-09-01T09:00:00Z', src: 'page', ...o,
  }] as const;
}

export function sampleExport() {
  i = 0;
  const tasks = Object.fromEntries([
    T({ title: 'Open Doctolib and book the dentist for a cleaning appointment next month', due: d(3), link: 'https://www.doctolib.fr/', app: 'Doctolib', est: 10 }),
    T({ title: 'Open Mail and send the signed lease to the agency', due: d(1), urgent: true }),
    T({ title: 'Open the thesis draft and write the second paragraph of the method section', project: 'p2', suit: 'S', est: 30, resume: 'write the second paragraph' }),
    T({ title: 'Open a new Claude chat and ask about the tax form', prompt: '/decide Should I file the form now or wait?', link: 'https://claude.ai/new', kind: 'decision' }),
    T({ title: 'Open Messages and text Alex about Sunday', suit: 'H', project: 'p3', important: false, due: d(10) }),
    T({ title: 'Walk to the park for 30 minutes', suit: 'H', project: 'p3', template: true, est: 30 }),
    T({ title: 'Open Files and sort the scanned receipts', important: false, est: null }),
    T({ title: 'Open the bank app and download the September statement', status: 'done', doneDay: d(-1), doneAt: d(-1) + 'T10:00:00Z', spent: 20, sessions: [{ d: d(-1), m: 20, why: 'done', at: d(-1) + 'T10:00:00Z' }] }),
    T({ title: 'Open the thesis draft and fix the references', project: 'p2', suit: 'S', status: 'done', doneDay: d(0), doneAt: d(0) + 'T09:00:00Z', spent: 25, est: 20,
      sessions: [{ d: d(0), m: 10, why: 'focus', at: d(0) + 'T08:40:00Z' }, { d: d(0), m: 15, why: 'done', at: d(0) + 'T09:00:00Z', manual: true }] }),
    T({ title: 'Open Maps and find a café near the library', suit: 'H', project: 'p3', where: 'away', important: false }),
    T({ title: 'Open the supervisor email and propose two meeting slots', project: 'p2', suit: 'S', est: 10, status: 'done', doneDay: d(-2), doneAt: d(-2) + 'T11:00:00Z', spent: 12,
      sessions: [{ d: d(-2), m: 12, why: 'done', at: d(-2) + 'T11:00:00Z' }] }),
  ]);
  return {
    exported: '2026-10-08T00:00:00Z', source: 'reussite-v1', tasks,
    projects: {
      p1: { name: 'Housing papers', suit: 'D', where: 'any', goal: 'Lease signed and filed by the end of the month', goalBy: 'claude', due: d(20), order: 1, status: 'active' },
      p2: { name: 'Thesis', suit: 'S', where: 'home', goal: null, goalBy: null, due: null, order: 2, status: 'active' },
      p3: { name: 'Friends & outings', suit: 'H', where: 'any', goal: 'See a friend every week', goalBy: 'samy', due: null, order: 3, status: 'active' },
      inbox: { name: 'Inbox', suit: 'S', where: 'any', goal: null, goalBy: null, due: null, order: 99, status: 'active' },
    },
    days: {
      [d(0)]: { date: d(0), plan: ['t9', 't1', 't2', 't3'], launches: [{ t: '09:30', k: 'start' }, { t: '14:00', k: 'restart' }], first: { id: 't1', title: 'x' }, checkin: null, closed: null, summary: null },
      [d(-1)]: { date: d(-1), plan: ['t8', 't5'], launches: [], first: null, checkin: null, closed: d(-1) + 'T20:00:00Z', summary: null },
    },
    decisions: { d1: { title: 'Stay in the flat or move?', problem: 'Rent goes up', options: [], chosen: 'Stay one more year', why: 'Cheaper overall', falsifier: 'Rent rises again', date: d(-30), reviewOn: d(60), taskIds: [] } },
    meta: { settings: { here: 'home' } },
  };
}
