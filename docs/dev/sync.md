# Sync protocol

Code: `src/sync/` (shared by the app, the relay and the connector) and `relay/` (the Worker). Brief §6.

## Keys

One random 256-bit key per person, made on the first device. It is shown as a **recovery key**: Crockford base32 (no I, L, O, U), 32 key bytes plus a 3-byte CRC-32 checksum, 56 characters in 14 groups of 4 joined by dashes. Typing tolerates spaces, dashes, lower case and O/0, I/L/1 mix-ups; a typo fails the checksum.

HKDF-SHA256 with the salt `reussite/sync/v1` and three `info` strings gives:

| info | bytes | use |
| --- | --- | --- |
| `space-id` | 16 | names the space on the relay (base64url) |
| `auth-secret` | 32 | the Bearer token (base64url); the relay keeps only `SHA-256(token text)`, base64url |
| `encryption-key` | 32 | AES-GCM-256 |

## Blobs

`[format byte][12-byte random IV][AES-GCM ciphertext + tag]`. Format 1 is JSON, format 2 is gzipped JSON (used from 128 bytes up when `CompressionStream` exists). Additional authenticated data is the format byte plus the space id, so a blob can't be moved to another space. On the wire a blob is base64url text.

## What is encrypted

- **Change batch**: `{ v, device, docs: [{ c: collection, d: partial doc }] }`. A partial doc is `{ id, _v, _hlc: {changed fields only}, ...those fields, _del? }`.
- **Snapshot**: `{ v, upto, docs: { collection: [whole docs, tombstones included] } }`.

Synced collections: everything in `COLLECTIONS` (schema.ts) including `meta` (settings). The `local` and `backups` tables never sync, so the sync key, the AI key and the push subscription can't enter a batch.

## Merge

Per field, last writer wins by hybrid logical clock; the node id breaks exact ties; arrays replace whole; a deletion (`_del`) is kept as a tombstone. `merge()` in `src/data/doc.ts` is commutative, associative and idempotent, so batches can arrive twice, late or in any order. A device receiving a timestamp advances its clock past it.

There is no outbox. A clock ends with the node id of the device that wrote it, and a device's clocks only go up. So "what to push" = every field (and `_del`) whose clock was written by this node and is above the **watermark** (the highest clock already pushed). Imported (v1) fields carry the oldest clock, node `0`; the first sync, and the sync after an import, also send those (`imported: true`).

A device remembers `{ seq, watermark, snapshotSeq }` (in `local`): the last relay seq applied, the push watermark, and the latest snapshot's `upto`. Its own batches are skipped when pulled.

A document with `_v` above the app's `SCHEMA_VERSION` (or a batch/snapshot with a higher `v`) stops the round: nothing from that page is applied or saved, the result says `newer`, and the app goes read-only and asks to reload. The data stays on the relay.

## Snapshots and pruning

Once 50 batches have piled up since the last snapshot, a device that has applied everything up to `seq` uploads a snapshot with `upto = seq`. The relay stores it (replacing the old one), deletes the batches with `seq <= upto`, and an older snapshot never replaces a newer one. A new or restored device pulls the snapshot and the batches after it.

## Relay endpoints

JSON in, JSON out, blobs as base64url strings. `Authorization: Bearer <auth secret>` on all of them. Base: `/v1/spaces/:space`.

| | |
| --- | --- |
| `POST /batches` `{device, blob}` | The first write to an unknown space sets its auth hash. Returns `{seq}` (201). |
| `GET /changes?after=N` | `{head, more, snapshot: {upto, blob, at} \| null, batches: [{seq, device, blob, at}]}`. The snapshot comes only if `N < upto`; batches are those after `max(N, upto)`, in order, a page of up to 100 batches or about 4 MB. `more` means ask again from the last seq. |
| `PUT /snapshot` `{upto, blob}` | `upto` must be between 1 and the highest seq (else 409 `bad_upto`). Returns `{upto, pruned}`. |
| `POST /devices/:device` `{label?}` | Marks the device seen; `label` is an encrypted `{name}`. |
| `GET /devices` | `{devices: [{device, label, lastSeen}]}` |
| `DELETE /` | Deletes the whole space (delete everywhere). |

The connector's switch (`/connector`, `/connector/code`) is in [connector.md](connector.md).

Errors are `{error: code}`: 400 `bad_request`, 401 `unauthorized`, 403 `forbidden` (wrong secret, nothing written) or `origin_not_allowed`, 404 `unknown_space` / `not_found`, 409 `bad_upto` / `wrong_key`, 409 `connector_off`, 413 `too_large`, 429 `rate_limited` (with `Retry-After`), 503 `connector_unavailable`.

Limits: a batch blob is at most 1 MiB, a snapshot 4 MiB (stored in 1 MB parts, because a D1 row holds 2 MB). Writes are limited to 60 a minute per space and, per IP, 120 a minute counting writes and failed sign-ins (`RATE_SPACE_PER_MIN`, `RATE_IP_PER_MIN`). CORS: only origins matching `ALLOWED_ORIGINS`; `*` stands for one DNS label or a port.

## What the relay can see

The space id, a hash of the auth secret, the size, time and device id of every blob, the device list (names are encrypted), and IP addresses. Not the contents of anything. (While the connector is on, it also holds the key: see [connector.md](connector.md).) The relay never decrypts for sync, which keeps each request far under the free plan's 10 ms of CPU.

## Using it from the app

`syncOnce(store, client, opts)` in `src/sync/run.ts` does a round: pull until caught up, fold in, push, snapshot when due. Provide a `SyncStore` over Dexie; its `putMany` should write through `store.ts`. `RelayClient` is the fetch wrapper (it encrypts and decrypts). Tests use `FakeDevice` from `src/sync/testing.ts`.

## Running the relay

`npm run relay:dev` (local D1, localhost origins allowed), `npm run relay:test` (Workers runtime, in-memory D1). Deploying needs the real Worker name and D1 id in `relay/wrangler.jsonc`, then `wrangler d1 migrations apply`.
