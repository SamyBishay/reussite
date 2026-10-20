# Change-sets, in short

When something in my list should change, end your reply with one change-set: one JSON object in a fenced code block labelled `reussite`. Réussite shows each change as before → after, and writes only the ones I tick. The full contract is in [`docs/CHANGESET.md`](../CHANGESET.md).

```
{"v": 1, "note": "optional, one short line", "changes": [ … ]}
```

## Rules

- Use the ids from the lines you were given (`t…` steps, `p…` projects, `d…` decisions). For something you create in the same change-set, give it `"ref": "name"` and use that name later as its id.
- Dates are `YYYY-MM-DD`, times `HH:MM`, estimates in minutes. Leave out any field you don't change.
- Never give weights. I weigh pros and cons myself.
- At most 80 changes. If a request is unclear, return no changes and ask one question in `note`.

## Operations

| op | fields |
| --- | --- |
| `task.create` | `ref?`, `set` (needs `title`) |
| `task.update` | `id`, `set` |
| `task.done` / `task.drop` | `id` |
| `task.reorder` | `ids` (a project's steps, in order) |
| `project.create` / `project.update` | `ref?` or `id`, `set` (`name`, `suit`, `goal`, `due`, `status`) |
| `day.update` | `date`, and any of `plan`, `add`, `remove`, `first`, `launches` (`[{"t": "09:30", "k": "start"}]`, `k` is `start` or `restart`) |
| `decision.create` / `decision.update` | `ref?` or `id`, `set` (`title`, `problem`, `options`, `chosen`, `why`, `mustBeTrue`, `falsifier`, `reviewOn`, `steps`) |
| `memory.add` / `memory.edit` / `memory.remove` | `note`, `text`, `line`, `kind?` (only for what I said, in my words) |

A step's `set` takes: `title` (start with the first action: "Open Mail and reply to…"), `project`, `suit` (`S` work and studies, `D` money and papers, `C` family and home, `H` people, leisure, health), `urgent`, `important`, `due`, `est`, `starter`, `app`, `link` (https only), `note`, `after` (ids it waits for), `at` and `dur`.

## Example

"Drop the games; the photos are due Friday; add 'Text Alex about dates' to Friends":

```reussite
{"v": 1, "changes": [
  {"op": "task.drop", "id": "t12"},
  {"op": "task.update", "id": "t7", "set": {"due": "2026-10-16"}},
  {"op": "task.create", "set": {"title": "Open Messages and text Alex about dates", "project": "p3", "est": 5}}
]}
```
