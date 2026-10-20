# Customizing Réussite

**Most things need no code.** Everything in Settings (urgency window, day start, places, notifications, AI, memory, calendar feed, theme, language) is yours to change in the app. Start there. This file is for changing the code, or running your own server.

It is written so that a coding agent can follow it step by step. Give it this file and say which part you want.

## 1. Fork and set up

1. Fork the repository on GitHub. Clone your fork.
2. Add the original as `upstream`:
   ```
   git remote add upstream <the original repository's address>
   ```
3. `npm install`, then `npm run dev` to try it.
4. Read [`AGENTS.md`](AGENTS.md): commands, layout and the invariants. The two that matter most when you change things: never lose data (no hard deletes), and any change to stored shapes needs a migration.

## 2. Keep your changes in their own branch

Leave `main` as an exact copy of upstream's `main`. Work in a branch of your own:

```
git checkout -b mine
```

Commit your changes there. Run `npm test`, `npm run typecheck` and `npm run e2e` before each commit.

## 3. Take the owner's updates

```
git fetch upstream
git checkout main && git merge --ff-only upstream/main
git checkout mine && git rebase upstream/main
```

If the rebase stops on a conflict, fix the files, `git add` them, and `git rebase --continue`. Then run the tests again. Keep your changes small and in few files so conflicts stay rare. Prefer adding a file to editing one.

## 4. Your own relay

The relay is the one server for sync, the AI connector, push notifications and the calendar feed. Without one, the app still works on a single device. Names and places are in [`docs/dev/infra.md`](docs/dev/infra.md).

You need a free Cloudflare account and `npx wrangler login`.

1. **Rename the Worker.** In `relay/wrangler.jsonc`, set `name` to a name of your own.
2. **Make your storage.** From `relay/`:
   - `npx wrangler d1 create <your-database-name>`, then put its name and id in `d1_databases`.
   - `npx wrangler kv namespace create OAUTH_KV`, then put the id in `kv_namespaces`.
   - `npx wrangler d1 migrations apply <your-database-name> --remote`
3. **Set the variables** in `vars` of `relay/wrangler.jsonc`:
   - `RELAY_URL` and `VAPID_SUBJECT`: your relay's address, `https://<worker-name>.<your-subdomain>.workers.dev`, no trailing slash.
   - `ALLOWED_ORIGINS`: your app's address, and its preview addresses (`https://*-<app-worker-name>.<your-subdomain>.workers.dev`).
   - `VAPID_PUBLIC_KEY`: see the next step.
4. **Make your keys.** From the repository root, `node scripts/vapid-keygen.mjs` prints a public and a private key. Do not save the output in a file.
5. **Set the secrets**, from `relay/`, one at a time (`npx wrangler secret put <NAME>`):
   - `CONNECTOR_WRAP_KEY`: 32 random bytes in base64, from `openssl rand -base64 32`.
   - `VAPID_PRIVATE_KEY`: the private key from step 4.
   Never put a secret in a file in the repository.
6. **Deploy:** `cd relay && npx wrangler deploy`.

## 5. Point the app at your relay

In `.env.production` at the root:

```
VITE_RELAY_URL=https://<your relay's address>
VITE_VAPID_PUBLIC_KEY=<the public key from step 4>
```

Neither is a secret. Rebuild with `npm run build`.

## 6. Your own app Worker

The app is a Worker of static files, set up by `wrangler.jsonc` at the root.

1. In `wrangler.jsonc`, set `name` to a name of your own. Keep it the same as in `ALLOWED_ORIGINS` above.
2. In the Cloudflare dashboard, go to Workers & Pages, Create, and connect your GitHub fork. Choose the Worker with that name. Then, under Settings, Builds:
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`
   - Non-production branch deploy command: `npx wrangler versions upload`
   - Root directory: `/`
3. Choose which branch deploys. If you keep your changes in `mine`, make `mine` the production branch; other branches then get preview addresses.
4. Push. Open your app's address. In Settings, turn sync on and check that it reaches your relay.

## 7. Check before you rely on it

- `npm test`, `npm run typecheck`, `npm run e2e` pass.
- Nothing scrolls sideways at 320, 375 or 430 px.
- Your private data stays out of the repository: never commit anything personal, and never put your own data in the docs or in `src/`.
