// A report of the calendar feed addresses on the relay (10 Nov 2026): for each, when it was last written, when it was last fetched and by what kind of
// calendar app (if that is logged), and which one stopped syncing. Pure, so it can be tested; `relay/scripts/feeds.ts` reads the rows and prints it.
// It lists and marks; it deletes nothing. Only a short form of each address is ever printed (the whole address is what keeps a feed private).
import { FEED_STALE_MS } from '../../src/feed/protocol';

export interface FeedRow {
  fid: string; alias: string | null; bytes: number; events: number;
  /** ms of the last write. */
  updated: number;
  /** ms of the last logged fetch; null when none is logged (fetches were not logged before 10 Nov 2026). */
  fetched: number | null; fetchedBy: string | null;
}

export interface FeedLine {
  id: string; kind: 'feed' | 'alias'; pointsAt: string | null; written: string; writtenDaysAgo: number; fetched: string; fetchedBy: string; events: number;
  /** Nothing has written this address for FEED_STALE_MS (an alias counts from the day it was pointed at the list's feed): the one that stopped syncing. */
  stopped: boolean;
  note: string;
}

/** The first six characters and the last two: enough to tell addresses apart, not enough to open one. */
export const shortId = (fid: string): string => fid.slice(0, 6) + '…' + fid.slice(-2);
const DAY = 86_400_000;
const day = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

export function reportFeeds(rows: readonly FeedRow[], now = Date.now()): FeedLine[] {
  const byId = new Map(rows.map(r => [r.fid, r]));
  return [...rows].sort((a, b) => b.updated - a.updated).map(r => {
    const ageDays = Math.floor((now - r.updated) / DAY);
    const target = r.alias ? byId.get(r.alias) : undefined;
    const stopped = now - r.updated >= FEED_STALE_MS;
    let note = '';
    if (r.alias) note = target
      ? `an old address: it was pointed at ${shortId(r.alias)} on ${day(r.updated)} and serves that feed's text, so it is current even though nothing has written to it since`
      : `an old address pointing at ${shortId(r.alias)}, which is not on the relay: it serves nothing`;
    else if (stopped) note = `nothing has written this feed for ${ageDays} days: a calendar subscribed to it shows an "out of date" event`;
    return {
      id: shortId(r.fid), kind: r.alias ? 'alias' : 'feed', pointsAt: r.alias ? shortId(r.alias) : null,
      written: day(r.updated), writtenDaysAgo: ageDays,
      fetched: r.fetched ? `${day(r.fetched)} (${Math.floor((now - r.fetched) / DAY)} days ago)` : 'not logged (fetches are logged from the day the relay was updated, 10 Nov 2026)',
      fetchedBy: r.fetchedBy ?? '—', events: r.events, stopped, note,
    };
  });
}

/** The lines as text, one block per address; the one that stopped syncing is marked. */
export function renderReport(lines: readonly FeedLine[]): string {
  if (!lines.length) return 'No calendar feed on the relay.';
  return lines.map(l => [
    `${l.stopped ? '▶ STOPPED SYNCING  ' : '                   '}${l.id}  (${l.kind}${l.pointsAt ? ' → ' + l.pointsAt : ''})`,
    `    last written: ${l.written} (${l.writtenDaysAgo} days ago)`,
    `    last fetched: ${l.fetched}${l.fetchedBy !== '—' ? ' by ' + l.fetchedBy : ''}`,
    `    events: ${l.events}`,
    l.note ? `    ${l.note}` : '',
  ].filter(Boolean).join('\n')).join('\n\n');
}
