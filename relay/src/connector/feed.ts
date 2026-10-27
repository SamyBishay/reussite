// After the connector changes the list, it writes the list's calendar feed again (docs/dev/feed.md), so a
// step an AI dropped or moved leaves the calendar without waiting for one of the person's devices to open.
// It can: while the connector is on, the relay holds the list's key, and the feed's id and secret are in the
// list (the setting `feedShared`). The text is the app's own (`feedText`), in the person's language.
import { feedText } from '../../../src/domain/feedText';
import { sharedFeed } from '../../../src/feed/protocol';
import { translate } from '../../../src/i18n/core';
import type { Env } from '../env';
import { writeFeed } from '../feed';
import type { Loaded } from './space';
import { View } from './view';

/** Write the feed from the list as it is now. False when the list has no shared feed or nothing was written. */
export async function refreshFeed(env: Env, s: Loaded, now = Date.now()): Promise<boolean> {
  const v = new View(s.maps, new Date(now));
  const st = v.settings, f = sharedFeed(st.feedShared);
  if (!f) return false;
  const data = { tasks: v.tasks, days: v.days, decisions: v.decisions, places: v.places, stays: v.stays, addresses: v.addresses, projects: v.projects };
  const text = feedText(data, st, v.today, st.feedDetail, (k, vars) => translate(st.language, k, vars), now, f.app ?? '', f.zone ?? v.zone);
  return writeFeed(env, f.fid, f.secret, text, now);
}
