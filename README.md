# Réussite

Réussite is a planner for adults with ADHD. It is built on a cognitive behavioural therapy (CBT) method. It helps with the hard part: starting.

Everything you have to do is a card. Each day you deal yourself a short hand, each card names its small first move, and each card you play lands on one of four piles, so you see your progress as you go. (Réussite is the French name of the card game patience.) It works offline, on your phone or your computer. It can also work with an AI you already use, if you want that.

Réussite helps you apply a method. It doesn't replace therapy or care from a professional.

## For friends: start here

**https://reussite.rudolphem.workers.dev/hello/** says what Réussite is, with pictures (in French: [/hello/fr/](https://reussite.rudolphem.workers.dev/hello/fr/)). Then open the app: it asks for the one thing you have been putting off, and you play your first card in about two minutes. Nothing to install first, and no account.

The [manual](https://reussite.rudolphem.workers.dev/manual/) has one short page per topic, for later.

## Open it

The app is at **https://reussite.rudolphem.workers.dev**. There is nothing to download from a store.

- **iPhone or iPad:** open the address in Safari. Tap Share, then Add to Home Screen. Open Réussite from there. (Notifications only work from the Home Screen.)
- **Android:** open the address in Chrome. Tap the menu, then Install app (or Add to Home screen).
- **Computer:** open the address in Chrome, Edge or Firefox. In Chrome and Edge, the install icon in the address bar adds it as an app.

## Your data

Your data stays on your devices. If you turn sync on, it is encrypted on your device first, so the host can't read it. Keep your recovery key: without it, nobody, including us, can get your data back.

## Learn more

The manual is on the web at [/manual/](https://reussite.rudolphem.workers.dev/manual/), in [`docs/manual/en/`](docs/manual/en/index.md), and in the app under Settings → About. The method is in [`docs/METHOD.en.md`](docs/METHOD.en.md).

## With the AI chat app you already use

Réussite has a connector: once it is added to your chat app, the app reads and edits your deck from inside the chat, and waits for your yes before anything bigger than one small change. Switch it on in Réussite, under Settings → How Réussite understands you → My AI chat app, through the connector; it gives the address to add and a pairing code. Add it on a computer:

- **ChatGPT**, on chatgpt.com in a browser: Plugins (chatgpt.com/plugins), then +, then Add custom MCP server. OpenAI's pages don't say which plans can add one; ChatGPT's own settings show whether the option is there for you.
- **Claude**, on claude.ai or the desktop app: Customize, then Connectors, then + Add, then Add custom connector. Every plan, Free included (Free allows one custom connector); on Team and Enterprise, an owner adds it first.
- **Gemini**, on gemini.google.com: Settings, then Connected Apps (if it isn't there, open Personal Intelligence first), then Add a custom app. Personal Google accounts only, 18 or over, in the United States, in English, with Keep Activity on.
- **Le Chat (Mistral)**, on chat.mistral.ai: Connectors, then + Add Connector, then the Custom MCP Connector tab. A name with no spaces, the address in Server URL. Adding one is an administrator's job; on Free, Pro and Student the account owner is the administrator.
- **Another app** that accepts MCP connectors: add a custom or remote connector with the address.

[`docs/ai/`](docs/ai/) holds two sets of instructions for the chat app, [`today`](docs/ai/skills/today.md) (dealing the day, getting unstuck, closing the day, the weekly review) and [`decide`](docs/ai/skills/decide.md) (a decision, step by step through the method), as plain text and as skills ([`today/SKILL.md`](docs/ai/skills/today/SKILL.md), [`decide/SKILL.md`](docs/ai/skills/decide/SKILL.md)). They work through the connector.

## For developers

Read [`AGENTS.md`](AGENTS.md) before changing the code. To make your own copy, with your own server, see [`CUSTOMIZING.md`](CUSTOMIZING.md).
