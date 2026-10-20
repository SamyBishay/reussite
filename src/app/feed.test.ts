import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { choir, day, state, settings as agendaSettings, tr } from '../domain/agenda.fixture';
import type { IcsTranslate } from '../domain/ics';
import { withDefaults } from '../data/settings';
import { getLocal } from '../data/db';
import { FEED_REFRESH_MS, feedHash, feedId, feedOff, feedOn, feedText, regenerateFeed, uploadFeed } from './feed';
import { db, days, settings, tasks } from './store';

const itr = tr as unknown as IcsTranslate;
const world = state({ tasks: [choir()], days: [day('2026-10-26', { launches: [] })] });
const text = (titles: boolean, now = Date.parse('2026-10-20T08:00:00Z')) => feedText(world, agendaSettings(), '2026-10-20', titles, itr, now);

describe('the feed text', () => {
  it('has no step title unless asked, and no reminders', () => {
    const generic = text(false);
    expect(generic).toContain('BEGIN:VEVENT');
    expect(generic).not.toContain('Choir');
    expect(generic).not.toContain('Hill House');
    expect(generic).not.toContain('VALARM');
    expect(text(true)).toContain('Choir');
  });

  it('covers a week back to 45 days ahead', () => {
    const t = feedText(world, agendaSettings(), '2026-10-20', false, itr, 0);
    // Mondays in range: Oct 19 and 26, Nov 2, 9, 16, 23, 30; not Oct 12 or Dec 7.
    const starts = [...t.matchAll(/DTSTART;TZID=[^:]+:(\d{8})/g)].map(m => m[1]);
    expect(starts).toContain('20261019');
    expect(starts).toContain('20261130');
    expect(starts).not.toContain('20261012');
    expect(starts).not.toContain('20261207');
  });

  it('hashes the same when only DTSTAMP differs, and differently when the content does', async () => {
    const a = text(false, Date.parse('2026-10-20T08:00:00Z')), b = text(false, Date.parse('2026-10-20T09:30:00Z'));
    expect(a).not.toBe(b);
    expect(await feedHash(a)).toBe(await feedHash(b));
    expect(await feedHash(a)).not.toBe(await feedHash(text(true)));
  });
});

describe('uploading', () => {
  const calls: { method: string; url: string; auth: string; body?: string }[] = [];
  beforeAll(() => {
    vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }));
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ method: init.method!, url, auth: (init.headers as Record<string, string>).Authorization!, body: init.body as string | undefined });
      return new Response('{}', { status: 200 });
    });
    settings.value = withDefaults({ relayUrl: 'http://localhost:8787' });
    tasks.value = new Map([['choir', { ...choir(), id: 'choir' } as never]]);
    days.value = new Map();
  });

  it('sends generic titles, skips an unchanged text, sends step titles when asked, and a new address replaces the old', async () => {
    await feedOn();
    const first = calls.at(-1)!;
    expect(first.method).toBe('PUT');
    expect(first.url).toBe(`http://localhost:8787/v1/feed/${feedId.value}`);
    expect(first.body).toContain('BEGIN:VCALENDAR');
    expect(first.body).not.toContain('Choir');
    const n = calls.length;
    await uploadFeed();
    expect(calls.length).toBe(n); // same text apart from DTSTAMP: nothing sent

    settings.value = withDefaults({ relayUrl: 'http://localhost:8787', feedTitles: true });
    await uploadFeed();
    expect(calls.at(-1)!.body).toContain('Choir');

    const old = feedId.value!, oldAuth = calls[0]!.auth;
    await regenerateFeed();
    expect(feedId.value).not.toBe(old);
    const del = calls.at(-1)!;
    expect(del).toMatchObject({ method: 'DELETE', url: `http://localhost:8787/v1/feed/${old}`, auth: oldAuth });
    expect(calls.at(-2)!.url).toContain(feedId.value!);

    const cur = feedId.value!;
    await feedOff();
    expect(feedId.value).toBeNull();
    expect(calls.at(-1)).toMatchObject({ method: 'DELETE', url: `http://localhost:8787/v1/feed/${cur}` });
    expect(await getLocal(db, 'feed.secret')).toBe('');
    const m = calls.length;
    await uploadFeed();
    expect(calls.length).toBe(m);
  });

  it('writes an unchanged feed again after a week, so the relay never forgets one in use', async () => {
    await feedOn();
    const n = calls.length;
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + FEED_REFRESH_MS - 60_000 });
    await uploadFeed();
    expect(calls.length).toBe(n);
    vi.setSystemTime(Date.now() + 120_000);
    await uploadFeed();
    expect(calls.length).toBe(n + 1);
    expect(calls.at(-1)!.method).toBe('PUT');
    await uploadFeed();
    expect(calls.length).toBe(n + 1);
    vi.useRealTimers();
    await feedOff();
  });
});
