# Change-sets, in short

When something in my deck should change, send it through Réussite's connector: `apply_changes` with `changes`, a list of operations. One small change I asked for (add one card, mark one played, move one date) is applied at once, with an undo id; anything else comes back as a diff before → after with a confirmation id, and is written only when you call again with that id after my yes. The connector's `get_method` gives the full contract, which is also in [`docs/CHANGESET.md`](../CHANGESET.md).

```
{"changes": [ … ], "note": "optional, one short line"}
```

## Rules

- Use the ids from the lines the connector gave you (`t…` cards, `p…` projects, `d…` decisions). Titles work too. For something you create in the same change-set, give it `"ref": "name"` and use that name later as its id.
- Dates are `YYYY-MM-DD`, times `HH:MM`, estimates in minutes. Leave out any field you don't change.
- Never give weights. I weigh pros and cons myself.
- At most 25 changes in one call; for more work make several calls. If a request is unclear, return no changes and ask one question in `note`.

## Operations

| op | fields |
| --- | --- |
| `task.create` | `ref?`, `set` (needs `title`) |
| `task.update` | `id`, `set` |
| `task.done` / `task.drop` | `id`; `task.done` also takes `day?` (the day it was played; for a waiting-for card, the day it happened); `task.drop` takes `day?` on a standing card only: that one day is called off and the series goes on |
| `task.reorder` | `ids` (a project's cards, in order) |
| `project.create` / `project.update` | `ref?` or `id`, `set` (`name`, `suit`, `outcome` (the goal in one sentence; `goal` still works), `measure`, `start`, `due`, `status`) |
| `day.update` | `date`, and any of `plan` (the whole hand, in order: how to write a day's hand, which may already hold cards; read the day first), `add` (adds to a hand on purpose, e.g. a trip's new days), `remove`, `first` (`launches` is accepted and stored but the app no longer uses launch points: leave it out) |
| `decision.create` / `decision.update` | `ref?` or `id`, `set` (`title`, `problem`, `options`, `chosen`, `why`, `mustBeTrue`, `falsifier`, `reviewOn`, `steps`) |
| `address.create` | `set`: `name`, `category?`, `place?`, `mapsUrl?` (only a real Maps link), `street?`, `note?` (why, and what you checked). A place to try, saved as *want to go*; only in the app, not through the connector |
| `settings.update` | `set`: `pillars` (my suits: one to four, in order: `{name, short?}`: the parts of my days that matter to me, in my words), `preferences` (`detail`: `very short`, `short` or `full`; `know`; `never`). Setting the app up with an AI; only in the app, not through the connector |
| `place.create` / `place.update` | `ref?` or `id`, `set` (`name`, `timeZone`, `parent`: the place this is an area of; one level only; an area has its parent's time zone) |
| `memory.add` / `memory.edit` / `memory.remove` | `note`, `text`, `line`, `kind?` (only for what I said, in my words) |

A project's `measure` is `{"kind": "none"}` (no bar), `{"kind": "count", "target": 10, "unit": "pages"}` or `{"kind": "milestones", "items": ["Draft sent", {"text": "Filed", "done": true}]}` (the whole list; a milestone matched by its text keeps its tick). The bar moves only for cards marked `advances: true` (a count adds `advanceBy`, default 1, when one is played) and for milestones ticked; it never counts cards.

A card's `set` (a `task`) takes: `title` (start with the first action: "Open Mail and reply to…"), `label` (a short name for calendars, five or six keywords: "Choir · Hill House"), `project`, `suit` (`S`, `D`, `C` or `H`: one of my four suits, under my own names; a new person's are `S` ♠ Work, `D` ♦ Leisure, `C` ♣ Personal projects and `H` ♥ Interpersonal obligations), `urgent`, `important`, `due` with `dueAt` (a deadline and its time of day; it goes in no calendar), `est`, `starter` (its first move), `app`, `link` (https only), `note`, `after` (ids it waits for), `at` and `dur` (an appointment that happens then: a call, a visit, a lunch; never time to work on a card), `slot` (`{day, at, dur}`: time set aside to work on it; movable, not an appointment, one per card), `advances` (does playing it move its project's bar: `true`, `false` or `null`; only what I said) with `advanceBy` (the amount a count gains, default 1), and a standing card that comes back every week (or every day): `template` true with `weekdays` (1 Monday … 7 Sunday) and `at`, and `until` (the last day, `YYYY-MM-DD`) when it ends ("every Monday until the end of December"), and `kind`: `task` (the default), `decision` or `event`. An `event` is something outside my hands that a card waits for (a call back, a reply): it sits in a chain with `after`, with an optional `nudge` (a day: Today asks me then whether it happened) and no `est`, `starter`, `due`, `at`, `slot`, `urgent` or `important`. `task.done` on it means it happened (`day` is the day it did) and frees the cards behind it.

## Example

"Drop the games; the photos are due Friday; add 'Text Alex about dates' to Friends", the `changes` of one `apply_changes` call:

```json
[
  {"op": "task.drop", "id": "t12"},
  {"op": "task.update", "id": "t7", "set": {"due": "2026-10-16"}},
  {"op": "task.create", "set": {"title": "Open Messages and text Alex about dates", "project": "p3", "est": 5}}
]
```
