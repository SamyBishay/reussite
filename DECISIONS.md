# Decisions

One line each: date, decision, why.

- 2026-10-09 · Stack: Vite + TypeScript (strict) + Preact + @preact/signals, Dexie, vite-plugin-pwa, Vitest, Playwright. · Brief §3; approved with the phase 0 plan.
- 2026-10-09 · Vite 8 and Vitest 5 instead of the planned Vite 6 / Vitest 3. · Vitest 3 pulled in packages with open security advisories (tinypool, @vitest/mocker); the current majors audit clean.
- 2026-10-09 · Fonts self-hosted through @fontsource (Atkinson Hyperlegible Next and Mono), bundled by Vite. · Brief §2.5 and §3: no third-party requests at runtime.
- 2026-10-09 · v1 export obtained by adding an "Export everything (JSON)" button to v1's Log tab; the export lives in `private/`, never in git. · v1 had no export, and this keeps the data out of any chat.
