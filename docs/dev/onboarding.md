# First-run onboarding and the AI preferences

## When it shows

`src/app/onboarding.ts`, run once in `App` after `start()` and before the first screen. It shows only when `onboardingWhy` says `new`:

1. a record of having finished: `local` key `onboarding` (`done`, `skipped` or `existing`), or `reussite.onboarded` in localStorage (a mirror, read first, so the check costs nothing);
2. a sync key on the device (`sync.key`): a device that has paired never runs it;
3. any document in any collection, `meta` (settings) included, tombstones included.

`local` is device-only: it is never synced, never in a backup. A device that passes by 2 or 3 is recorded as `existing`, so wiping its list later does not start onboarding. Playwright's `storageState` puts the localStorage mirror in every test; the onboarding tests ask for none.

## The flow

`src/flows/onboarding.tsx`, rendered by `App` in place of the tabs. One question per screen: language, places, suits, theme, Addresses & people, AI, the AI's preferences, sync (not now / set up / "I already use Réussite on another device"), notifications, recovery key (only if a key exists and is not confirmed), then the end (plan the first day, or Home). Screens the device cannot use are left out (no relay, no push). Every screen has Back, Next and "Skip, use defaults" (skips the rest, keeps the answers so far).

Answers wait in a draft and are written once, at the end, by `applyDraft`: the places (`createDoc`), then one `saveSettings` with only the keys the person touched (plus the language and, with a saved key, the AI provider). Two reasons: a device that pairs must not push defaults whose fresh clocks would win over the settings already in the space (pairing drops the draft), and a screen never touched writes nothing. What cannot wait is local anyway: the AI key (`aiKey.<provider>` in `local`), and the language and look, which show at once without being saved.

The pieces are the Settings ones: `KeyField` and `PreferencesEditor` (`src/ai/AiSettings.tsx`), `NotifySwitch` (`NotifySettings.tsx`, asks for permission from the tap only, explains the install on iOS outside the Home Screen app), `JoinPanel` and `KeyView` (`SyncSettings.tsx`).

## AI preferences

The setting `aiPreferences` (text, synced). Its default is the template in `docs/ai/preferences.md`, built by `src/domain/preferences.ts` (`buildPreferences`; onboarding fills the level of detail and two free lines). Empty sends nothing. It is in the stable part of every system prompt (`systemPrompt` in `src/ai/context.ts`, after the profile and before the language line, so the bytes are the same in every feature) and in the Ask any AI and trip packs as "How I want you to work with me". "Show me what's sent" shows it as part of the system text.
