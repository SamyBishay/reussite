# Push notifications

How a reminder reaches a locked phone with the app closed. The app works out what should ring and when (`buildSchedule`, in the domain), encrypts each notification for its own browser, and hands the ciphertext and a time to the relay. The relay keeps it until the minute it is due and posts it to the browser vendor's push service. Nothing here is a second copy of the list: the schedule is derived from the list, rebuilt whenever the app opens or something changes, and the relay's copy is disposable.

Files: `src/push/protocol.ts` (shared types and limits), `src/push/encrypt.ts` (RFC 8291), `src/push/vapid.ts` (RFC 8292), `relay/src/push.ts` (endpoints), `relay/src/webpush.ts` (endpoint check, VAPID headers, one POST), `relay/src/tick.ts` (the cron), migration `relay/migrations/0005_push.sql`.

## Identity

The device makes a random 16-byte push id (`pid`) and a random 32-byte push secret, and keeps both in `local` (never synced). The first write for a `pid` stores `SHA-256(secret)`; from then on the Bearer secret is required (trust on first use, as for a space). Push has nothing in common with sync: no space id, no key, so the relay cannot tell which space a subscription belongs to. The cost: "Delete everywhere" cannot reach other devices' push rows. They are forgotten after 45 days without a schedule write, and the push service will refuse them sooner if the subscription is gone (404/410 deletes the row).

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

At minute 0 the same run also prunes: devices with no register or schedule write for 45 days (and their items), items past their TTL, items of no device. The app writes the schedule every time it is opened or the list changes, so a device in use is never pruned; one not opened for about two weeks runs dry anyway, because the window is 14 days (iOS has no background work for a closed app, so nothing can refill it).

CPU of a 36-send tick: `npm run relay:bench:push` (see DECISIONS.md for the numbers).

## What the relay can see

The endpoint (which push service, and an opaque token for this browser), the push id and a hash of the secret, the time each notification is to be sent and the TTL and urgency, the size of each (358 bytes for almost all), when it was sent and what the push service answered, the 45-day clock, and IP addresses. Not the text of any notification, nor the keys to read it, nor the space the device belongs to. The push service sees the same ciphertext and the sending times.
