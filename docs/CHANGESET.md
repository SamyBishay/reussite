# Réussite change-set, version 1

A change-set is one JSON object: `{"v": 1, "note": "…", "changes": [ … ]}`. Réussite shows each change as before → after with a checkbox; only ticked changes are written. `note` is optional: one short line for the person (say there what was unclear), up to 1,000 characters.

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
| `memory.add` | `note`, `kind?`, `text` (a new line in the note; `kind` makes the note if there is none of that name) |
| `memory.edit` | `note`, `line`, `text` (replace a line) |
| `memory.remove` | `note`, `line` (forget a line) |
| `memory.note` | `note`, `set`: `name`, `aliases` (the whole list), `kind` |

**Step `set`**: `title` (start with the concrete first action: "Open Mail and reply to…"), `project`, `suit` (`S` work and studies, `D` money and papers, `C` family and home, `H` life: people, leisure, health), `urgent`, `important` (true/false), `due`, `est`, `starter` (the smallest first action), `app`, `link` (https only), `note`, `where` (place id or `any`), `after` (step ids it waits for), `at` and `dur` (a fixed time and duration), and for a standing obligation that repeats every week: `template` (true), `weekdays` (1 = Monday … 7 = Sunday) and `at`, with `lead` (minutes of notice before it; leave it out for the person's usual). A `template` without `at` and `weekdays` is ignored. `template` is read only when a step is created.

**Memory**: short notes about people, places and ongoing matters, in the person's words. `note` is a note's id, name or alias; `kind` is `profile`, `person`, `place`, `area` or `topic`. `line` is a line's number in the context you were given (from 1) or its exact text. Write a line only for what the person said, in their words, never a conclusion about their health, character or anyone's private life. Private notes are not shown to you and cannot be changed. Memory changes always wait for the person's yes, under Remember.

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

A standing obligation (every Monday at 19:00, a reminder before it starts) and a memory line, in one change-set:

```reussite
{"v": 1, "changes": [
  {"op": "task.create", "set": {"title": "Choir, Hill House 602", "template": true, "weekdays": [1], "at": "19:00", "dur": 90, "lead": 30}},
  {"op": "memory.add", "note": "Choir", "kind": "topic", "text": "Rehearsal is on Mondays at Hill House 602"},
  {"op": "memory.edit", "note": "Ibrahim", "line": 2, "text": "Works days now"},
  {"op": "memory.remove", "note": "Ibrahim", "line": "Has a cat"}
]}
```

## The one-tap link

This section is for Réussite itself; it is left out of what an AI is given. When the person has a drop address, the AI answers with a link instead of the fenced block: `https://<app>/drop#<space>.<key>.<mode>.<data>`, with no trailing slash after `drop`.

- `space`: the space id, 22 characters of base64url. `key`: the inbox public key (X25519), 43 characters of base64url. Together they are the drop address, shown in Settings, AI. They are not secret.
- `mode` `z`: `data` is the change-set JSON compressed with deflate-raw, then base64url (padding and the `+/` alphabet are tolerated). Mode `j`: `data` is the JSON itself, percent-encoded, for an AI that cannot compress. The fragment never reaches a server.
- Over about 8,000 characters of fragment, the AI gives the fenced block instead. The page reads up to 64 KB and refuses a link that expands past 256 KB.
- Opening it: where the browser holds the same space (sync on, same space id), the page opens the diff-and-tick screen at once. Elsewhere (an iPhone's Safari, whose storage is separate from the Home Screen app's) the page checks the change-set, seals it to the inbox public key (ephemeral X25519, HKDF-SHA256, AES-GCM, the space id as authenticated data), and posts it to the relay's inbox. The person's devices derive the same key pair from the recovery key, fetch the inbox at each sync, and open the diff-and-tick screen for each drop, one at a time. A drop is deleted from the relay once it has been applied or dismissed.
- Nothing is applied without the person's ticks. The inbox accepts at most 16 KB per drop, 50 waiting drops, and keeps each 30 days.

