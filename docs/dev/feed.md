# The calendar feed

A web address a calendar app can subscribe to (Settings → Calendar). The device builds the calendar text and uploads it; the relay stores it and serves it. Nothing here is a second copy of the list: the text is derived from it and the relay's copy is disposable.

Files: `src/app/feed.ts` (build, hash, upload, switch), `src/app/CalendarSettings.tsx` (the block), `src/feed/protocol.ts` (ids and limits shared with the relay), `relay/src/feed.ts` (endpoints), migration `relay/migrations/0006_feed.sql`. The text comes from `agenda` and `icsFor` (see `src/domain/ics.ts`), the same code as Add to calendar.

## Content

Launch points and fixed-time items from 7 days back to 45 days ahead, no reminders (`withAlarms: false`; calendar apps decide when to refresh, so reminders are notifications' job). Titles are generic ("▶ Start", "Fixed time") unless the synced setting `feedTitles` is on; the plain warning next to the switch says that titles in the feed are not end-to-end encrypted and the relay can read them.

## Identity

The device makes a feed id (`fid`, 24 random bytes = 192 bits, base64url) and a write secret (32 bytes), and keeps both in `local` (`feed.id`, `feed.secret`, `feed.on`, `feed.hash`, `feed.old`); never synced, so there is one feed per device. The first write for a `fid` stores `SHA-256(secret)` (trust on first use). The `fid` is the only thing that keeps reading private. No link to a space, so "Delete everywhere" does not reach feeds; the device deletes its own when the feed is switched off or regenerated (a delete that fails is retried at later uploads from `feed.old`). Rows are not pruned by time yet.

## When the app uploads

At start, when the page becomes visible, and 4 seconds after any change to the data or settings (an `effect` on the store's signals). A hash of the text without its `DTSTAMP` lines is kept after each successful upload; an unchanged hash sends nothing.

## Relay endpoints

| | |
| --- | --- |
| `PUT /v1/feed/:fid` | Body: the calendar text (`text/calendar`), at most 256 KB, must start with `BEGIN:VCALENDAR` and end with `END:VCALENDAR`. Bearer write secret. 201 new, 200 update. CORS and origin check as for sync. |
| `DELETE /v1/feed/:fid` | Bearer. 200 `{ok, deleted}`; an unknown feed is fine. |
| `GET /cal/:fid.ics` | No secret, no CORS, no Origin check. `Content-Type: text/calendar; charset=utf-8`, `ETag` (a hash of the text), `Cache-Control: max-age=900`; 304 on a matching `If-None-Match`; 404 for an unknown address. |

**Limits** (per minute): 5 new feeds per IP; 20 writes per feed; 256 KB per write; a wrong secret also counts against the shared per-IP counter. `GET` counts only **misses**, 30 per IP, then 429: a real subscriber is never limited, a scan is. Tunable with `RATE_FEED_NEW_IP_PER_MIN`, `RATE_FEED_PUT_PER_MIN`, `RATE_FEED_MISS_PER_MIN`.

## What the relay can see

The calendar text: with generic titles, when something starts and where in time zone names, and nothing of what it is; with `feedTitles`, the titles too. Who asks for it (IP addresses, the calendar app's user agent).
