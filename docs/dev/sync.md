# Sync protocol

Code: `src/sync/` (shared by the app, the relay and the connector) and `relay/` (the Worker). Brief §6.

## Keys

One random 256-bit key per person, made on the first device. It is shown as a **recovery key**: Crockford base32 (no I, L, O, U), 32 key bytes plus a 3-byte CRC-32 checksum, 56 characters in 14 groups of 4 joined by dashes. Typing tolerates spaces, dashes, lower case and O/0, I/L/1 mix-ups; a typo fails the checksum.

HKDF-SHA256 with the salt `reussite/sync/v1` and these `info` strings gives:

| info | bytes | use |
| --- | --- | --- |
| `space-id` | 16 | names the space on the relay (base64url) |
| `auth-secret` | 32 | the Bearer token (base64url); the relay keeps only `SHA-256(token text)`, base64url |
| `encryption-key` | 32 | AES-GCM-256 |
| `inbox-x25519` | 32 | the seed of the inbox X25519 key pair (the drop page seals to its public half; every device derives the same pair) |

## Blobs

`[format byte][12-byte random IV][AES-GCM ciphertext + tag]`. Format 1 is JSON, format 2 is gzipped JSON (used from 128 bytes up when `CompressionStream` exists). Formats 3 and 4 are the same two with **wire generation 2** inside (below). The format byte is the version gate: an app from before generation 2 doesn't know 3 and 4, so it fails to open such a blob (a decrypt error, nothing applied) instead of misreading it; a current app reads all four. Additional authenticated data is the format byte plus the space id, so a blob can't be moved to another space. On the wire a blob is base64url text.

## What is encrypted

- **Change batch**: `{ v, device, docs: [{ c: collection, d: partial doc }] }`. A partial doc is `{ id, _v, _hlc: {changed fields only}, ...those fields, _del? }`.
- **Snapshot**: `{ v, upto, docs: { collection: [whole docs, tombstones included] } }`, whole or in two parts, hot and cold (below). Part headers add `part`, `cut`, `cold`, `x`, `top`.

### Wire generation 2: clocks

A stored document has one HLC per field, about 27 characters each, 70% of a snapshot. On the wire (`src/sync/wire.ts`; the stored shape and `SCHEMA_VERSION` don't change) a document is `{ id, _v?, _del?, _h?: base, _o?: { field: clock | 0 }, ...fields }`: `_h` is the clock of every present field not listed in `_o`; `_o` gives the clock of the fields that differ, `0` for a field present with no clock, and a clock for a field the document doesn't hold (clocks with no value are kept); `_v` is left out when it equals the blob's `v`. A batch is `{ f: 2, v, device, docs }`, a snapshot `{ f: 2, v, upto, docs, … }`. `f` marks the generation; blobs without it (generation 1) hold whole documents and are still read. A document with a field named `_h` or `_o` is sent whole. Decoding rebuilds `_hlc` in place, so everything after it (merge, the engine, the connector) sees ordinary documents. Round-trip tests in `wire.test.ts` check tombstones, fields with no clock and clocks with no field, on thousands of random documents.

Synced collections: everything in `COLLECTIONS` (schema.ts) including `meta` (settings), `memory` (notes: `kind`, `name`, `aliases`, `lines` with an id and `by` each, `private`), `exchanges` (Home's history: the text, the turns, the applied change-sets and their Undo records), `addresses` (`name`, `category`, `placeId`, `mapsUrl`, `street?`, `state`, `visits` with an id each, `by`, `note`) and `people` (`name`, `placeId`, `reach`, `note`, `lastSeen`; no home address). The `local` and `backups` tables never sync, so the sync key, the AI key and the push subscription can't enter a batch.

## Merge

Per field, last writer wins by hybrid logical clock; the node id breaks exact ties; arrays replace whole (so a note's `lines` and an exchange's `changes` and `undo` do too: two devices that edit one note before syncing keep the later write's lines, and a Home follow-up joins an exchange only if every field of it was last written by this device); a deletion (`_del`) is kept as a tombstone. `merge()` in `src/data/doc.ts` is commutative, associative and idempotent, so batches can arrive twice, late or in any order. A device receiving a timestamp advances its clock past it.

There is no outbox. A clock ends with the node id of the device that wrote it, and a device's clocks only go up. So "what to push" = every field (and `_del`) whose clock was written by this node and is above the **watermark** (the highest clock already pushed). Imported (v1) fields carry the oldest clock, node `0`; the first sync, and the sync after an import, also send those (`imported: true`).

A device remembers `{ seq, watermark, snapshotSeq }` (in `local`): the last relay seq applied, the push watermark, and the latest snapshot's `upto`. Its own batches are skipped when pulled.

**Schema 3** (phase 2b) adds the `memory` and `exchanges` collections. Migration 3 changes no stored data; the schema number is what matters: a device still on schema 2 reads a schema-3 batch as newer and goes read-only (the relay marks such a space `newer` too) instead of skipping the memory it does not know and writing back over it. See "Rolling out schema 3" below.

**Schema 4** (phase 4) adds the `addresses` and `people` collections, and the optional step fields `addressId`, `personId` and `offer` (what the planner offers for a standing obligation: `address` or `person`). Migration 4 changes no stored data; as for schema 3, the number is what matters: a device on schema 3 reads a schema-4 batch as newer and goes read-only instead of skipping addresses and people it doesn't know. Arrays merge whole, so an address's `visits` are one value: two devices recording a visit to the same address before syncing keep the later write's visits. The relay and the connector take `COLLECTIONS` and `SCHEMA_VERSION` from `src/data/schema.ts`, so both know schema 4 without a separate list; no tool of the connector reads an address or a person (docs/dev/connector.md), and no AI request carries them. See "Rolling out schema 4" below.

A document with `_v` above the app's `SCHEMA_VERSION` (or a batch/snapshot with a higher `v`) stops the round: nothing from that page is applied or saved, the result says `newer`, and the app goes read-only and asks to reload. The data stays on the relay.

## Snapshots and pruning

Once 8 batches (`SNAPSHOT_EVERY`) have piled up since the last snapshot, a device that has applied everything up to `seq` uploads a snapshot with `upto = seq`. The tail is kept short because every reader decrypts and folds it, about 0.1 to 0.3 ms of CPU a batch, and the connector has 10 ms. The relay stores it (replacing the old one), deletes the batches with `seq <= upto`, and an older snapshot never replaces a newer one. A new or restored device pulls the snapshot and the batches after it.

Two writers can't lose anything: a snapshot must contain everything up to its `upto`, so whoever writes one has pulled and applied up to `upto` first (a device uses its own `seq`, which its own later pushes don't raise; the connector uses the highest seq it read, or its own batch's if that followed directly). The relay refuses an `upto` above the head (409 `bad_upto`) and ignores one that isn't newer than the stored snapshot (the answer carries the stored `upto`, `pruned: 0`). The check is also inside the write: every statement of the (atomic) batch that replaces the snapshot is guarded by "no stored snapshot with `upto >=` mine", and pruning only deletes batches the stored snapshot covers, so two writers racing past the first check still can't put an older snapshot over a newer one.

### Hot and cold

Reading the whole list costs CPU in proportion to its size, and most of a year's list is finished history. So a snapshot is two separately encrypted blobs (`src/sync/parts.ts`), which the relay stores as rows of kind `hot` and `cold` (migration `0004`; a snapshot written before it is kind `full`, one whole blob):

- **hot**: open steps; steps done in the last 30 days, or with a time and due in them; the sessions of those steps and of the last 30 days; the days from 30 days ago on, future included; every project, decision, place, stay and setting, every live address and person (a deleted one, a tombstone, only if it was touched in the last 30 days: both collections are small and are read whole by the trip pack, and the connector never needs the cold part for them), and every live memory note (a forgotten one, a tombstone, only if it was touched in the last 30 days; the connector's `read_memory` needs the notes and never the cold part); the steps a hot day's list or a decision points to; and any other document with a clock from the last 30 days. Exchanges (Home's history) are hot only when written in the 2 days before the cut or since (`EXCHANGE_MARGIN_MS`): nothing hot-only reads them, and a month of them with their Undo records costs every connector call about 2 ms. A device that pushes an exchange write made more than a day earlier (it was offline) rewrites both parts at once (`lateExchanges`, `SyncState.owesFull`), since that write may be older than the margin. Its header carries the **cut** (`{ day, wall, coldUpto }`: when and with what `upto` the cold part was made), an **index** of the cold ids per collection (`"\nid\nid\n"`), and a **digest** of the cold documents (estimate points for steps done in the last 400 days, steps done per project).
- **cold**: everything else, tombstones of old documents included.

A document can be in both; merging is idempotent and commutative, so a reader merges both and gets the whole list.

**Hot-only snapshots.** A snapshot normally rewrites only the hot part and leaves the cold one on the relay. It is made with the same cut as the stored cold part: hot = what is hot by that cut + everything touched since. That is always a superset of what the stored cold part leaves out, so cold stays valid however long it is kept; every week (`FULL_EVERY_MS`), or when no cut is known, both parts are rewritten with a new cut. The cut is in the encrypted hot header and in the device's sync state (`SyncState.cut`).

The relay checks only what it can see: `PUT /snapshot` with `part: 'hot'` and no `cold` names `coldUpto`, and is refused (409 `bad_parts`) unless the stored cold part is at least that new, which is why a whole snapshot from an older app is never silently turned into a hot one. A device that gets `bad_parts` writes both parts.

**Readers.** A device (or anything that needs everything) asks `GET /changes` and merges `snapshot` (hot, or whole) and `cold`. `cold` is sent only if the reader's `after` is below its `upto`: a reader that already has everything cold holds gets hot only. The connector reads hot only and reads cold when it must (docs/dev/connector.md).

**A hot reader and a stub.** A batch that touches a document the cold part also holds (reopening an old step, planning a day with one) leaves a hot reader with a partial document. It sees this because the index lists the id and the hot part doesn't hold it, and then it reads cold before answering. To keep that rare, an app that has just pushed such an edit (`touchesCold`) pulls its own batch back and snapshots at once; the connector, which had to read cold, cuts the hot part again after its write.

## Relay endpoints

JSON in, JSON out, blobs as base64url strings. `Authorization: Bearer <auth secret>` on all of them except `POST /inbox`. Base: `/v1/spaces/:space`.

| | |
| --- | --- |
| `POST /batches` `{device, blob}` | The first write to an unknown space sets its auth hash. Returns `{seq}` (201). |
| `GET /changes?after=N` | `{head, more, snapshot: {upto, blob, at} \| null, cold?: {upto, blob, at} \| null, batches: [{seq, device, blob, at}]}`. The snapshot (its hot part, or the whole one) comes only if `N < upto`, and `cold` only if `N <` its own `upto`; batches are those after `max(N, upto)`, in order, a page of up to 100 batches or about 4 MB. `more` means ask again from the last seq. |
| `PUT /snapshot` `{upto, blob, part?, cold?, coldUpto?}` | `upto` must be between 1 and the highest seq (else 409 `bad_upto`). Without `part`: a whole snapshot, replacing everything (what apps before the split send). `part: 'hot'` with `cold: {upto, blob}`: both parts, replacing everything. `part: 'hot'` with `coldUpto`: the hot part only (409 `bad_parts` unless the stored cold part is at least that new). Returns `{upto, pruned}`; `upto` is the stored one when this wasn't newer. |
| `POST /devices/:device` `{label?}` | Marks the device seen; `label` is an encrypted `{name}`. |
| `GET /devices` | `{devices: [{device, label, lastSeen}]}` |
| `DELETE /` | Deletes the whole space (delete everywhere). |
| `POST /inbox` `{blob}` | **No Authorization.** A change-set sealed to the space's inbox public key by the drop page (`src/sync/inbox.ts`). 201 `{id}`. At most 16 KB, 50 waiting per space; 10 a minute per IP and 20 per space (`RATE_INBOX_IP_PER_MIN`, `RATE_INBOX_SPACE_PER_MIN`); 404 `unknown_space` for a space that doesn't exist; 429 `rate_limited` when over a limit or full. |
| `GET /inbox` | `{items: [{id, blob, at}]}`, oldest first, up to 50 of the last 30 days. |
| `DELETE /inbox/:id` | `{ok, deleted}`; the app calls it once a drop has been applied or dismissed. |

The connector's switch (`/connector`, `/connector/code`) is in [connector.md](connector.md). The link format and the sealed box are in [CHANGESET.md](../CHANGESET.md) ("The one-tap link") and `src/sync/inbox.ts`; the relay only stores the box (table `inbox`, migration 0003, cleared by "delete everywhere").

Errors are `{error: code}`: 400 `bad_request`, 401 `unauthorized`, 403 `forbidden` (wrong secret, nothing written) or `origin_not_allowed`, 404 `unknown_space` / `not_found`, 409 `bad_upto` / `bad_parts` / `wrong_key`, 409 `connector_off`, 413 `too_large`, 429 `rate_limited` (with `Retry-After`), 503 `connector_unavailable`.

Limits: a batch blob is at most 1 MiB, each part of a snapshot 4 MiB (stored in 1 MB chunks, because a D1 row holds 2 MB). Writes are limited to 60 a minute per space and, per IP, 120 a minute counting writes and failed sign-ins (`RATE_SPACE_PER_MIN`, `RATE_IP_PER_MIN`). CORS: only origins matching `ALLOWED_ORIGINS`; `*` stands for one DNS label or a port.

## What the relay can see

The space id, a hash of the auth secret, the size, time and device id of every blob (and which of hot, cold or whole a snapshot row is, and its `upto`; not the cut, the index or the digest, which are inside), the device list (names are encrypted), and IP addresses. Not the contents of anything. The inbox holds sealed boxes it can't open. Push and the calendar feed are not part of sync and have no link to a space, but they live on the same relay: for push, each device's push-service address (an opaque endpoint), the times its notifications are to be sent, their size and when they were sent, and not their text (encrypted on the device for that browser); for the feed, the calendar text, which has generic titles unless the person chose to include step titles (see [push.md](push.md), [feed.md](feed.md)). (While the connector is on, it also holds the key: see [connector.md](connector.md).) The relay never decrypts for sync, which keeps each request far under the free plan's 10 ms of CPU.

## Using it from the app

`syncOnce(store, client, opts)` in `src/sync/run.ts` does a round: pull until caught up, fold in, push, snapshot when due. Provide a `SyncStore` over Dexie; its `putMany` should write through `store.ts`. `RelayClient` is the fetch wrapper (it encrypts and decrypts). Tests use `FakeDevice` from `src/sync/testing.ts`.

## In the app

- `src/data/syncstore.ts`: the `SyncStore` over Dexie (`writeMerged`, `dexieSyncStore`). State is `local['sync.state']`.
- `src/app/store.ts`: `putMerged(writes)` is the only way incoming documents are written (it throws in read-only mode); `onLocalWrite(f)` registers a listener (several are allowed; sync and push each add one) called after each local write; `getClock()`.
- `src/app/sync.ts`: keys and flags in `local` (`sync.key`, `sync.keySaved`, `sync.full`, `sync.lastAt`, `sync.lastError`…), `startSync`, `syncNow` (one round at a time, backoff), `requestSync` (2 s debounce), `markFull` (after an import or restore), set-up / join / turn off / delete, backups, and the `sync` diagnostics section.
- `src/app/SyncSettings.tsx`, `src/app/qr.tsx`: Settings → Sync & devices, the guided flows, the cards on Today, QR drawing and scanning.
- Old-schema documents are upgraded by `upgradeEntries` (migrations) before merging; `SyncStore.upgrade` is optional. A round with `stopIfGone` stops when the relay has no space for a device that had pulled before (deleted elsewhere); `full` pushes every field.

## Running the relay

`npm run relay:dev` (local D1, localhost origins allowed), `npm run relay:test` (Workers runtime, in-memory D1). Deploying needs the real Worker name and D1 id in `relay/wrangler.jsonc`, then `wrangler d1 migrations apply`.

## Rolling out schema 3

Deploy the **app first, the relay a few minutes later**, never the other way round (DECISIONS.md, phase 2b).

- Until the relay is updated, its connector (schema 2) reads the app's schema-3 batches as newer and refuses to read or write, and says so. Nothing is lost, and the connector is the only thing that waits.
- The other way round, the new relay's connector writes and its compactions are schema 3 at once. Every device still on schema 2 then goes read-only, and its Reload banner can only load the old app until the new one is deployed. The banner's Reload (`src/app/reload.ts`) tells a waiting service worker to take over and reloads once it has, so after the app is deployed one tap on Reload is enough.

This is the opposite of the order for wire generation 2 below, which only added blob formats an old app cannot open; there the relay went first.

## Rolling out schema 4

Same order as schema 3: the **app first, the relay a few minutes later**, never the other way round (DECISIONS.md, phase 4).

- Until the relay is updated, its connector (schema 3) reads the app's schema-4 batches as newer and refuses to read or write, and says so. Nothing is lost; the connector is the only thing that waits.
- The other way round, the new relay's connector writes and its compactions are schema 4 at once, and every device still on schema 3 goes read-only until the new app is deployed, with a Reload that can only load the old app.

## Rolling out schema 5

Same order as schemas 3 and 4: the **app first, the relay a few minutes later**, never the other way round (DECISIONS.md, phase 4b). **The relay must be redeployed for schema 5**: it reads `SCHEMA_VERSION` from the app's source (`relay/src/connector/space.ts`), and its change-set validation (`label` on a step, `parent` on a place) is the app's `ChangeSchema` bundled into it.

- What schema 5 adds is optional and stored only when set: `tasks.label`, `places.parentId`, `days.areas`. No collection, no index and no Dexie version are new.
- The migration changes one thing in stored data: `urgent` and `important` are cleared on standing obligations (`template`). Every device does it by itself, as for schema 2's decisions, so the cleared field takes the clock *right after* its old one (`after` in `src/data/hlc.ts`, same node, counter + 1): the same on every device, newer than the value it replaces, so a copy that has not migrated yet loses to it, and older than any real edit. Documents arriving from a device on an older schema go through `upgradeEntries`, which keeps the migration's clock; a partial one that does not carry `template` is left as it is (the flags are ignored by the matrix and the planner anyway).
- Until the relay is updated, its connector (schema 4) reads the app's schema-5 batches as newer, and every tool says to update the relay and writes nothing. Nothing is lost; the connector is the only thing that waits.
- The other way round, the new relay's connector writes (and compacts) schema 5 at once, and every device still on schema 4 goes read-only until the new app is deployed, with a Reload that can only load the old app.
- A device on schema 4 that pulls schema-5 data applies nothing and goes read-only (`newer`; `src/sync/engine.ts`, tested in `engine.test.ts`, `syncstore.test.ts`, `sync.test.ts` and, for the connector, `connector.undo.test.ts`: all use `SCHEMA_VERSION + 1`, so they follow the bump). The backups and the v1 importer migrate through the same list and merge as before.
- Areas are read forgivingly (`src/domain/places.ts`): a parent that is gone, a loop or a chain of more than one level makes the place its own top. Writes are checked (`parentProblem`), which is why two devices that each make a valid change cannot leave a place unreadable.

## Older apps and older blobs

- Blobs of wire generation 1 (format bytes 1 and 2, whole documents, a whole snapshot) are read by every version.
- An app from before generation 2 can't open format bytes 3 and 4 (it gets a decrypt error and applies nothing) and doesn't know the `cold` field. For that change the relay went first, then the app; an app that was not yet updated stops syncing with an error until it is reloaded, and loses nothing.
- A whole snapshot on the relay stays readable by everything. The first app of the new version that snapshots replaces it with two parts. A whole snapshot from an old app replaces two parts (it holds everything).
