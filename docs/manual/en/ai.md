# AI

Everything is set in one place: Settings → **How Réussite understands you**. You choose between two things, and you can change your mind at any time.

## On this device, or a cloud AI

1. **On this device** (the default). Réussite reads the lines you type on Home by itself: a card, a time, a length, several cards in one line. Nothing leaves this device, and it costs nothing. Everything in the app works this way.
2. **A cloud AI.** An AI on a provider's servers also reads what the app can't, plans the day with you and helps with your cards. There are two ways, and you can use one or both:
   - **My own key.** Choose OpenRouter (or any OpenAI-compatible service), or Anthropic, and put your key in the box. The key stays on this device. It is never synced or put in backups. Tap **Test the connection**. **Get a key, step by step** walks you through it.
   - **My AI chat app, through the connector.** An AI chat app you already use (ChatGPT, Claude, Gemini, or another app that accepts connectors of the MCP kind) reads and edits your list while you chat. It needs sync. See below.

Choosing **On this device** turns the key off. It does not switch the connector off: your chat app stays signed in until you switch the connector off yourself, and the section says so, with the switch next to it.

Under the choice, a short list answers **Is it all linked?**: sync on or off, the recovery key saved or not, the connector on or off, when your chat app last came in, and whether your key works. Tap a line that is not done to go to what does it.

## What an AI can do

With a key, Réussite can (without a key saved on this device, none of these show, and nothing on the screen asks for an AI):

- turn plain words into changes ("drop the games; the photos are due Friday"): the box on Today, the Matrix and Projects, which says which AI it asks ("Ask Claude to change the list", "Ask ChatGPT to change the list", or "Ask your AI…" when the model's name is not one it knows), and the one box on Home;
- **Improve with AI**: reorder the day's plan, pick between steps, write starters and split big steps. If its plan breaks the method's rules, Réussite says why and keeps the plan made by the rules;
- **Plan the day with an AI**: Home's **Plan the day** and the morning notification open a proposal in five parts (what has to happen, your main goals, one step for each pillar, what fits where you are, the total against your free time) that you keep, swap or skip, then confirm on the review screen. The daily loop page has the details;
- **Break it down with AI**: propose small steps with starters and estimates;
- help with decisions: draft the problem, suggest options you missed, suggest pros and cons (marked "suggested", weight 3 until you set it), draft the steps and a SMART goal. It never sets weights;
- suggest a smaller starter when you're stuck;
- review your goals in the weekly review, one project at a time: check each against SMART, say which open steps move it, and propose a clearer sentence, a measure, dates, and steps to drop or add. You keep, skip or flip each one. The daily loop page has the details. On a project's page in the review, **Propose a goal and next steps** still proposes a goal and next steps for that project, and a goal stays "proposed" until you confirm it;
- **Plan this trip**, under a stay in Settings: day lists, fixed times and places to try for the trip. See [Places and trips](places-and-trips.md).

**You see every change before it is written.** Tick what you want, untick what you don't. Nothing is applied without your ticks, and what you apply can be undone.

There is no copy and paste: an AI answers inside the app with your key, or works on your list through the connector. A link an AI sent you before still opens.

## Show me what's sent

Before Réussite first sends something to an AI, it shows you **exactly what will be sent**: the endpoint, the model, the instructions, your data and request, and the memory notes. Nothing leaves the device until you tap **Send**. Turn on **Always show what's sent** to see it every time.

## How an AI should work with you

Under **My own key**, **More** has a box, **How an AI should work with you**. It is a few lines of your own: one question at a time, facts about progress and no praise of character, no guilt, push back on avoidance, how long answers should be. It goes with every request. Empty it to send nothing.

## What it costs

Under **My own key**, **More** shows this month's calls and tokens on this device, and about how much was spent when a price is known. Set a **monthly limit**: at the limit the AI stops, and Home goes back to the step form.

## The connector

The connector lets an AI chat app read your list and edit it while you chat. It needs sync. In Settings → How Réussite understands you, under **My AI chat app, through the connector**, **Connect my AI chat app, step by step** walks you through it: who can use it, sync and its recovery key, the connector, where to add it in your app, the address and pairing code, and a check that your app has come in.

**Who can use it**, from each app's own help pages (November 2026; they change often):

- **ChatGPT**: OpenAI's pages don't say which plans can add a custom connector, so that isn't confirmed. ChatGPT's own settings show whether the option is there for you.
- **Claude**: every plan, Free included (Free allows one custom connector). On Team and Enterprise, an owner adds it first, then you connect.
- **Gemini**: personal Google accounts only (not work or school), 18 or over, in the United States, in English, with Keep Activity on.
- **Another app** that accepts MCP connectors: if it lets you add a custom or remote connector, it works the same way.

By hand:

1. Tap **Switch on**. Read what it says: **while the connector is on, whoever runs the relay can read your whole list.**
2. Add the address shown as a custom connector, on a computer (adding from a phone isn't confirmed for any of these apps):
   - ChatGPT, on chatgpt.com in a browser: Plugins, then +, then Add custom MCP server; give it a name, put the address in Server URL, then Create as a plugin.
   - Claude, on claude.ai or the desktop app: Customize, then Connectors, then + Add, then Add custom connector.
   - Gemini, on gemini.google.com: Settings, then Connected Apps (or Personal Intelligence first), then Add a custom app.
   - Another app: add a custom or remote connector with the address.
3. Sign in when asked and type the **pairing code** Réussite shows. It works once, for ten minutes.

Once added, Claude and Gemini use it in their phone apps too; for ChatGPT's phone app that isn't confirmed.

With no key on this device but the connector on, Home’s **Plan the day** card also offers **Plan it in your AI chat**, and the Sunday review banner (on Today, the Matrix and the bell) **Review in your AI chat**. They copy a short sentence (“Plan my day with Réussite”) to say in a new chat in your app. Réussite makes no AI call itself. One small change (adding a step, ticking one done, moving a date) goes straight in, with an undo. Anything else waits for your yes in the chat. **Switch off** signs every AI app out at once. Notes you marked Private are never readable by it.

**Research says:** Trials of CBT skills programmes show real but modest gains for adults with ADHD; whether an app alone gives the same gains is not known. [See the evidence](research-method.md).

**Practice says:** an AI is useful when it follows the method, asks one question at a time and says what it did.

See also [Privacy](privacy.md).
