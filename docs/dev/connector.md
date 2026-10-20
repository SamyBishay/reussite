# The connector

A remote MCP server inside the relay Worker (`relay/src/connector/`). An AI app the person already pays for (Claude first) reads and edits their list through it, at no AI cost to Réussite. Brief §10. It stays off until the person switches it on.

## How it fits together

```
AI app ──OAuth 2.1 + DCR──▶ /oauth/register, /authorize (pairing code), /oauth/token
       ──Bearer token──────▶ /mcp  (Streamable HTTP, stateless, JSON responses)
                                │ props {spaceId}
                                ▼
                  decrypt the snapshot's hot part + later batches ──▶ tools ──▶ one encrypted batch, device "connector"
```

- `@cloudflare/workers-oauth-provider` (pinned) sits in front of the Worker. It owns `/oauth/*`, the discovery documents (`/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource/mcp`) and token checks; storage is the KV namespace `OAUTH_KV`. Everything else goes to `handle` in `relay/src/index.ts`.
- `/mcp` is built with `createMcpHandler` from `agents/mcp/server` (stateless, no Durable Objects) over `@modelcontextprotocol/server` 2.x, which is what that version of the Agents SDK takes. A server with its ten tools is built for every request; that costs about 1 ms.
- Tool input is validated by zod schemas; change-sets by the app's own `ChangeSchema` (`src/ai/changeset.ts`) and planned by the app's own `planChanges` (`src/ai/apply.ts`). What a write means (`finishEffects`, `newTaskFields`, `nextOccurrence`, `projectCompletes`, `dueRulePatches`) is in `src/domain/effects.ts`, shared with `src/app/actions.ts`; the read rules are in `src/domain/lists.ts`, shared with `src/app/model.ts`. The Worker has no copy of the data model, merge, change-set schema or validation.

## Switching on and off (app → relay)

`Authorization: Bearer <auth secret>` as for sync. Types are in `src/sync/protocol.ts`.

| | |
| --- | --- |
| `POST /v1/spaces/:space/connector` `{key}` | `key` is the space's raw 32-byte encryption key, base64url (`SpaceKeys.encKeyRaw`). The relay checks that it opens what the space already holds (409 `wrong_key` if not), stores it and the auth secret wrapped with AES-GCM under `CONNECTOR_WRAP_KEY` (D1 table `connector`), registers the device `connector` with the encrypted label `{name: "Connector"}`, and returns 201 `{on: true, code, expires, url}`. `code` is `ABCD-EFGH`, shown once; `url` is what to add in the AI app. 503 `connector_unavailable` if the secret isn't set (nothing is stored). Safe to repeat. |
| `POST …/connector/code` | A fresh code `{code, expires}`. 409 `connector_off` if the connector isn't on. |
| `GET …/connector` | `{on, lastUsed, url}`; `lastUsed` is ms or `null`. |
| `DELETE …/connector` | Deletes the wrapped key, codes, pending confirmations, undo records and the `connector` device row, then revokes every grant and token of the space at once (`listUserGrants` / `revokeGrant`, with the space id as the user id). `{ok: true, revoked: n}`. |

"Delete everywhere" (`DELETE /v1/spaces/:space`) does the same, and the connector's tables are in `SPACE_TABLES`. The rate limits of sync apply (60 writes a minute per space, per IP).

The pairing code is 8 characters from `ACDEFGHJKMNPRTVWXY34679` (no 0 O Q, 1 I L, 2 Z, 5 S, 8 B, U), single use, valid 10 minutes, kept only as an HMAC under the wrap key. At most three unused codes per space.

## Signing in (AI app → relay)

1. The app registers itself (`POST /oauth/register`, dynamic client registration). Redirect URIs are exact-matched; `https://claude.ai/api/mcp/auth_callback` and `https://claude.com/api/mcp/auth_callback` work like any other registered URI. A client with no compliant redirect is refused by the library.
2. `GET /authorize?…` shows a small page (no scripts, fonts or images, inline CSS, light and dark, 320 px, English or French from `Accept-Language`): the app's name (escaped), where the sign-in goes, "read and edit this list", and one field, the pairing code. The OAuth library's consent helpers carry the request (a one-use handle plus a cookie bound to the browser).
3. `POST /authorize?…` with a valid code completes the authorization with `userId` = the space id and `props` `{spaceId}`. A wrong, used or expired code shows the page again with a plain error and issues nothing. Cancel sends `access_denied` back to the app.
4. Attempts are limited per IP (`RATE_PAIR_IP_PER_MIN`, default 10 a minute) and overall (`RATE_PAIR_ALL_PER_MIN`, default 60; a code doesn't say which space it belongs to, so guesses can't be counted per space). Failed attempts also draw on the IP's general budget. Per space: at most three live codes, and the space's write limit applies when a grant is completed.

Access tokens last an hour; a grant lives while the app keeps refreshing it (idle limit 90 days). Switching off revokes all of them.

## The tools

All answers are plain text, compact lines `id | title | Q1 | due | estimate | project` as the app's AI context uses (`stepLine`). Quadrants: Q1 now, Q2 plan, Q3 quick, Q4 later. A tool error is a normal result with `isError: true` and a sentence saying what to do.

| tool | input | answers |
| --- | --- | --- |
| `today` | none | The date and place; the next step with its starter and resume note; today's list in order with the estimated total and its personal range; launch points; fixed times; steps carried from yesterday; decisions to check; what is done today. |
| `get_day` | `date` | The same for any date. |
| `query_tasks` | `quadrant?` 1–4, `project?` id or name, `place?` id, name or `any`, `status?` `open` (default) `done` `dropped` `all`, `due_from?`, `due_to?`, `text?` (all words, case and accents ignored), `limit?` ≤ 50 | At most 50 lines, most pressing first (done steps newest first), with the count. |
| `get_task` | `id` (an id or a title) | The step with its fields and its work sessions. |
| `get_project` | `id` (an id or a name) | Goal, SMART fields, counts, at most 50 open steps. |
| `get_decision` | `id` (an id or a title) | Problem, options with their four columns, the choice, its steps. |
| `read_memory` | `name?` a note id, name or alias, or words that contain one; `query?` free words | What the person told Réussite. Nothing: the profile in full, then the index of the other notes (`id \| kind \| name \| aliases`, newest first, at most 60). A name: the matching notes (by id, name, alias, then a whole-word name in the text, then a unique prefix of whole words) and a query: the notes named in it or with all its words in one line; each note as the app's AI reads it (`noteBlock`, `src/domain/memory.ts`: the head, then the lines numbered from 1) and the open steps that name it (`queryText`, at most 10). At most 8 notes. No match: one sentence and the index. |
| `get_method` | `language?` `en` or `fr` | `METHOD.<lang>.md` and `CHANGESET.md` in short form (bundled as text modules). Needs no list. |
| `apply_changes` | `changes?` (the change-set's list), `note?`, `v?`, `confirm?` | See below. |
| `undo` | `id` | See below. |

Server instructions (sent at initialisation): what Réussite is; call `get_method` before planning or a decision; call `read_memory` when the person names someone, a place or a matter; a new fact goes through `apply_changes` as `memory.add`, in their words, and a memory change always waits for their yes; never change the list without the person's yes except one low-risk change; one `apply_changes` for a quick edit; titles work for ids; no weights.

**Memory is private by construction.** `read_memory` filters out every note with `private: true` before it matches anything, so no id, name, alias or word in a line of a private note finds it, and nothing in an answer says one exists (a miss says only that nothing matches). `apply_changes` leaves them out the same way (step 2 above). The note format is the app's (`noteBlock`): one function writes it for the app's prompts and for this tool.

### `apply_changes`

The input is the contract in `docs/CHANGESET.md` (version 1, same operations). Steps:

1. Every change is checked with `ChangeSchema`. Any error → nothing is written and **all** errors come back (`Change 2 (task.update): set.due: YYYY-MM-DD`).
2. Titles become ids wherever an id is expected (`task.update/done/drop` ids, `task.reorder`, `day.update`, `set.after`, `set.project`, `set.where`, project and place ids). An id or a ref made in the same change-set is left alone; otherwise the title is matched exactly, then by a unique prefix of whole words, ignoring case, accents and punctuation. Several matches → the candidates come back as lines and nothing is written. No match → "No step with the id or title …", nothing written.
   A memory note (`note` of `memory.*`) is found the same way by id, name or alias, private notes left out; `memory.add` with a `kind` names a new note instead and is not looked up (a name a private note has makes a new open note, exactly as a name no note has). A note that two notes match (the same name or alias) is left alone. A confirmation id keeps each line pinned to its id (`pinLines`), so a yes an hour later edits the line that was shown, and line changes are written on the note as it is then. Notes are read only when a change asks.
3. The set is planned with `planChanges`. Changes that come to nothing (already so) are listed, not written.
4. **One low-risk change** (`isLowRisk` in `src/ai/apply.ts`: a single change that adds a step, ticks one done, or moves one date, meaning only `due`, or `due` and `at`) is applied at once (a memory change never is, and a new standing obligation, one `task.create` with `template`, `weekdays` and `at`, is): one encrypted batch under the device `connector`, a receipt of what changed, the ids created, and an **undo id** (`u…`).
5. **Anything else** is not written. The answer is the diff (`before → after`) and a **confirmation id** (`c…`), stored encrypted for one hour. Calling `apply_changes` again with only `{"confirm": "c…"}` applies it. If the list changed meanwhile so the plan is no longer the same size, the confirmation is dropped and a fresh one is asked for.
6. "R: choir Monday 19:00, Hill House 602" is one call: `{"op": "task.create", "set": {"title": "Choir, Hill House 602", "project": "Choir", "due": "2026-10-26", "at": "19:00", "dur": 90}}`.

AI-originated fields carry `by: "ai"` / `src: "ai"` as in the app. Weights are never taken from an AI.

### `undo`

Reverts one applied change-set by its undo id. Each document the change-set touched remembers, per field, the value it replaced and the value it wrote (encrypted with the space key, kept 30 days). Undo writes the old values back as **new** changes with fresh clocks, so they reach the app at its next sync. A field the person changed since (its current value isn't the one the change-set wrote) is left alone and named. A document the change-set created is undone with a tombstone (`_del`), never a hard delete, and only if nothing was written to it since (no field with a newer clock than the change-set's) and nothing made since refers to it (a session on a step, a step in a project); otherwise it stays and is named as left alone. A timer that the change-set stopped is not started again by an Undo made much later. An undo id works once.

The revert itself is `undoWrites` in `src/ai/undo.ts`, the same function the app's Undo uses (`applyUndo` in `src/app/store.ts`); the records are `UndoDoc` (`src/data/schema.ts`), made by `UndoLog`. **Memory:** a change to a memory note records the note's `lines` before and after, so an undo record in `connector_undo` (30 days, encrypted with the space key like the rest) can hold text the person has since forgotten. It is deleted with the record: when used, after 30 days, or when the connector is switched off. A memory line the person forgets in the app is gone from the notes at once, but a record made by the connector before that may still hold its text for up to 30 days; switching the connector off removes them now.

## Rolling out

The relay is deployed a few minutes **after** the app (docs/dev/sync.md, "Rolling out schema 3"). A relay that is newer than the app's data writes schema 3 at once and puts every device still on schema 2 into read-only mode. An older relay reads the app's schema-3 batches as newer, and every tool says to update the relay and writes nothing.

## The connector as a device

Its node id is `connector`; its clock is kept per space in D1 (`connector.hlc_wall`, `hlc_counter`) and is moved past every timestamp it reads, so a phone with a fast clock can't make the connector's writes lose against older values. It writes with the same document functions as the app (`create`, `patch`, `remove` in `src/data/doc.ts`), collects what to send with `collectOutgoing` (every field whose clock carries its node and is above the clock it started from), and appends the batch through the same code path as `POST /batches` (`appendBatch`: sequence number, per-space rate limit). The space is read with `loadSpace` (`relay/src/connector/space.ts`): the snapshot's **hot part** goes straight into maps (it has each document once), later batches are folded in with `applyIncoming`. The cold part is read (`loadCold`, merged under the hot documents) only when something needs it, see "What a call reads". A document from a newer schema than the Worker's `SCHEMA_VERSION` makes every tool answer "update the relay" and write nothing.

Every call updates `connector.last_used` in the same statement that checks the connector is on. When it isn't, `/mcp` answers 403 with a message saying so (normally the token is already revoked and the answer is 401).

## What the relay can read while the connector is on

The whole list: the relay holds the space's key (wrapped; unwrapped in memory for each call) and decrypts it to answer. It also keeps, encrypted with that key, the change-sets waiting for a yes and the undo records. The wrap key (`CONNECTOR_WRAP_KEY`, a Worker secret) never leaves the Worker. Whoever runs the relay could read the space during this time, and only a new recovery key fully undoes having shared it. Switching off deletes the key, the codes, the pending and undo records, and revokes every token. The privacy note in the app says this in plain words, and Settings → Connector (`src/app/ConnectorSettings.tsx`) says it before the button and again in the confirmation. The app asks `GET …/connector` when Settings opens and every ten minutes, keeps `on` and `lastUsed` in `local` for the diagnostics `[connector]` section, and shows the relay's `connector` device row with its last use instead of the row's own `last_seen`.

## What a call reads

A snapshot is in two parts, hot and cold (docs/dev/sync.md, "Hot and cold"). Hot holds what the common questions are about; cold holds finished history. A snapshot written before the split is one whole part and is read whole.

| call | reads |
| --- | --- |
| `read_memory` | hot only (every live note is in the hot part; so are the open steps it lists) |
| `today`, `get_day` (a date in the hot window, 30 days back and all the future), `query_tasks` for open steps, `get_project`, `get_decision`, `get_task` by id for an open or recent step, `apply_changes` and `undo` on open or recent things | hot only |
| `query_tasks` with `status` done, dropped or all; `get_day` for an older date; `get_task` by an id or title that isn't in hot; `apply_changes` naming a step that isn't in hot or a day or step that exists only in cold | hot, then cold |

How it is done: a tool that finds it needs cold throws `NeedCold` before it has written anything, the wrapper in `tools.ts` reads cold and runs it again (a write starts from copies of the maps, so a run that stopped half way leaves nothing behind). Two things keep hot-only answers equal to whole-list answers (a test compares them): the hot header's **index** of cold ids says whether a document that a batch touched, or that a day or decision points to, also lives in cold, and then cold is read first; and its **digest** gives the personal estimate (steps done in the last 400 days, so older ones weigh under 1%) and "steps done" per project (`ColdDigest`; `View.cold`). Titles are looked up among hot steps first, and in cold only if none matches there.

After a write the connector may cut the hot part again (`compact`): once 10 batches (`COMPACT_TAIL`) have piled up on it, if the cold part wasn't involved and the hot part is under 600 documents (`COMPACT_MAX_DOCS`; above that gzip alone takes more than the call has left), or at once when this call had to read cold and so holds the whole list. It never rewrites the cold part; the apps do, about weekly. `storeSnapshot` (`relay/src/sync.ts`) is the one place that writes a snapshot, for the HTTP route and for this.

## CPU on the free plan

The free plan gives a request 10 ms of CPU. One call used to decrypt, gunzip and parse the whole snapshot (3.5 MB of JSON for a list of 1,500 steps and 3,000 sessions) and fold up to 50 batches, 25 to 45 ms. Four changes, in the order they were measured (`npm run relay:bench`, median ms of CPU on a laptop, Node's V8; database round trips not counted; `BENCH_SIZE=today` is the owner's list: 281 steps, 110 sessions; the default is the heavy one: 1,500 and 3,000):

| | today's list, read | today's list, `today` | heavy, read | heavy, `today` |
| --- | --- | --- | --- | --- |
| whole snapshot, 30 batches (before) | 12.2 | 11.6 | 31.2 | 36.3 |
| snapshot after 8 batches | 6.1 | 9.3 | 28.4 | 41.4 |
| clocks on the wire as one base clock a document | 5.2 | 6.8 | 21.4 | 27.3 |
| hot part only (the tool's own time also fell by memoising the view: it built an Intl formatter for every line it printed) | 2.7 | 2.3 | 6.1 | 9.2 |
| warm isolate, the cache holds the merged list | 0.3 | 1.1 | 0.3 | 2.6 |

**Memory.** Notes are always in the hot part, so a space with 150 notes of 8 lines (`BENCH_MEMORY`, the default of `npm run relay:bench`) reads about 1.2 ms slower on a cold isolate for every call, `read_memory` or not, and the notes are built into maps only by a call that reads them (`View.memory` is a getter). Measured on a laptop, median ms, cold isolate with no cache, read plus tool (today's list: 281 steps, 110 sessions): `today` 3.1, `read_memory` 2.8, `read_memory` by name with its steps 3.4, `read_memory` by a query that reads every line 4.2; warm isolate 0.4, 0.9 and 1.6. On the heavy list: `today` 10.1 (8.6 without memory), `read_memory` 6.3, by name 9.1, by query 10.8. The tool's own work is 0.3 ms with no arguments, 0.7 by name and 2.6 by query; the rest is the read.

What is left: on the heavy list the hot part is 583 steps and 485 sessions, 480 KB of JSON in 100 KB. Reading it is gunzip 1.3 ms, UTF-8 and `JSON.parse` 1.6 ms, rebuilding each document's `_hlc` 1.9 ms, the tail of 8 batches 0.8 ms; AES-GCM is 0.1 ms. So parsing and rebuilding dominate, not crypto. The tool's own work is 0.2 to 2 ms, the MCP layer 1.2 ms on top. The first call of a fresh process is slower (cold code: 8 to 15 ms at today's size, 20 to 35 at the heavy one). Rewriting the hot part (`compact`) costs 2.6 ms for today's list and 17 ms for the heavy one, mostly gzip, which is why the connector leaves it to the apps above 600 documents.

**The cache.** A module-level LRU in the Worker isolate (`relay/src/connector/cache.ts`) keeps the decrypted, merged maps of up to 3 spaces (24 MB by a rough count), keyed by space and the wrapped key, with the highest seq they contain. A call that finds its space there reads only the batches after that seq (plus a small query that checks no newer snapshot folded batches away and the space still exists). It is an optimisation: a new isolate starts empty, and the benchmark reports the cold-isolate number (no cache) as the guarantee and the warm one apart. It holds plaintext in the isolate's memory only while the connector is on, which doesn't change the trust model: the relay already holds the key then, and everyone who can run the Worker can read the list as it is. An entry is dropped when the connector is switched off or the space deleted (in the isolate that handles that), when it is switched on again (the wrapped key differs), after 5 minutes idle, and to stay within its budget. Other isolates can't be reached from the one that handles the switch-off, but every call first runs the statement that checks the connector is on, so a stale entry there can never answer; it is gone with its isolate or after 5 idle minutes. A call that writes works on copies of the maps it changes, and a refused write leaves the cache alone.

## Running it

`relay/.dev.vars` (gitignored; see `.dev.vars.example`) holds `CONNECTOR_WRAP_KEY` (`openssl rand -base64 32`) and `RELAY_URL`. `npm run relay:dev`, `npm run relay:test`, `npm run relay:bench`. To deploy: set `RELAY_URL` and the real names and ids in `relay/wrangler.jsonc`, create the KV namespace `OAUTH_KV`, run the D1 migrations, `wrangler secret put CONNECTOR_WRAP_KEY`. Check the bundle with `wrangler deploy --dry-run --outdir out` (about 360 KiB gzipped; the free plan allows 3 MiB).
