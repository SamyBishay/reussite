import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { day, state, task, settings as agendaSettings, tr } from '../domain/agenda.fixture';
import type { IcsTranslate } from '../domain/ics';
import type { FeedDetail } from '../domain/calItems';
import { feedText } from './feed';

const itr = tr as unknown as IcsTranslate;

describe('planned cards in the feed', () => {
  const plan = state({
    tasks: ['a', 'b', 'c'].map(id => task(id, { title: 'Open the file ' + id, est: 30, label: 'file ' + id })),
    days: [day('2026-10-22', { plan: ['a', 'b', 'c'], launches: [{ t: '09:30', k: 'start' }] })],
  });
  const feed = (detail: FeedDetail) => feedText(plan, agendaSettings(), '2026-10-21', detail, itr, Date.parse('2026-10-21T08:00:00Z'));

  it('lays them out from the launch point as timed, transparent events with no reminder, not as all-day events', () => {
    const t = feed('labels');
    expect(t).toContain('DTSTART;TZID=Europe/Paris:20261022T093000');
    expect(t).toContain('DTSTART;TZID=Europe/Paris:20261022T100000');
    expect(t).toContain('DTEND;TZID=Europe/Paris:20261022T110000');
    expect(t).not.toContain('VALUE=DATE');
    expect(t).not.toContain('VALARM');
    expect(t).toContain('TRANSP:TRANSPARENT');
    expect(t).toContain('SUMMARY:file a');
    expect(t).toContain('UID:plan:a:2026-10-22@');
  });

  it('says only "Planned step" at the times level', () => {
    const t = feed('times');
    expect(t.match(/SUMMARY:Planned step/g)).toHaveLength(3);
    expect(t).not.toContain('file a');
  });

  it('keeps a step that is due and not planned as an all-day event', () => {
    const w = state({ tasks: [task('d', { due: '2026-10-23', est: 30, label: 'rent' })] });
    const t = feedText(w, agendaSettings(), '2026-10-21', 'labels', itr, 0);
    expect(t).toContain('DTSTART;VALUE=DATE:20261023');
    expect(t).toContain('SUMMARY:rent');
  });
});
