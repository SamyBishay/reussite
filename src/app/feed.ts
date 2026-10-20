// The subscribable calendar feed (brief §8, docs/dev/feed.md). The device builds the calendar
// text itself (the same agenda the Add to calendar file reads, without reminders, a week back
// to 45 days ahead) and uploads it to the relay, which serves it at an address only this device
// knows. Ids and the write secret live in `local`: a feed belongs to one device, never synced.
// Step titles stay out of the text unless the person asked for them (`feedTitles`).
import { effect, signal } from '@preact/signals';
import { getLocal, setLocal } from '../data/db';
import { addDays } from '../domain/dates';
import { agenda, type AgendaData, type AgendaSettings } from '../domain/agenda';
import { exported, genericTitles, icsFor, realTitles, type IcsTranslate } from '../domain/ics';
import { b64uEncode } from '../sync/bytes';
import { feedPath, feedUrl, FEED_ID, MAX_FEED_BYTES } from '../feed/protocol';
import { t } from '../i18n';
import { days, db, decisions, places, settings, stays, tasks, today } from './store';
import { relayBase } from './sync';

export const FEED_PAST_DAYS = 7;
export const FEED_AHEAD_DAYS = 45;
/** The wait after a change before uploading, so a burst of edits is one upload. */
export const FEED_DEBOUNCE_MS = 4000;

const K = { id: 'feed.id', secret: 'feed.secret', on: 'feed.on', hash: 'feed.hash', old: 'feed.old' } as const;
interface Old { fid: string; secret: string }

/** Whether this device has a feed, and its address id. Null while off. */
export const feedId = signal<string | null>(null);
/** The last upload failed (the relay was unreachable or refused): shown under the switch; the next trigger retries. */
export const feedError = signal<string | null>(null);
export const feedBusy = signal(false);

/** The calendar text for the feed window around `day`. Real titles only if `titles`. */
export function feedText(data: AgendaData, s: AgendaSettings, day: string, titles: boolean, tr: IcsTranslate, now: number): string {
  const events = agenda(data, s, addDays(day, -FEED_PAST_DAYS), addDays(day, FEED_AHEAD_DAYS)).filter(exported);
  return icsFor(events, { now, titles: titles ? realTitles(tr) : genericTitles(tr), withAlarms: false, name: 'Réussite' });
}

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

async function call(method: 'PUT' | 'DELETE', fid: string, secret: string, body?: string): Promise<boolean> {
  const base = relayBase();
  if (!base) return false;
  try {
    const res = await fetch(base + feedPath(fid), { method, headers: { Authorization: 'Bearer ' + secret, ...(body !== undefined ? { 'Content-Type': 'text/calendar; charset=utf-8' } : {}) }, body });
    return res.ok;
  } catch { return false; }
}

/** Feeds this device stopped using (switched off, regenerated) and could not delete yet. */
async function forget(): Promise<void> {
  const old = (await getLocal<Old[]>(db, K.old)) ?? [];
  if (!old.length) return;
  const left: Old[] = [];
  for (const o of old) if (!(await call('DELETE', o.fid, o.secret))) left.push(o);
  await setLocal(db, K.old, left);
}
async function retire(o: Old): Promise<void> {
  await setLocal(db, K.old, [...((await getLocal<Old[]>(db, K.old)) ?? []), o]);
  await forget();
}

let running = false, again = false;
let timer: ReturnType<typeof setTimeout> | undefined;

/** Upload the feed if it changed (or `force`). Never two at once. */
export async function uploadFeed(force = false): Promise<void> {
  if (running) { again = true; return; }
  running = true;
  feedBusy.value = true;
  try {
    do {
      again = false;
      const fid = await getLocal<string>(db, K.id), secret = await getLocal<string>(db, K.secret);
      if (!(await getLocal<boolean>(db, K.on)) || !fid || !secret || !relayBase()) break;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) break;
      const text = feedText({ tasks: tasks.value, days: days.value, decisions: decisions.value, places: places.value, stays: stays.value }, settings.value, today.value, settings.value.feedTitles, t, Date.now());
      const hash = await feedHash(text);
      if (!force && hash === (await getLocal<string>(db, K.hash))) { feedError.value = null; break; }
      if (new TextEncoder().encode(text).length > MAX_FEED_BYTES) { feedError.value = t('feedTooBig'); break; }
      if (await call('PUT', fid, secret, text)) { await setLocal(db, K.hash, hash); feedError.value = null; }
      else { feedError.value = t('feedUploadFailed'); break; }
      force = false;
    } while (again);
    await forget();
  } finally { running = false; feedBusy.value = false; }
}

/** An upload a few seconds from now; each call pushes it back. */
export function scheduleFeed(): void {
  clearTimeout(timer);
  timer = setTimeout(() => void uploadFeed(), FEED_DEBOUNCE_MS);
}

async function newFeed(): Promise<void> {
  const fid = random(24), secret = random(32);
  feedId.value = fid; // the switch answers at once
  await setLocal(db, K.id, fid); await setLocal(db, K.secret, secret); await setLocal(db, K.hash, ''); await setLocal(db, K.on, true);
}

export async function feedOn(): Promise<void> {
  if (!relayBase() || feedId.value) return;
  await newFeed();
  await uploadFeed(true);
}

/** A new address; the old one stops working as soon as the new one is up. */
export async function regenerateFeed(): Promise<void> {
  const fid = await getLocal<string>(db, K.id), secret = await getLocal<string>(db, K.secret);
  await newFeed();
  await uploadFeed(true);
  if (fid && secret) await retire({ fid, secret });
}

export async function feedOff(): Promise<void> {
  clearTimeout(timer);
  feedId.value = null; feedError.value = null; // the switch answers at once
  const fid = await getLocal<string>(db, K.id), secret = await getLocal<string>(db, K.secret);
  await setLocal(db, K.on, false); await setLocal(db, K.id, ''); await setLocal(db, K.secret, ''); await setLocal(db, K.hash, '');
  if (fid && secret) await retire({ fid, secret });
}

let started = false;
/** Once the data is loaded: read this device's feed, then keep it current (start, page shown, any change). */
export async function startFeed(): Promise<void> {
  if (started) return;
  started = true;
  const fid = await getLocal<string>(db, K.id);
  feedId.value = (await getLocal<boolean>(db, K.on)) && fid && FEED_ID.test(fid) ? fid : null;
  // Any change to what the feed is made of schedules an upload; an unchanged text is skipped by its hash.
  effect(() => {
    void [tasks.value, days.value, decisions.value, places.value, stays.value, settings.value, today.value];
    if (feedId.value) scheduleFeed();
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void uploadFeed(); });
  void uploadFeed();
}
