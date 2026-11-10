# Audit of the owner's requests (written 2026-11-10)

**Method.** 227 typed messages pulled from the Claude Code logs for this repo. They run from 9 Oct to 2 Nov 2026 (38 sessions); nothing newer exists, and chats outside Claude Code are not in them. Each request was checked against the code at `main` (3d8dd17). The text of the 28 Oct fix prompt is in no log. Its contents come from the owner's 29 Oct planning prompt, which lists it. "Unverified" means I found no code, test or decision that settles it.

| Request | Date | Source | Verdict | Evidence |
| --- | --- | --- | --- | --- |
| Feed labels timed events with a short label, not "Fixed time" | 21 Oct, again 23 Oct | chat, session | **Partly shipped.** The option exists, but the default is still `times`, which writes "Fixed time" | 4172ef7; `settings.ts:152`, `calItems.ts:62` |
| Remove the daily WhatsApp event at its source | 27 Oct | chat, session | **Partly shipped.** The source was a stale feed from a device that stopped syncing, not a step. Feeds are now one per list. Deleting the old feed waited for you to resubscribe, and I found no record that it happened | 4fccc7d |
| `query_tasks` returns standing steps; find a step by title; feed leaves out dropped and done | 27 Oct | chat, session | Shipped. The feed filter was not re-checked | b95082c; `relay/test/connector.standing.test.ts` |
| One list per card, one Start here, + on Projects, closed folded, Matrix area chip | 28 Oct | session | Shipped within 90 minutes | 468ab9b, 70908e8, 5721bb0, d1188f3 |
| Paused card says Continue and resumes from its logged total | 28 Oct | chat | **Never run.** No "Continue" label; `elapsedSec` restarts at each start | `model.ts:78` |
| Finishing a card with logged time doesn't ask for a duration | 28 Oct | chat | **Never run.** It asks unless the timer is running | `sheets.tsx:135-144` |
| Remove the pause-reason question | 28 Oct | chat | **Never run.** The "Why did you stop?" chips are still there | `sheets.tsx:796-820` |
| Remove all start/restart nudges, keep due and fixed-time reminders | 28 Oct | chat | Shipped three days later, as S2 of the plan | a3027c5 |
| SMART progress for projects | 28 Oct | chat | Shipped as S6, schema 7 | 8535ff3 |
| The daily planning message got lost | 28 Oct | chat | Shipped as S2 and S4; the phone test is owed | 3fa7a1e, b429824 |
| Nothing puts the day's steps into the calendar | 28 Oct | chat | **Shipped, then shelved by you** (S5, then "shelf them") | c8673b9 → 4a328e6 |
| Planning for today puts everything in urgent + important | 28 Oct, again 1 Nov | chat, session | Shipped on the second complaint. Urgency is now the tick only. No code path sets `urgent` from the plan | d586d61 |
| Notes unfolded in the card sheet | 29 Oct | chat | **Never run.** The note field sits inside the folded More | `sheets.tsx:660-675` |
| Remove "today's played cards" from the top of Projects and Calendar | 29 Oct, again 1 Nov | chat, session | Shipped on the second ask | ebd2146, e651942 |
| The Drop confirm state must not wrap at 320 px | 29 Oct | chat | **Unverified.** No test covers "Drop again" at 320 px, and three separate Drop buttons exist | `sheets.tsx:307`, `EventUi.tsx:76`, `CarryUi.tsx:41` |
| Tapping the running card opens its sheet without pausing | 29 Oct | chat | **Unverified.** The ⋯ button opens the sheet; nothing names the tap | `Today.tsx:174` |
| Fixed time vs due | 29 Oct | chat | **Shipped 10 Nov, verified by tests.** Deadline (`due`/`dueAt`), appointment (`at`) and slot (`slot`) are three fields; see `docs/dev/slots.md`. On a phone: unverified on device | `tests/e2e/deadlines.spec.ts`, `cardfields.spec.ts`, `planslots.spec.ts`; `DECISIONS.md` 2026-11-10 |
| "Waiting for" event steps with a nudge date | 31 Oct | session | Shipped the same day | 98d095a, 82da148 |
| Top of every page under the iOS blur | 1 Nov, four times | session | **Shipped then reported broken.** Five attempts in one day. Nothing has touched the band since 948fd8f, so the later layout commits (e9e6ffd, c994469) or the spoofed test are the suspects | 398342e, cb994b1, 948fd8f; `topband.spec.ts` |
| Connecting people to projects | n/a | n/a | Dropped by you | n/a |

## Causes, ranked

1. **Demoted instead of done (7 rows).** The 28 Oct fixes never got a build session. The 29 Oct planning prompt said leftovers go in "only if they block the loop". The plan then wrote them down as "check on the phone, only fixed if the test fails", and "not next week" (`PLAN-2026-11-02.md:24-28,177`). The check was never run. **Fix:** a request is done only with a test that names it. "Check on the phone" is not an end state for something you asked for.
2. **Reversals between prompts (4 rows).** Planned steps in the calendar went timed (23 Oct 17:44), then fixed-only (20:03), then projected (31 Oct), then shelved (1 Nov). Optional fields under More (23 Oct) contradict notes unfolded (29 Oct). Start here moved to Home and back. **Fix:** before building, grep `DECISIONS.md` for the surface. If the request reverses an entry, say so, ask once, and mark the old entry superseded.
3. **Fixes that weren't verified, so you asked again (3 rows).** Urgency, the played-cards line and the iOS top each took two to four asks. The iOS test spoofs `navigator.standalone`, so it can pass while the phone fails. **Fix:** when you repeat a request, find the earlier commit and add the test it lacked. Say "unverified on device" in the last message.
4. **Sessions ending partway (2 rows).** The WhatsApp session ended on a step waiting for you. The 1 Nov session ran out of context, and the 31 Oct `/clear` lost agent work (you asked "check the completed tasks"). **Fix:** the last message of every session lists each request as done (with hash) or open (with the reason).
5. **A frozen brief that sessions are still told to read.** "Do not reopen the frozen brief" (31 Oct) and `BRIEF-changes.md` ("the owner applies them") meant proposed changes went to a file nobody applied. `AGENTS.md` still sends sessions to that brief. **Fix:** `DECISIONS.md` and your message outrank the brief, and no session writes "proposed brief edits" instead of working.

Requests that never reached a session (the 28 Oct prompt, the 29 Oct list) are the root of cause 1. **Fix:** paste each request into a session on the day you write it.

## Three structural problems

1. **Every change fans out.** One UI tweak touches `sheets.tsx` (905 long lines), CSS, English and French strings, 34 manual pages, screenshots, `DECISIONS.md`, the relay (a redeploy) and often a migration. Sessions run out of context (the 400k-token session). **Fix:** one change to the manual per session at most. Screenshots and French in a batch. Split `sheets.tsx` by sheet.
2. **No oracle for what you see.** iOS top, wrapping at 320 px, push and the planning message can only be judged on your phone. Tests spoof them, and the phone tests from S1 to S9 are still owed. **Fix:** a short "owed on device" list in the final message of every session, and layout bugs get a 320/375/430 test that measures the symptom.
3. **Rules duplicated by surface.** Drop has three implementations, Start here two, and calendar text four (`calItems`, `ics`, `feedText`, `calView`). `DECISIONS.md` has 461 entries that contradict each other (298, 332, 339). **Fix:** one component or function per interaction; the next session that touches a duplicate merges it.
