# The calendar feed

A web address a calendar app can subscribe to (Settings → Calendar). The list has one feed: a device builds the calendar text and uploads it, and so does the connector after its own changes; the relay stores it and serves it. Nothing here is a second copy of the list: the text is derived from it and the relay's copy is disposable.

Files: `src/domain/feedText.ts` (the text, pure), `src/app/feed.ts` (hash, upload, switch, follow the list's feed), `relay/src/connector/feed.ts` (the connector's write), `src/app/CalendarSettings.tsx` (the block), `src/feed/protocol.ts` (ids and limits shared with the relay), `relay/src/feed.ts` (endpoints), migrations `relay/migrations/0006_feed.sql` and `0007_feed_alias.sql`. The text comes from `agenda` and `icsFor` (see `src/domain/ics.ts`), the same code as Add to calendar.

## Content

Fixed-time items only, from 7 days back to 45 days ahead (`agenda` filtered by `exported`, then `icsFor`): one-off items with `at` and standing items on their weekdays (a placed copy replaces the standing item's own event). No planned cards, no due steps and no all-day events; the check-in, the close and the review are not in the feed or in Add to calendar either: they stay in Today, the planner and the notifications. Done and dropped items are not events. No reminders in the feed (`withAlarms: false`; calendar apps decide when to refresh, so reminders are notifications' job). The calendar asks to be fetched every 15 minutes (`REFRESH-INTERVAL` and `X-PUBLISHED-TTL`, `PT15M`): Outlook, Thunderbird and macOS honour it; iOS fetches subscribed calendars on its own schedule (Settings → Calendar → Accounts → Fetch New Data). Nothing depends on the clock, so the text (and its hash) changes only when the data does.

What an event says is the synced setting `feedDetail`, three levels (`calItems.ts` builds the words, `ics.ts` only formats them):

| Level | SUMMARY | Also |
| --- | --- | --- |
| `times` | "Fixed time" | nothing |
| `labels` | the step's short name (`shortLabel`) | nothing |
| `full` | the short name | LOCATION: the linked address's street address (else its name), else the name of the place or area the step is set to ("Anywhere" gives none); DESCRIPTION: the full title, the leave-by line (fixed-time items with a lead), the note, the link; URL: `<app address>#task/<id>`, which opens the step's sheet (`taskFromHash` in `nav.ts`) |

`feedDetail` replaces the old `feedTitles` switch: until the person picks a level, `withDefaults` reads `feedTitles: true` as `labels` and anything else as `times`; the old key is left in the document. No migration is needed (settings are filled in on read). The warning that this is not end-to-end encrypted shows on `labels` and `full`. Add to calendar (the one-off file) always uses `full`.

## Identity

One feed per list (since 27 Oct 2026; before, one per device). Its id (`fid`, 24 random bytes = 192 bits, base64url) and write secret (32 bytes) are the synced setting `feedShared` (`{fid, secret, app, zone}`, `src/feed/protocol.ts`), end-to-end encrypted like the rest of the list: every device writes the same feed, and the relay can read the setting only while the connector is on, when it already holds the list's key. `app` is the app's address (the link that opens a step), `zone` the zone of the device that made the feed (for events whose place has none). `'off'` means the person switched the calendar off; `null`, never set. A device keeps the feed it writes in `local` (`feed.id`, `feed.secret`, `feed.on`, `feed.hash`, `feed.at`, `feed.old`, `feed.alias`).

`reconcileFeed` runs at start and whenever `feedShared` changes (it arrives from other devices by sync):

| `feedShared` | this device | then |
| --- | --- | --- |
| a feed | off | adopt it |
| a feed | on, the same feed | nothing |
| a feed | on, another feed | point the other feed at it (`POST /v1/feed/:fid/alias`, with that feed's secret), adopt it |
| `'off'` | on | switch off, delete its feed |
| `null` | on | share its feed (a device from before shared feeds; if two race, the setting's last write wins and the other becomes an alias) |

Switching on adopts the list's feed if it has one, else makes one and shares it; switching off writes `'off'` and deletes the feed; **Make a new address** shares a new one and deletes the old, whose aliases go with it. A device that regenerates deletes the old feed after the new one is up, so another device's alias of it is refused (404) and that device simply adopts the new one. Switch-off and regenerate wait for an upload under way, so a PUT never lands after the DELETE and makes the feed again.

The first write for a `fid` stores `SHA-256(secret)` (trust on first use). The `fid` is the only thing that keeps reading private. Rows not written for 60 days are pruned by the relay's hourly run (`relay/src/tick.ts`); an alias lives as long as the feed it points at. "Delete everywhere" switches the feed off (`'off'`, then deletes it).

## The connector

After `apply_changes` or `undo` writes, the connector builds the feed from the list as it now is (`refreshFeed`: `feedText`, the person's `language` and `feedDetail`, `feedShared.app` and `.zone`) and writes it (`writeFeed` in `relay/src/feed.ts`: the secret's hash must match, an alias is never written). A failure is ignored: the next device that opens writes it. So a step an AI drops or moves leaves the calendar at once, not when a device next opens. Privacy: the relay builds the text only while the connector is on, when it already reads the list; the text is what a device would upload.

## When the app uploads

Only the device that made a feed can write it (the secret never leaves it), and only while the app runs there. A feed whose device is no longer used (the app reinstalled or its storage cleared, which makes a new device) is an orphan: it keeps its last text until the 60-day prune, and a calendar subscribed to it shows that text, done and dropped steps included. The cure is to subscribe to the address the device in use shows in Settings → Calendar.

At start, when the page becomes visible, after each sync, and 4 seconds after any change to the data or settings (an `effect` on the store's signals). Never while sync is on and has not succeeded since the app started (`syncBehind` in `src/app/sync.ts`: also read-only and deleted-list), so a device with an old copy never overwrites the feed; Settings → Calendar says the feed waits (`feed-held`), and after six hours behind the whole app says so (`SyncStaleBanner`: **Sync now**, **Sync settings**). A hash of the text without its `DTSTAMP` lines is kept after each successful upload; an unchanged hash sends nothing, except that a feed is written again when its last write is over a week old (`FEED_REFRESH_MS`), so the 60-day prune never reaches a feed in use.

## Relay endpoints

| | |
| --- | --- |
| `PUT /v1/feed/:fid` | Body: the calendar text (`text/calendar`), at most 256 KB, must start with `BEGIN:VCALENDAR` and end with `END:VCALENDAR`. Bearer write secret. 201 new, 200 update. CORS and origin check as for sync. |
| `DELETE /v1/feed/:fid` | Bearer. Deletes the feed and the feeds that point at it. 200 `{ok, deleted}`; an unknown feed is fine. |
| `POST /v1/feed/:fid/alias` | Bearer (that feed's secret), JSON `{to}`. The feed keeps its id and secret, drops its text and serves `to`'s; feeds that pointed at it follow. 404 when either feed is gone or `to` is itself an alias. A PUT to an alias answers 200 `{ok, alias: true}` and writes nothing (an app from before shared feeds). |
| `GET /cal/:fid.ics` | No secret, no CORS, no Origin check. `Content-Type: text/calendar; charset=utf-8`, `ETag` (a hash of the text), `Cache-Control: no-cache` (a calendar revalidates on every fetch; unchanged, it costs a 304); 304 on a matching `If-None-Match`; 404 for an unknown address. An alias serves the feed it points at. A feed not written for 10 days (`FEED_STALE_MS`) gets one all-day event today, "Réussite: this calendar is out of date", with what to do in English and French (`served`); the ETag covers it. |

**Limits** (per minute): 5 new feeds per IP; 20 writes per feed; 256 KB per write; a wrong secret also counts against the shared per-IP counter. `GET` counts only **misses**, 30 per IP, then 429: a real subscriber is never limited, a scan is. Tunable with `RATE_FEED_NEW_IP_PER_MIN`, `RATE_FEED_PUT_PER_MIN`, `RATE_FEED_MISS_PER_MIN`.

## What the relay can see

The calendar text: at `times`, when something starts and where in time zone names, and nothing of what it is; at `labels`, the steps' short names too; at `full`, also their places and addresses, titles, notes, links and the link that opens each in the app. Who asks for it (IP addresses, the calendar app's user agent).
