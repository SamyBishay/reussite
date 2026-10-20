# Infrastructure

Names, ids and URLs only; never secrets. Brief §3, Infrastructure. Free plan only.

| Resource | Name | URL or id | Notes |
| --- | --- | --- | --- |
| GitHub repository | `SamyBishay/reussite` | https://github.com/SamyBishay/reussite | Private |
| Cloudflare account | | `e69c9092b483436063434ce38203b853` | workers.dev subdomain `rudolphem` |
| The app | Worker `reussite` (static assets) | https://reussite.rudolphem.workers.dev | Workers Builds from GitHub: `main` deploys, other branches get preview URLs. Config: `wrangler.jsonc` at the root |
| The relay | Worker `d1-reussite` | https://d1-reussite.rudolphem.workers.dev | Deployed by hand: `cd relay && npx wrangler deploy`. Config: `relay/wrangler.jsonc` |
| D1 database | `prod-d1` | `eac5b14c-f7a1-4ea9-9c0f-3ae01cb73bf8` | Relay storage. Migrations: `cd relay && npx wrangler d1 migrations apply prod-d1 --remote` |
| KV namespace | `OAUTH_KV` | `ef4eab1767b3429a8c8d5e4bf42f365b` | Connector sign-ins |
| Custom domain | | | None yet |

## Secrets (names only)

Set with `npx wrangler secret put <NAME>` from `relay/`.

- `CONNECTOR_WRAP_KEY`: 32 random bytes, base64 (`openssl rand -base64 32`). Wraps the space keys the connector holds. Changing it switches every connector off.
- `VAPID_PRIVATE_KEY`: the private half of the Web Push signing pair, base64url of the 32-byte scalar. Made once with `node scripts/vapid-keygen.mjs` (prints to the terminal, writes no file); its public half goes in the `VAPID_PUBLIC_KEY` var below and in `.env.production` as `VITE_VAPID_PUBLIC_KEY`. Changing the pair makes every device subscribe again the next time the app is opened. See [push.md](push.md).

## Relay variables and triggers (`relay/wrangler.jsonc`)

Not secrets. Names only here; values in the file.

- `ALLOWED_ORIGINS`, `RELAY_URL`: as for sync and the connector.
- `VAPID_PUBLIC_KEY`: the public half of the pair above (the file holds a placeholder until the pair is made).
- `VAPID_SUBJECT`: the relay's https address, the VAPID token's `sub`.
- `PUSH_HOSTS`: the push services a registered endpoint may point at.
- `triggers.crons`: `* * * * *` (one of the free plan's five): sends due notifications, and prunes at minute 0.
- Migration `0005_push.sql` creates `push_devices` and `push_items`.

## Build settings of the `reussite` Worker (dashboard → Settings → Builds)

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Non-production branch deploy command: `npx wrangler versions upload`
- Root directory: `/`
- The app finds the relay through `VITE_RELAY_URL`, set in `.env.production`.
