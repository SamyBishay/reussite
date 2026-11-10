See AGENTS.md.

@AGENTS.md

## File map

Line counts are rough (many lines are long). Details of each folder are in AGENTS.md → Layout.

| Path | Purpose | ~Lines |
| --- | --- | --- |
| `src/domain/` | Pure rules, no I/O: days, urgency, planner, chains, calendar text, greeting, day order. Every rule has a unit test | 8.9k |
| `src/data/` | Schema, migrations, clocks, Dexie, settings defaults | 2.2k |
| `src/app/` | Store (`store.ts` writes), actions, model, sheets (`sheets.tsx`), shared UI | 9k |
| `src/views/` | One file per tab: Home, Today, Matrix, Projects, Calendar, Settings… | 2.4k |
| `src/flows/` | Guided flows: set-up, morning, review, decisions, close of day | 2.9k |
| `src/ai/` | AI adapters, change-set contract, review screen, prompts | 5.6k |
| `src/push/`, `src/feed/`, `src/sw.ts` | Web Push, calendar feed ids, service worker | 0.9k |
| `src/i18n/` | `en.ts`, `fr.ts`: every UI string | 3.9k |
| `src/styles/` | `app.css` and tokens, calendar | 1.3k |
| `relay/` | Cloudflare Worker: sync, push, feed, MCP connector. Imports `src/domain`, so redeploy it after domain changes | 3.3k + tests 4.5k |
| `tests/e2e/` | Playwright (44 specs); `tests/manual/` takes the manual's screenshots | 8.6k |
| `docs/` | `METHOD.en.md` (the method), `dev/` (per feature), `manual/` (en, fr), `ai/` (kit), `AUDIT.md` | 3.2k |
| `DECISIONS.md` | The log of choices (461 entries); the first place to look before changing behaviour | 0.5k |

The invariants are in AGENTS.md (one list).
