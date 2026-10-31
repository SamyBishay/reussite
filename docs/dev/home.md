# Home

Where the person types. Code: `src/views/Home.tsx` (the screen), `src/app/home.ts` (what happens to a line), `src/domain/parse.ts` (the local parser), `src/domain/greeting.ts` (the greeting), `src/views/History.tsx`. Memory, which Home reads and writes, is `src/views/Memory.tsx`, `src/domain/memory.ts` and `src/domain/memoryMd.ts`. Brief §5.

Home holds a greeting, at most one card, the last receipt and the input. No counts, no list, no streaks. The menu icon at the top holds what has no tab: Settings, Places, Memory, History.

## A line, from input to receipt

1. `submitHome` (`src/app/home.ts`). If the card is asking which of several steps, or how long a step took, the line answers it first.
2. `parseHome` reads the line (below). The result is one of:
   - `changes`: one change-set (`by: 'me'`, so the step gets `by: 'me'`, `src: 'home'`, and its estimate `estBy: 'me'`).
   - `pick`: a done, move or drop matches several open steps. The card lists up to five; a tap or a short follow-up ("the bank one") picks, and the line is read again with only that step to find.
   - `sheet`: understood, but it needs the task sheet (a repeat the schedule cannot hold). The sheet opens prefilled.
   - `unknown` with a reason (`empty`, `question`, `several`, `memory`, `long`, `nomatch`): goes through `routeUnknown`.
3. A `changes` result goes through `run`: `planChanges`, then `isLowRisk`. **One change that adds a step, ticks one done, or moves one date (`due`, or `due` and `at`) is applied at once.** The receipt reads "Added “…”", "Done: “…”", "Moved “…”" with **Undo**. Everything else opens the review (`openChangeReview`, with its Undo recorded): a drop, a decision, any memory change, several changes. If the review is closed without applying, the card keeps "n changes · Review" for ten minutes and nothing is written.
4. A step ticked done with no timer running asks, in the card, how long it took (the duration buttons, or a typed "25" or "1h30"; "I didn't time it" leaves no session). With a timer running, its time is saved. The session joins the same Undo.

Typing a line that opens the task sheet writes nothing. Closing the sheet writes nothing; Save creates the step (`openNewTask(prefill, onSaved?)`, a draft in memory).

## The parser's grammar

The parser is pure and deterministic. It reads English and French at once, whatever the app's language, because people mix them and dictation does. An "R:" prefix, or a leading "add", "ajouter", "remind me to", "rappelle-moi de", is dropped. Accents and case are ignored.

| What | English | Français | Becomes |
| --- | --- | --- | --- |
| Done | `done X`, `finished X`, `X done`, `✓ X`; add `yesterday` at the end for yesterday | `fait X`, `fini X`, `terminé X`, `j'ai fini X`, `c'est fait X`, `X fait`; `hier` | `task.done` (with `day` for yesterday) |
| Move | `move X to friday`, `push`, `postpone`, `reschedule`, `defer`, `X → friday` | `reporter X à vendredi`, `déplacer`, `repousser`, `décaler`, `X → vendredi` | `task.update` of `due` (and `at`) |
| Drop | `drop X`, `abandon`, `scrap` | `supprimer X`, `abandonner X` | `task.drop`; opens the review |
| A day | `today`, `tonight`, `tomorrow`, `the day after tomorrow`, `in 3 days/weeks/months`, `friday`, `next friday`, `26/10`, `26 oct`, `october 26`, `2026-10-26` | `aujourd'hui`, `ce soir`, `demain`, `après-demain`, `dans 3 jours/semaines/mois`, `vendredi`, `vendredi prochain`, `26/10`, `26 oct`, `le 26 octobre` | `due` |
| A time | `19:00`, `7pm`, `7:30 pm`, `at 19h`, `noon` | `19h`, `19h30`, `à 19h`, `midi`, `vers 19h` | `at` |
| A length | `1h`, `2h30`, `45 min`, `for 2 hours`, `about 20 minutes` | `1h`, `45 min`, `pendant 2 heures`, `environ 20 minutes` | `dur` if the line has a time, else `est` |
| A range | `14h-15h30`, `14:00 to 15:30` | `14h à 15h30`, `de 14h à 15h30` | `at` and `dur` |
| A place | `at <a place you have>` | `chez`, `au`, `à <un lieu que vous avez>` | `where` |
| A repeat | `every monday`, `every day`, `mondays`, `every week` | `chaque lundi`, `tous les jours`, `les lundis`, `chaque semaine` | see below |

Rules that are easy to get wrong:

- **"Nh" is a time when N is 5 or more, or after at, à, vers, from, de; `1h`, `2h30` and anything after for, pendant, about is a length.** `19h`, `7pm` and `14:30` are always times.
- **A weekday on its own is the next one, never today.** `26/10` is day first (month first only when the day is over 12 and the month is not); a date already gone this year is next year's. Short English day names (`mon`, `sat`, `sun`) count only after on, by, next, this, every.
- **A time with no date** is today, or tomorrow if it has already passed today by the day-start rule (`atOnDay`): at 20:00, "call mum 9:00" is tomorrow; at 00:30 with the day starting at 04:00 it is that same morning.
- **A short line adds one `task.create` to the Inbox** (up to 8 words after the date, time and length are taken out; `due` only when the text says one). It is not also put on today's plan.
- **Every day or every week on named days, with a time and no other date, is a standing obligation** (`template`, `weekdays`, `at`, the default lead). A repeat without a time, with a gap longer than a week, or with a date opens the sheet with the Repeats field filled.
- **"at X" after a time stays in the title** as ", X" ("Choir, Hill House 602" at 19:00), unless X starts with an article or is a place you have.
- **Targets of done, move and drop** are open steps that are not standing obligations. A name matches exactly, or by a unique start of whole words ("choir" finds "Choir dues"; "cho" finds nothing), or by the words together anywhere in the title, or by all its words anywhere. Several matches give a `pick`; none gives `unknown/nomatch`, never a guess. If the words also find a standing obligation, the line goes to the AI or the sheet and never to another step that starts the same. A done keyword is a word of its own: "finish the essay" and "terminer le rapport" are new steps.
- **Goes to the AI, or to the sheet if none:** a question (`?`, or what, who, when, why, how, qui, quand, pourquoi, comment…), several clauses (`;`, a new line, "and then", "puis"), a statement about someone in memory ("Ibrahim is…", or a note's name and a verb), and a title over eight words.

## The greeting

Two pure things in `src/domain/greeting.ts`, both run on the 30-second clock tick, and one order they read, `dayOrder` (`src/domain/dayOrder.ts`, also what Today's Start here, its list and the next-step bar read; `dayOrderOf` in `src/app/model.ts` gathers the data).

**The line** is a template from `en.ts`/`fr.ts` (`greet…` keys) with slots filled from real data, chosen when Home opens (`GreetingLine` in `Home.tsx`). Kinds, each eligible only when its data exists: the next fixed item ahead today ({time}, {title}), a project close to its goal (an active project with a step done and one or two left; the SMART measure replaces this), the time of day (morning until noon, afternoon until 18:00, evening after, by `dayStart`), steps done today ({n}, done only) and planned but not started ({n}, nothing done or running). Every template ends by inviting the person to type in the box, never counts what was missed or carried, and never says database, record, entry or field (a unit test scans both languages). `pickGreeting` returns the candidate shown longest ago (never shown first), in an order seeded by the day, so a template is not repeated within a day while another is eligible; the shown keys are in `localStorage` under the day (`reussite.greet.<day>`, `src/app/greetingShown.ts`, try/catch, older days dropped), one more each time Home mounts. It is the same with an AI on: no call is made.

**The card** is `greeting()` over the first item of `dayOrder`. In this order, the first that applies:

1. **A fixed-time item has taken over** (the first item of the order is a fixed one): it shows the item, its time and "leave at …", even over a running timer or a closed day. Fixed items are the agenda's (the same that feed push and the calendar feed) for the day, standing items not yet placed included.
2. **A running timer** that is the first item: the running step. The running bar steps aside only while the greeting is that step; "Still on…?" always shows.
3. **A closed day**: tomorrow's first step, or "No first step chosen for tomorrow yet."
4. **The first item of the order** (the first step that fits before the next fixed item), with the person's own estimate and "usually" after it (never the personal estimate first, so it does not anchor).
5. **Nothing on today's list yet**: Plan the day. **Everything on it done**: a line saying so, with Close the day.

## The card and the nudge

The card shows, in this order of priority, one of:

1. What an open exchange has to say or ask: which step (`pick`), how long a step took (`duration`), "n changes · Review" (`review`), or an AI's answer (`answer`). It lives in memory and lapses after ten minutes; only what was applied is in the exchange.
2. Otherwise **one nudge**, the first of: the recovery key not saved (sync on); a decision due for checking; yesterday's open steps (the nudge's button opens `CarriedSheet`, one card at a time, not a bulk carry); the review day. Nothing if none.

## Exchanges and turns

An exchange (`exchanges` collection, synced) is written when a change-set is applied, or when an AI answers. It holds `at`, `text`, `turns`, `changes` (the change-set ids applied), `undo` (change-set id → `UndoDoc[]`), `undone` and `src`.

- `src`: `home`, `link` (a one-tap link opened where the list is) or `inbox` (a link sent through the relay). A `link` or `inbox` exchange is always its own: Home never continues it, and a Home line a minute later does not join it. Its text is the change-set's note, else "Changes from an AI's link".
- **Turn `kind`**: `add`, `standing`, `done`, `move`, `drop` (the local parser applied it; `reply` is the step's title, `n` the changes written), `changes` (any other applied change-set), `answer` (an AI answered, nothing changed), `duration` (how long a ticked step took). The receipt is built from the turns in the app's language when read, not stored.
- **Follow-ups.** A line within ten minutes of the last turn joins the newest exchange of this device, unless every change in it was undone, so "3 changes · Undo" takes back all three. After ten minutes Home starts clean: the receipt goes, and History keeps the exchange.
- **Never one another device wrote to.** A follow-up joins an exchange only if every field of it was last written by this device (its clocks carry this device's node). `changes` and `undo` merge whole, so two devices adding turns to one exchange before syncing would lose one change-set and its Undo.
- **Pruning.** Exchanges older than 90 days (by their last turn) are emptied (text, turns, changes, undo, undone) and then tombstoned, when the app starts. History lists the last 90 days, newest first.

## Undo

One pure module, `src/ai/undo.ts`; the relay's connector uses it too. In the app, `recordWrites(fn)` in `store.ts` notes the local `createDoc`, `update` and `removeDoc` made while `fn` runs (one run at a time; sync's `putMerged` is never noted) and gives the `UndoDoc[]`; `applyUndo` reverts them.

- Undo reverts all of an exchange's change-sets, newest first, in one go.
- **"Left alone."** A field is put back only if it still holds what the change-set wrote. A field edited since stays, and the toast says how many ("Undone. 2 edits you made since were left alone.").
- **A step the change-set made** is tombstoned (never hard-deleted) only if no field of it has a clock newer than the change-set's newest write (`UndoDoc.at`) and nothing made since refers to it (a session on the step, a step in a project). Otherwise it stays and counts as left alone.
- **A timer the change-set stopped** is started again only within ten minutes (`FRESH_MS`). After that `started` stays empty and the session that saved its time stays.
- **A document the change-set removed** is not brought back: a tombstone has no way back.
- **In History, past ten minutes**, Undo asks first.
- **Forget** (memory) is never recorded for Undo. Forgetting a line or note also goes through the exchanges: one whose Undo holds that note loses those records, and its text and every turn's text and reply are emptied (History shows "Forgotten from Memory").

## The AI route and "outside"

`routeUnknown`: without an AI set up, the task sheet opens prefilled with what was read. With one (`aiOn`), `askHome` sends the line with the earlier turns of the open exchange (the last six) and the memory notes it names. The reply is a change-set:

- Changes go through `run`, like a typed line: one low-risk change at once, else the review.
- No changes: the answer is the change-set's `note`, shown on the card and kept as an `answer` turn, so History lists it and a follow-up within ten minutes has the context.
- **`outside: true`** is an optional field of the envelope that only Home's prompt asks for: the request is not about the list, the memory or the method, and the reply is one line pointing to their usual AI. The card then offers **Ask any AI**. It is read when there are no changes, and it is **not** in `docs/CHANGESET.md`: an outside AI is never told about it, and the contract stays version 1.
- If the AI fails, or the monthly limit is reached, the card says one plain sentence with **Add as a step**, which opens the task sheet prefilled. Cancel in the preview leaves the text in the input. Nothing is written.

"Show me what's sent" applies as everywhere, and lists the memory notes sent (private notes are never among them).

## Spend and the limit

Per device and month, in `local` (`aiUsage.YYYY-MM`; never synced): calls, tokens, and dollars for the calls that have a price (`src/ai/ask.ts`, `src/ai/prices.ts`).

- Dollars are OpenRouter's `cost` (in every reply), or, for Anthropic's own API, the table in `prices.ts`: Haiku 5.5 $0.10 in / $0.50 out, Sonnet 5.5 $2 / $10, Opus 5.5 $4 / $20 per million tokens; cache reads $0.01 / $0.20 / $0.20; five-minute cache writes 1.25 times the input price. Haiku is not priced above 100K prompt tokens. Any other provider or model shows tokens only: no price is guessed. The table is dated in the file; update it when the prices change.
- `aiMonthlyCap` (US dollars, default none, Settings → AI): when this month's dollars reach it, every AI call stops with the `cap` error before the preview, so nothing is shown or sent. Only calls with a dollar figure count toward it, and the settings page says so.
- Settings → AI shows the month's calls and tokens, the dollars so far, and a note that dollars count only priced calls.

## Memory in a request

Every feature's prompt does this (Home, command box, plan, break it down, decisions, stuck, review, Ask any AI). The system prompt is two parts: a stable one (intro, method, the profile note, the language line; no date) and the feature's own. The profile (all non-private profile notes) is in the stable part, so its bytes are the same in every feature. In the user message, `pickNotes` adds the notes the message, the steps sent or their projects name, within `memoryBudget` (3,000 tokens, a setting; the profile counts first): whole words of a name or alias, most recently updated first; a note that does not fit is skipped and a smaller one after it may still go. **A private note is never picked.** The note format (`noteHead`, `noteBlock`) is one function in `src/domain/memory.ts`, shared with the connector's `read_memory`.

## The morning ritual (plan 2 Nov, S2)

`src/flows/checkin.tsx`, one question per screen: yesterday (a line from `cardsOn`/`minutesOn`, then `CarriedFlow`: each open step on its own card, then `MissedFlow`: each fixed item of yesterday whose time passed, Move or Remove; both in `src/app/CarryUi.tsx`), the shape (a kind of day, **from** and **until**), the four pillars, the plan, and the first step alone. `days.shape` is `{start, end?, preset}`: `end` is optional and additive (no migration); `dayOrderOf` (`src/app/model.ts`) reads it, so a day's `end` is its "until" (else `settings.dayEnd`) and nothing is placed before its `start`. The start defaults to now to the next 5 minutes (not before `dayStart`); `launchDefaults` is still stored and no longer read. The pillars are the four suits (`pillarsOf`, `PILLARS` in `src/domain/planner.ts`): each row is the planner's steps of that suit, with Swap and Skip; an empty pillar says so and offers Add one (a step of that suit, placed like a swapped-in one). The plan is laid out with `dayOrder` over the screen's own items (fixed items at their time to leave, a standing obligation at its time, the steps in the gaps), and `dayLoad` gives "x of y free" and the minutes over; the ratio is already in `planEst`. Go writes the plan, `first`, `shape` and `load`, then shows the first item of `dayOrderOf` alone with Start (a fixed item that has taken over comes first). Launch points no longer exist in the planner (`Plan` has no `launches`), Today, Settings or the close; `days.launches` is kept as stored and the change-set still accepts it.

## Carried and missed, one at a time (plan 2 Nov, S3)

`src/app/CarryUi.tsx` holds the cards; there is no bulk carry (`carryOver` is gone). `carriedOn(k)` (`src/app/model.ts`) is yesterday's open steps (`yesterdayOpen`) without the fixed-time items that passed; `missedOn(k)` is `dayOrder(...).missed` over a day's fixed items (`fixedOnDay`), read at the clock and not narrowed by the area chip, so for yesterday it is every fixed item not done. A **CarriedCard** answers with existing actions only: Today is `carry` (counts, and keeps the step on yesterday's list in the ritual, which writes the day's list itself); Another day is `planOn`; Drop it is `dropTask` and `droppedLine` ("Unlocked: …") on a second tap; Make it a decision is `planOn` on today, `kind: 'decision'`, then the decision flow; Already done is `finishTask` for yesterday. A **MissedCard** answers Move with `moveFixed` (a day and a time), Remove with `dropTask` (`skipThisTime` for a repeating one: this time only), Already done with `finishTask`. Nothing writes until a button is tapped. `MissedNow` shows today's first passed item on Home and Today; Today's `carry` banner and the bell's nudge open `openCarried()`. No count of either appears in the greeting.
