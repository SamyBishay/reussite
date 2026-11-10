# Deadlines, appointments and slots

A step carries three times, each in its own field (schema 9, additive; `docs/dev/` is per feature, `DECISIONS.md` 2026-11-10 has the choices).

| | Field | What it is | Calendar tab | Feed, reminders | On Today after it passes |
| --- | --- | --- | --- | --- | --- |
| Deadline | `due` (+ `dueAt`) | must be done by then | no | no | stays; "was due 17:00", plain colour; an earlier day: "carried over" |
| Appointment | `at` (+ `dur`, `lead`) | happens then | yes, solid | yes | stays, marked "missed", with Move / Remove (`eventMissed`, `missedOn`) |
| Slot | `slot` `{day, at, dur}` + `slotLog` | time set aside to work on it | yes, dashed, "slot ·" | no | stays; "slot passed", Re-slot |

- **Pure rules**: `src/domain/slots.ts` (`dueState`, `slotState`, `eventMissed`, `readSlot`, `writeSlot`, `slotsFor`), each with a test. The app's wrappers are `dueStateOf`, `slotStateOf`, `eventMissed` and `slotsOfDay` in `src/app/model.ts`; the writes are `setSlot`, `planDaySlots` and `dueOn` in `src/app/actions.ts`.
- **One slot per step; the log keeps the past.** Every write of `slot` goes through `writeSlot`, which appends `{from, to, at, by, why}` to `slotLog` (last 20). `why`: planned, set, moved, reslotted, cleared. Writing the same slot is no change.
- **Re-slot is the person's.** `SlotChip` (`src/app/SlotUi.tsx`) opens a sheet with a proposal (the step's projected start in `dayOrderOf`, else the next five minutes); only its button writes. Nothing re-slots by the clock. A connector `task.update` of `slot` waits for the person's yes like any other update.
- **Plan my day writes slots, never `at`**: `planDaySlots(day)` after the check-in's `accept` and the morning's `applied`, from `slotsFor(dayOrderOf(day))`. Fixed items get none; a step the day has no room for gets none.
- **Calendar**: `calViewEvents` gives `kind: 'slot'` events (`.k-slot` in `src/styles/calendar.css`) in every view; dragging one on the hour grid calls `setSlot(…, 'moved')`. `feedText`, `ics` and `agenda` never read them (`src/app/feed.test.ts`).
- **An event's day** is still its `due` (or its list's) when it has an `at` (DECISIONS 2026-11-02): a step with both a deadline on one day and an appointment on another is not representable. `dueAt` on a step with an `at` is allowed and means the deadline's time.
- **Connector**: `dueAt` and `slot` are in `taskSet` (`src/ai/changeset.ts`); `dueAt` needs a `due`; a standing step and an event take neither; `get_method` and `docs/CHANGESET.md` say work time is a slot, never `at`. Rendering is in `relay/src/connector/render.ts`.
- **WebKit**: a date or time input set to `''` by script keeps bad input and blocks its form; the slot fields are remade (a new `key`) when emptied (`SlotFields`).
