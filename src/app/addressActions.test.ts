import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { addresses, createDoc, db, people, start, tasks, settings, saveSettings, today } from './store';
import { createAddress, createPerson, editAddress, editPerson, editVisit, finishTask, recordVisit, removeAddress, removePerson, setLastSeen } from './actions';
import { addressesIn, addressesOn, categories, categoryName, offerAddressesNow, offerPeopleNow, peopleIn } from './model';
import { newTaskFields } from '../domain/effects';
import { DEFAULT_ADDRESS_CATEGORIES, withDefaults } from '../data/settings';
import type { Task } from '../data/schema';

const settle = () => new Promise(r => setTimeout(r, 40));
beforeAll(async () => { await start(); });

const step = (extra: Partial<Task>) => createDoc<Task>('tasks', newTaskFields('Coffee', 'H', null, extra, new Map(), new Date().toISOString(), Date.now()));
const open = async (id: string) => { await settle(); return tasks.value.get(id)!; };

describe('addresses', () => {
  it('creates with defaults, edits, and removes with a tombstone', async () => {
    const id = await createAddress({ name: '  Chez Zed ', placeId: 'paris', mapsUrl: 'https://maps.apple.com/?q=Zed' });
    await settle();
    expect(addresses.value.get(id)).toMatchObject({ name: 'Chez Zed', category: 'other', placeId: 'paris', state: 'want', visits: [], by: 'me', note: '', street: null });
    await editAddress(id, { category: 'food', note: 'Ask for the corner table' });
    await settle();
    expect(addresses.value.get(id)).toMatchObject({ category: 'food', note: 'Ask for the corner table' });
    expect(addressesIn('paris').map(a => a.id)).toContain(id);
    expect(addressesIn('lyon').map(a => a.id)).not.toContain(id);
    await removeAddress(id);
    await settle();
    expect(addresses.value.has(id)).toBe(false);
    expect((await db.addresses.get(id))!._del).toBeTruthy();
  });

  it('records visits: the address becomes been, a visit from the same step is written once, edit and remove work', async () => {
    const id = await createAddress({ name: 'Le Nid', placeId: 'paris' });
    const v1 = await recordVisit(id, { note: ' cosy ', verdict: 'again', day: '2026-10-01', stepId: 's1' });
    await settle();
    expect(addresses.value.get(id)).toMatchObject({ state: 'been', visits: [{ id: v1, day: '2026-10-01', note: 'cosy', verdict: 'again', stepId: 's1' }] });
    // opened twice from the same step: one visit, the later words
    expect(await recordVisit(id, { note: 'cosy, but loud', verdict: 'maybe', day: '2026-10-01', stepId: 's1' })).toBe(v1);
    const v2 = await recordVisit(id, { verdict: 'not-again' });
    await settle();
    const a = addresses.value.get(id)!;
    expect(a.visits.map(v => [v.verdict, v.note])).toEqual([['maybe', 'cosy, but loud'], ['not-again', '']]);
    expect(a.visits[1]).toMatchObject({ id: v2, day: today.value, stepId: null });
    await editVisit(id, v2!, { verdict: 'again', note: 'second thoughts' });
    await editVisit(id, v1!, null);
    await settle();
    expect(addresses.value.get(id)!.visits).toMatchObject([{ id: v2, verdict: 'again', note: 'second thoughts' }]);
    expect(await recordVisit('missing', { verdict: 'again' })).toBeNull();
  });

  it('a done step that feeds an address says to ask for the visit, until a visit came from it', async () => {
    const aid = await createAddress({ name: 'Parc', placeId: 'any' });
    const sid = await step({ addressId: aid });
    await settle();
    const done = await finishTask(await open(sid), null);
    expect(done.addressId).toBe(aid);
    await recordVisit(aid, { verdict: 'again', stepId: sid });
    await settle();
    expect((await finishTask(await open(await step({ addressId: aid })), null)).addressId).toBe(aid); // another step: asks again
    const again = await step({ addressId: aid });
    await recordVisit(aid, { verdict: 'maybe', stepId: again });
    await settle();
    expect((await finishTask(await open(again), null)).addressId).toBeNull();
    expect((await finishTask(await open(await step({})), null)).addressId).toBeNull();
  });
});

describe('people', () => {
  it('creates, edits, sets last seen, and removes with a tombstone; there is no home address', async () => {
    const id = await createPerson({ name: 'Ibrahim', placeId: 'paris', reach: 'whatsapp://send?phone=1' });
    await settle();
    expect(people.value.get(id)).toMatchObject({ name: 'Ibrahim', reach: 'whatsapp://send?phone=1', note: '', lastSeen: null });
    expect(Object.keys(people.value.get(id)!).some(k => /address|street|home/i.test(k))).toBe(false);
    await editPerson(id, { note: 'Moves in March' });
    await setLastSeen(id, '2026-10-05');
    await settle();
    expect(people.value.get(id)).toMatchObject({ note: 'Moves in March', lastSeen: '2026-10-05' });
    expect(peopleIn('paris').map(p => p.id)).toContain(id);
    await removePerson(id);
    await settle();
    expect(people.value.has(id)).toBe(false);
    expect((await db.people.get(id))!._del).toBeTruthy();
  });

  it('a done step that feeds a person sets their last seen to that day, never back to an earlier one', async () => {
    const pid = await createPerson({ name: 'Léa', placeId: 'any', lastSeen: '2026-09-01' });
    await settle();
    const s1 = await step({ personId: pid });
    await finishTask(await open(s1), null, '2026-10-10');
    await settle();
    expect(people.value.get(pid)!.lastSeen).toBe('2026-10-10');
    // a step ticked for an earlier day does not move it back
    await finishTask(await open(await step({ personId: pid })), null, '2026-10-03');
    await settle();
    expect(people.value.get(pid)!.lastSeen).toBe('2026-10-10');
    // today
    await finishTask(await open(await step({ personId: pid })), null);
    await settle();
    expect(people.value.get(pid)!.lastSeen).toBe(today.value);
    // a person who is gone does not stop the step from being done
    const gone = await step({ personId: 'nobody' });
    await finishTask(await open(gone), null);
    expect((await open(gone)).status).toBe('done');
  });
});

describe('what the planner offers, and the module switch', () => {
  it('offers addresses and people of the place; off, nothing', async () => {
    await createAddress({ name: 'Offer Cafe', placeId: 'rome', category: 'cafe' });
    await createAddress({ name: 'Offer Museum', placeId: 'rome', category: 'museum' });
    await createPerson({ name: 'Offer Person', placeId: 'rome' });
    await settle();
    expect(offerAddressesNow(null, 'rome').map(a => a.name)).toEqual(['Offer Cafe', 'Offer Museum']);
    expect(offerAddressesNow('museum', 'rome').map(a => a.name)).toEqual(['Offer Museum']);
    expect(offerPeopleNow('rome').map(p => p.name)).toEqual(['Offer Person', 'Léa']); // Léa, from the test above, is Anywhere and was seen today
    expect(addressesOn()).toBe(true);
    await saveSettings({ addressesPeople: false });
    await settle();
    expect(addressesOn()).toBe(false);
    expect(offerAddressesNow(null, 'rome')).toEqual([]);
    expect(offerPeopleNow('rome')).toEqual([]);
    await saveSettings({ addressesPeople: true });
    await settle();
  });

  it('names categories from the strings until the person edits them', async () => {
    expect(categories().map(c => c.id)).toEqual(['food', 'cafe', 'shopping', 'sight', 'museum', 'park', 'outing', 'other']);
    expect(categoryName('cafe')).toBe('Café & bar');
    await saveSettings({ addressCategories: [{ id: 'cafe', name: 'Coffee' }, { id: 'brunch', name: '' }] });
    await settle();
    expect(categoryName('cafe')).toBe('Coffee');
    expect(categoryName('brunch')).toBe('brunch');
    expect(categoryName('gone')).toBe('gone');
    await saveSettings({ addressCategories: DEFAULT_ADDRESS_CATEGORIES });
    await settle();
    expect(settings.value.addressCategories).toHaveLength(8);
  });

  it('settings defaults: the module is on and the categories are the eight defaults; a chosen list is never reset', () => {
    const d = withDefaults(undefined);
    expect(d.addressesPeople).toBe(true);
    expect(d.addressCategories.map(c => c.id)).toEqual(['food', 'cafe', 'shopping', 'sight', 'museum', 'park', 'outing', 'other']);
    expect(d.addressCategories.every(c => c.name === '')).toBe(true);
    const chosen = withDefaults({ addressesPeople: false, addressCategories: [{ id: 'food', name: 'Eating' }] });
    expect(chosen.addressesPeople).toBe(false);
    expect(chosen.addressCategories).toEqual([{ id: 'food', name: 'Eating' }]);
  });
});
