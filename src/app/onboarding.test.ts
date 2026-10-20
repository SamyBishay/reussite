import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { ReussiteDb, setLocal } from '../data/db';
import { create, remove } from '../data/doc';
import { createClock, tick } from '../data/hlc';
import { makeBackup, restoreBackup } from '../data/backup';
import { SCHEMA_VERSION } from '../data/schema';
import { FLAG, SYNC_KEY, onboardingWhy, recordOnboarded } from './onboarding';

let n = 0;
const fresh = () => new ReussiteDb('onboarding-' + ++n);
const clock = createClock('node');
const doc = (fields: object, id = 'x') => create(id, fields, SCHEMA_VERSION, tick(clock)) as never;

describe('when onboarding shows', () => {
  it('shows on a device with nothing: only this device\'s own bookkeeping is there', async () => {
    const d = fresh();
    await setLocal(d, 'node', 'abc');
    await setLocal(d, 'schema', SCHEMA_VERSION);
    await setLocal(d, 'app.firstSeen', Date.now());
    await setLocal(d, 'aiKey.anthropic', 'sk-test'); // a key typed during onboarding is not data
    expect(await onboardingWhy(d)).toBe('new');
  });

  it('never shows once there is a task, a place, a day, a memory note, or a settings document', async () => {
    for (const [c, fields] of [['tasks', { title: 'A' }], ['places', { name: 'Home' }], ['days', { plan: [] }], ['memory', { name: 'N' }], ['meta', { language: 'fr' }], ['people', { name: 'P' }]] as const) {
      const d = fresh();
      await d.table_(c).put(doc(fields));
      expect(await onboardingWhy(d), c).toBe('data');
    }
  });

  it('counts a deleted document as data: something was there', async () => {
    const d = fresh();
    await d.table_('tasks').put(remove(doc({ title: 'A' }), clock) as never);
    expect(await onboardingWhy(d)).toBe('data');
  });

  it('never shows after an existing backup is restored', async () => {
    const from = fresh();
    await from.table_('tasks').put(doc({ title: 'A' }, 't1'));
    await from.table_('places').put(doc({ name: 'Home' }, 'p1'));
    const file = await makeBackup(from);
    const to = fresh();
    expect(await onboardingWhy(to)).toBe('new');
    await restoreBackup(to, file);
    expect(await onboardingWhy(to)).toBe('data');
  });

  it('never shows on a device with a sync key: a second device that pairs does not run it', async () => {
    const d = fresh();
    await setLocal(d, SYNC_KEY, 'AAAA');
    expect(await onboardingWhy(d)).toBe('sync');
  });

  it('never shows twice: finished, skipped or recorded as existing', async () => {
    for (const how of ['done', 'skipped', 'existing'] as const) {
      const d = fresh();
      expect(await onboardingWhy(d)).toBe('new');
      await recordOnboarded(d, how);
      expect(await d.local.get(FLAG)).toMatchObject({ value: how });
      expect(await onboardingWhy(d)).toBe('flag');
    }
  });

  it('the mirror in localStorage counts as a record', async () => {
    expect(await onboardingWhy(fresh(), true)).toBe('flag');
  });
});
