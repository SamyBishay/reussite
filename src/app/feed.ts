// The subscribable calendar feed (brief §8, docs/dev/feed.md). A device builds the calendar text itself
// (`feedText`, the agenda's fixed-time items, a week back to 45 days ahead) and uploads it to the relay,
// which serves it at an address nobody can guess. The list has one feed: its id and write secret are the
// synced setting `feedShared`, so whichever device is open keeps it current, and no device that stops being
// used leaves a calendar behind that nothing updates. A device that has not synced holds its upload back.
// What the text says of a step is the person's choice (`feedDetail`): nothing, its short name, or the name with its place and notes.
import { computed, effect, signal } from '@preact/signals';
import { getLocal, setLocal } from '../data/db';
import type { CalData } from '../domain/calItems';
import { FEED_AHEAD_DAYS, FEED_PAST_DAYS, FEED_REFRESH_HINT, feedText } from '../domain/feedText';
import { b64uEncode } from '../sync/bytes';
import { aliasPath, feedPath, feedUrl, FEED_ID, MAX_FEED_BYTES, sharedFeed, type SharedFeed } from '../feed/protocol';
import { t } from '../i18n';
import { addresses, days, db, decisions, places, projects, readOnly, saveSettings, settings, stays, tasks, today } from './store';
import { lastSyncAt, relayBase, syncBehind, syncError } from './sync';

export { FEED_AHEAD_DAYS, FEED_PAST_DAYS, FEED_REFRESH_HINT, feedText };
/** The wait after a change before uploading, so a burst of edits is one upload. */
export const FEED_DEBOUNCE_MS = 4000;
/** An unchanged feed is still written this often, so the relay's 60-day clock (tick.ts) never runs out on a feed in use. */
export const FEED_REFRESH_MS = 7 * 86_400_000;

/**
 * `id`, `secret`: the feed this device writes (the shared one once adopted); `alias`: older feeds of this device
 * to point at the shared one, not yet done on the relay; `old`: feeds to delete.
 */
const K = { id: 'feed.id', secret: 'feed.secret', on: 'feed.on', hash: 'feed.hash', at: 'feed.at', old: 'feed.old', alias: 'feed.alias' } as const;
interface Old { fid: string; secret: string }
interface Alias extends Old { to: string }

/** Whether this device has a feed, and its address id. Null while off. */
export const feedId = signal<string | null>(null);
/** The last upload failed (the relay was unreachable or refused): shown under the switch; the next trigger retries. */
export const feedError = signal<string | null>(null);
export const feedBusy = signal(false);

/** The upload waits for this device's sync (shown under the switch). */
export const feedHeld = computed(() => !!feedId.value && syncBehind.value);

/** The app's own address, for the link that opens a step. */
export const appAddress = () => (typeof location === 'undefined' ? '' : location.origin + location.pathname);
const deviceZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; } };

/** The data the exports read, from the store. */
export const calData = (): CalData => ({ tasks: tasks.value, days: days.value, decisions: decisions.value, places: places.value, stays: stays.value, addresses: addresses.value, projects: projects.value });

/** What makes two feeds the same: the text without its DTSTAMP lines (they change on every build). */
export async function feedHash(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text.replace(/^DTSTAMP:.*\r\n/gm, ''));
  return b64uEncode(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}

const random = (n: number) => b64uEncode(crypto.getRandomValues(new Uint8Array(n)));

/** The address calendar apps subscribe to, https and webcal. Null while off or without a relay. */
export function feedLinks(): { https: string; webcal: string } | null {
  const base = relayBase(), fid = feedId.value;
  if (!base || !fid) return null;
  const https = feedUrl(base, fid);
  return { https, webcal: https.replace(/^https?:/, 'webcal:') };
}

async function call(method: 'PUT' | 'DELETE' | 'POST', path: string, secret: string, body?: string, type = 'text/calendar; charset=utf-8'): Promise<Response | null> {
  const base = relayBase();
  if (!base) return null;
  try {
    return await fetch(base + path, { method, headers: { Authorization: 'Bearer ' + secret, ...(body !== undefined ? { 'Content-Type': type } : {}) }, body });
  } catch { return null; }
}
const ok = async (r: Promise<Response | null>) => !!(await r)?.ok;

/** Feeds this device stopped using (switched off, regenerated) and could not delete yet; aliases it could not make yet. */
async function forget(): Promise<void> {
  const old = (await getLocal<Old[]>(db, K.old)) ?? [];
  if (old.length) {
    const left: Old[] = [];
    for (const o of old) if (!(await ok(call('DELETE', feedPath(o.fid), o.secret)))) left.push(o);
    await setLocal(db, K.old, left);
  }
  const aliases = (await getLocal<Alias[]>(db, K.alias)) ?? [];
  if (aliases.length) {
    const left: Alias[] = [];
    for (const a of aliases) {
      const r = await call('POST', aliasPath(a.fid), a.secret, JSON.stringify({ to: a.to }), 'application/json');
      // 404: the old feed or the shared one is gone (pruned, deleted): nothing left to point anywhere.
      if (!r || (!r.ok && r.status !== 404 && r.status !== 403)) left.push(a);
    }
    await setLocal(db, K.alias, left);
  }
}
async function retire(o: Old): Promise<void> {
  await setLocal(db, K.old, [...((await getLocal<Old[]>(db, K.old)) ?? []), o]);
  await forget();
}

async function use(f: SharedFeed): Promise<void> {
  feedId.value = f.fid;
  await setLocal(db, K.id, f.fid); await setLocal(db, K.secret, f.secret);
  await setLocal(db, K.hash, ''); await setLocal(db, K.at, 0); await setLocal(db, K.on, true);
}
const share = (fid: string, secret: string) => saveSettings({ feedShared: { fid, secret, app: appAddress(), zone: deviceZone() } });

/**
 * Bring this device in line with the list's feed: adopt the shared one (a feed of its own from before sharing
 * becomes an alias of it, so a calendar subscribed to that address keeps working), share its own when the list
 * has none yet, or switch off when the person switched the calendar off on another device.
 */
export async function reconcileFeed(): Promise<void> {
  if (readOnly.value) return;
  const raw = settings.value.feedShared, shared = sharedFeed(raw);
  const on = !!(await getLocal<boolean>(db, K.on));
  const fid = await getLocal<string>(db, K.id), secret = await getLocal<string>(db, K.secret);
  if (shared) {
    if (on && fid === shared.fid) return;
    // The feed this device wrote until now points at the list's: a calendar subscribed to it keeps working. A feed
    // already deleted (the shared one was regenerated or switched off elsewhere) is refused by the relay, as it should be.
    if (on && fid && secret) await setLocal(db, K.alias, [...((await getLocal<Alias[]>(db, K.alias)) ?? []), { fid, secret, to: shared.fid }]);
    await use(shared);
    scheduleFeed();
    return;
  }
  if (raw === 'off') {
    if (!on) return;
    feedId.value = null;
    await setLocal(db, K.on, false); await setLocal(db, K.id, ''); await setLocal(db, K.secret, ''); await setLocal(db, K.hash, '');
    await settled();
    if (fid && secret) await retire({ fid, secret });
    return;
  }
  if (on && fid && secret && FEED_ID.test(fid)) await share(fid, secret);
}

let running = false, again = false;
let timer: ReturnType<typeof setTimeout> | undefined;
/** The upload under way: a delete waits for it, or a PUT that lands after the DELETE would make the feed again. */
let inflight: Promise<void> = Promise.resolve();
const settled = async () => { clearTimeout(timer); while (running) await inflight; };

/** Upload the feed if it changed (or `force`). Never two at once, and never from a copy of the list that sync has not brought up to date. */
export function uploadFeed(force = false): Promise<void> {
  if (running) { again = true; return inflight; }
  return (inflight = upload(force));
}

async function upload(force: boolean): Promise<void> {
  running = true;
  feedBusy.value = true;
  try {
    do {
      again = false;
      await forget();
      const fid = await getLocal<string>(db, K.id), secret = await getLocal<string>(db, K.secret);
      if (!(await getLocal<boolean>(db, K.on)) || !fid || !secret || !relayBase()) break;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) break;
      if (syncBehind.value) break; // the next sync schedules it again
      const text = feedText(calData(), settings.value, today.value, settings.value.feedDetail, t, Date.now(), appAddress());
      const hash = await feedHash(text);
      const same = hash === (await getLocal<string>(db, K.hash)) && Date.now() - ((await getLocal<number>(db, K.at)) ?? 0) < FEED_REFRESH_MS;
      if (!force && same) { feedError.value = null; break; }
      if (new TextEncoder().encode(text).length > MAX_FEED_BYTES) { feedError.value = t('feedTooBig'); break; }
      if (await ok(call('PUT', feedPath(fid), secret, text))) { await setLocal(db, K.hash, hash); await setLocal(db, K.at, Date.now()); feedError.value = null; }
      else { feedError.value = t('feedUploadFailed'); break; }
      force = false;
    } while (again);
  } finally { running = false; feedBusy.value = false; }
  // A call that came in after the last pass (while old feeds were being deleted, or before a stop) is not lost.
  if (again) { again = false; await upload(false); }
}

/** An upload a few seconds from now; each call pushes it back. */
export function scheduleFeed(): void {
  clearTimeout(timer);
  timer = setTimeout(() => void uploadFeed(), FEED_DEBOUNCE_MS);
}

/** Switch the calendar on: the list's feed if it has one, else a new one that every device then shares. */
export async function feedOn(): Promise<void> {
  if (!relayBase() || feedId.value) return;
  const shared = sharedFeed(settings.value.feedShared);
  if (shared) await use(shared);
  else {
    const f = { fid: random(24), secret: random(32) };
    await use(f);
    await share(f.fid, f.secret);
  }
  await uploadFeed(true);
}

/** A new address for every device; the old one stops working as soon as the new one is up. */
export async function regenerateFeed(): Promise<void> {
  await settled();
  const fid = await getLocal<string>(db, K.id), secret = await getLocal<string>(db, K.secret);
  const f = { fid: random(24), secret: random(32) };
  await use(f);
  await share(f.fid, f.secret);
  await uploadFeed(true);
  if (fid && secret) await retire({ fid, secret });
}

/** Switch the calendar off, on every device: the feed is deleted from the relay. */
export async function feedOff(): Promise<void> {
  feedId.value = null; feedError.value = null; // the switch answers at once
  const fid = await getLocal<string>(db, K.id), secret = await getLocal<string>(db, K.secret);
  await setLocal(db, K.on, false); await setLocal(db, K.id, ''); await setLocal(db, K.secret, ''); await setLocal(db, K.hash, '');
  await settled(); // no upload starts now; the one under way finishes before the delete
  await saveSettings({ feedShared: 'off' });
  if (fid && secret) await retire({ fid, secret });
}

let started = false;
/** Once the data is loaded: read this device's feed, follow the list's, then keep it current (start, page shown, any change, each sync). */
export async function startFeed(): Promise<void> {
  if (started) return;
  started = true;
  const fid = await getLocal<string>(db, K.id);
  feedId.value = (await getLocal<boolean>(db, K.on)) && fid && FEED_ID.test(fid) ? fid : null;
  // The list's feed setting comes in from other devices by sync.
  effect(() => { void settings.value.feedShared; void reconcileFeed(); });
  // Any change to what the feed is made of schedules an upload; an unchanged text is skipped by its hash. A sync
  // that brings nothing still counts: the upload held back until this device was current can go.
  effect(() => {
    void [tasks.value, days.value, decisions.value, places.value, stays.value, addresses.value, projects.value, settings.value, today.value, lastSyncAt.value, syncError.value];
    if (feedId.value) scheduleFeed();
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void uploadFeed(); });
  void uploadFeed();
}
