# Réussite — notes for coding agents

Réussite is a local-first PWA for planning with a CBT method for adult ADHD. The build brief (what to build, by phase) is the Claude doc "Réussite 2 — build brief" on the owner's account (https://claude.ai/code/artifact/b9d2a428-4a60-475c-8f19-e7b64cea1b19), read with the Claude Docs connector. Ignore `BRIEF.md` in this repo: it is out of date and not to be consulted. Read the doc, `DECISIONS.md` (choices already made) and `docs/METHOD.en.md` (the method) before changing behaviour.

## Commands

| | |
| --- | --- |
| `npm run dev` | dev server |
| `npm test` | unit tests (Vitest) |
| `npm run typecheck` | TypeScript, strict |
| `npm run e2e` | end-to-end tests, Firefox (the main desktop browser) |
| `npm run e2e:android` | end-to-end tests, Chrome on Android emulation |
| `npm run e2e:webkit` | end-to-end tests, WebKit and iPhone emulation, in Playwright's container (podman) |
| `npm run manual:shots` | the manual's screenshots (`public/manual/shots`), not part of `e2e`; see `docs/dev/manual.md` |
| `npm run build` | production build into `dist/` |
| `npm run check:import`, `npm run check:app` | run the importer and the app on the real export in `private/`; they print counts only |

## Layout

- `src/domain/` — pure functions with no I/O: dates and the day-start rule, urgency and quadrants, ratio, duration buttons, link resolution, repeats, chains (`chains.ts`: steps that wait for one another as one card, one pure index shared with the relay), personal estimates, the planner, decision scores, stays, matrix moves, calendar grids, and Home's: the line parser (`parse.ts`, grammar in `docs/dev/home.md`), the greeting (`greeting.ts`), memory notes and their format in a prompt (`memory.ts`), memory import and export as Markdown (`memoryMd.ts`), and the one name-matching rule (`names.ts`: `findByName`, `mentions`); areas in use (`areas.ts`: select order, chips, grouping, half days; the rules of areas themselves are `places.ts`) and a person's page (`people.ts`); phase 4b's: a step's short name for calendars (`label.ts`) and areas of a place (in `places.ts`: `zoneOfPlace`, `onPage`, `placeAndAreas`, `parentProblem`); and phase 4's: Maps links (`mapsLink.ts`), the offers for addresses and people (`offers.ts`, and `offerPick.ts`: what a picked offer sets on the step), the Google Takeout parser (`takeout.ts`) and the trip pack's text (`trip.ts`); and phase 4b's: short names (`label.ts`), areas (`places.ts`), what the calendar exports say of a step (`calItems.ts`: the all-day events and the three levels of detail; `ics.ts` only formats), the feed's text (`feedText.ts`, shared with the connector) and what the Calendar tab shows on each day (`calView.ts`: the hour grid's events and the all-day row). Every rule here has a unit test.
- `src/data/` — the data model (`schema.ts`), hybrid logical clock (`hlc.ts`), documents with per-field clocks and tombstones (`doc.ts`), Dexie database (`db.ts`), migrations, v1 importer, backups, settings defaults.
- `src/app/` — state (`store.ts`: signals mirroring IndexedDB, and the only place that writes), read helpers (`model.ts`), write actions (`actions.ts`), shared UI and sheets, `More`/`Fold` (the folded optional fields of every form and the folded Settings sections, `More.tsx`), theme; Home's logic, exchanges and Undo (`home.ts`), the views and the hash (`nav.ts`), keyboard detection for the bottom bar (`keyboard.ts`), Memory's writes (`memoryActions.ts`), addresses and people (create, edit, record a visit, last seen: `actions.ts`; offers and categories: `model.ts`), the read-only banner's Reload (`reload.ts`), the area filter per view (`areas.ts`) and its chips and editor (`AreaUi.tsx`), the Places sheet (`PlacesSheet.tsx`), Addresses and people's sheets and the after-visit screen (`AddressSheets.tsx`) and the Takeout import (`TakeoutSheet.tsx`).
- `src/ai/` — AI (phase 2): provider adapters (`adapters.ts`), the one entry point `ask`/`askChanges` with "Show me what's sent" (`ask.ts`), prompt and context building (`context.ts`), the change-set contract (`changeset.ts`, documented in `docs/CHANGESET.md`), pure plan-and-apply (`apply.ts`) with the app's writer (`writer.ts`), the review screen (`Review.tsx`), the command box, Ask any AI and Paste the reply (`ui.tsx`), Settings → AI (`AiSettings.tsx`), the pure Undo shared with the relay (`undo.ts`), model prices and the monthly cap (`prices.ts`). "Plan this trip" (phase 4) builds its pack in `trip.ts` from a stay in Settings, and its reply comes back through Paste the reply; `address.create` is an op of the app only (the connector refuses it).
- `src/push/` — Web Push (phase 3b): the shared types and limits (`protocol.ts`), RFC 8291 encryption (`encrypt.ts`), VAPID tokens (`vapid.ts`), the reconciler's diff (`reconcile.ts`), the notification payload (`notification.ts`), the relay calls (`client.ts`), what the browser supports (`support.ts`). The schedule itself is `src/domain/notify.ts`; the app side is `src/app/push.ts` and `NotifySettings.tsx`; see `docs/dev/push.md`.
- `src/feed/` — the calendar feed's ids and limits shared with the relay (`protocol.ts`); the upload is `src/app/feed.ts`, the text is `src/domain/ics.ts`; see `docs/dev/feed.md`.
- `src/sw.ts` — the service worker (vite-plugin-pwa `injectManifest`): precache, update banner, `push` and `notificationclick`. Its own `tsconfig.sw.json` (WebWorker lib).
- `src/views/` — one file per tab or screen: Home, Today, Matrix, Projects, Calendar (with the Log; the grid itself, `CalendarGrid.tsx`, is Schedule-X in a lazy chunk, styled by `src/styles/calendar.css`), Settings, Memory, History, Addresses; see `docs/dev/home.md`.
- `src/flows/` — guided flows, one question per screen: first-run onboarding (`onboarding.tsx`; when it shows is `src/app/onboarding.ts`, see `docs/dev/onboarding.md`), check-in and planner, break it down, I'm stuck, decisions, weekly review, the close-of-day show.
- `src/manual/` — the manual's viewer (`Manual.tsx`, lazy, opened from Settings → About), its small Markdown reader (`markdown.ts`) and the page order (`pages.ts`); the pages are `docs/manual/<language>/*.md` (English and French) and the pictures `public/manual/shots/`, made by `tests/manual/manual.spec.ts`; see `docs/dev/manual.md`. Update the pages when behaviour changes, and re-run `npm run manual:shots` when a screen does.
- `src/i18n/` — `en.ts` and `fr.ts`; every UI string lives there. `fr.ts` may lag behind: missing keys fall back to English and are translated in one batch at the end of each phase (the i18n test lists them).
- `docs/ai/` — the AI kit: `skills/<name>.md` (today, decide) are plain prompts to paste into any chatbot, `skills/<name>/SKILL.md` the same as Claude skills; `preferences.md`, the short `CHANGESET.md`. Update them with `docs/METHOD.en.md` and `docs/CHANGESET.md`. `README.md` is for friends; `CUSTOMIZING.md` is for forks (update it with `docs/dev/infra.md` when a var, secret or build setting changes).
- `src/assets/dove/`, `scripts/dove/` — the pictures cut out of Hilma af Klint's The Dove (the celebration in `src/app/stgeorge.ts`, the onboarding mark) and the scripts and masks that make them and the icons; see `docs/dev/dove.md`.
- `tests/e2e/` — Playwright; `tests/manual/` — the manual's screenshots (their own config); `tests/private/` — checks against the real export (never committed data).

## Invariants

1. **Never lose data.** No hard deletes: set `_del`. Never drop a field you don't recognise. Importing and restoring merge; they don't replace.
2. **Migrations are mandatory.** Any change to stored shapes bumps `SCHEMA_VERSION` and adds a function to `src/data/migrations/index.ts`, with a test on fixtures of every earlier version. Migrations run before any write, after a local backup.
3. **Settings are data.** New settings get defaults in `DEFAULT_SETTINGS`; an update never resets a value the person chose.
4. **Every write goes through `store.ts`** (`createDoc`, `update`, `upsert`, `removeDoc`) so it gets field clocks and respects read-only mode.
5. **No hard-coded UI text, and nothing personal.** Strings go in `en.ts`, and in `fr.ts` by the end of the phase. French typography is applied automatically.
6. **`private/` is never committed, printed or sent anywhere.** Checks that read it print counts only.
7. **Tests must pass** (`npm test`, `npm run typecheck`, `npm run e2e`) before a commit. Nothing may scroll sideways at 320, 375 or 430 px.
8. Links open outside the app; only schemes in `ALLOWED_SCHEMES` are accepted.
