# The manual

For friends, in plain words. One short page per topic, in English (`docs/manual/en/`) and French (`docs/manual/fr/`). The pages are Markdown files, read on GitHub and in the app: Settings → About → **Read the manual** opens them in a sheet. Brief §15.

## The pages

`src/manual/pages.ts` lists them in reading order; `index.md` is the contents. A new page is a new file with the same name in `en/` and `fr/` (the test fails if one is missing or if the links and pictures differ) plus a line in `PAGES` and a link from the index. `src/manual/manual.test.ts` checks that every file is listed, every link goes to a page, every picture is one the screenshot spec takes and that all the pictures exist.

Each rule or feature of the method has two lines, **Research says** and **Practice says**. Until the evidence files arrive, each carries the placeholder `[E?]` (the one `docs/METHOD.en.md` uses) and says "untested": a status, never a verdict. Search for `[E?]` to find them all when the files come. Say only what the app does; the buttons are named as `src/i18n/en.ts` names them.

Supported Markdown (`src/manual/markdown.ts`): headings, paragraphs, bullet and numbered lists, quotes, rules, code, **bold**, *italic*, `code`, links and pictures. No HTML, no tables. A link is a page (`daily-loop.md`) or a link whose scheme is in `ALLOWED_SCHEMES`; anything else is shown as plain text. A picture is `![what it shows](shot:name)`.

## The viewer

`src/manual/Manual.tsx` is a lazy chunk (a dynamic `import()` from Settings), and each page is a lazy chunk of its own (`import.meta.glob` with `?raw`), so none of it is in the main bundle. The text is precached with the rest of the build, so it reads offline. The page is in the app's language, else English with a line saying so. The Markdown becomes a tree of Preact elements (never HTML), so a page can't run anything. A link to a page stays inside the sheet; an outside link goes through `ExtLink`, like a step's.

## The screenshots

`npm run manual:shots` (`scripts/manual-shots.sh`, `playwright.manual.config.ts`, `tests/manual/manual.spec.ts`) builds the app, runs it on port 4175 and takes the pictures with Firefox at 375 px wide, twice the pixels, in English and French, light and dark: 18 pictures each, so 72 files in `public/manual/shots/<lang>-<theme>/<name>.png`. It is not part of `npm run e2e`, and it does not need the relay.

- **Invented data only.** The spec builds one list in code (`list(lang)`, in the app's language), restores it as a backup file, and drives the app. Nothing is read from `private/`, and the footer's credit is blanked.
- **Dates move with the day**, so the pictures are never stale: run it again before a release, and commit what changes.
- **Size.** After the run, ImageMagick squeezes each picture to 64 colours (the screens are flat, so nothing is lost): 72 files, under 3 MB in all. Without ImageMagick the script says so and keeps the originals, which are about three times larger. Commit only squeezed files.
- **In the app**, a picture is `manual/shots/<page's language>-<theme>/<name>.png`, with the theme the app shows now (the chosen one, else the device's). The pictures are not in the precache (`globIgnores` in `vite.config.ts`); the service worker keeps each one the first time it is shown (`src/sw.ts`, shown from the cache and refreshed in the background).

To add a picture: take it in the spec with `shot(page, 'name')`, run the script, and use `![…](shot:name)` in the page. The test fails if a page names a picture the spec doesn't take. `MANUAL_SHOTS_DIR` changes where they go.

The viewer's own tests are `tests/e2e/manualview.spec.ts` (opens, French, dark picture, links, nothing sideways at 320, 375 and 430 px, and in French at 320 px) and `src/manual/markdown.test.ts`.

## The French pages

`docs/manual/fr/` has the same file names, links and `shot:` pictures as `en/` (a test checks it). It speaks as the app does: vouvoiement, addresses are « bonnes adresses » and people « proches », and a button is named exactly as `src/i18n/fr.ts` names it (the starter is « démarreur »). The viewer does not add French typography to a page, so the files carry it: a narrow no-break space (U+202F) before `;` `:` `!` `?` and inside « », and a no-break space between a number and `h`, `min`, `%`. A test fails on an ordinary space there. If a page is ever missing in French, the viewer shows the English one with a line saying so.
