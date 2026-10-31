# The morning with an AI

With an AI set up (`aiOn`: a provider and its key on this device), Home's **Plan the day**, the small **Plan the day** under a fixed-time first item, and the morning notification open a planning exchange: the AI proposes the day in five sections, the person keeps, swaps or skips each item, a short exchange adjusts it, and it ends in one change-set on the existing review screen. Plan 2 Nov, "Morning" point 3 (the owner's words of 31 Oct: the AI proposes and the person chooses). With no AI, nothing changes: `openPlanDay` opens the ritual (`src/flows/checkin.tsx`), and the ritual stays one tap away (**Plan it myself**, on Home beside Plan the day and inside the exchange).

## The pieces

| | |
| --- | --- |
| `src/domain/propose.ts` | `proposeDay`: pure candidates per section, ids and reasons only. Tested in `propose.test.ts`. |
| `src/app/model.ts` `proposalFor(k)` | gathers the input from the stores (open steps not on a later day's list, today's fixed items, events to check, carried steps, projects, today's place) and returns the proposal, the suit and project of every step it names, and `loadFor(ids)`. |
| `src/ai/prompts.ts` `morningPrompt` | the request: the five sections as candidate lines, the pillars in the person's own names (`settings.suits`), the room the day has, the calibration line and the memory (the profile is in the system prompt). A later turn adds what was kept and skipped and what the person said. |
| `src/ai/features.ts` | `MorningReply` (the schema), `readMorning` (the reply read against the candidates), `swapOptions`, `swapItem`, `setSkipped`, `keptItems`, `firstKey`, `morningChangeSet`. All pure; tested in `src/ai/morning.test.ts`. |
| `src/flows/morning.tsx` | the sheet, `openMorning`, `openPlanDay`. |
| `src/app/home.ts` `recordPlanning` | the change-set joins Home's exchanges: its receipt and Undo on Home and in History. |

## The sections (`proposeDay`)

1. **Must happen:** today's fixed-time items (locked: not a choice), then overdue, due-today, urgent (Q1/Q3) and carried steps, at most six, rest in `mustMore`; events whose nudge has come (`check`, locked, never planned). A step that cannot be done at today's place is left out unless it was carried.
2. **Main goals:** at most two active projects (not the Inbox) with an open step that can be done here and is not already in section 1, nearest `due` first, then one with a goal; each with its first open step (the project's own order) and `more` (its other steps). `moreGoals` are the next projects, each with its first step.
3. **Pillars:** for each of S, D, C, H the best of what is left by quadrant, due date and order; `more` are the next ones; `covered` are the steps of that pillar already in sections 1, 2 and 4. A pillar with nothing has `pick: null`.
4. **Here:** steps whose own place is today's place or one of its areas (not Anywhere), by priority, at most four. Section 4 is taken before the pillars, so a place-bound step is not also a pillar's pick.
5. **Load:** `dayLoad` for the steps the proposal puts on the day, against the fixed items and the day's end (`dayEnd`, or the day's `shape.end`). The sheet recomputes it with `loadFor` as the person skips and swaps.

A step that waits for another (`blocked`) is never a candidate.

## What the AI may do, and what is checked

The AI sends `must`, `goals`, `pillars`, `here` (each item an `id` from the candidates, with a one-sentence `line`, and `cut: true` for a step it would leave out), `first`, `split` and `note`. Only goals and pillars may carry a `new` step (a goal's joins its project; a pillar's has that suit, in the Inbox). `readMorning` keeps only ids it was given for that section, drops repeats, keeps the fixed items and the events to check whatever it says, appends any must-happen step it left out, falls back on the candidates for a section or a pillar it forgot, and drops a `line` or a `note` that names a "card" or a "suit" (the app's words; the person's pillar names are used instead). A step skipped on an earlier turn (`gone`) is never offered again. With no usable reply (the AI failed, or the person cancelled "Show me what's sent") the first turn shows the candidates unworded, with the error and a way to the ritual.

## The change-set

`morningChangeSet`: `task.create` for each kept new step (`important: true`), `splitChanges` for a kept step the AI asked to break down (the first step keeps the id and goes on the day; the others wait for it, by `after`), then one `day.update` with `plan` and `first`. The plan is the list the day already has (fixed items on it stay; steps never mentioned stay; a skipped step that was on it leaves), then the kept steps: the first step, what has to happen, the goals, where the person is, the pillars. Applied through `ReviewList` (inline, `record`), so each change has its tick and the exchange keeps its Undo. After a tick the day is stamped `checkin` (so the push and the Plan the day buttons stop), with its `load`; this stamp is not part of the Undo. A standing obligation cannot be placed by a change-set (it would make a new series): it stays on the day through the agenda, as in `dayOrder`.

## The notification

The `checkin:` push carries `PLAN_URL` (`./#plan`, `src/push/notification.ts`); every other push keeps `./#today`. A cold start reads the hash (`planFromHash`, `openLinkedPlan` in `src/app/App.tsx`); an open window is sent `{type: 'OPEN_URL', url}` by the worker (`src/sw.ts`) and sets the hash. With an AI set up (`aiReady`: read from the database, as `aiOn` may not be known yet) the exchange opens on Home; without, the app goes to Today as it always did.

## Tests

`tests/e2e/morningai.spec.ts` (OpenRouter stubbed): the five sections, skip a pillar item, swap a goal's first step, the review, Today in the day's order, an adjusting turn, the failure path, the ritual one tap away, the notification, and nothing sideways at 320, 375 and 430 px.
