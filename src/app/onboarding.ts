// First-run onboarding: when it shows, and what it leaves behind (brief §12). It shows on a device that has
// no data at all and no record of having finished it, and never on one that has anything: a task, a place,
// a changed setting, a synced space. The record is device-local (`local`, never synced), plus a mirror in
// localStorage that is read before the database is: a second device that pairs has a sync key, so it never
// runs it either.
import { signal } from '@preact/signals';
import { COLLECTIONS } from '../data/schema';
import { getLocal, setLocal, type ReussiteDb } from '../data/db';
import { db } from './store';

export const FLAG = 'onboarding';
export const SYNC_KEY = 'sync.key';
const MIRROR = 'reussite.onboarded';

/** 'pending' until the check at start has run; 'show' on a new device; 'off' everywhere else. */
export const onboarding = signal<'pending' | 'show' | 'off'>('pending');

/** Why it does or does not show. `new` is the only reason it shows. */
export type Why = 'flag' | 'sync' | 'data' | 'new';

const mirrored = (): boolean => { try { return localStorage.getItem(MIRROR) === '1'; } catch { return false; } };

/** The decision, with no side effects. `mirror`: the localStorage record, read by the caller. */
export async function onboardingWhy(d: ReussiteDb, mirror = false): Promise<Why> {
  if (mirror || (await getLocal<string>(d, FLAG))) return 'flag';
  if (await getLocal<string>(d, SYNC_KEY)) return 'sync';
  // Tombstones count: a deleted document is still something that was there.
  for (const c of COLLECTIONS) if ((await d.table_(c).count()) > 0) return 'data';
  return 'new';
}

/** Record that the person is past onboarding (finished, skipped, or already had data). */
export async function recordOnboarded(d: ReussiteDb, how: 'done' | 'skipped' | 'existing'): Promise<void> {
  await setLocal(d, FLAG, how);
  try { localStorage.setItem(MIRROR, '1'); } catch { /* the database record is enough */ }
}

/** Run once after `start()`. An existing install is recorded as such, so wiping its list later never starts onboarding. */
export async function decideOnboarding(): Promise<Why> {
  const why = await onboardingWhy(db, mirrored());
  if (why === 'sync' || why === 'data') await recordOnboarded(db, 'existing');
  onboarding.value = why === 'new' ? 'show' : 'off';
  return why;
}

export async function finishedOnboarding(how: 'done' | 'skipped'): Promise<void> {
  await recordOnboarded(db, how);
  onboarding.value = 'off';
}
