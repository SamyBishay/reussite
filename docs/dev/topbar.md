# The top edge (`#topbar`)

Added 2026-11-11. Decision: `DECISIONS.md`, 2026-11-11 "The top of the page is a real element".

**Why.** Safari 26 web apps fill the status bar with the solid colour of a fixed or sticky element that sits at the top edge of the viewport, and show a soft blur under it when there is none (from WebKit's bug tracker; not confirmed on iOS 27). `theme-color` is ignored. The earlier band, `html::before`, was a pseudo-element of `<html>` that began 2px above the screen: not an element, and not at y = 0.

**What it is.**
- `<div id="topbar" class="topbar">` in `index.html`, before `#root` and before the script: it exists before the first paint and is never replaced. `src/main.tsx` renders `Topbar` (`src/app/Topbar.tsx`) into it once.
- CSS (`.topbar`, `src/styles/app.css`): `position:sticky; top:0; width:100%; z-index:10; background:var(--ground); opacity:1; padding-top:var(--sat)`. No alpha, no `backdrop-filter`. Sheets, scrims and the full-screen layers are above it (z-index 20 and up).
- Content, by screen: Home → `HomeBar` (`src/views/Home.tsx`: wordmark, clock, date, bell, menu); Today, Matrix, Projects, Calendar → `Mast` (date, minutes timed, place pill, a visually hidden `h1`); Settings, Memory, History, Addresses, Waiting, Notifications → their title (`h2.sec.topbar-title`, which the views no longer draw). While the app loads, and during first-run set-up, it is empty: only the status bar's room.

**Layout.** The element is in the flow, so each screen starts below it by layout; `.app` has only a small gap above its content. Home and the Calendar are one screen tall: `body:has(.app[data-view="home"|"calendar"])` is a column of the top edge and `#root`, and `.app` takes what is left (no `100dvh` on `.app`). `--topbar-h` (`src/app/topbarSize.ts`) is the element's height, used only for the suit piles' sticky offset on Today.

**`--sat` and the 86px fallback.** `--sat` is `env(safe-area-inset-top)`. `markIosApp` (`src/app/ios.ts`) puts `ios-app` on `<html>` in an iPhone's home-screen app and, when the inset reads 0 there in portrait, `ios-noinset`; `:root.ios-app.ios-noinset` makes `--sat` 86px (an island is 59 to 62px tall, and the status bar's blur fades out about 83px down). It looks again on `resize` and `orientationchange`.

**Diagnostics.** Settings → Layout diagnostics shows the header's computed position, top, box, width, background and opacity.

**Tests.** `tests/e2e/topband.spec.ts` (320, 375, 430; light and dark; every screen): at top 0, full width, opaque, sticky, the same element across tab switches, nothing interactive starts above its bottom edge. `src/app/ios.test.ts` for the fallback class. Unverified on device: the spoofed iPhone branch in other engines proves the element is built as designed, not what iOS does with it.
