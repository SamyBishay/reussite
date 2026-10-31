# Réussite change-set, version 1

A change-set is one JSON object: `{"v": 1, "note": "…", "changes": [ … ]}`. Réussite shows each change as before → after with a checkbox; only ticked changes are written. `note` is optional: one short line for the person (say there what was unclear), up to 1,000 characters.

Use the ids from the lines you were given (`t…` steps, `p…` projects, places, `d…` decisions). To refer to something you create in the same change-set, give it `"ref": "any-name"` and use that name as its id later. Dates are `YYYY-MM-DD`, times `HH:MM`, estimates in minutes. Leave out any field you don't change. **Never give weights**: the person weighs pros and cons themselves.

## Operations

| op | fields |
| --- | --- |
| `task.create` | `ref?`, `set` (needs `title`) |
| `task.update` | `id`, `set` |
| `task.done` | `id`, `day?` (the day it was done; default today; on a step of `kind` `event`, the day it happened) |
| `task.drop` | `id` |
| `task.reorder` | `ids` (a project's steps in their new order) |
| `project.create` | `ref?`, `set` (needs `name`) |
| `project.update` | `id`, `set` |
| `day.update` | `date`, and any of: `plan` (the whole list, in order), `add`, `remove` (step ids), `first` (the step to start with), `launches` (accepted and stored, but the app no longer uses launch points: leave it out) |
| `place.create` / `place.update` | `ref?` or `id`, `set`: `name`, `timeZone` (IANA, e.g. `Europe/Paris`), `parent` (makes it an area of that place: an id, a name, or the `ref` of a place made earlier in the change-set, which must come first; on `place.update`, `null` makes it a place again) |
| `stay.create` / `stay.update` | `id` for updates, `set`: `place` (id or name), `from`, `to`, `note?` |
| `address.create` | `set`: `name` (needed), `category?`, `place?`, `mapsUrl?`, `street?`, `note?`. A place to try, saved as *want to go* |
| `decision.create` / `decision.update` | `ref?` or `id`, `set` (create needs `title`) |
| `memory.add` | `note`, `kind?`, `text` (a new line in the note; `kind` makes the note if there is none of that name) |
| `memory.edit` | `note`, `line`, `text` (replace a line) |
| `memory.remove` | `note`, `line` (forget a line) |
| `memory.note` | `note`, `set`: `name`, `aliases` (the whole list), `kind` |

**Step `set`**: `title` (start with the concrete first action: "Open Mail and reply to…"), `label` (a short name for calendars, five or six keywords at most: "Choir · Hill House", "CAF claim letter"; the title stays the sentence; leave it out and the app derives one from the title; an empty `label` on an update clears it), `project`, `suit` (`S` work and studies, `D` money and papers, `C` family and home, `H` life: people, leisure, health), `urgent`, `important` (true/false), `due`, `est`, `starter` (the smallest first action), `app`, `link` (https only), `note`, `where` (place id or `any`), `after` (step ids it waits for), `at` and `dur` (a fixed time and duration), and for a standing obligation that repeats every week: `template` (true), `weekdays` (1 = Monday … 7 = Sunday) and `at`, with `lead` (minutes of notice before it; leave it out for the person's usual). A `template` without `at` and `weekdays` is ignored. `template` is read only when a step is created. `task.update` on a standing obligation changes the series (its `at`, `weekdays`, `dur`, `lead`, title and the rest); it never clears its time or days and never gives it a `due`. `task.drop` ends the series; `task.done` is for the copy placed on a day, not the series. `lead` is 0 to 1440 minutes; `null` means the person's usual. `kind` is `task` (the default), `decision` or `event`. An **event** is something outside the person's hands that a step waits for (a call back, a reply, a delivery): it sits in a chain with `after`, but nobody does it, estimates it or schedules it. Give it `title`, `project`, `after`, `where`, `note` and, if useful, `nudge` (a day, or `null`): from that day Today asks the person whether it happened. It takes no `est`, `starter`, `urgent`, `important`, `due`, `at`, `dur`, `lead`, `weekdays` or `template`: a change that gives it one is refused, and `nudge` belongs to events only. `task.done` on an event means it **happened** (`day` is the day it did, today or earlier) and frees the steps that wait for it; `task.drop` gives up waiting and frees them too. `task.update` with `"kind": "event"` turns a step into one (its estimate, time and date are cleared), `"kind": "task"` turns it back. A change-set holds at most 80 changes.

**Areas**: a place can hold areas (Cairo → Heliopolis): `place.create` with `parent`. An area has no time zone of its own (it takes its parent's; any `timeZone` you give for one is ignored), and what is set to an area (`where`, an address's `place`) is on its parent's page. One level only: an area cannot hold areas, and a place that holds areas cannot become one; such a change is skipped. A step, an address or a person can be set to an area with the same `where` / `place` fields as to a place.

**Memory**: short notes about people, places and ongoing matters, in the person's words. `note` is a note's id, name or alias; `kind` is `profile`, `person`, `place`, `area` or `topic`. `line` is a line's number in the context you were given (from 1), its id, or its exact text; a line is at most 600 characters, and several `memory.add` for one note are fine. A name that two notes share is left alone, and a name no note has makes a new note only when you give a `kind`. Write a line only for what the person said, in their words, never a conclusion about their health, character or anyone's private life. Private notes are not shown to you and cannot be changed. Memory changes always wait for the person's yes, under Remember.

**Addresses** (a trip plan's suggestions): `address.create` adds a place the person may want to go to. `name` is needed; `category` is one of the category ids you were given (anything else becomes `other`); `place` is a place's id or name (none, or one that is not found, means Anywhere); `mapsUrl` only if you are sure of a real Google or Apple Maps link (https); `street` if you know it; `note` is one line: why you suggest it and what you checked (opening hours, a closing day). It is saved as *want to go*, marked as yours, and shown in the review like any change, where the person can untick it. One the person already has (the same name in that place, or the same link) is left out. `address.create` is understood by the app only: the connector refuses it, and an address can't be changed or removed this way. To put the place on a day, make a step for it ("Go to …") and add that step to the day.

**Trip days**: a trip is planned with day lists and fixed times, never an hourly grid. For each day, one `day.update` with `add` (existing step ids, or `ref`s of steps you create with `task.create` and `"where": "<place id>"`). A train, a booking or a ticket is a `task.create` with `at`, `dur` and `due` (the day). Nothing else gets a time.

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
- Opening it: where the browser holds the same space (sync on, same space id), the page goes to Home and opens the diff-and-tick screen at once (an installed app with `launch_handler: focus-existing` gets the address from `launchQueue` in its open window). Elsewhere (an iPhone's Safari, whose storage is separate from the Home Screen app's) the page checks the change-set, seals it to the inbox public key (ephemeral X25519, HKDF-SHA256, AES-GCM, the space id as authenticated data), and posts it to the relay's inbox. The person's devices derive the same key pair from the recovery key, fetch the inbox at each sync, and open the diff-and-tick screen for each drop, one at a time. A drop is deleted from the relay once it has been applied or dismissed.
- What is applied is kept as an exchange (`src` `link`, or `inbox` for a drop from the relay), listed in History with Undo.
- Nothing is applied without the person's ticks. The inbox accepts at most 16 KB per drop, 50 waiting drops, and keeps each 30 days.

