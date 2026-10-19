# The connector

A remote MCP server inside the relay Worker (`relay/src/connector/`). An AI app the person already pays for (Claude first) reads and edits their list through it, at no AI cost to Réussite. Brief §10. It stays off until the person switches it on.

## How it fits together

```
AI app ──OAuth 2.1 + DCR──▶ /oauth/register, /authorize (pairing code), /oauth/token
       ──Bearer token──────▶ /mcp  (Streamable HTTP, stateless, JSON responses)
                                │ props {spaceId}
                                ▼
                  decrypt snapshot + later batches ──▶ tools ──▶ one encrypted batch, device "connector"
```

- `@cloudflare/workers-oauth-provider` (pinned) sits in front of the Worker. It owns `/oauth/*`, the discovery documents (`/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource/mcp`) and token checks; storage is the KV namespace `OAUTH_KV`. Everything else goes to `handle` in `relay/src/index.ts`.
- `/mcp` is built with `createMcpHandler` from `agents/mcp/server` (stateless, no Durable Objects) over `@modelcontextprotocol/server` 2.x, which is what that version of the Agents SDK takes. A server with its nine tools is built for every request; that costs about 1 ms.
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
| `get_method` | `language?` `en` or `fr` | `METHOD.<lang>.md` and `CHANGESET.md` in short form (bundled as text modules). Needs no list. |
| `apply_changes` | `changes?` (the change-set's list), `note?`, `v?`, `confirm?` | See below. |
| `undo` | `id` | See below. |

Server instructions (sent at initialisation): what Réussite is; call `get_method` before planning or a decision; never change the list without the person's yes except one low-risk change; one `apply_changes` for a quick edit; titles work for ids; no weights.

### `apply_changes`

The input is the contract in `docs/CHANGESET.md` (version 1, same operations). Steps:

1. Every change is checked with `ChangeSchema`. Any error → nothing is written and **all** errors come back (`Change 2 (task.update): set.due: YYYY-MM-DD`).
2. Titles become ids wherever an id is expected (`task.update/done/drop` ids, `task.reorder`, `day.update`, `set.after`, `set.project`, `set.where`, project and place ids). An id or a ref made in the same change-set is left alone; otherwise the title is matched exactly, then by a unique prefix, ignoring case, accents and punctuation. Several matches → the candidates come back as lines and nothing is written. No match → "No step with the id or title …", nothing written.
3. The set is planned with `planChanges`. Changes that come to nothing (already so) are listed, not written.
4. **One low-risk change** (`isLowRisk` in `src/ai/apply.ts`: a single change that adds a step, ticks one done, or moves one date, meaning only `due`, or `due` and `at`) is applied at once: one encrypted batch under the device `connector`, a receipt of what changed, the ids created, and an **undo id** (`u…`).
5. **Anything else** is not written. The answer is the diff (`before → after`) and a **confirmation id** (`c…`), stored encrypted for one hour. Calling `apply_changes` again with only `{"confirm": "c…"}` applies it. If the list changed meanwhile so the plan is no longer the same size, the confirmation is dropped and a fresh one is asked for.
6. "R: choir Monday 19:00, Hill House 602" is one call: `{"op": "task.create", "set": {"title": "Choir, Hill House 602", "project": "Choir", "due": "2026-10-26", "at": "19:00", "dur": 90}}`.

AI-originated fields carry `by: "ai"` / `src: "ai"` as in the app. Weights are never taken from an AI.

### `undo`

Reverts one applied change-set by its undo id. Each document the change-set touched remembers, per field, the value it replaced and the value it wrote (encrypted with the space key, kept 30 days). Undo writes the old values back as **new** changes with fresh clocks, so they reach the app at its next sync. A field the person changed since (its current value isn't the one the change-set wrote) is left alone and named. A document the change-set created is undone with a tombstone (`_del`), never a hard delete. An undo id works once.

## The connector as a device

Its node id is `connector`; its clock is kept per space in D1 (`connector.hlc_wall`, `hlc_counter`) and is moved past every timestamp it reads, so a phone with a fast clock can't make the connector's writes lose against older values. It writes with the same document functions as the app (`create`, `patch`, `remove` in `src/data/doc.ts`), collects what to send with `collectOutgoing` (every field whose clock carries its node and is above the clock it started from), and appends the batch through the same code path as `POST /batches` (`appendBatch`: sequence number, per-space rate limit). Batches and snapshots are read with `loadSpace` (`relay/src/connector/space.ts`): the snapshot goes straight into maps (it has each document once), later batches are folded in with `applyIncoming`. A document from a newer schema than the Worker's `SCHEMA_VERSION` makes every tool answer "update the relay" and write nothing.

Every call updates `connector.last_used` in the same statement that checks the connector is on. When it isn't, `/mcp` answers 403 with a message saying so (normally the token is already revoked and the answer is 401).

## What the relay can read while the connector is on

The whole list: the relay holds the space's key (wrapped; unwrapped in memory for each call) and decrypts it to answer. It also keeps, encrypted with that key, the change-sets waiting for a yes and the undo records. The wrap key (`CONNECTOR_WRAP_KEY`, a Worker secret) never leaves the Worker. Whoever runs the relay could read the space during this time, and only a new recovery key fully undoes having shared it. Switching off deletes the key, the codes, the pending and undo records, and revokes every token. The privacy note in the app says this in plain words, and Settings → Connector (`src/app/ConnectorSettings.tsx`) says it before the button and again in the confirmation. The app asks `GET …/connector` when Settings opens and every ten minutes, keeps `on` and `lastUsed` in `local` for the diagnostics `[connector]` section, and shows the relay's `connector` device row with its last use instead of the row's own `last_seen`.

## CPU on the free plan

One call decrypts, gunzips and parses the whole snapshot before it can answer, which costs several times the free plan's 10 ms. `npm run relay:bench` measures it on a synthetic space (1,500 steps, 3,000 sessions, 200 days, 40 projects, 20 decisions). See DECISIONS.md for the numbers and the options. A connector-owned cache of the merged state would not help: it is as big as the snapshot and writing it costs more CPU than reading it.

## Running it

`relay/.dev.vars` (gitignored; see `.dev.vars.example`) holds `CONNECTOR_WRAP_KEY` (`openssl rand -base64 32`) and `RELAY_URL`. `npm run relay:dev`, `npm run relay:test`, `npm run relay:bench`. To deploy: set `RELAY_URL` and the real names and ids in `relay/wrangler.jsonc`, create the KV namespace `OAUTH_KV`, run the D1 migrations, `wrangler secret put CONNECTOR_WRAP_KEY`. Check the bundle with `wrangler deploy --dry-run --outdir out` (about 360 KiB gzipped; the free plan allows 3 MiB).
