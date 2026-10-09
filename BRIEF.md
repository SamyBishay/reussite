# Réussite 2 — build brief

You are building the second version of Réussite, a planning app built on a psychologist's CBT method for adult ADHD. Read this file, `docs/METHOD.md` and `docs/reussite-v1.html` in full before writing any code.

---

## 0. How we work

- I'm Samy. I have a computer-science background and read code, but I want you to write it. I'm the product owner and the tester.
- **Work phase by phase** (section 12). At the end of each phase: run the tests, deploy a preview, and give me a checklist of at most ten things to try on my phone and computer. Then **stop and wait** for me to say "go to phase N". Don't start the next phase on your own.
- **Ask me questions one at a time**, and only when the answer changes what you build. Otherwise take the conventional option and log it in `DECISIONS.md` (one line each: date, decision, why).
- Before any code: propose the stack and folder layout in fifteen lines or fewer, and wait for my OK.
- My real data lives in `private/`. Add it to `.gitignore` before anything else, and never commit, print or send its contents anywhere except to the importer running locally.
- Small commits. Keep `CHANGELOG.md` in plain language (the app shows it to friends after an update).
- **This brief can change while you build.** When I update it, I'll say what changed and which phase it belongs to. Re-read the changed sections before you continue, and flag anything that conflicts with work already done.
- When something in this brief turns out to be impossible or much more expensive than it looks, say so before building around it.

---

## 1. What this is, and for whom

**v1** (`docs/reussite-v1.html`) is a single page hosted as a Claude artifact. It stores its data in the artifact's database (`window.claude.use('db')`, Firestore-like, collections `tasks`, `projects`, `days`, `decisions`, `meta`) and uses Claude from the page for "Plan my day" and a plain-language command box. Outside the page, Claude chats read and write the same database (quick edits that start with "R:", a daily morning push, the `today` and `decide` skills). It works well for me, and only for me: it needs a paid Claude account and it is wired to my life. Its prompts name me and hard-code France and Cairo; v2 must contain nothing personal, and everything specific to a person comes from their Settings.

**v2** is for me and a handful of friends (three to ten). It must:

- run on **iPhone, iPad, Android and desktop**, installed to the home screen or dock;
- work **without Claude**, with **any AI or none**;
- keep each person's data **end-to-end encrypted**, so that I, the host, can't read it;
- let me **ship updates** without breaking anyone's list or settings, and let friends **customise** it without touching code;
- apply the method fully **by hand, with zero tokens**, with AI as an optional accelerator.

It is not a product: no accounts, payments, app stores, analytics or marketing.

---

## 2. Principles, in priority order

1. **The method is the app.** Every flow in METHOD.md works by hand, with no AI. AI only speeds up what the person could do themselves, and never writes without their confirmation.
2. **Their data is theirs.** Local-first. The server holds only ciphertext, push subscriptions and what the user explicitly makes public (the optional calendar feed). No accounts, no emails, no passwords.
3. **Customisation is data, not code.** Everything a friend might want to change lives in Settings, which syncs. A code update replaces code and migrates data; it never overwrites settings.
4. **One question per screen** in guided flows. One tap to start the first step. Each to-do is its own card; never merge several into one.
5. **Calm and legible.** Keep v1's look and feel: Atkinson Hyperlegible (self-hosted), 44 px tap targets, works at 375 px wide, light and dark, respects reduced motion. No streaks, no guilt copy.
6. **A small, boring stack** that any coding agent (Claude Code, Codex, Cursor…) can maintain from the repository's own docs.

---

## 3. Architecture

### Client

- A **Progressive Web App**: Vite, TypeScript, Preact (or React if you have a strong reason), no CSS framework. Port v1's CSS custom properties and components rather than redesigning.
- `vite-plugin-pwa` (Workbox) for offline use and update detection.
- IndexedDB through Dexie or `idb`.
- Hosted on **Cloudflare Pages**, deployed from GitHub `main`; preview deploys for branches.
- Self-host the fonts; no third-party scripts at runtime.

### Relay (one small server)

- One **Cloudflare Worker** plus **D1** (or Durable Objects with SQLite if you show it's simpler). It does three jobs:
  1. **Sync**: stores encrypted change batches and snapshots per "space" (section 6).
  2. **Push**: stores Web Push subscriptions and scheduled, pre-encrypted payloads; a **Cron Trigger every minute** sends what's due.
  3. **Calendar feed**: serves an opt-in `.ics` projection at a secret URL (section 8).
- Mind the free plan: 100,000 requests a day, 5 cron triggers per account, **10 ms CPU per invocation** (https://developers.cloudflare.com/workers/platform/limits/). Keep the cron handler tiny: payloads arrive already encrypted, and the VAPID token is cached. If we outgrow it, Workers Paid is $5 a month; tell me before relying on it.
- The relay's base URL is a setting, so a friend who forks can run their own.

### AI

- Called **from the browser with the user's own key**. Two adapters:
  - **OpenAI-compatible chat completions**, with a configurable base URL. Default: OpenRouter (`https://openrouter.ai/api/v1`), which gives access to most models with one key and accepts an Anthropic key through its BYOK setting. The same adapter covers OpenAI, Mistral, and local servers that allow CORS.
  - **Anthropic Messages API**, with the `anthropic-dangerous-direct-browser-access: true` header that allows direct browser calls.
- Two model slots in Settings: *quick* (edits, small proposals) and *thinking* (planning, breakdowns, decisions).

---

## 4. Data model

Keep v1's collections and field names so the importer is a straight copy. v1's fields, for reference:

- `tasks/<id>`: title, project, suit (`S` work & studies, `D` money & papers, `C` family & home, `H` life: people, leisure, health), kind (`task` | `decision`), urgent (blockers only), important, due (YYYY-MM-DD), est (minutes), estBy, app, link, prompt, starter, spent (minutes), sessions [{d, m, why, at, manual?}], status (`open` | `done` | `dropped`), doneDay, doneAt, started (ISO while a timer runs), resume, carried, where, after (id or ids that must be done first), template (a standing obligation), note, order, created, src, from.
- `projects/<id>`: name, suit, where, goal, goalBy, due, order, status. `inbox` holds steps added on the fly.
- `days/<YYYY-MM-DD>`: date, plan (task ids in order), launches [{t: 'HH:MM', k: 'start' | 'restart', n?, first?}], first {id, title}, checkin (ISO), closed (ISO), summary.
- `decisions/<id>`: title, problem, options [{name, pros, cons, prosNot, consNot, score}] with items as [text, weight], chosen, why, mustBeTrue, falsifier, date, reviewOn, taskIds.
- `meta/settings`: here (`france` | `cairo`), ratio.

Changes for v2:

- **Every document** gets an `id`, a schema version, per-field update timestamps (hybrid logical clock) for merging, and a tombstone instead of hard deletion.
- **Sessions move to their own collection** (`sessions/<id>`: taskId, d, m, why, at, source: `timer` | `corrected` | `typed`), so two devices timing the same task never overwrite each other. v1's `manual: true` becomes `typed`. The task's `spent` becomes derived.
- **Estimates**: tasks keep `est`, the current estimate, and gain `est0`, the estimate frozen when the first session starts, which is what the learning uses (section 5, Estimates that learn your pace). On import, v1's `est` fills both.
- **Places** are no longer hard-coded: `places/<id>` {name, timeZone, order}, defined by the person; v1's `france`/`cairo` migrate into it. Steps and projects keep `where`: a place id, or `any` (*Anywhere*).
- **Stays**: `stays/<id>` {placeId, from, to, note}. Steps gain an optional `dueRule` {beforeEndOf: stayId, daysBefore: 1} for "before I leave" (section 5, Places and stays).
- **Addresses and people** (phase 4): `spots/<id>` {name, category, placeId, mapLink, address?, status: `want` | `been`, visits [{d, note, again: `yes` | `maybe` | `no`}], note, by} and `people/<id>` {name, placeId, contact (a link), note, lastSeen}, with no home-address field. Steps gain optional `spotId` and `peopleIds`.
- **Suits** are settings: name, short name, glyph and colour for each of the four. v1's labels are the defaults.
- **Attribution** fields (`estBy`, `goalBy`, item `by`) take `me` | `ai`; v1's `samy` → `me`, `claude` → `ai`.
- **Repeating steps**: tasks gain an optional `repeat` {every: n, unit: `day` | `week` | `month`, weekdays?: [1–7], monthDay?: 1–31, from: `due` | `done`, until?: YYYY-MM-DD}. Different from a standing obligation (`template`), which the planner places on a day: a repeating step is an ordinary step with a due date that comes back.
- **Fixed times**: tasks gain optional `at` (HH:MM) and `dur` (minutes) for things that happen at a set time: appointments, a standing obligation placed on a day, the fixed commitments typed in the morning check-in. Most steps have neither; they float between launch points.
- **Projects** gain `smart` {specific, measurable, attainable, relevant, dated} alongside the one-sentence `goal`, a `status` of `active` | `paused` | `done` | `dropped`, and links to their decisions.
- **Decisions** become structured (section 9): `projectId`, `taskId`, a structured `problem`, items as objects {id, text, w (1–5), by, mirrorOf?}, a `status` (`draft` | `decided` | `reviewing` | `closed`), `listClosedAt`, `newFacts` [{at, text}], `reviews` [{on, falsifierHappened, note}] and a `history` of score snapshots whenever weights change.
- **Settings** is one synced document (section 7). **Device-local** values (sync key, push subscription, AI key unless the user opts in to syncing it) never leave the device unencrypted and never enter the synced document in plaintext.

**Import**: accept a JSON export of v1 in either shape: `{collection: [docs]}` or `{collection: {id: doc}}`, with or without each doc wrapped as `{data, version}`. Show a summary (counts per collection, anything skipped) before writing. My export is in `private/`.

---

## 5. Everything the person can do by hand (no AI)

### The task sheet

Every field is editable: title, starter, urgent, important, due, estimate, suit, place, project, kind (task or decision), standing obligation, waits for (`after`: pick other steps, with search), app, link, prompt (editable, with Copy), note.

- **Due dates** can be changed inline wherever a step appears (Today, Matrix, Projects), with quick picks: today, tomorrow, +1 week, clear.
- **Done on another day**: "Mark done" defaults to today; "Done on…" takes a date (quick pick: yesterday) and an optional time spent. A done step shows its done date, which stays editable. Reopen is always available.
- **Time**: the step's sessions are listed (date, minutes, why) and can be added, edited and deleted; an edited session becomes `corrected`. Totals and personal estimates recompute.
- **How long did it take?** Whenever a step is marked done without a running timer (including "Done on…"), a duration sheet asks how long it took. The same picker is used in the sessions editor.
  - **Quick buttons scaled to the estimate**: ¼×, ½×, 1×, 1½× and 2× the step's personal estimate (below), rounded to clean values (5-minute steps under an hour, 15-minute steps above), duplicates removed, never under 5 minutes. Doublings below the estimate, finer steps above it, because real times for people with ADHD usually land above the estimate. With no estimate: 5, 15, 30, 45, 60 and 90 minutes.
  - **A wheel for anything else**: two native `<select>`s, hours (0–8) and minutes (in 5-minute steps), which iOS shows as a scroll wheel; dropdowns elsewhere are fine. The wheel starts at the step's personal estimate. Durations entered this way are saved as `typed` and count for less in the learning: memory underestimates durations, and a default the person simply accepts would otherwise teach the model its own guess.
  - **"Didn't time it"** marks the step done with no session; it is left out of the learning.

### Repeating steps

- The task sheet has a **Repeats** field: never (default), every day, every week (on chosen weekdays), every month (on a date), or every *n* days, weeks or months; optionally until a date.
- **From the due date or from completion**: "pay rent on the 5th" repeats from its due date; "water the plants every 10 days" repeats from when it was done. The person chooses; the default is from the due date.
- When a repeating step is marked done (including "Done on…") or dropped *for this time*, the next occurrence is created as a new step with its due date, keeping the title, starter, estimate, project, place, app, link and prompt, and with no sessions. Its time history stays with each occurrence, so the estimate learning sees every one. "Stop repeating" ends the series.
- Only the next occurrence exists at any time, so the matrix and the calendar never fill up with future copies. The calendar shows later occurrences as faint markers on their dates.
- A missed occurrence isn't duplicated: it stays one overdue step until it is done or skipped ("Skip this time" creates the next one and drops this one).

### Making *Later* happen sometimes

*Later* (not urgent, not important) is where things go to die. The method says park or drop; but some of it is wanted, and nothing in a daily planner ever reaches it. So:

- **Weekly allotment.** At the Sunday review, one screen shows the *Later* items for the current place, oldest first, and asks for at most two for the week: each gets a day, as an *optional* card on that day.
- **Daily: added or removed.** On that day the planner puts the optional card at the end of the plan, after the work steps and the obligation, marked "If there's room". It doesn't count towards the work-step limit and is never carried over: if it isn't played, it goes back to *Later* with no carry count.
- **Light days pull one in.** On a day whose plan is under half its usual load, or a rest day, the planner offers one more *Later* item ("You have room: …?").
- **Promote or drop.** A *Later* item offered at four Sunday reviews and never picked gets one question: make it important (it moves to *Protect*), make it a leisure obligation, or drop it. If something keeps being wanted but never chosen, it's mislabelled.

### When the timer was wrong

- **Forgot to start it.** Next to "Start the timer", "I started earlier" backdates the start, with quick picks (5, 10, 15, 30 minutes ago) or the wheel.
- **Forgot to stop it.** Once a timer has run for twice the step's personal estimate (at least 45 minutes), or past the start of the next day, a notification asks "Still on <step>?" (phase 3; before then, a banner the next time the app opens): *Still going* / *I stopped at…*. Stopping a timer that has run that long asks the same question before saving. "I stopped at…" takes a clock time or a duration, and the session is saved as `corrected`.
- **Any session can be fixed later** in the step's sessions list.
- **Changing an estimate.** Before work starts, it is simply edited. Once a session exists, the first estimate is frozen as `est0`, and editing the estimate asks one question: "Was the first estimate a slip (a typo, or the wrong step)?" *Yes* replaces `est0`. *No* keeps `est0` for the learning and saves the new figure as the estimate for what's left. Otherwise correcting estimates after the fact would erase the very gap rule 4 asks you to measure.

### Estimates that learn your pace

v1 multiplies every estimate by one number, the median of real time over estimate. v2 keeps the idea and refines it by kind of step. It runs on the device, offline, with no AI and no tokens: a pure function, recomputed whenever a step is done, and unit-tested.

- **You estimate first.** The person's own estimate stays the input. The personal estimate appears only **after** it's typed, never before: "30 min → usually 45 for you". Showing the history first would anchor the estimate, and the gap between the two numbers is what rule 4 teaches.
- **What it learns from**: done steps with a frozen estimate (`est0`) and recorded time, weighted by source: `timer` 1, `corrected` 0.5, `typed` 0.5. "Didn't time it" is excluded. Remembered durations are biased, which is why they count for less: people underestimate how long past tasks took, and that bias feeds their underestimates of future ones; recorded durations are the proposed remedy (Roy, Christenfeld & McKenzie, *Psychological Bulletin* 2005, https://pages.ucsd.edu/~mckenzie/Royetal2005PsychBull.pdf). Older data fades with a half-life of 60 days, so the model follows changes in how the person works.
- **The model**, in log space, because ratios multiply:
  - for each step, r = ln(real time / est0), clipped to ±ln 6, so a forgotten timer can't wreck it;
  - a **global offset**: the weighted mean of r, the person's overall bias;
  - a **size term**: one slope of r on ln(est0), fitted once there are 15 data points and shrunk towards zero. In the same review, tasks under about 5 minutes were mostly overestimated and tasks over about 12 minutes mostly underestimated; one slope captures that;
  - a **class offset**: the mean remaining residual for the step's **app** if it has at least 3 data points, else its **project**, else its **suit**, multiplied by n / (n + 5). A class with two data points barely moves the estimate; one with thirty mostly speaks for itself. The app is the most telling class, because titles start with it ("Open Mail and…", "Open Doctolib and…");
  - personal estimate = est × exp(global + size + class), rounded to 5 minutes.
- **A range** from the 25th and 75th weighted percentiles of residuals in the class used: "~45 min (35–60)". The day's total gets a range too.
- **Cold start**: no correction until there are 5 weighted data points; until then the step shows "Learning your pace: 2 of 5 timed".
- **Explainable**: tapping a personal estimate shows its basis in one line, such as "Mail steps: 12 timed, usually 1.4× your estimate."
- **Where it's used**: planner totals, the duration wheel's default, the calendar's day loads, the "Still on…?" threshold. The raw estimate is never overwritten.
- **AI estimates are calibrated separately**: steps with `estBy: 'ai'` get their own offset, and the Log shows whose estimates land closer for this person, theirs or the AI's.
- **Calibration in the Log**: the median ratio by month and by app. Getting better at estimating is real progress, so it belongs with the other things that make progress visible.

### Opening other apps and websites

A step's link must open the right place: websites in the default browser (Safari on iOS), apps in their own app. Never a browser sheet inside Réussite. In v1, every link opens a new page inside the Home Screen web app instead.

- On iOS, a link to another site from a Home Screen web app opens in an in-app browser, and universal links (which would hand claude.ai to the Claude app) don't fire there, or after a JavaScript redirect; only a real tap counts (https://linkrunner.io/blog/universal-links-app-links-break-in-app-browsers).
- **Apps first, by URL scheme**: resolve each step's `app` and `link` to the app's own scheme where one exists (`mailto:`, `sms:`, `tel:`, `whatsapp://`, `claude://`…). Schemes open the app directly. Keep the table of known apps in one file, and let the link field accept any scheme on an allow-list plus `https:` (never `javascript:` or `data:`).
- **Websites on iOS**: when running standalone on iOS, rewrite `https://` to `x-safari-https://`, which opens Safari. Apple doesn't document it, but installed web apps use it (https://github.com/kita0905game-cyber/life-quest/pull/5); test it on the current iOS and fall back to plain `https://` if it fails.
- **Claude**: copy the prompt to the clipboard first, as v1 does, then open the app. The mobile app registers `claude://`, documented for Claude Code routes (https://support.claude.com/en/articles/14898120-open-the-claude-mobile-app-with-a-link); test whether a plain new chat with a prefilled prompt can be opened that way. If not, open `claude://` and let the person paste. On desktop, open claude.ai in a new browser tab.
- Open from the tap handler itself, with nothing awaited before it, or iOS ignores it.
- On Android and desktop, test what an ordinary link does and add workarounds only where needed.
- A Settings switch: open websites in the browser (default) or inside Réussite.

### Matrix

- Move steps between quadrants: drag on desktop and tablet; on phones, long-press or a "Move to…" menu.
- Because urgency follows dates, moving *into* Now or Quick without a due date inside the window asks one question: set a due date, or mark it as a blocker? Moving *out of* urgent while the due date is inside the window asks for a new due date.
- Filter by project, suit and place; search.

### Projects

- Edit name, suit, place, due date, status and order.
- **SMART goal editor**: five fields plus the one-sentence goal, with a short hint per letter. A goal proposed by AI shows "proposed" until the person taps Confirm or edits it.
- Reorder steps, set what waits for what, move a step to another project.
- Linked decisions appear on the project: the choice made and the next check date.
- v1's progress bar stays.

### Days

- A day navigator (yesterday, today, tomorrow, any date) to edit any day's plan, launch points and first step. Closing the day can set tomorrow's first step and start time.

### Calendar view

A Calendar tab, between Projects and Log, that puts the list on dates. It shows only Réussite's own data; it doesn't read anyone's calendar (section 8).

- **What it shows on each day**: the stay it belongs to, as a labelled band; steps due that day; the day's plan, as cards in order; launch points; anything with a fixed time (`at`, `dur`); decision checks (`reviewOn`); project due dates; the Sunday review. Past days show the cards played, as suit pips like the foundation piles, and the time logged.
- **The urgency window**: days within the urgency window (21 days by default) are tinted, so you can see when a far deadline will start counting as urgent.
- **Month view**: a grid with compact markers per day (due count, planned count, pips for cards played). Tapping a day opens that day in the day navigator.
- **Week view**: an agenda. On a phone, the seven days are stacked; on a tablet or desktop, they sit side by side as columns. Each day lists fixed-time items first, with their times, then the plan's cards and the due steps. It is **not an hourly grid**: the method's launch points are not a timetable, and a filled-in week of time blocks is the kind of schedule that doesn't get followed. Untimed steps never get a time slot.
- **Moving things**: on desktop and tablet, dropping a step on a day's plan list plans it for that day, and dropping it on the day's header makes that day its due date. On a phone, the step's "Move to…" menu offers both, "Plan it on…" and "Due on…", as two separate choices. Done steps can be moved to another day, which changes their done date.
- **Planning ahead stays light**: a future day holds its first step, its fixed-time items and the week's Protect steps and obligations chosen at the Sunday review. Steps 5 and 6 of the Sunday review happen in the week view. The full plan for a day is still made that morning.
- Days follow the day-start rule (05:00) and the current place's time zone, and the calendar feed (section 8) uses the same data.

### Places and stays

v1 has two hard-coded pages, France and Cairo. v2 generalises them.

- **Every place gets a page.** A place is created in Settings, during onboarding, or by typing a new name in a step's or project's place field, and its page exists at once. A place's page shows its own steps and projects plus everything marked *Anywhere*. Anywhere is the default for new steps: the base layer shared by every page.
- **The place switcher** at the top (v1's "In France" pill) shows the current place, and opens any other place's page without moving there, to prepare Cairo from France, say. Today, Matrix, Projects and Calendar follow the page being viewed; the planner and notifications follow the current place.
- **Stays**: a place with a first and last day ("Strasbourg, 4–7 Oct"). On a stay's first day the current place switches by itself, in that place's time zone, with a one-line notice. Outside any stay, the current place is the last one chosen by hand. A day belongs to the stay that starts on it.
- **"Before I leave"**: a step can be due before the end of a stay. Its due date is the stay's last day minus one (adjustable), and it moves when the stay's dates move, so it turns urgent on its own as departure nears.
- In the Calendar, stays show as labelled bands, and planning a day inside a future stay draws on that place's page.

### Addresses and people (phase 4; a module that can be switched off)

The method makes leisure and seeing people obligations (rule 7). The hard part of an outing is often choosing where, or with whom, and choosing is a decision, which doesn't belong in a starter. Lists made in advance turn "go out" into "Open the front door → the bakery on the corner". They exist to feed the plan: not a travel journal, not a maps app.

**Addresses** (*bonnes adresses*), per place:

- **Fields**: name; category (food, café & bar, shopping, sight, museum, park & public space, outing, other; editable in Settings); place; a Maps link; an optional street address; *want to go* or *been*; visits.
- **Adding takes seconds.** iPhones don't let web apps appear in the share sheet (https://web.dev/learn/pwa/os-integration/), so the flow is: copy the link in Maps → + Address → Paste. Read the name from Google and Apple Maps links when the link contains it; otherwise ask for it. No geocoding, map tiles, photos, opening hours or external APIs.
- **The link opens the Maps app** (see "Opening other apps and websites").
- **After a visit**, one screen: a short note on how it was, and *again / maybe / not again*. It appears when a step linked to the address is marked done, or by hand from the address. The note is the point: it corrects the next choice the way timing corrects the next estimate.
- **Feeding the plan**: when the planner places a leisure obligation, it offers up to three addresses in the current place: *again* first, then *want to go*, least recently visited first. Deterministic, never random (see Rewards). Picking one sets the step's title, starter and link.
- **Import once** from a Google Maps list exported with Google Takeout. The export comes as CSV or JSON and varies by account, so take whatever title, note and URL are present.

**People**, per place:

- **Fields**: name; place; how to reach them (a link that opens WhatsApp, Messages or Mail); a note; *last seen*, set when a step linked to them is done. Last seen shows as a date, never as an overdue warning.
- **No home addresses.** These are people who didn't sign up for the app, so store only what the plan needs.
- When the planner places a people obligation, it offers those in the current place seen least recently.
- People are **never** sent to an AI unless ticked for that request.

**Planning a trip**, from a stay:

- "Plan this trip" builds an *Ask any AI* context pack (section 10): the stay's place and dates, its addresses with notes and ratings, its open steps and fixed-time items, the people there only if ticked, and the person's question. The pack asks the AI to check opening hours and closures on the web if it can, and to answer with a change-set: day lists, fixed-time items (trains, bookings), and any addresses it suggests, saved as *want to go* with its reason in the note and marked `by: 'ai'`.
- This is meant for a chatbot with web search. The in-app AI can't browse, so it can only rearrange what's already on the list.
- Trip days follow the calendar's rule: day lists and fixed-time items, never an hourly grid.

### The method's flows, by hand

These follow METHOD.md exactly; read it for the rules.

1. **Morning check-in**, one question per screen: yesterday's open items (tick → done *on yesterday*, with quick time chips 5/15/30/60+), carry the rest (carry count +1; at 3, offer to shrink it or turn it into a decision), then today's shape (start time, fixed commitments saved as fixed-time items, or presets such as "Afternoon only", "An hour or less", "Rest day").
2. **Rule-based planner** (deterministic, no AI): a timed *Plan the day* card; carried items; unblocked Now steps for the current place; exactly one Protect step; Quick steps side by side, each its own card; at most `maxWorkSteps` work steps; one standing obligation with a time; totals of personal estimates, with their range, including planning time; a start launch point at the chosen start time and one or two restarts after fixed commitments. Rest day: the obligation only, unless something is due within two days. Anything over 30 minutes or without a starter is flagged "Break it down first". Then Go with this / Swap one / Too much, cut it. Unit-test the rules.
3. **Break it down**: asks for the first action (where, with what), runs the starter test as a three-item checklist (under two minutes; no thinking; not a reflex like getting dressed), and creates the steps with their `after` chain and estimates.
4. **I'm stuck**: which step → which friction (can't start / stopped and can't get back in / drifted) → shows the resume note or starter → "Still too big? Write a smaller starter" (saved) → restarts the timer. A second stall on the same step offers to turn it into a question to someone or a decision, and notes the friction on the step.
5. **Close the day**: the close-of-day show (below) and summary, then tomorrow's first step and optional start time.
6. **Decision wizard** (section 9).
7. **Sunday review**: the eight steps in METHOD.md, plus the *Later* allotment (below), one question per screen, ending with how this week's estimates compared with reality, overall and by app, and the pattern of pause reasons.
8. **Gentle insisting**: while a plan is open, a slim banner on the other tabs shows the first step ("starter → title", with Start). No nagging, no counters.

Keep v1's timer, pause sheet (resume note + reason), launch points, carry banner, swap sheet and suit piles.

### The close-of-day show

The point of the show is to see what you did. In v1 (`runCascade` in `docs/reussite-v1.html`) you can't read the cards, for three reasons:

- the cards scroll past without stopping, at about 200 px a second on a phone, wobbling and rotating as they go;
- every frame paints a 20% veil over the whole canvas for the firework trails, so the moving cards smear too;
- on a phone the cards are about 65 px wide, which puts their titles at 9 px.

Rebuild it like this:

- **Deal, don't parade.** The day's cards are flicked in one at a time and land in a tableau, where they **stay**, flat, unrotated, on whole pixels. When the last one lands, the whole day is laid out, still.
- **A firework for each card**, bursting behind it as it lands, on top of the general fireworks. The final count still bursts open at the end, with the big one.
- **Readable at rest**: titles at 14 px or more. On a phone that means two columns of cards. If they don't all fit at that size, the tableau scrolls, or later cards show rank and suit only and the summary lists every title.
- **Pace**: about 0.6–0.9 seconds per card, the whole deal under ten seconds, a tap to hurry it and Skip to jump to the end.
- **Built for sharpness**: the cards are DOM elements animated with `transform` only, so the browser renders their text crisply at the screen's real pixel density (v1 caps its canvas at 2×; an iPhone 13 Pro is 3×). The fireworks stay on a canvas underneath, and only that canvas gets the trail effect.
- **Timed by the clock, not by frames**, so it looks the same at 60 Hz and on 120 Hz screens.
- **Reduced motion**: the cards fade into place, no fireworks. The setting to turn the show off stays.
- The finished tableau stays on screen behind the summary, so the day can be looked at as long as you like.

### Rewards: what we take from games

METHOD.md's rule 6 stands: seeing progress is the reward, and nothing else is invented. These techniques come from game design and its research, and every one of them makes real progress more visible and more felt. None of them adds points, currencies or prizes.

**Four rules, each from evidence:**

1. **Only success gets juice.** Effects fire on real completions, never as decoration. In a controlled study, amplified feedback tied to success raised players' sense of competence and their enjoyment, while the same effects shown regardless of success lowered competence, apparently because they hid the link between action and result (Kao, Ballou, Gerling, Breitsohl & Deterding, CHI 2024, https://people.csail.mit.edu/dkao/pdf/3613904.3642656.pdf).
2. **A moderate dose.** In Kao's 2020 study of four versions of the same game, medium and high "juiciness" beat both none and extreme on every measure (https://www.sciencedirect.com/science/article/pii/S1875952118300879). Default to the middle, with a setting for Off / Calm / Lively (Lively is the default; there is no "extreme").
3. **Immediate, and reliable.** The dopamine transfer deficit account of ADHD predicts that delayed and intermittent reinforcement work poorly, and immediate, consistent reinforcement works better (Tripp & Wickens, J Child Psychol Psychiatry 2008; Neuropharmacology 2009). So the feedback comes the instant a step is done, every time, not only at the end of the day. **No random or variable rewards** of any kind: that is the loot-box schedule, and in the same CHI 2024 study, random variety in the feedback did nothing for curiosity.
4. **Proportional.** Bigger moments for bigger things: a step < the day's last card < a project's last step < a decision made. Peggle is the model here. Its developers first wanted loud pachinko-style celebrations; players preferred the understated placeholder, a short message and Ode to Joy, which the team kept and refined by zooming in on the ball as it nears the last peg (https://en.wikipedia.org/wiki/Peggle).

**The techniques:**

- **Hit stop on Done.** Fighting games freeze the frame for a few frames on impact so a hit feels weighty (Masahiro Sakurai devotes a video to it, https://www.gonintendo.com/contents/13581-sakurai-s-latest-game-dev-video-features-8-hit-stop-techniques). On Done: a pause of about 60–100 ms with a small scale pop, then the card flies to its suit pile (v1's flight, kept).
- **Game-feel basics** (Jonasson & Purho, "Juice It or Lose It", 2012, https://www.gdcvault.com/play/1016487/juice-it-or-lose): eased motion rather than linear, a little squash and settle when a card lands, a few particles at the landing point, the pile's rank ticking up (A, 2, 3…). Keep it short and clear of the text: Folmer Kelly's "Don't Juice It or Lose It" talk (GDC Europe, 2014, https://www.gamedeveloper.com/design/video-indies-resist-the-urge-to-juice-it-or-lose-it-) warns that effects which bury the context cost more than they give.
- **The last card.** When the last open step of today's plan is completed, a Peggle-style beat: a brief slow-down and zoom as the card lands, then a short flourish, before the close-of-day show (which stays the user's own action).
- **A completed project** gets the biggest moment: its progress bar fills, its cards stack up like a finished solitaire foundation, and the project moves to a Completed shelf that stays browsable.
- **Goal gradient, honestly.** People speed up as a goal gets closer; a coffee card with two of twelve stamps pre-filled was completed faster than a plain ten-stamp card (Kivetz, Urminsky & Zheng, J Marketing Research 2006, https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2733214). Use it without the trick: project bars show "2 steps left" near the end, and each day's bar starts with the *Plan the day* card already played, because planning is real work that was really done.
- **Accumulation, not streaks.** Played cards stay visible as a collection: pips on the calendar, the Completed shelf, the Log. Nothing counts consecutive days, so a missed day costs nothing.
- **Sound**: on by default. A short sound on every completed step (under 0.3 s) and, at the close of the day, a soft card sound as each card lands plus one short final chord. Generate the sounds with the Web Audio API (no audio files), with a little variation in pitch only as the day's count grows, never at random. Set `navigator.audioSession.type = 'ambient'` where supported (Safari), so the sounds mix with the person's music or podcast instead of pausing it (https://developer.mozilla.org/en-US/docs/Web/API/AudioSession/type). **Test on an iPhone whether the silent switch mutes them**; if it doesn't, sound defaults to off on iOS. A Sound setting: on / off, plus volume.
- **The completed-step animation** (hit stop, pop, flight to the pile) takes **0.6 s at most**, stays in sync with its sound, and **never blocks the next tap**: the person can tap the next card while it plays.
- **Touch**: a light vibration on Android where the browser allows it. iPhones don't let web apps vibrate; don't build workarounds.

**Safety**: nothing flashes more than three times a second, and no flash covers a large part of the screen (WCAG 2.3.1, https://w3c.github.io/wcag21/understanding/three-flashes-or-below-threshold.html). Reduced motion swaps every effect for a short fade. **Never**: points, XP, levels, currencies, badges for opening the app, daily login rewards, leaderboards, streaks, or random rewards.

### Nothing scrolls sideways

In v1, the step details sheet (the ⋯ button on a card) scrolls horizontally on an iPhone. The likely cause: iOS gives date and number inputs a wide minimum width, so the two-column Estimate / Due row overflows, and grid and flex children keep their default `min-width: auto`. In v2:

- Form controls and every grid or flex child get `min-width: 0`; date inputs get `appearance: none` and an explicit width.
- An e2e test opens every view and every sheet at 320, 375 and 430 px wide, in WebKit, and fails if the page's or the sheet's `scrollWidth` exceeds its `clientWidth`.

---

## 6. Sync between a person's devices

- **First device** generates a random 256-bit key. Setup shows it as a **recovery key** (grouped characters plus a QR code) with a plain warning: *lose every device and this key, and the list is gone; nobody, including Samy, can recover it.* A card stays on Today until the person confirms they've saved it (password manager, printed, photo in a safe place).
- **Another device joins** by scanning the QR code (BarcodeDetector where available, a small JS decoder otherwise) or typing the key.
- From the key, derive with HKDF: a **space id**, an **auth secret** (the relay stores only its hash, set on first write; required for writes and deletes) and an **encryption key** (AES-GCM 256, fresh 96-bit IV per blob).
- **Protocol**: each device pushes encrypted change batches (field-level operations with HLC timestamps) to the relay, which appends them with a sequence number; devices pull everything after their last sequence. From time to time a device uploads an encrypted snapshot and the relay drops the batches it covers.
- **Merge**: per-field last-writer-wins by HLC; arrays such as `plan` and `launches` replace whole. No conflict dialogs, ever. Don't add a CRDT library unless a test shows last-writer-wins losing something that matters, and tell me first.
- **When**: on open, when the app becomes visible, and two seconds after the last edit. Phones can't sync in the background (iOS has no background sync), so the app must be fast to catch up on open. Show "synced at HH:MM" quietly in Settings, not on Today.
- **Sync off** is a valid state: everything works on one device, with a reminder every two weeks to save a backup file.
- Call `navigator.storage.persist()` and show the result in Settings. On iOS it is granted by heuristics, more readily to home-screen apps (https://webkit.org/blog/14403/updates-to-storage-policy/).
- The relay caps blob size and rate-limits per space.

Tests: merge is commutative and idempotent; two devices editing offline converge; a wrong key can't read or overwrite; a device restored from the recovery key gets everything back.

---

## 7. Settings tab

- **Appearance**: theme (System / Light / Dark / by time of day, with the two times); accent colour and the four suit colours, with a contrast check that warns below WCAG AA (4.5:1) for text and derives the soft and deep variants automatically; text size (S / M / L); reduce motion; celebrations Off / Calm / Lively (section 5, Rewards), which also governs the close-of-day show. Ship v1's "Lilac & sea" palette as the default plus two or three presets, and let a theme be exported and imported as a small JSON file.
- **Method**: urgency window (21 days), day starts at (05:00), maximum work steps per day (3), planning time (15 min), default launch times, suit names and glyphs, places (name, time zone), stays, the current place outside a stay, address categories, the Addresses & People module on or off, morning and evening reminder times, Sunday review day and time.
- **Notifications**, **Calendar**, **AI** (provider, key, models, "show me what's sent"), **Sync & devices** (pair a device, show recovery key, turn sync off), **Data** (export a backup, encrypted or plain JSON; import; delete everything on this device / everywhere).
- **Language**: French and English, both first-class, from phase 0. Every UI string lives in one strings file per language; nothing is hard-coded. French follows French typography: a narrow non-breaking space before ; : ! ? and inside « », plurals through `Intl.PluralRules` ("1 carte jouée", "2 cartes jouées"), dates and times through `Intl`. METHOD.md exists as `METHOD.fr.md` and `METHOD.en.md`; the French text uses the method's own French CBT vocabulary (TCC, *balance décisionnelle*, *activation comportementale*…) and I review it. Every AI request asks for answers in the person's language. The UI language is independent of the language the person writes their steps in.
- **About**: version, changelog, the method (rendered METHOD.md), its credit line, the not-therapy note, and the privacy note (section 11).
- **Credit line**: the home page (Today) footer shows, in small muted text under the version number, a credit to Nelly Darmon, the psychologist whose method this is, in the wording she chooses. Keep the wording in one setting per language, not hard-coded, so it can change without a release; show nothing if she prefers not to be named, and add any published references she gives to About. Don't ship the credit until her answer is recorded in `DECISIONS.md`.
- **Not therapy**: a short line in the same footer, in About and on the first-run screens, saying that Réussite helps apply a method but doesn't replace therapy or care from a professional.

---

## 8. Notifications and calendar

### Push notifications

- **Web Push with VAPID.** On iPhone and iPad it works only once the app has been added to the Home Screen (iOS/iPadOS 16.4 and later); on Android and desktop, from the browser. Home Screen web apps were kept in the EU after Apple's 2024 reversal, so this applies to French users too.
- **What notifies**: the day's launch points (start and restarts), standing obligations with a time, the morning check-in, closing the day, decision checks on their review date, and the Sunday review. Each type can be turned off.
- **Privacy**: the device encrypts each payload itself (RFC 8291, `aes128gcm`, using the subscription's `p256dh` and `auth` keys) and uploads ciphertext with its send time. The relay only adds the VAPID signature and sends it. A setting chooses generic text ("▶ Start", "↻ Restart") or text with the step's title; both stay end-to-end encrypted. If client-side payload encryption proves unreliable on a platform, stop and ask me before falling back to generic server-side text.
- Accepting a plan, adding or removing a launch point, or changing a reminder time replaces that day's scheduled pushes for that device.
- A push can't run code on iOS; tapping it opens the app, which syncs and shows the step.

### Calendar (one-way; no reading of anyone's calendar)

- **Add to calendar**: generates an `.ics` for today (or the week) with launch points as 5-minute events and obligations with their duration, each with a VALARM at the start, the right TZID for the current place and CRLF line endings, and hands it to the share sheet or downloads it. This works well with Apple Calendar and desktop apps. Google Calendar on Android may not open `.ics` files directly; the feed is for those users.
- **Subscribe**: an opt-in feed at a secret URL served by the relay, from a projection the device uploads. Default content is times plus generic titles; including step titles is a separate switch, with a plain warning that this part is not end-to-end encrypted. The URL can be regenerated. The calendar app decides how often it refreshes (Google can take hours), so the feed is for seeing the day; reminders come from notifications.
- Fixed commitments are typed in the morning check-in. Two-way calendar sync is out of scope.

---

## 9. Balances décisionnelles (the decision wizard)

v1 can only record a decision made in a chat. v2 makes the whole method usable by hand, linked to projects, and revisitable.

- **Start**: from a step whose kind is *decision*, from a project ("New decision"), or from the "I'm stuck" flow. The decision is linked to its project and step.
- **Screens, one question each**:
  1. **Problem**: what is happening / what should be happening / the gap / constraints / deadline / what's in my control. A "This is really two problems" button splits it.
  2. **Options**: the person's own first; then a checklist of the usual missing ones (do nothing; delay, until when; a smaller version; a combination; ask someone; hand it off; change the order), each added with one tap. Screen out the impossible with a one-line reason. **Close the list.** After the balances, "Add an option" first asks "What's the new fact?" and records it in `newFacts`.
  3. **Balances**, one option per screen: four columns (pros of doing / cons of doing / pros of not doing / cons of not doing). Items are added inline; each weight is a 1–5 tap. An item can be marked "mirror of…" another so it counts once. The *pros of not doing* column carries the hint "Relief and avoidance show up here. It's information, not a fault." On a phone, the columns stack as four sections.
  4. **Scores**: computed live, Score = (pros of doing + cons of not doing) − (cons of doing + pros of not doing), shown as one bar per option. If the top two are within 10%, one question: "Which would you regret less?"
  5. **The choice**: chosen option, why, what must be true, what would falsify it, and the check date.
  6. **Steps**: add the steps that carry out the choice to the linked project (titles as first actions, starters, estimates, `after`), set or confirm the project's SMART goal, and put the first step on today's or tomorrow's list. Marking the decision task done plays a card.
- **Revisit**: on the check date, the decision appears on Today and sends a notification. "Did the falsifier happen?" Yes → reopen at step 1 with the new fact, keeping the old version; No → set the next check, or close it.
- **Re-weigh any time**: weights stay editable; each change adds a score snapshot to `history`, so the person sees how the balance moved.
- **Views**: a Decisions list (open, to check, closed) and a full decision page showing the four columns and scores for every option, not just the chosen line v1 shows in the Log.

AI help (phase 2) is limited to: suggesting missing options, suggesting column items (marked as suggestions), drafting the problem lines from a free-text description, and drafting steps and the SMART goal. **AI never proposes weights.**

---

## 10. AI features (optional, phase 2)

- **Rules**: every AI feature returns JSON validated against a schema (zod). Invalid output shows a plain error and writes nothing. Proposed changes always appear as before → after diffs with checkboxes, as in v1's command box; only ticked changes are written. Anything the AI originated is marked `by: 'ai'` until the person confirms or edits it.
- **System prompt** = METHOD.md (bundled) plus the feature's output contract. Send compact lines as v1 does (`id | title | quadrant | due | est | project`), at most 25 candidates, never the whole list. Any request that asks for estimates also gets one line of the person's calibration (overall and for the apps involved), so the AI's numbers start personal.
- **"Show me what's sent"** previews the exact request before the first call of each kind.
- **Features**:
  1. **Command box** on Today, Matrix and Projects: plain language → change-set (v1's behaviour, any provider).
  2. **Plan my day**: the morning check-in runs by hand; the AI then improves the rule-based plan (breaks down big items, writes starters, picks between candidates). Its output is validated against the planner's rules (work-step limit, exactly one Protect, one obligation); a plan that breaks them is rejected and the rule-based plan shown instead.
  3. **Break it down**: proposes steps with starters, estimates and `after`. Its estimates are marked `ai` and calibrated separately. The AI's real use for estimates is steps with no history, where general knowledge gives a first number.
  4. **Decision help**: as listed in section 9.
  5. **Stuck**: proposes a smaller starter.
  6. **Sunday review help**: proposes SMART goals and next steps for confirmation.
- Errors (no key, no credit, rate limit, network) give one plain sentence and a button to the manual path.

### Using any outside AI (the replacement for "R:" from a chat)

- **"Ask any AI"** builds a context pack: a short summary of the method, the chosen scope (today, the matrix, one project, one decision) as compact lines, the change-set contract, and the person's question. It goes to the clipboard and the share sheet, ready to paste into ChatGPT, Claude, Le Chat or anything else.
- The pack asks the AI to answer with one fenced block labelled `reussite` containing the change-set.
- **"Paste the reply"** finds that block and opens the same diff-and-tick screen as the command box. One contract, one parser, one review screen for all three routes.
- The change-set contract covers every collection: create, update, complete (with a done date), drop and reorder tasks; edit projects and their SMART goals; edit a day's plan and launch points; create and edit places, stays, addresses and people; and create or update a whole decision (problem, options, column items, weights only if the person typed them, choice, steps). Version it, document it in `docs/CHANGESET.md` with examples, and keep it short enough to paste into any chatbot. I'll use the same contract from my Claude chats, where messages starting with "R:" used to edit v1 directly.

### Optional, phase 5: local MCP server

A small Node MCP server that pairs as a device (scans or takes the recovery key), syncs through the relay, and exposes `today`, `query_tasks`, `get_decision` and `apply_changes` (diff returned, applied on confirmation). It's for Claude Desktop or Claude Code on a computer; it can't serve phones without putting the key on a server, which we won't do.

---

## 11. Updates, customisation, security

### Updates

- Pushing to `main` deploys. The service worker detects the new version and shows a banner with the changelog lines since the person's version and a Reload button. It **never reloads by itself**, and never while a timer is running.
- **Migrations**: a schema version and an ordered list of migration functions, run on load before any write, after saving a local backup of the pre-migration data. A migration never drops fields it doesn't recognise. Each migration is tested on a fixture of every earlier version, including my v1 export shape.
- **Mixed versions**: a person's devices may run different versions for a while. A device that pulls data written by a newer schema version stops writing, keeps working read-only, and asks to reload. Test this.
- Settings are data: an update never resets them. New settings get defaults.

### Customisation by friends

- Everything in section 7 needs no code.
- For people who want to change code: `CUSTOMIZING.md` explains forking, keeping changes in their own branch, and taking my updates with `git fetch upstream && git rebase upstream/main`, written so that any coding agent can follow it. Add `AGENTS.md` (architecture, commands, invariants: never lose data, migrations are mandatory, tests must pass) and a `CLAUDE.md` that points to it. A fork sets its own relay URL and Pages project.

### Security and privacy

- Strict Content-Security-Policy; `connect-src` limited to the relay and the AI endpoints configured in Settings.
- No analytics, no tracking, no third-party runtime scripts.
- The AI key stays on the device unless the person turns on "sync my AI key", in which case it travels only inside the encrypted data.
- **Privacy note** in About, in plain words: what the relay can see (encrypted blobs, their sizes and timing, IP addresses, push endpoints, and the calendar projection only if it's switched on), what an AI provider sees (exactly what each request sends, viewable with "Show me what's sent"; people only when ticked), and that losing every device and the recovery key loses the list.

---

## 12. Phases and acceptance

Stop at the end of each phase (section 0).

### Phase 0 — Foundation

Repository, stack, `.gitignore` with `private/`, French and English strings with French typography, `llms.txt` and `AGENTS.md` skeletons, data layer with the v2 model, importer, a port of v1's Today, Matrix, Projects and Log, the Settings tab's Appearance and Method sections, PWA install (manifest, icons, offline), backup export and import, English and French strings, Pages deploy.
**Done when**: my v1 export imports with nothing lost (counts match, spot-checked); the app works offline from the iPhone Home Screen and on desktop; changing the accent colour and theme works and persists; tapping a step's link opens Safari or the right app, never a page inside Réussite; no view or sheet scrolls sideways; marking an untimed step done asks how long it took; unit tests cover urgency, quadrants, ratio and the duration buttons; the footer shows the not-therapy line, and the credit line once its wording is in `DECISIONS.md`.

### Phase 1 — The method by hand

Section 5 (except Addresses and people, which is phase 4) and section 9 without AI: the full task sheet, done-on-another-day, sessions editor, inline due dates, matrix moves, project editor with SMART goals, timer and estimate fixes, personal estimates, day navigator, calendar view (month and week), places, place pages and stays, morning check-in, rule-based planner, Break it down, I'm stuck, Close the day, the decision wizard with revisits and re-weighing, the Sunday review, the insisting banner.
**Done when**: I can run a whole day and a whole decision on my phone without any AI; I can do a Sunday review's week planning in the week view, and moving a step to a day plans it or sets its due date as I chose; a stay switches my current place on its first day, and its "before I leave" steps turn urgent on their own; on my iPhone, every card's title can be read as it lands at the close of the day, and Done, the day's last card and a finished project each feel distinct; a forgotten timer can be fixed in two taps; a repeating step, done or skipped, comes back once on the right date (from its due date or from completion), and the repeat rules are unit-tested; personal estimates match a hand calculation on a fixture, with tests for clipping, weights, shrinkage and the cold start; completing a step plays its sound and animation in under 0.6 s without blocking the next tap; a *Later* item picked at the Sunday review appears as an optional card on its day and goes back untouched if not played; the planner and scoring rules are unit-tested; e2e tests pass at 375×812 and 1280×800 in Chromium and WebKit.

### Phase 2 — AI, any provider

Section 10: provider settings, both adapters, the six features, Ask any AI and Paste the reply, "Show me what's sent".
**Done when**: the same task works with OpenRouter (a Claude model and one non-Claude model) and with an Anthropic key directly; a round trip through a chatbot I paste into applies cleanly; invalid AI output never writes anything.

### Phase 3 — Sync, notifications, calendar

Sections 6 and 8: keys, recovery, pairing, the relay, merge, push scheduling with on-device payload encryption, the "Still on…?" reminder, Add to calendar, the subscribable feed.
**Done when**: an edit on my phone appears on my laptop within seconds of opening it, and the reverse; offline edits on two devices converge; a device wiped and restored from the recovery key gets everything back; a launch point notifies on my iPhone (Home Screen app) and on an Android phone; the feed shows today's launch points in Apple Calendar.

### Phase 4 — Friends

First-run onboarding (one question per screen: language, places, suits, theme, Addresses & People or not, AI or not, sync, notifications, recovery key), the Addresses and People module and Plan this trip (section 5), the documentation and AI kit (section 15), with the evidence files once I deliver them, the method explainer from METHOD.md, `CUSTOMIZING.md`, `AGENTS.md`, `CLAUDE.md`, a README for friends, and fixes from my own two weeks of daily use.
**Done when**: a friend can get from a link to a planned first day in under fifteen minutes with me beside them; I can save an address from Maps on my iPhone in under fifteen seconds; a trip planned through Ask any AI comes back as day lists I can tick in; a friend can paste `docs/ai/skills/today.md` into a chatbot of their choice and run a morning check-in with it.

### Phase 5 — Optional

The local MCP server (section 10).

---

## 13. Out of scope

App-store or native wrappers; accounts and passwords; shared lists between people; reading anyone's calendar; server-side AI or server-side planning (it would need their key and plaintext on a server); payments; analytics; streaks or points beyond the close-of-day show; maps, geocoding, photos or opening hours inside the app; storing anyone's home address.

---

## 14. Why v2 differs from what v1 was asked to do

My original request to v1 asked for these, and v1 left gaps; v2 closes them.

| Asked for | v1 | v2 |
| --- | --- | --- |
| Separate urgency and importance | Matrix, read-only | Matrix with moves and inline dates |
| Estimate while scheduling, including the scheduling | Estimates per step; planning time only inside the chat skill | Timed "Plan the day" card; planner totals from personal estimates that learn by kind of step |
| Confirm by timing and writing it down | Timer; time editable only at "done" | Sessions editor; done on another day |
| Break down at the friction points, action-word first step | Starter stored but not editable on the page; resume notes | Starter editable everywhere; Break it down; I'm stuck triage |
| Sense of progress on big projects | Project bars, cascade | Kept; the close-of-day show rebuilt so the cards can be read |
| Weighted pros and cons, of doing and of not doing | Only in a chat; the page shows the chosen line | Full decision wizard, scores, revisits, history |
| SMART goals | Free-text goal; confirmation only in a chat | SMART editor with Confirm |
| Problem solving: define, list all, weigh, choose, operationalise | Only in a chat | Wizard steps 1–6, linked to projects |
| Ask what I did yesterday; insist on what matters | Plan my day (Claude only); chat skill | Manual check-in; insisting banner |
| Schedule leisure and people as obligations | Standing items | Kept; one per planned day |
| iCal on iPhone | `.ics` sent from a chat | Add to calendar; subscribable feed; push |
| Questions as one-at-a-time multiple choice | In chat popups | Guided flows, one question per screen |
| Weekly review | Only in a chat | Sunday review wizard |

---

## 15. Documentation and evidence

Three sets of docs, one source of truth. Each is written for its reader; together they replace me as the person who knows how Réussite works.

### The manual (`docs/manual/fr/`, `docs/manual/en/`)

For friends. Plain words, short pages: getting started, the daily loop, the matrix, projects, decisions, places and trips, the calendar, timing and estimates, settings, privacy, recovering a lost device, FAQ. Screenshots are generated by the e2e tests in both languages and both themes, so they never go stale. The app's About screen renders it.

### Developer and AI docs

`AGENTS.md` (with `CLAUDE.md` pointing to it), `docs/dev/` (architecture, data model, sync, push, the change-set contract in `CHANGESET.md`, testing, `DECISIONS.md`), and an `llms.txt` at the repository root: a short index of every doc with one line each, so any AI can find what it needs without reading everything.

**The AI kit (`docs/ai/`)** makes the method portable to any LLM, inside or outside the app:

- `skills/today.md` and `skills/decide.md`: the daily loop and the decision method, rewritten from my Claude skills (I'll supply them) without anything personal. Each is written once and published in two forms: as a Claude skill (`SKILL.md` with frontmatter) and as a plain system prompt any chatbot accepts.
- `preferences.md`: how the AI should behave with the person, as a template they fill in during onboarding and can edit in Settings: one question at a time; facts about progress, never praise of character; no guilt; no questions about feelings they didn't raise; push back on the avoidance patterns in METHOD.md; language; level of detail. The context pack and every in-app AI request include it.
- `CHANGESET.md` again, in the short form a chatbot needs.

### The evidence (`docs/evidence/`)

`EVIDENCE.md` (a literature review I'm writing separately; it arrives during phase 4), `references.json` (CSL-JSON with DOIs) and `MAP.md` (each method rule and feature → its evidence IDs). Until it arrives, METHOD.md and the manual carry evidence-ID placeholders where claims are made.

Every entry carries three labels, and the docs never collapse them into one score:

- **Strength** (research track): A meta-analysis or systematic review of RCTs · B RCT · C controlled experiment or quasi-experiment · D observational (cohort, correlational, survey, diary) · E qualitative study or case report.
- **Fit**: *direct* (adults with ADHD, self-guided tools) · *partial* (adults with ADHD in therapy, or the general population in apps) · *analogy* (games, management, other fields).
- **Status**: replicated · mixed · contested · theory (a proposed mechanism, not a finding) · untested.

**Practice** is a separate track, not a lower tier: clinical guidelines and treatment manuals; clinicians' practice (including the psychologist whose method this is); practitioners' know-how (designers, game developers); testimonials, including mine and friends'. **Standards** (WCAG, platform rules) are requirements, listed apart.

In the manual and in METHOD.md, each rule and feature has two short lines, **Research says** and **Practice says**. "Untested" is a status, never a verdict: much of what works in clinical practice hasn't been studied, and where the two diverge, the docs say so plainly rather than pick a side.
