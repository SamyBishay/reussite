# Push notifications

How a reminder reaches a locked phone with the app closed. The app works out what should ring and when (`buildSchedule`, in the domain), encrypts each notification for its own browser, and hands the ciphertext and a time to the relay. The relay keeps it until the minute it is due and posts it to the browser vendor's push service. Nothing here is a second copy of the list: the schedule is derived from the list, rebuilt whenever the app opens or something changes, and the relay's copy is disposable.

Files: `src/push/protocol.ts` (shared types and limits), `src/push/encrypt.ts` (RFC 8291), `src/push/vapid.ts` (RFC 8292), `relay/src/push.ts` (endpoints), `relay/src/webpush.ts` (endpoint check, VAPID headers, one POST), `relay/src/tick.ts` (the cron), migration `relay/migrations/0005_push.sql`.

## Identity

The device makes a random 16-byte push id (`pid`) and a random 32-byte push secret, and keeps both in `local` (never synced). The first write for a `pid` stores `SHA-256(secret)`; from then on the Bearer secret is required (trust on first use, as for a space). Push has nothing in common with sync: no space id, no key, so the relay cannot tell which space a subscription belongs to. The cost: "Delete everywhere" cannot reach other devices' push rows; it does switch off this device's notifications and delete its row. The others are forgotten after 45 days without a schedule write, and the push service will refuse them sooner if the subscription is gone (404/410 deletes the row).

## Encryption

The device encrypts each notification with `encryptPush(subscriptionKeys, plaintext)`: RFC 8291 `aes128gcm`, WebCrypto only. A fresh ephemeral ECDH P-256 key and salt per message; the shared secret is mixed with the subscription's `auth` secret (HKDF, info `WebPush: info\0 || p256dh || sender key`); content key and nonce come from a second HKDF over the salt. One record, record size 4096, header `salt | rs | 65 | sender key` (86 bytes), then AES-128-GCM of `plaintext || 0x02 || zeros`. The padded plaintext is a multiple of 256 bytes, so every notification of up to 255 bytes is 358 bytes on the wire; the largest allowed (767 bytes of plaintext) is 870. The relay never gets `p256dh` or `auth`, only the endpoint, so it cannot decrypt even if it wanted to; the push service sees only ciphertext, as does anyone in between. The browser decrypts before the service worker sees the payload.

The plaintext is JSON the service worker reads (title, body, tag, url). `decryptPush` exists for tests and the e2e push stub.

Checked against the RFC's Appendix A example to the byte (`src/push/encrypt.test.ts`).

## VAPID

The relay proves it is the application server the subscription was made for: an ES256 JWT `{aud: origin of the endpoint, exp: now + 12 h, sub: VAPID_SUBJECT}` in `Authorization: vapid t=<jwt>, k=<public key>`. `sub` is the relay's https address, not an email. The public key is the relay var `VAPID_PUBLIC_KEY` and the app's `VITE_VAPID_PUBLIC_KEY` (the browser ties a subscription to it, so a device re-subscribes when its stored key differs from the build's); the private scalar is the secret `VAPID_PRIVATE_KEY`. `scripts/vapid-keygen.mjs` prints a pair to stdout and writes nothing. A tick signs once per audience (FCM, Apple, Mozilla, Windows are four), not once per message.

## Relay endpoints

JSON, base64url blobs, `Authorization: Bearer <push secret>`, CORS and origin check as for sync. Base: `/v1/push/:pid`.

| | |
| --- | --- |
| `PUT /` `{endpoint}` | Registers or updates the device; the first write sets the secret's hash. 201 new, 200 update. The endpoint's host must be in `PUSH_HOSTS`; else 400 `bad_endpoint`. |
| `PUT /schedule` `{items, keep}` | Atomic replace (one D1 batch). `items` are written by id (an existing id is overwritten and its retry count reset); stored items whose id is in neither `items` nor `keep` are deleted; an id in `keep` the relay does not hold is ignored. Each item: `{id, at (ms), ttl (60..86400 s), urgency?, blob}`; `at` within 31 days of the relay's clock. At most 150 distinct ids, 512 KB. Returns `{stored, held}`. |
| `POST /send` `{blob}` | One push now, TTL 60 s, high urgency. 201 `{ok, status}`; 410 `gone` (and the device is deleted) when the push service says the subscription no longer exists; 502 `push_failed` otherwise; 503 `push_unavailable` without VAPID keys. |
| `DELETE /` | The device and its items. 200 `{ok, deleted}`; deleting an unknown device is fine. |

Errors are `{error: code}` as in sync, plus `bad_endpoint`, `unknown_device` (404, schedule and send for a `pid` the relay does not hold), `gone`, `push_failed`, `push_unavailable`.

**Limits** (per minute): 5 new devices per IP; 10 updates per device; 10 schedule writes per device and, with them, the shared 120 per IP counting writes and failed sign-ins; 3 test sends per device. A wrong secret counts against the IP. Tunable with `RATE_PUSH_NEW_IP_PER_MIN`, `RATE_PUSH_UPDATE_PER_MIN`, `RATE_PUSH_SCHEDULE_PER_MIN`, `RATE_PUSH_SEND_PER_MIN`.

**The host allow-list** (`PUSH_HOSTS`, comma-separated) is what stops a registered endpoint from aiming the relay at an internal address. An endpoint is accepted only if, as the URL parser reads it (the parser `fetch` will use), it is `https`, has no username or password, and its host equals an entry or ends in `.suffix` of a `*.suffix` entry, on the default port. IP literals never match. Production: `fcm.googleapis.com` (Chrome, Android), `updates.push.services.mozilla.com` (Firefox), `*.push.apple.com` (Safari, Home Screen apps), `*.notify.windows.com` (Edge). An entry may name a port (`host:8080`, or `host:*` for any) and then plain http is accepted for `localhost` and `127.0.0.1` only: that is how the local tests reach their stub. The list is checked again at every send, and redirects are never followed.

## The cron

`triggers.crons = ["* * * * *"]`: `scheduled` calls `runTick` (`relay/src/tick.ts`). Each run:

1. One select: items with `at <= now + 5 s` and not past `at + ttl`, joined to their device, oldest first, at most 36.
2. A pool of 6 sends at a time; each is a POST with `Content-Encoding: aes128gcm`, `TTL` (seconds left), `Urgency`, VAPID `Authorization`.
3. One batch of writes: delete the items sent or given up on; add 1 to `tries` for those to retry; delete devices (and their items) the push service called gone; update each device's `fails`, `last_status`, `last_sent`.

About 38 subrequests against a limit of 50; whatever is over 36 waits for the next minute. Outcomes: 2xx delivered; 404/410 the subscription is gone, so the device is deleted; 429, 5xx or no answer is retried on the next ticks while the item is within its TTL, and given up after 3 sends; any other 4xx (a refused payload, a rejected token) drops the item and keeps the device. An item past its TTL is never sent. With no VAPID keys set a tick does nothing and leaves everything for later.

At minute 0 the same run also prunes: devices with no register or schedule write for 45 days (and their items), items past their TTL, items of no device, and calendar feeds not written for 60 days ([feed.md](feed.md)). The app writes the schedule every time it is opened or the list changes, so a device in use is never pruned; one not opened for about two weeks runs dry anyway, because the window is 14 days (iOS has no background work for a closed app, so nothing can refill it).

CPU of a 36-send tick: `npm run relay:bench:push` (see DECISIONS.md for the numbers).

## In the app

Files: `src/sw.ts` (the service worker), `src/app/push.ts` (state, subscription, triggers), `src/push/reconcile.ts` (the diff), `src/push/notification.ts` (payload and `showNotification` arguments), `src/push/client.ts` (the relay calls), `src/push/support.ts` (what this browser can do), `src/app/NotifySettings.tsx` (Settings → Notifications).

**The service worker** is `src/sw.ts`, built by vite-plugin-pwa `injectManifest`: precache, the navigation fallback, `SKIP_WAITING` for the update banner, and two handlers. `push` always calls `showNotification` (iOS withdraws the permission from a worker that receives a push and shows nothing), so a payload that is missing or not JSON still shows the app's name; the tag is the item id, so a re-sent item replaces its notification. `notificationclick` focuses an open window of the app, else opens `./#today`.

**The payload** is `{title, body, tag, url}` as JSON (title is always "Réussite"), cut to fit 767 bytes, encrypted for the subscription's `p256dh`/`auth`.

**State and keys.** `pushState` is one of hidden (the build has no `VITE_VAPID_PUBLIC_KEY`), install (iOS outside the Home Screen app: the push API is not there until it is installed, so Settings explains the install first), unsupported, norelay, default, granted, denied. The permission prompt is only ever asked from the tap on the switch. The device's `push.id`, `push.secret`, `push.vapid` (the key the subscription was made with), `push.endpoint` (the endpoint last registered), `push.sent` (the diff cache), `push.on`, `push.lastAt`, `push.lastError` and `push.held` are in the `local` table: not synced, not in backups. The relay address is the sync one (`relayUrl`); push works with sync off.

**Reconciling** (`reconcileNow`, never two at once): make sure the subscription exists and was made with this build's VAPID key (else unsubscribe and subscribe again), register the endpoint if the relay has not seen it, run `buildSchedule`, and give `planUpload` the result and the cache. An item whose hash (auth secret, id, time, ttl, plaintext) matches the cache is not encrypted again and goes into `keep`; the rest are encrypted and uploaded; whatever is no longer wanted is simply not named. The write is skipped when nothing changed, except once a day, so the relay's 45-day clock keeps running for a device in use. If the relay answers `unknown_device` it is registered again and everything is re-sent; if it holds fewer items than were sent plus kept, everything is re-sent once. When it runs: at start, when the page becomes visible, when the network returns, and 3 seconds after any change to the tasks, days, decisions, places, stays, sessions or settings (a local write, a merge from sync, a switch).

**Switching off** deletes the device at the relay, unsubscribes, and forgets the id, secret and cache. **The test button** posts one push through the relay; on `gone` (the push service dropped the subscription, the relay deleted the device) the app subscribes again, registers, and sends once more.

**Known limits.** There is no `pushsubscriptionchange` handler: re-registering from the worker would need it to reach the push secret and the relay address in the database and run the whole client, for a case that is rare and heals by itself, so a browser that rotates a subscription is noticed the next time the app opens (until then the relay's push is refused and the row is deleted on 404/410). An offline stop of a timer leaves the "Still on…?" push on the relay (nothing can cancel it from a closed app). The banner in the app and the push use the one rule `stillOnDue` (`src/domain/calendar.ts`): twice the personal estimate (at least 45 minutes) from the start or the last "still going", or the next `dayStart` in the place's zone, whichever comes first; `src/app/push.parity.test.ts` pins both, including the day boundary.

## What the relay can see

The endpoint (which push service, and an opaque token for this browser), the push id and a hash of the secret, the time each notification is to be sent and the TTL and urgency, the size of each (358 bytes for almost all), when it was sent and what the push service answered, the 45-day clock, and IP addresses. Not the text of any notification, nor the keys to read it, nor the space the device belongs to. The push service sees the same ciphertext and the sending times.
