import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { agenda, type AgendaEvent } from './agenda';
import { choir, day, place, settings, state, stay, task, tr } from './agenda.fixture';
import { DEFAULT_FIXED_MINUTES, escapeText, fold, genericTitles, icsFor, realTitles, type IcsOptions, type IcsTranslate } from './ics';

const NOW = Date.parse('2026-10-19T08:00:00Z');
const itr = tr as unknown as IcsTranslate;
const opts = (o: Partial<IcsOptions> = {}): IcsOptions => ({ now: NOW, titles: realTitles(itr), withAlarms: true, deviceZone: 'Europe/Paris', ...o });
const ev = (o: Partial<AgendaEvent>): AgendaEvent => ({ id: 'fixed:x:2026-10-20', kind: 'fixed', day: '2026-10-20', at: Date.parse('2026-10-20T17:00:00Z'), time: '19:00', place: 'paris', zone: 'Europe/Paris', title: 'Choir', dur: 90, ...o });

interface Node { name: string; props: [string, string, string][]; kids: Node[] }
/** A small parser: unfolds, checks nesting, returns the tree. Properties are [name, params, value]. */
function parse(text: string): Node {
  expect(text.endsWith('\r\n')).toBe(true);
  const lines = text.slice(0, -2).split('\r\n');
  const un: string[] = [];
  for (const l of lines) { if (l.startsWith(' ')) un[un.length - 1] += l.slice(1); else un.push(l); }
  const root: Node = { name: 'ROOT', props: [], kids: [] };
  const stack = [root];
  for (const l of un) {
    const c = l.indexOf(':');
    const head = l.slice(0, c), value = l.slice(c + 1);
    const [name, ...params] = head.split(';');
    if (name === 'BEGIN') { const n: Node = { name: value, props: [], kids: [] }; stack.at(-1)!.kids.push(n); stack.push(n); }
    else if (name === 'END') { expect(stack.at(-1)!.name).toBe(value); stack.pop(); }
    else stack.at(-1)!.props.push([name!, params.join(';'), value]);
  }
  expect(stack).toHaveLength(1);
  return root.kids[0]!;
}
const prop = (n: Node, k: string) => n.props.find(p => p[0] === k);
const kids = (n: Node, name: string) => n.kids.filter(k => k.name === name);

describe('line format', () => {
  it('uses CRLF everywhere and starts and ends the calendar', () => {
    const text = icsFor([ev({}), ev({ id: 'launch:2026-10-20:0', kind: 'launch', launch: { k: 'start', n: 0 }, title: undefined, dur: undefined })], opts());
    expect(text.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    const cal = parse(text);
    expect(prop(cal, 'VERSION')![2]).toBe('2.0');
    expect(prop(cal, 'PRODID')).toBeTruthy();
    expect(prop(cal, 'CALSCALE')![2]).toBe('GREGORIAN');
  });

  it('folds at 75 octets without splitting é or an emoji', () => {
    for (const unit of ['é', '🙂', 'a', 'Ω']) {
      for (let pad = 0; pad < 6; pad++) {
        const line = 'SUMMARY:' + 'x'.repeat(pad) + unit.repeat(80);
        const parts = fold(line);
        for (const p of parts) expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75);
        for (const p of parts) expect(p).not.toContain('�');
        expect(parts.map((p, i) => (i ? p.slice(1) : p)).join('')).toBe(line);
        expect(parts.slice(1).every(p => p.startsWith(' '))).toBe(true);
      }
    }
    expect(fold('SHORT:line')).toEqual(['SHORT:line']);
    // The boundary case: a 2-byte letter whose second byte would be octet 76.
    const edge = 'S:' + 'a'.repeat(72) + 'é';
    expect(fold(edge)[0]).toBe('S:' + 'a'.repeat(72));
    expect(fold(edge)[1]).toBe(' é');
  });

  it('escapes backslash, semicolon, comma and newlines in text', () => {
    expect(escapeText('a\\b;c,d\ne\r\nf')).toBe('a\\\\b\\;c\\,d\\ne\\nf');
    const cal = parse(icsFor([ev({ title: 'Choir; room 3, floor 2\nbring music' })], opts()));
    expect(prop(kids(cal, 'VEVENT')[0]!, 'SUMMARY')![2]).toBe('Choir\\; room 3\\, floor 2\\nbring music');
  });

  it('keeps the same UIDs across runs, and different ones for different events', () => {
    const a = icsFor([ev({}), ev({ id: 'fixed:y:2026-10-21' })], opts());
    const b = icsFor([ev({}), ev({ id: 'fixed:y:2026-10-21' })], opts({ now: NOW + 5 * 86_400_000 }));
    const uids = (t: string) => parse(t).kids.filter(k => k.name === 'VEVENT').map(k => prop(k, 'UID')![2]);
    expect(uids(a)).toEqual(uids(b));
    expect(uids(a)).toEqual(['fixed:x:2026-10-20@reussite.local', 'fixed:y:2026-10-21@reussite.local']);
    expect(a).toBe(icsFor([ev({}), ev({ id: 'fixed:y:2026-10-21' })], opts()));
  });
});

describe('events', () => {
  it('makes a launch point a 5-minute event and an obligation as long as its duration', () => {
    const cal = parse(icsFor([
      ev({ id: 'launch:2026-10-20:0', kind: 'launch', at: Date.parse('2026-10-20T06:30:00Z'), time: '08:30', launch: { k: 'start', n: 0 }, title: undefined, dur: undefined }),
      ev({}), ev({ id: 'fixed:z:2026-10-20', dur: null }),
    ], opts()));
    const [l, c, d] = kids(cal, 'VEVENT');
    expect(prop(l!, 'DTSTART')).toEqual(['DTSTART', 'TZID=Europe/Paris', '20261020T083000']);
    expect(prop(l!, 'DTEND')![2]).toBe('20261020T083500');
    expect(prop(l!, 'SUMMARY')![2]).toBe('▶ Start');
    expect(prop(c!, 'DTSTART')![2]).toBe('20261020T190000');
    expect(prop(c!, 'DTEND')![2]).toBe('20261020T203000');
    expect(DEFAULT_FIXED_MINUTES).toBe(60);
    expect(prop(d!, 'DTEND')![2]).toBe('20261020T200000');
  });

  it('puts the leave-by time in the description and the launch note in its title', () => {
    const cal = parse(icsFor([ev({ lead: 30 }), ev({ id: 'launch:2026-10-20:1', kind: 'launch', launch: { k: 'restart', n: 1, note: 'taxes' }, lead: undefined, dur: undefined })], opts()));
    const [c, l] = kids(cal, 'VEVENT');
    expect(prop(c!, 'DESCRIPTION')![2]).toBe('leave at 18:30');
    expect(prop(l!, 'SUMMARY')![2]).toBe('↻ Restart · taxes');
  });

  it('puts a VALARM at the start of each event, or none without alarms', () => {
    const on = kids(parse(icsFor([ev({})], opts())), 'VEVENT')[0]!;
    const al = kids(on, 'VALARM');
    expect(al).toHaveLength(1);
    expect(prop(al[0]!, 'TRIGGER')![2]).toBe('-PT0M');
    expect(prop(al[0]!, 'ACTION')![2]).toBe('DISPLAY');
    expect(prop(al[0]!, 'DESCRIPTION')).toBeTruthy();
    const text = icsFor([ev({})], opts({ withAlarms: false }));
    expect(text).not.toContain('VALARM');
  });

  it('exports only launch points and obligations', () => {
    const cal = parse(icsFor([ev({}), ev({ id: 'checkin:2026-10-20', kind: 'checkin' }), ev({ id: 'close:x', kind: 'close' }), ev({ id: 'review:x', kind: 'review' }), ev({ id: 'decision:d:x', kind: 'decision' })], opts()));
    expect(kids(cal, 'VEVENT')).toHaveLength(1);
  });

  it('can use generic titles that say nothing about the step', () => {
    const text = icsFor([ev({ title: 'Secret therapy' }), ev({ id: 'launch:a:0', kind: 'launch', launch: { k: 'start', n: 0, note: 'secret' } })], opts({ titles: genericTitles(itr), withAlarms: false }));
    expect(text).not.toMatch(/Secret|secret|leave at/i);
    expect(text).toContain('SUMMARY:Fixed time');
    expect(text).toContain('SUMMARY:▶ Start\r\n');
  });
});

describe('time zones', () => {
  const choirWeek = (extra = {}) => {
    const w = { tasks: [choir()], ...extra };
    return agenda(state(w), settings(), '2026-10-19', '2026-11-02');
  };

  it('writes TZID and a VTIMEZONE for Paris with the change on 25 October 2026', () => {
    const cal = parse(icsFor(choirWeek(), opts()));
    const ev2 = kids(cal, 'VEVENT');
    expect(ev2.map(e => prop(e, 'DTSTART')![2])).toEqual(['20261019T190000', '20261026T190000', '20261102T190000']);
    expect(ev2.every(e => prop(e, 'DTSTART')![1] === 'TZID=Europe/Paris')).toBe(true);
    const tz = kids(cal, 'VTIMEZONE');
    expect(tz).toHaveLength(1);
    expect(prop(tz[0]!, 'TZID')![2]).toBe('Europe/Paris');
    const std = kids(tz[0]!, 'STANDARD').find(s => prop(s, 'DTSTART')![2] === '20261025T030000')!;
    expect(prop(std, 'TZOFFSETFROM')![2]).toBe('+0200');
    expect(prop(std, 'TZOFFSETTO')![2]).toBe('+0100');
  });

  it('gives a zone without daylight-saving time a single STANDARD', () => {
    const tokyo = place('tokyo', 'Asia/Tokyo');
    const e = agenda(state({ tasks: [choir()], places: [tokyo], stays: [stay('s', 'tokyo', '2026-10-01', '2026-12-01')] }), settings(), '2026-10-19', '2026-10-26');
    const tz = kids(parse(icsFor(e, opts())), 'VTIMEZONE')[0]!;
    expect(tz.kids.map(k => k.name)).toEqual(['STANDARD']);
    expect(prop(tz.kids[0]!, 'TZOFFSETTO')![2]).toBe('+0900');
  });

  it('knows Cairo, which falls back on 29 October 2026', () => {
    const e = agenda(state({ tasks: [choir({ weekdays: [1, 2, 3, 4, 5, 6, 7] })], stays: [stay('s', 'cairo', '2026-10-01', '2026-12-01')] }), settings(), '2026-10-27', '2026-11-02');
    const cal = parse(icsFor(e, opts()));
    const tz = kids(cal, 'VTIMEZONE')[0]!;
    expect(prop(tz, 'TZID')![2]).toBe('Africa/Cairo');
    const change = tz.kids.find(k => k.name === 'STANDARD' && prop(k, 'DTSTART')![2] !== '19700101T000000')!;
    expect(prop(change, 'TZOFFSETFROM')![2]).toBe('+0300');
    expect(prop(change, 'TZOFFSETTO')![2]).toBe('+0200');
    expect(kids(cal, 'VEVENT').every(x => prop(x, 'DTSTART')![2].endsWith('T190000'))).toBe(true);
  });

  it('writes both zones when a stay switches zone in the middle of the week', () => {
    const e = agenda(
      state({ tasks: [choir({ weekdays: [1, 2, 3, 4, 5, 6, 7] })], stays: [stay('s', 'cairo', '2026-10-22', '2026-10-31')] }),
      settings(), '2026-10-20', '2026-10-24',
    );
    const cal = parse(icsFor(e, opts()));
    expect(kids(cal, 'VTIMEZONE').map(z => prop(z, 'TZID')![2])).toEqual(['Africa/Cairo', 'Europe/Paris']);
    const by = Object.fromEntries(kids(cal, 'VEVENT').map(x => [prop(x, 'UID')![2], prop(x, 'DTSTART')!]));
    expect(by['fixed:choir:2026-10-21@reussite.local']).toEqual(['DTSTART', 'TZID=Europe/Paris', '20261021T190000']);
    expect(by['fixed:choir:2026-10-22@reussite.local']).toEqual(['DTSTART', 'TZID=Africa/Cairo', '20261022T190000']);
  });

  it('uses the device zone for events that have none', () => {
    const cal = parse(icsFor([ev({ zone: undefined })], opts({ deviceZone: 'America/New_York' })));
    expect(prop(kids(cal, 'VEVENT')[0]!, 'DTSTART')![1]).toBe('TZID=America/New_York');
    expect(prop(kids(cal, 'VTIMEZONE')[0]!, 'TZID')![2]).toBe('America/New_York');
  });
});

describe('golden file', () => {
  it('matches tests/fixtures/ics/week.ics', () => {
    const e = agenda(
      state({
        tasks: [choir(), task('visit', { title: 'Dentist, Dr. Martin; 2nd floor — é🙂 with a long title that has to be folded somewhere past the limit', at: '09:15', due: '2026-10-22', dur: 45 })],
        days: [day('2026-10-20', { launches: [{ t: '08:30', k: 'start' }, { t: '14:00', k: 'restart', n: 'Taxes' }] })],
        stays: [stay('s', 'cairo', '2026-10-26', '2026-10-31')],
      }),
      settings(), '2026-10-19', '2026-10-28',
    ).filter(x => x.kind !== 'checkin' && x.kind !== 'close');
    const text = icsFor(e, opts({ name: 'Réussite' }));
    const path = new URL('../../tests/fixtures/ics/week.ics', import.meta.url);
    if (process.env.UPDATE_GOLDEN || !existsSync(path)) writeFileSync(path, text);
    expect(text).toBe(readFileSync(path, 'utf8'));
    parse(text);
  });
});
