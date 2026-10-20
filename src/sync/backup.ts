// Encrypted backup files: the same backup as the plain JSON one, sealed with the space key
// (AES-GCM, authenticated with the space id), so it opens on any device that holds the key.
import type { BackupFile } from '../data/backup';
import { openFromText, sealToText, type Sealer } from './crypto';

export interface EncryptedBackupFile { format: 'reussite-backup-encrypted'; v: 1; exported: string; blob: string }

export const isEncryptedBackup = (raw: unknown): raw is EncryptedBackupFile =>
  !!raw && typeof raw === 'object' && (raw as { format?: unknown }).format === 'reussite-backup-encrypted' && typeof (raw as { blob?: unknown }).blob === 'string';

export async function sealBackup(keys: Sealer, file: BackupFile): Promise<EncryptedBackupFile> {
  return { format: 'reussite-backup-encrypted', v: 1, exported: file.exported, blob: await sealToText(keys, file) };
}

/** The plain backup inside; throws DecryptError if the key is not the one it was made with. */
export const openBackup = (keys: Sealer, file: EncryptedBackupFile): Promise<unknown> => openFromText(keys, file.blob);
