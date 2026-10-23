# The calendar feed

A web address a calendar app can subscribe to (Settings → Calendar). The device builds the calendar text and uploads it; the relay stores it and serves it. Nothing here is a second copy of the list: the text is derived from it and the relay's copy is disposable.

Files: `src/app/feed.ts` (build, hash, upload, switch), `src/app/CalendarSettings.tsx` (the block), `src/feed/protocol.ts` (ids and limits shared with the relay), `relay/src/feed.ts` (endpoints), migration `relay/migrations/0006_feed.sql`. The text comes from `agenda` and `icsFor` (see `src/domain/ics.ts`), the same code as Add to calendar.

## Content

Fixed-time items from 7 days back to 45 days ahead, and the open planned cards (a day's list) and due steps from today to 45 days ahead as all-day events (`VALUE=DATE`, one each, transparent; `allDayItems` in `src/domain/calItems.ts`). Launch points, the check-in, the close and the review are not in the feed or in Add to calendar: they stay in Today, the planner and the notifications. No reminders in the feed (`withAlarms: false`; calendar apps decide when to refresh, so reminders are notifications' job).

What an event says is the synced setting `feedDetail`, three levels (`calItems.ts` builds the words, `ics.ts` only formats them):

| Level | SUMMARY | Also |
| --- | --- | --- |
| `times` | "Fixed time", "Planned step", "Step due" | nothing |
| `labels` | the step's short name (`shortLabel`) | nothing |
| `full` | the short name | LOCATION: the linked address's street address (else its name), else the name of the place or area the step is set to ("Anywhere" gives none); DESCRIPTION: the full title, the leave-by line (fixed-time items with a lead), the note, the link; URL: `<app address>#task/<id>`, which opens the step's sheet (`taskFromHash` in `nav.ts`) |

`feedDetail` replaces the old `feedTitles` switch: until the person picks a level, `withDefaults` reads `feedTitles: true` as `labels` and anything else as `times`; the old key is left in the document. No migration is needed (settings are filled in on read). The warning that this is not end-to-end encrypted shows on `labels` and `full`. Add to calendar (the one-off file) always uses `full`.

## Identity

The device makes a feed id (`fid`, 24 random bytes = 192 bits, base64url) and a write secret (32 bytes), and keeps both in `local` (`feed.id`, `feed.secret`, `feed.on`, `feed.hash`, `feed.at`, `feed.old`); never synced, so there is one feed per device. The first write for a `fid` stores `SHA-256(secret)` (trust on first use). The `fid` is the only thing that keeps reading private. No link to a space, so "Delete everywhere" cannot reach other devices' feeds; it does switch off this device's feed and delete its row. A device deletes its own feed when it is switched off or regenerated too (a delete that fails is retried at later uploads from `feed.old`). Other devices' rows expire: the relay's hourly prune (`relay/src/tick.ts`) deletes a feed not written for 60 days.

## When the app uploads

At start, when the page becomes visible, and 4 seconds after any change to the data or settings (an `effect` on the store's signals). A hash of the text without its `DTSTAMP` lines is kept after each successful upload; an unchanged hash sends nothing, except that a feed is written again when its last write is over a week old (`FEED_REFRESH_MS`), so the 60-day prune never reaches a feed in use.

## Relay endpoints

| | |
| --- | --- |
| `PUT /v1/feed/:fid` | Body: the calendar text (`text/calendar`), at most 256 KB, must start with `BEGIN:VCALENDAR` and end with `END:VCALENDAR`. Bearer write secret. 201 new, 200 update. CORS and origin check as for sync. |
| `DELETE /v1/feed/:fid` | Bearer. 200 `{ok, deleted}`; an unknown feed is fine. |
| `GET /cal/:fid.ics` | No secret, no CORS, no Origin check. `Content-Type: text/calendar; charset=utf-8`, `ETag` (a hash of the text), `Cache-Control: max-age=900`; 304 on a matching `If-None-Match`; 404 for an unknown address. |

**Limits** (per minute): 5 new feeds per IP; 20 writes per feed; 256 KB per write; a wrong secret also counts against the shared per-IP counter. `GET` counts only **misses**, 30 per IP, then 429: a real subscriber is never limited, a scan is. Tunable with `RATE_FEED_NEW_IP_PER_MIN`, `RATE_FEED_PUT_PER_MIN`, `RATE_FEED_MISS_PER_MIN`.

## What the relay can see

The calendar text: at `times`, when something starts and where in time zone names, and nothing of what it is; at `labels`, the steps' short names too; at `full`, also their places and addresses, titles, notes, links and the link that opens each in the app. Who asks for it (IP addresses, the calendar app's user agent).
