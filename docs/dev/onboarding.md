# First-run onboarding and the AI preferences

## When it shows

`src/app/onboarding.ts`, run once in `App` after `start()` and before the first screen. It shows only when `onboardingWhy` says `new`:

1. a record of having finished: `local` key `onboarding` (`done`, `skipped` or `existing`), or `reussite.onboarded` in localStorage (a mirror, read first, so the check costs nothing);
2. a sync key on the device (`sync.key`): a device that has paired never runs it;
3. any document in any collection, `meta` (settings) included, tombstones included.

`local` is device-only: it is never synced, never in a backup. A device that passes by 2 or 3 is recorded as `existing`, so wiping its list later does not start onboarding. Playwright's `storageState` puts the localStorage mirror in every test; the onboarding tests ask for none.

## The flow

`src/flows/onboarding.tsx`, rendered by `App` in place of the tabs. S9 made it short: the first screen is the language and **one choice**, "Set up with an AI" or "Set up by myself"; the same screen carries "I already use Réussite on another device" and "Skip, use defaults". There is no look screen (the default palette and the system's light or dark; the look stays in Settings → Appearance) and no cards, suits or Matrix words anywhere: the pillars are "what matters in your days".

- **By myself** (`pillars`, `places`, `done`): four plain questions, one for each pillar, each with examples and an input that holds the default pillar's name (`settings.suits`, in the current language; a renamed one's short name is `shortName` of it), then the places (at least one, the device's zone already chosen), then the end. Under a minute.
- **With an AI** (`connect`, then `key` and `chat`, or `paste`, then `done`): the tutorial offers three ways to connect, and the conversation ends in a change-set on the review screen.
  - *A key, inside the app* (`key`): the provider (OpenRouter-compatible or Anthropic), numbered steps with the page to open, the Settings `KeyField`, "Test the connection", then **Start talking**. The provider is used at once through `draftProvider` (`src/ai/ask.ts`) and saved with the rest at the end. "I don't have a key" goes to `paste`.
  - *Claude or ChatGPT*, *Another chatbot* (`paste`): the app builds one message, `setupPack` (`src/ai/setup.ts`: the method in short, the person's lines for an AI if any, the job, the block to end with, nothing of their list), to copy or share; the person talks in the chatbot and pastes its whole reply into the screen, read by `readReply` (the reader of Paste the reply, `src/ai/ui.tsx`) and cut back to the setup ops by `onlySetup`. Choosing Claude or ChatGPT also puts the connector on the Next steps; the connector itself cannot do set-up (see below).
  - *The conversation* (`chat`): the first line is the app's own (`obChatFirst`), so nothing is sent until the person writes. Each turn is one `ask('setup', 'quick', …)` with `setupPrompt` (the exchange so far in order; "Show me what's sent" as ever) and the reply `{say, changes}`; `say` joins the conversation, and when `changes` holds setup changes (`readSetup`) the review opens inline. At most five exchanges, then the AI must propose. Cancel on the review goes back to the conversation, nothing written; an AI error offers "Use a chatbot instead".
- Every screen has Back. "Skip, use defaults" (the first screen and the by-hand ones) keeps the answers so far and goes to the end.

### The setup change-set

`settings.update` (`src/ai/changeset.ts`, `docs/CHANGESET.md`): `pillars` (one to four `{name, short?}` in order, written onto the four piles in the app's language) and `preferences` (`detail`, `know`, `never`, rebuilt with `buildPreferences`). With `place.create` for the places, that is the whole set-up. `planChanges` reads the current pillars, language and preferences from `Snapshot.settings`; without it (the connector) the op comes to nothing, and the connector refuses it up front (`relay/src/connector/changes.ts`: the person's own settings are changed in the app, from a block they paste). The Writer's `settings` writes through `saveSettings`. The review shows each pillar as before → after ("Pillar 1"), and the lines for an AI. A setup reply carries no step: anything but `settings.update` and `place.create` is dropped.

### What is written, and when

By hand, answers wait in a draft and are written once, at the end, by `applyDraft`: the places (`createDoc`), then one `saveSettings` with only the keys the person touched (plus the language and, with a saved key, the AI provider). Two reasons: a device that pairs must not push defaults whose fresh clocks would win over the settings already in the space (pairing drops the draft), and a screen never touched writes nothing. What cannot wait is local anyway: the AI key (`aiKey.<provider>` in `local`), and the language, which shows at once without being saved.

With an AI, what the person ticks is applied by the review (the settings document with the pillars and lines, the places) and `settle` then writes the draft's rest at once (language, provider, `here` as the first place); the done screen only records that set-up is over. Pairing is reachable only from the first screen, so it never follows these writes.

A device that pairs ("I already use Réussite on another device", `JoinPanel`) goes straight to the end: the space has the settings and places, so nothing is asked and nothing is written. Notifications, sync and the recovery key are no longer screens; they are Home's Next steps.

### The Next steps card

`finishedOnboarding` (done, skipped or paired) records `{on: true, connector}` in `local` (`nextSteps`; device-only, never synced or in a backup; `loadNextSteps` reads it at start, `dismissNextSteps` clears `on`). An install from before has no record and never sees the card. `NextStepsCard` (`src/app/NextSteps.tsx`, on Home between the card and the receipt) lists `nextSteps(facts)` (`src/domain/nextSteps.ts`, pure): the recovery key to save (instead of the offer of sync), sync (when a relay is set and sync is off), reminders (when offered and not on), Addresses & people (while on), the connector (if chosen and not on). Each line opens its Settings section with `openSettingsSection` (Settings, every fold around the section opened, scrolled to); a line goes when it is done and the card with it; "Hide this" removes it for good.

The pieces are the Settings ones: `KeyField` and `PreferencesEditor` (`src/ai/AiSettings.tsx`), `JoinPanel` (`SyncSettings.tsx`), and for the card `NotifySwitch` and `KeyView` stay in Settings.

## AI preferences

The setting `aiPreferences` (text, synced). Its default is the template in `docs/ai/preferences.md`, built by `src/domain/preferences.ts` (`buildPreferences`; the setup conversation fills the level of detail and two free lines through `settings.update`, and Settings → AI edits the text). Empty sends nothing. It is in the stable part of every system prompt (`systemPrompt` in `src/ai/context.ts`, after the profile and before the language line, so the bytes are the same in every feature) and in the Ask any AI and trip packs as "How I want you to work with me". "Show me what's sent" shows it as part of the system text.
