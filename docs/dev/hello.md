# The hello page and the link preview

What Réussite is, for someone who was sent the link and has not opened the app. DECISIONS.md 2026-11-14.

## The page

`/hello/` in English and `/hello/fr/` in French: plain static pages with no script, built like the public manual (`docs/dev/manual.md`) by `manualSite()` in `src/manual/site.ts`.

- **The words** are `docs/hello/en.md` and `docs/hello/fr.md`, in the manual's Markdown (`src/manual/markdown.ts`). The first heading and the paragraph under it are the hero, with the mark and an **Open Réussite** button; the rest is the page. A picture is a manual screenshot (`![…](shot:today)`, served from `/manual/shots/`), so `npm run manual:shots` keeps them current; a link to `getting-started.md` goes to that page of the manual in the same language. The French file holds its own narrow no-break spaces, like the manual's pages.
- **`renderHello(lang, md, appUrl)`** is pure and tested (`src/manual/site.test.ts`: no script, the app link, every link and picture exists, the two languages have the same headings, pictures and links, French typography, the preview tags). It shares the manual's stylesheet, fonts (`/manual/fonts/`) and CSP; the mark's two pictures are copied from `src/assets/dove/` to `/hello/mark-light.webp` and `/hello/mark-dark.webp`.
- **The app links to it** from the welcome screen of first run ("What is Réussite?", `ob-more`), in a new tab.
- **The service worker leaves it alone**: `/hello/…` is in the `NavigationRoute` denylist of `src/sw.ts` and in `globIgnores` of `vite.config.ts`, like `/manual/…`.
- Tests: `tests/e2e/hello.spec.ts` (both languages, the switch, the manual link, Open goes to the app, the dark pictures, nothing sideways and the main button in the first screen at 320, 375, 390 and 430 px).

## The link preview

A chat app that is sent the address shows a title, a sentence and a picture, read from tags in the page.

- `previewTags(md, appUrl)` writes them into the built `index.html` (a `transformIndexHtml` step of the same plugin), from the English hello page's heading and first paragraph; the hello pages carry their own, in their language. A preview is in English for the app's address: the reader's language is not known when the tags are read.
- **`VITE_APP_URL`** (`.env.production`) is the address the app is served at. The picture's address must be absolute, so without this variable the tags hold the words and no picture.
- **The picture** is `public/hello/og.png` (1200×630): the mark, the name, one line and the four suit symbols, in the af Klint palette and the app's font. `node scripts/og-image.mjs` makes it again (it draws a small page with Playwright's Firefox and takes its picture); run it after changing the mark or the line. It is not part of the build.
- Unverified on device: how each chat app crops and caches the picture. A chat app keeps a preview for days, so a change shows late.
