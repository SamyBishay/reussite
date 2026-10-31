# SMART goals v2 (schema 7)

A project's goal is an **outcome** (one sentence), a **measure** and two dates. A step says whether finishing it **moves the goal**. The bar is measured; it never counts cards. Pure rules: `src/domain/goal.ts`. Editor and the done-time sheet: `src/app/smart.tsx`. Card: `ProjectCard` in `src/views/Projects.tsx`. "Moves the goal?": the step sheet, `src/app/sheets.tsx`.

## Stored shapes

| on | field | meaning |
| --- | --- | --- |
| project | `outcome` | the sentence; `null` when cleared. Missing on a project an older device wrote: `goal` stands in (`outcomeOf`). The old `goal` is never written again. |
| project | `measure` | `{kind:'none'}` (no bar), `{kind:'count', target, unit}` or `{kind:'milestones', items:[{id, text, done: day or null}]}`. Missing, unreadable or an unknown kind reads as none (`readMeasure`); a read never rewrites it. One field, so it merges whole (the later writer wins); a tick on one device and an edit of the target on another is the rare loss. |
| project | `measurePrev` | what the measure held before another kind was picked, so going back finds it (the editor only). |
| project | `start` | the day the goal starts (`startOf` falls back on `created`); `due` is the day it ends. |
| project | `smart`, `smartBy`, `goalBy` | unchanged. The five questions are folded under the editor. `goalBy: 'ai'` shows "proposed" on the outcome. |
| step | `advances` | `true`: finishing it moves the bar. `false` or `null` or missing: it does not. Only `true` ever moves a bar. Events and standing steps never do (`advancing`). |
| step | `advanceBy` | what a done advancing step adds to a count; missing or not positive reads as 1 (`amountOf`). |

The bar is **derived**, never stored: a count is the sum of `amountOf` over the project's done steps with `advances: true` (`progressOf`), milestones are the ticked ones over all. So reopening a step lowers a count by itself, and nothing needs to stay in step across devices. The Projects card shows the bar and "4 of 10 pages" / "2 of 5 milestones"; no measure shows no bar. The card's "3 / 7" is a plain count of steps, not the bar. Home's greeting names a project "close to its goal" only when its bar is at least 60 % and not full.

## Done

`finishTask` returns `goal` when the step advances and its project has a bar (`offerFor`): a count with milestones left, or a count. `complete()` in `sheets.tsx` then opens `GoalDone` (`openGoalDone`): a count asks the amount (chips +1 +2 +3 +5 +10, another amount, or keep) and writes `advanceBy` on the step; milestones ask "Tick a milestone?" and write the project's `measure` with `tickMilestone`. Closing the sheet keeps the default: +1, nothing ticked. It is not asked when the done step finishes the project, or when the after-visit screen of an address is shown. The same step done by the change-set or the connector gets the default amount (change it with `task.update` `advanceBy`, or send `measure`).

## Migration 6 → 7

Additive, after the automatic backup, undone by ignoring the new fields (`src/data/migrations/index.ts`, `v7`). A project gets `outcome` (its `goal` copied; `goal` untouched; `null` with no goal), `measure: {kind:'none'}` and `start` (the creation day; `null` with none); a step gets `advances: null`. Every new field takes the oldest clock, so it never wins over a real edit; a document that already has a field (another device migrated first) keeps it; deleted documents are left alone. `runMigrations` returns `goals: {outcomes, steps}` (`goalsReport`), saves it as the local key `goalsReport`, and the app says it once: "Goals updated: n projects given an outcome, n steps." A partial document from an older device is not given the fields (`upgradeEntries` keeps only the keys it has): the readers above fill the defaults.

Rollout: an app on schema 6 meeting a schema 7 document goes read-only and asks to reload, as at every bump; a relay on schema 7 reads documents of both. The relay stores only sealed documents and does not read these fields; the connector reads them with the same readers, so a project written by either shape reads the same.

## Change-set and connector

`docs/CHANGESET.md`. Project `set`: `outcome` (`goal` is its old name and sets the outcome), `measure`, `start`, `due`, `smart`. Step `set`: `advances`, `advanceBy` (an event takes neither; a new step that sets one waits for a yes, it is not "low-risk"). A milestones list is the whole list: items matched by text keep their id and tick, `done: true` ticks today. The review shows a measure as words (`measureLabel`). `get_project` and the app's project context print `goal:` (the outcome), `measure:` (with where the bar stands), `starts:` and `moves the goal:` (the open advancing steps), through one function (`goalLines`). The connector never sees done steps held only by the cold part, so a count there says "older done steps not counted".
