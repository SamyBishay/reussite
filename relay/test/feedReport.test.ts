import { describe, expect, it } from 'vitest';
import { reportFeeds, renderReport, shortId, type FeedRow } from '../src/feedReport';
import { FEED_STALE_MS } from '../../src/feed/protocol';

const NOW = Date.UTC(2026, 10, 10, 12, 0);
const DAY = 86_400_000;
const live = 'L'.repeat(8) + 'liveLIVELIVELIVELIVELIVELIVEx';
const old = 'O'.repeat(8) + 'oldOLDOLDOLDOLDOLDOLDOLDOLDOy';
const rows: FeedRow[] = [
  { fid: live, alias: null, bytes: 20_000, events: 48, updated: NOW - 3_600_000, fetched: NOW - 600_000, fetchedBy: 'Google Calendar' },
  { fid: old, alias: live, bytes: 0, events: 0, updated: NOW - 13 * DAY, fetched: null, fetchedBy: null },
];

describe('the feed report', () => {
  it('shows only a short form of each address', () => {
    expect(shortId(live)).toBe('LLLLLL…Lx'.replace('Lx', live.slice(-2)));
    const text = renderReport(reportFeeds(rows, NOW));
    expect(text).not.toContain(live);
    expect(text).not.toContain(old);
  });
  it('says when each was written and fetched, and by what; no log is said plainly', () => {
    const [a, b] = reportFeeds(rows, NOW);
    expect(a!.fetched).toContain('2026-11-10 11:50 UTC (0 days ago)');
    expect(a!.fetchedBy).toBe('Google Calendar');
    expect(b!.fetched).toContain('not logged');
    expect(b!.writtenDaysAgo).toBe(13);
  });
  it('marks a feed nobody has written for the relay\'s stale time, and explains an old address that follows a live feed', () => {
    const stale: FeedRow = { fid: 'S'.repeat(32), alias: null, bytes: 9000, events: 12, updated: NOW - FEED_STALE_MS - DAY, fetched: NOW - 2 * DAY, fetchedBy: 'Apple Calendar' };
    const lines = reportFeeds([...rows, stale], NOW);
    expect(lines.filter(l => l.stopped && l.kind === 'feed').map(l => l.id)).toEqual([shortId(stale.fid)]);
    const text = renderReport(lines);
    expect(text).toContain('▶ STOPPED SYNCING');
    expect(text).toContain('out of date');
    expect(lines.find(l => l.kind === 'alias')!.note).toContain('serves that feed');
  });
  it('an address pointing at a feed that is gone says it serves nothing; no rows is said calmly', () => {
    const [x] = reportFeeds([{ ...rows[1]!, alias: 'Z'.repeat(32) }], NOW);
    expect(x!.note).toContain('serves nothing');
    expect(renderReport([])).toBe('No calendar feed on the relay.');
  });
});
