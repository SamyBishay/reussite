See AGENTS.md.

@AGENTS.md

## File map

Line counts are rough (many lines are long). Details of each folder are in AGENTS.md → Layout.

| Path | Purpose | ~Lines |
| --- | --- | --- |
| `src/domain/` | Pure rules, no I/O: days, urgency, planner, chains, calendar text, greeting, day order. Every rule has a unit test | 9.2k |
| `src/data/` | Schema, migrations, clocks, Dexie, settings defaults | 2.3k |
| `src/app/` | Store (`store.ts` writes), actions, model, shared UI, the top edge (`Topbar.tsx`: `#topbar`, the sticky header every screen sits under), sheets (`sheets.tsx` is the one import path; the code is in `sheetBase.ts`, `timerSheets.tsx`, `taskSheet.tsx`, `moveSheets.tsx`) | 9.6k |
| `src/views/` | One file per tab: Home, Today, Matrix, Projects, Calendar, Settings… | 2.4k |
| `src/flows/` | Guided flows: set-up, morning, review, decisions, close of day | 2.8k |
| `src/ai/` | AI adapters, change-set contract, review screen, prompts | 5.7k |
| `src/push/`, `src/feed/`, `src/sw.ts` | Web Push, calendar feed ids, service worker | 0.9k |
| `src/i18n/` | `en.ts`, `fr.ts`: every UI string (each puts four files of `parts/` together) | 4.0k |
| `src/styles/` | `app.css`, `app-phase1.css`, `app-onboarding.css`, `app-look.css` (imported in this order in `main.tsx`; the order is the cascade), tokens, calendar | 1.4k |
| `relay/` | Cloudflare Worker: sync, push, feed, MCP connector. Imports `src/domain`, so redeploy it after domain changes | 3.4k + tests 4.6k |
| `tests/e2e/` | Playwright (58 specs); `tests/manual/` takes the manual's screenshots | 9.7k |
| `docs/` | `METHOD.en.md` (the method), `dev/` (per feature), `manual/` (en, fr), `ai/` (kit), `AUDIT.md` | 3.2k |
| `DECISIONS.md` | The log of choices (490 entries); the first place to look before changing behaviour | 0.5k |

The invariants are in AGENTS.md (one list).
