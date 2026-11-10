// List the calendar feed addresses on the relay (10 Nov 2026): when each was last written and last fetched, and which one stopped syncing.
//   npm --prefix relay run feeds            the live relay (read-only: one SELECT, nothing is changed or deleted)
//   npm --prefix relay run feeds -- --local the local dev database
// It prints a short form of each address, never the whole one, and no calendar text.
import { execFileSync } from 'node:child_process';
import { reportFeeds, renderReport, type FeedRow } from '../src/feedReport';

const where = process.argv.includes('--local') ? '--local' : '--remote';
const run = (sql: string): Record<string, unknown>[] => {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', where, '--json', '--command', sql], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] });
  const parsed = JSON.parse(out.slice(out.indexOf('['))) as { results: Record<string, unknown>[] }[];
  return parsed[0]?.results ?? [];
};

// Fetches are logged from migration 0009; before it is applied the columns are not there.
const cols = new Set(run('PRAGMA table_info(feeds)').map(c => String(c.name)));
const logged = cols.has('fetched');
const rows = run(
  'SELECT fid, alias, length(ics) AS bytes, (length(ics) - length(replace(ics, \'BEGIN:VEVENT\', \'\'))) / 12 AS events, updated' +
  (logged ? ', fetched, fetched_by' : '') + ' FROM feeds',
).map((r): FeedRow => ({
  fid: String(r.fid), alias: r.alias ? String(r.alias) : null, bytes: Number(r.bytes) || 0, events: Number(r.events) || 0, updated: Number(r.updated) || 0,
  fetched: r.fetched ? Number(r.fetched) : null, fetchedBy: r.fetched_by ? String(r.fetched_by) : null,
}));

console.log(`${rows.length} feed address${rows.length === 1 ? '' : 'es'} on the ${where === '--local' ? 'local' : 'live'} relay${logged ? '' : ' (fetches are not logged yet: apply migration 0009)'}\n`);
console.log(renderReport(reportFeeds(rows)));
