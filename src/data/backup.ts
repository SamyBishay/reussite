// Backup files (brief §7, Data): every synced collection, deletions included, with clocks,
// so restoring merges cleanly. Plain JSON in phase 0; encrypted export arrives with the keys in phase 3.
import { COLLECTIONS, SCHEMA_VERSION, type Collection } from './schema';
import { type ReussiteDb, dumpAll } from './db';
import { merge, type Stored } from './doc';
import { migrateData, type Data } from './migrations';

export interface BackupFile { format: 'reussite-backup'; schema: number; exported: string; data: Record<string, unknown[]> }

export async function makeBackup(db: ReussiteDb): Promise<BackupFile> {
  return { format: 'reussite-backup', schema: SCHEMA_VERSION, exported: new Date().toISOString(), data: await dumpAll(db, COLLECTIONS) };
}

export function parseBackup(raw: unknown): BackupFile {
  const f = raw as Partial<BackupFile> | null;
  if (!f || f.format !== 'reussite-backup' || typeof f.schema !== 'number' || typeof f.data !== 'object' || !f.data) throw new Error('not a Réussite backup');
  if (f.schema > SCHEMA_VERSION) throw new Error('made by a newer version of Réussite; reload first');
  return f as BackupFile;
}

/** Merge a backup into the database (newer edits on either side win), after backing up what's here. */
export async function restoreBackup(db: ReussiteDb, file: BackupFile): Promise<Record<string, number>> {
  const data = migrateData(file.data as Data, file.schema);
  await db.backups.add({ at: new Date().toISOString(), reason: 'before restoring a backup', schema: SCHEMA_VERSION, data: await dumpAll(db, COLLECTIONS) });
  const counts: Record<string, number> = {};
  await db.transaction('rw', COLLECTIONS.map(c => db.table_(c)), async () => {
    for (const c of COLLECTIONS as readonly Collection[]) {
      const docs = ((data[c] ?? []) as Stored<Record<string, unknown>>[]).filter(d => d && typeof d.id === 'string' && d._hlc);
      counts[c] = docs.length;
      if (!docs.length) continue;
      const existing = await db.table_(c).bulkGet(docs.map(d => d.id));
      await db.table_(c).bulkPut(docs.map((d, i) => (existing[i] ? merge(existing[i]!, d) : d)));
    }
  });
  return counts;
}

/** Hand a file to the person: the share sheet on phones where it can take files, else a download. */
export async function saveFile(name: string, text: string, type = 'application/json'): Promise<void> {
  const file = new File([text], name, { type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (/iPhone|iPad|Android/i.test(nav.userAgent) && nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file] }); return; } catch (e) { if ((e as Error).name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const readFileText = (f: File) => f.text();
