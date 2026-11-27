// Optional local metadata keyed by document and field clock. The clock ties a label to
// precisely the value that sync sends. Keep only clocks still present on the document.
import type { ReussiteDb } from './db';
import { parse } from './hlc';
import type { Collection } from './schema';
import type { ChangeDoc, StoredDoc } from '../sync/protocol';

const keyOf = (c: Collection, id: string) => 'sync.cause/' + c + '/' + id;
const clocksOf = (d: StoredDoc) => new Set([...Object.values(d._hlc), ...(d._del ? [d._del] : [])]);

/** Call in the same IndexedDB transaction as the document write. */
export async function recordCause(db: ReussiteDb, c: Collection, before: StoredDoc | undefined, after: StoredDoc, cause: string): Promise<void> {
  const oldClocks = before ? clocksOf(before) : new Set<string>();
  const clocks = clocksOf(after);
  if (clocks.size === oldClocks.size && [...clocks].every(h => oldClocks.has(h))) return;
  const key = keyOf(c, after.id);
  const old = (await db.local.get(key))?.value as ChangeDoc['causes'];
  const value = Object.fromEntries([...clocks].flatMap(h => {
    const label = oldClocks.has(h) ? old?.[h] : cause.slice(0, 64);
    return label ? [[h, label]] : [];
  }));
  await db.local.put({ key, value });
}

export async function attachCauses(db: ReussiteDb, docs: ChangeDoc[]): Promise<void> {
  // The same document can be present on different devices. This table is device-local,
  // and a label only applies if the outgoing delta contains its original clock.
  const labels = await db.local.bulkGet(docs.map(({ c, d }) => keyOf(c, d.id)));
  docs.forEach((entry, i) => {
    const own = labels[i]?.value as ChangeDoc['causes'];
    entry.causes = Object.fromEntries([...clocksOf(entry.d)].map(h =>
      [h, own?.[h] ?? (parse(h).node === '0' ? 'import/restore' : 'sync')]));
  });
}
