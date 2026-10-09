# Réussite — notes for coding agents

Réussite is a local-first PWA for planning with a CBT method for adult ADHD. Read `BRIEF.md` (what to build, by phase), `DECISIONS.md` (choices already made) and `docs/METHOD.en.md` (the method) before changing behaviour.

## Commands

| | |
| --- | --- |
| `npm run dev` | dev server |
| `npm test` | unit tests (Vitest) |
| `npm run typecheck` | TypeScript, strict |
| `npm run e2e` | end-to-end tests, Chromium |
| `npm run e2e:webkit` | end-to-end tests, WebKit and iPhone emulation, in Playwright's container (podman) |
| `npm run build` | production build into `dist/` |
| `npm run check:import`, `npm run check:app` | run the importer and the app on the real export in `private/`; they print counts only |

## Layout

- `src/domain/` — pure functions with no I/O: dates and the day-start rule, urgency and quadrants, ratio, duration buttons, link resolution. Every rule here has a unit test.
- `src/data/` — the data model (`schema.ts`), hybrid logical clock (`hlc.ts`), documents with per-field clocks and tombstones (`doc.ts`), Dexie database (`db.ts`), migrations, v1 importer, backups, settings defaults.
- `src/app/` — state (`store.ts`: signals mirroring IndexedDB, and the only place that writes), read helpers (`model.ts`), write actions (`actions.ts`), shared UI and sheets, theme.
- `src/views/` — one file per tab.
- `src/i18n/` — `en.ts` and `fr.ts`; every UI string lives there.
- `tests/e2e/` — Playwright; `tests/private/` — checks against the real export (never committed data).

## Invariants

1. **Never lose data.** No hard deletes: set `_del`. Never drop a field you don't recognise. Importing and restoring merge; they don't replace.
2. **Migrations are mandatory.** Any change to stored shapes bumps `SCHEMA_VERSION` and adds a function to `src/data/migrations/index.ts`, with a test on fixtures of every earlier version. Migrations run before any write, after a local backup.
3. **Settings are data.** New settings get defaults in `DEFAULT_SETTINGS`; an update never resets a value the person chose.
4. **Every write goes through `store.ts`** (`createDoc`, `update`, `upsert`, `removeDoc`) so it gets field clocks and respects read-only mode.
5. **No hard-coded UI text, and nothing personal.** Strings go in both `en.ts` and `fr.ts` (the type check enforces the keys). French typography is applied automatically.
6. **`private/` is never committed, printed or sent anywhere.** Checks that read it print counts only.
7. **Tests must pass** (`npm test`, `npm run typecheck`, `npm run e2e`) before a commit. Nothing may scroll sideways at 320, 375 or 430 px.
8. Links open outside the app; only schemes in `ALLOWED_SCHEMES` are accepted.
