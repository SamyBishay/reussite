# Réussite change-set, version 1

A change-set is one JSON object: `{"v": 1, "note": "…", "changes": [ … ]}`. Réussite shows each change as before → after with a checkbox; only ticked changes are written. `note` is optional: one short line for the person (say there what was unclear).

Use the ids from the lines you were given (`t…` steps, `p…` projects, places, `d…` decisions). To refer to something you create in the same change-set, give it `"ref": "any-name"` and use that name as its id later. Dates are `YYYY-MM-DD`, times `HH:MM`, estimates in minutes. Leave out any field you don't change. **Never give weights**: the person weighs pros and cons themselves.

## Operations

| op | fields |
| --- | --- |
| `task.create` | `ref?`, `set` (needs `title`) |
| `task.update` | `id`, `set` |
| `task.done` | `id`, `day?` (the day it was done; default today) |
| `task.drop` | `id` |
| `task.reorder` | `ids` (a project's steps in their new order) |
| `project.create` | `ref?`, `set` (needs `name`) |
| `project.update` | `id`, `set` |
| `day.update` | `date`, and any of: `plan` (the whole list, in order), `add`, `remove` (step ids), `first` (the step to start with), `launches` (`[{"t": "09:30", "k": "start"}]`, `k` is `start` or `restart`) |
| `place.create` / `place.update` | `ref?` or `id`, `set`: `name`, `timeZone` (IANA, e.g. `Europe/Paris`) |
| `stay.create` / `stay.update` | `id` for updates, `set`: `place` (id or name), `from`, `to`, `note?` |
| `decision.create` / `decision.update` | `ref?` or `id`, `set` (create needs `title`) |

**Step `set`**: `title` (start with the concrete first action: "Open Mail and reply to…"), `project`, `suit` (`S` work and studies, `D` money and papers, `C` family and home, `H` life: people, leisure, health), `urgent`, `important` (true/false), `due`, `est`, `starter` (the smallest first action), `app`, `link` (https only), `note`, `where` (place id or `any`), `after` (step ids it waits for), `at` and `dur` (a fixed time and duration).

**Project `set`**: `name`, `suit`, `where`, `goal` (one sentence), `smart` (`specific`, `measurable`, `attainable`, `relevant`, `dated`), `due`, `status` (`active`, `paused`, `done`, `dropped`).

**Decision `set`**: `title`, `project`, `problem` (`what`, `should`, `gap`, `constraints`, `deadline`, `control`), `options` (`[{"name", "screened"?, "pros", "cons", "prosNot", "consNot"}]`, each column a list of short texts; an option with an existing name adds to it), `chosen` (an option's name), `why`, `mustBeTrue`, `falsifier`, `reviewOn`, `steps` (step `set`s that carry out the choice).

## Examples

"Drop the games; the photos are due Friday; add 'Text Alex about dates' to Friends":

```reussite
{"v": 1, "changes": [
  {"op": "task.drop", "id": "t12"},
  {"op": "task.update", "id": "t7", "set": {"due": "2026-10-16"}},
  {"op": "task.create", "set": {"title": "Open Messages and text Alex about dates", "project": "p3", "est": 5}}
]}
```

A new project with a goal and two steps, the second waiting for the first, and the first on today's list:

```reussite
{"v": 1, "changes": [
  {"op": "project.create", "ref": "move", "set": {"name": "Move out", "suit": "C", "goal": "Keys handed back by 30 November"}},
  {"op": "task.create", "ref": "a", "set": {"title": "Open Mail and ask the agency for the check-out date", "project": "move", "est": 10, "starter": "Open Mail"}},
  {"op": "task.create", "set": {"title": "Open Calendar and block the check-out morning", "project": "move", "after": ["a"], "est": 5}},
  {"op": "day.update", "date": "2026-10-09", "add": ["a"]}
]}
```

Options and pros and cons for a decision (no weights):

```reussite
{"v": 1, "changes": [
  {"op": "decision.update", "id": "d1", "set": {"options": [
    {"name": "Stay one more year", "pros": ["No moving costs"], "prosNot": ["Relief of not deciding now"]},
    {"name": "Move in spring", "cons": ["Two months of searching"]}
  ]}}
]}
```
