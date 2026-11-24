# Réussite security remediation handoff

## Instructions for Claude Code

Work in the Réussite checkout. Read `AGENTS.md` and the relevant entries in `DECISIONS.md`. This handoff combines the supplied Opus audit with the independent review of commit `c6c922a`. Issues 1, 2 and 7 combine overlapping findings. Issues 8–14 carry the other Opus findings. Have each subagent check the current branch before implementing its issue. The Cloudflare quota findings assume Workers Free, as described in the repository. Deployment settings and cross-region behavior still need owner-side verification. [Reviewed commit](https://github.com/SamyBishay/reussite/commit/c6c922a4cefd0cfc961745c9fb5c309ba88755dc)

Assign one subagent per issue. Give each agent the reporting requirements below as well as its brief. Use isolated worktrees for parallel edits. The proposed fixes are starting points. An agent may choose another approach if it meets the acceptance criteria and explains the trade-off. The coordinator owns integration and verification across issues.

- **Integrate 1 and 2 first.** Coordinate the relay entry point and any shared quota controls so both fixes cover the deployed routes.
- **Prepare 3, 4 and 5 in parallel.** Coordinate 4 and 7 on connector authorization and database migrations. Coordinate 1 and 5 on relay sync changes. Review any shared files and migration numbering before integration.
- **Prepare 6 and 7 once their product decisions are clear.** Keep the verified implementation, migrations, and any deployment configuration changes together in the handoff to the owner.
- **Coordinate 8–14 by the code they share.** Issues 4, 7, 9 and 10 touch connector authorization or storage. Issue 12 should account for the custom endpoints preserved in 3. Issue 13 can proceed independently unless a dependency update changes OAuth or MCP behavior.

### Priority and functionality

| Fix order | Issue | What can go wrong today | What users may notice after the fix |
| --- | --- | --- | --- |
| 1 | D1 quota and storage | Sync, connector, feeds and reminders can fail together | Tighter limits may tell users on a shared connection to retry. Storage caps can affect large decks. An invite requirement would change onboarding. |
| 2 | OAuth quotas and pairing lockout | Pairing and token refresh can fail service-wide | Tighter limits may require a retry. Registration expiry may require re-pairing. |
| 3 | Backup credential destinations | A restore can redirect sync or AI credentials and requests | A destination change may need local confirmation. Custom relay and AI settings may need to be approved on each device. |
| 4 | Connector revocation | An old OAuth grant can regain access when the connector is re-enabled | Switching the connector off and on requires a fresh pairing. Existing clients may also need a one-time re-pair, depending on migration. |
| 5 | Sync batch ordering | A concurrent edit can silently disappear from other devices and later restores | Normally invisible. Compatibility work may be needed if any public sync behavior changes. |
| 6 | Calendar revocation | A calendar subscription can keep serving plaintext after deletion appears complete | Deletion can report a pending or partial result. A revoked subscription stops updating. |
| 7 | Connector write approval | The AI client can approve the same edits it proposed | Protected edits need a human approval step. The chosen design may require opening Réussite, and chat-only edits may take longer. |
| 8 | Recovery key exposure and rotation | A copied key gives lasting access to sync until the space is changed | Showing the key may ask for device verification. Rotation may require rejoining devices, saving a new key, and keeping access to older encrypted backups. |
| 9 | Remove the sync bearer from connector escrow | A compromise of both connector escrow and its wrapping key also exposes a long-lived sync credential | Routine pairing and chat should work as before. Privacy wording may change to explain the relay’s access. |
| 10 | OAuth client identity and scopes | A user can be misled into pairing an untrusted client with full edit privileges | Users may choose read-only access or see stronger consent warnings. Client restrictions can affect custom connectors. |
| 11 | Drop inbox admission | Junk can occupy the inbox and block legitimate drops | Old drop links may need replacing. New links must still open the review screen. |
| 12 | CSP and framing | Another site can embed the app, and broad network permissions weaken defense against script injection | Embedded copies may stop opening. Stricter network rules may affect custom endpoints. |
| 13 | Dependency advisories | The browser can run out of memory during validation of oversized input | Usually invisible. Check acceptance of valid legacy imports and AI replies after an upgrade. |
| 14 | Native app link schemes | A tapped card link can invoke an OS automation or another app | Existing Shortcut links may be blocked or gain a confirmation. Ordinary links should still open as configured on iOS. |

Review workflow compatibility in this order of expected user impact **7 → 8 → 3 → 4 → 10 → 11 → 6 → 14 → 2 → 12 → 1 → 5 → 9 → 13**. Re-rank it once the implementations and migrations are known. For incident impact, start with **1 and 2** for service outages and **5** for silent data loss.

### What each subagent must tell the owner

Flag expected user-facing changes when proposing the implementation, then report the actual changes after verification. Use plain language and name the affected screen, workflow or client. Specifically call out added taps, prompts or waiting, re-pairing or re-entry, removed options, behavior on older devices, effects on existing data and URLs, and anything a user must do before or after rollout. State whether each impact applies to existing users, new users, or both. If the normal workflow is unaffected, say so explicitly. Distinguish what Réussite does from what a third-party calendar or AI client may continue to display.

Each final report should give the chosen fix and why, the verified normal workflow, the exact user-facing impact, any operator-only rollout or migration steps, and what remains unverified. Use the repo’s checks and focused tests for the new guarantees. Where the result depends on Cloudflare settings or a real device, name the specific setting or behavior the owner needs to verify.

## 1. Protect the D1 quota and bound sync storage

**Description.** The current limiter updates a D1 counter before deciding whether a request is over the limit. Rejected traffic can consume the same daily budget as regular relay operations. Cloudflare’s Free plan stops D1 queries when the account reaches its quota. Opus also found that public clients can create spaces and that stored sync data lacks a cumulative per-space cap. [Rate counter](https://github.com/SamyBishay/reussite/blob/c6c922a/relay/src/limits.ts#L24-L36) · [Space creation](https://github.com/SamyBishay/reussite/blob/c6c922a/relay/src/sync.ts#L35-L49) · [D1 quotas](https://developers.cloudflare.com/d1/platform/pricing/#frequently-asked-questions)

**Proposal.** Use an upstream or Worker-native admission control that can reject excess traffic before D1. Check its coverage on the deployed hostname and the aggregate budget across locations and routes. Bound space creation and stored bytes, including snapshots and batches. If the design uses invite-only enrollment or tighter shared-IP limits, surface the effect on friends setting up sync or reconnecting.

**Acceptance.** Rejections at the new gate can be verified with no D1 work. Storage accounting stays correct during retries, compaction, and deletion, with a clear recovery path for a legitimate space at its limit. Normal sync, legitimate pairing and calendar refresh work within the intended budget. The agent identifies the routes and production configuration the protection depends on.

## 2. Bound public OAuth writes and protect pairing availability

**Description.** Dynamic registration and consent-form creation both write KV state before a user pairs. Registration has no configured expiry. These flows share a Free-plan budget with legitimate OAuth operations. Opus also found that an already rate-limited source still advances the separate global pairing counter, which can block everyone’s pairing. [OAuth config](https://github.com/SamyBishay/reussite/blob/c6c922a/relay/src/connector/oauth.ts#L13-L25) · [Consent and pairing](https://github.com/SamyBishay/reussite/blob/c6c922a/relay/src/connector/authorize.ts#L112-L150) · [Provider storage](https://github.com/cloudflare/workers-oauth-provider/blob/602610ce1c11fdb412388713f66a4ca2a45c110d/src/oauth-provider.ts#L5412-L5429) · [KV limits](https://developers.cloudflare.com/kv/platform/limits/)

**Proposal.** Apply admission controls before registration and consent creation write KV. Give unused registrations a bounded lifetime and verify how the provider renews active ones. Keep an aggregate guessing defense for pairing codes. Gate attempts by source and check consent transaction validity before charging the shared allowance for eligible attempts. Preserve the genuine user’s ability to retry a mistyped code. Coordinate storage usage with issue 1 and any client allowlist with issue 10.

**Acceptance.** Existing grants can refresh under the intended compatibility policy. New pairing works with supported clients. Rejections at the per-source gate leave other users’ pairing allowance available, and eligible guesses remain subject to an aggregate limit. The owner can see when someone has to retry or register again, and which routes and dashboard settings must be covered.

## 3. Keep restored settings from redirecting credentials

**Description.** Backup restore merges settings alongside data. A changed relay URL can receive a live sync bearer. A changed OpenAI-compatible endpoint can receive the local AI key and a prompt on the next AI request. Prior approval for a feature can suppress its preview after the destination changes. [Backup restore](https://github.com/SamyBishay/reussite/blob/c6c922a/src/data/backup.ts#L14-L35) · [Relay selection](https://github.com/SamyBishay/reussite/blob/c6c922a/src/app/sync.ts#L76-L88) · [Sync request](https://github.com/SamyBishay/reussite/blob/c6c922a/src/sync/client.ts#L29-L42) · [AI request and preview](https://github.com/SamyBishay/reussite/blob/c6c922a/src/ai/ask.ts#L55-L115)

**Proposal.** Store credential destinations as device-local trust decisions. Legacy backups and synced settings can supply a proposed value. Require local approval before any credential-bearing request reaches a new destination, and bind AI preview approval to the actual destination. Include push and calendar requests in the relay review because those features also use the configured relay.

**Acceptance.** Restore and sync cannot silently change an approved credential destination. Existing default setups migrate cleanly, and users can still deliberately configure a custom relay or provider. The agent reports what happens to custom settings on older backups and on a second device.

## 4. Bind OAuth grants to a connector activation

**Description.** Switching off removes the D1 connector row and separately revokes grants in KV. The MCP request checks the space ID and the presence of a current connector row. If old OAuth state survives or remains cached, it can become usable after reactivation because the row carries no activation identity the grant must match. [Connector off](https://github.com/SamyBishay/reussite/blob/c6c922a/relay/src/connector/admin.ts#L92-L108) · [MCP authorization](https://github.com/SamyBishay/reussite/blob/c6c922a/relay/src/connector/mcp.ts#L28-L39) · [KV consistency](https://developers.cloudflare.com/kv/concepts/how-kv-works/#consistency)

**Proposal.** Give each connector activation a unique identity. Bind grants to it and check it in D1 on every MCP request. Use the same identity at the write boundary when an in-flight request could outlive a switch-off. Define the migration for grants created before that identity exists.

**Acceptance.** A fresh pairing works. Grants from an earlier activation are refused even when OAuth storage still recognizes them. The owner knows whether any existing client needs to pair again on rollout, and what happens to a write already in progress.

## 5. Commit sync sequence numbers and batches together

**Description.** The relay allocates a sequence before inserting the batch. Under concurrency a higher sequence can become visible while a lower sequence is still pending. Clients advance their cursor to the highest batch they read, and snapshot pruning can remove an edit skipped this way. Both app and connector appends need review. [App append](https://github.com/SamyBishay/reussite/blob/c6c922a/relay/src/sync.ts#L104-L110) · [Connector append](https://github.com/SamyBishay/reussite/blob/c6c922a/relay/src/sync.ts#L128-L143) · [Client cursor](https://github.com/SamyBishay/reussite/blob/c6c922a/src/sync/run.ts#L108-L119) · [Snapshot pruning](https://github.com/SamyBishay/reussite/blob/c6c922a/relay/src/sync.ts#L240-L251)

**Proposal.** Allocate the sequence and insert the batch in one transaction. Preserve the connector’s transactional confirmation, undo, and clock updates. Check the assumption that a successful read observes a consistent snapshot and tail before the client advances its cursor.

**Acceptance.** Normal concurrent writes from devices and the connector remain visible through subsequent sync and snapshot pruning. A failed or retried write preserves consistent state. Existing device cursors and snapshots remain usable, or the agent explains the recovery path and whether users could lose an unsynced edit.

## 6. Report calendar deletion accurately and revoke old URLs

**Description.** “Delete everywhere” promises calendar shutdown, but the relay’s sync deletion leaves feeds outside that transaction. The UI only attempts cleanup for a feed active on the current device. A failed feed delete is queued for retry while the UI can show success. A feed can carry titles, places and notes in plaintext. [Manual promise](https://github.com/SamyBishay/reussite/blob/c6c922a/docs/manual/en/sync-and-recovery.md#L40-L45) · [Delete UI](https://github.com/SamyBishay/reussite/blob/c6c922a/src/app/SyncSettings.tsx#L163-L175) · [Feed cleanup](https://github.com/SamyBishay/reussite/blob/c6c922a/src/app/feed.ts#L72-L79)

**Proposal.** Resolve the current shared feed identity before the sync key is forgotten. Revoke the feed and its aliases, preserve a safe retry path, and report partial completion when the relay cannot confirm removal. Account for stale devices and pending relay maintenance so ordinary writes cannot recreate a revoked URL. If the product retains independent feeds, match the UI and manual to what the app can actually revoke.

**Acceptance.** The UI distinguishes deletion of the sync copy from verified calendar revocation. Old feed URLs and aliases covered by the operation stop serving feed content. Existing subscribers are told what to expect, including any previously cached events held by their calendar provider.

## 7. Require human approval for protected connector writes

**Description.** The connector gives a confirmation ID to the same AI client that proposes the changes. The server trusts the client to ask the person before returning that ID. It also replans the edits at confirmation time and checks only that the item count matches the earlier plan. The effect of a new plan can change while the count remains the same. [Confirmation proposal and commit](https://github.com/SamyBishay/reussite/blob/c6c922a/relay/src/connector/changes.ts#L76-L156)

**Proposal.** Reuse Réussite’s review screen to collect approval from the person’s app, with the approval bound to the exact reviewed changes and connector activation. If a supported MCP client offers a human-approval mechanism the server can verify, evaluate it against the same requirement. Decide explicitly whether the current one-small-edit exception remains and report the workflow for each supported client.

**Acceptance.** The AI client’s ordinary write authorization alone cannot confirm a protected change. A material change to the reviewed diff requires fresh approval. Retries remain idempotent. The agent gives the owner the new sequence of taps, explains what happens while Réussite is closed, and identifies any edits that still apply immediately.

## 8. Protect recovery keys and provide a rotation path

**Description.** Opus found that the recovery key is stored in device-local IndexedDB and can be shown as text and a QR code on an unlocked device. All paired devices derive the same long-lived sync credentials, so there is no individual device revocation. The manual currently tells people who suspect key exposure to delete the synced copy and set up sync again. [Key storage](https://github.com/SamyBishay/reussite/blob/c6c922a/src/app/sync.ts#L278-L321) · [Show key](https://github.com/SamyBishay/reussite/blob/c6c922a/src/app/SyncSettings.tsx#L70-L83) · [Recovery manual](https://github.com/SamyBishay/reussite/blob/c6c922a/docs/manual/en/sync-and-recovery.md#L28-L45)

**Proposal.** Review device verification for showing or exporting a key, with a usable fallback for supported browsers. Consider a guided rotation that verifies the new copy before retiring the old one. Treat UI verification and recovery after key theft as separate controls. Review the storage threat model and how rotation handles offline devices, the connector, and backups encrypted under the old key.

**Acceptance.** Recovery still works on a fresh device. An interrupted rotation preserves the deck and gives the user a safe way to resume. The owner sees exactly which devices and connectors must rejoin, which key they need for existing backups, and whether the design supports individual device revocation.

## 9. Remove the sync bearer from connector escrow

**Description.** Opus found that the connector wraps and stores the space’s AES key together with its sync bearer. The bearer is unnecessary for the connector’s internal D1 access. A compromise that exposes both an escrow copy and its wrapping key therefore also exposes the credential accepted by the public sync API. [Escrow write](https://github.com/SamyBishay/reussite/blob/c6c922a/relay/src/connector/admin.ts#L52-L69) · [Key wrapping](https://github.com/SamyBishay/reussite/blob/c6c922a/relay/src/connector/wrap.ts) · [Connector data access](https://github.com/SamyBishay/reussite/blob/c6c922a/relay/src/connector/tools.ts#L49-L62)

**Proposal.** Stop storing the bearer in new escrow rows. Choose a compatible cleanup for existing rows, such as rewriting them after a successful unwrap. Review the recorded escrow decision and coordinate cleanup with issue 4 so authorization and migration remain consistent. Check privacy copy against the connector’s ability to decrypt the deck and the operator’s retention settings.

**Acceptance.** Updating existing rows preserves legitimate connector use under the chosen migration. New rows and migrated live rows omit the bearer. The owner knows what historical backups can retain and whether users need to rotate a sync key or re-pair. [Connector privacy model](https://github.com/SamyBishay/reussite/blob/c6c922a/docs/dev/connector.md#L147-L151)

## 10. Improve OAuth consent and enforce grant permissions

**Description.** Opus flagged unauthenticated client registration, self-supplied client names, and grants that can both read and edit the deck. The consent form shows the redirect host and can warn that a client is unverified. Users still need to decide whether they trust the client, and the app needs to enforce any scope it displays. [Registration](https://github.com/SamyBishay/reussite/blob/c6c922a/relay/src/connector/oauth.ts#L13-L25) · [Consent UI](https://github.com/SamyBishay/reussite/blob/c6c922a/relay/src/connector/authorize.ts#L95-L109) · [MCP handler](https://github.com/SamyBishay/reussite/blob/c6c922a/relay/src/connector/mcp.ts#L29-L39)

**Proposal.** Offer a read-only grant and enforce it at tool dispatch, including confirmation and undo. Make the client identity and requested permissions clear on the consent screen. Consider a configurable redirect-host allowlist where the operator wants one, and account for custom clients and self-hosting. Coordinate migration of existing grants with issue 4.

**Acceptance.** A read-only grant can read the authorized deck and cannot call tools that change it. Owners can see which supported clients require setup changes and how existing read-write grants are handled.

## 11. Protect the drop inbox from unwanted submissions

**Description.** Opus found that the inbox accepts entries with a space ID and has a fixed capacity. Unwanted entries can occupy it and disrupt the drop-link workflow. The app’s review screen is the separate control for deciding whether to apply a drop. [Inbox admission](https://github.com/SamyBishay/reussite/blob/c6c922a/relay/src/inbox.ts#L24-L45) · [Drop review](https://github.com/SamyBishay/reussite/blob/c6c922a/src/app/Drop.tsx)

**Proposal.** Require a scoped, revocable submission credential on drop links, independent of the public encryption key. Keep the receiver’s review and expiry behavior, and define how to replace or retire legacy links.

**Acceptance.** Valid drops still reach the receiver’s review screen. Admission rejects submissions without a valid credential before consuming an inbox slot. The owner knows who needs a new link and what people see when they open an older one.

## 12. Prevent framing and review browser connection permissions

**Description.** Opus found that the app sets CSP in a meta tag. That delivery mechanism cannot enforce `frame-ancestors`, and the build permits HTTPS connections broadly to support configurable endpoints. [App CSP](https://github.com/SamyBishay/reussite/blob/c6c922a/vite.config.ts#L8-L30)

**Proposal.** Serve an HTTP framing policy on the actual app responses. Review a narrower network policy alongside issue 3. Preserve the deliberate custom relay and provider workflows supported by the deployment, or identify the compatibility change for the owner.

**Acceptance.** The production build provides the intended policy on app entry points, including relevant fallback routes. Normal sync, custom providers under the chosen policy, navigation and service-worker updates still work. Report any effect on legitimate embeds, forks, or previews.

## 13. Update affected dependencies and check release reachability

**Description.** Opus flagged the app’s Zod advisory and relay transitive advisories. The independent lockfile audit confirmed the app advisory. The flagged Node-server packages were absent from a local esbuild relay bundle. The exact Wrangler release bundle still needs verification. [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) · [App lockfile](https://github.com/SamyBishay/reussite/blob/c6c922a/package-lock.json#L7452-L7461) · [Relay dependencies](https://github.com/SamyBishay/reussite/blob/c6c922a/relay/package.json)

**Proposal.** Upgrade the app to a patched Zod release. Check the actual relay release bundle and advisory reachability before changing the relay dependency tree. Review advisories on the current lockfiles and make focused updates where warranted.

**Acceptance.** Report the new locked versions, the advisories resolved, and evidence for any remaining relay reachability assessment. Verify representative valid AI replies, drop links, and imports still work.

## 14. Review card links that can open OS automation

**Description.** Opus flagged `shortcuts:` and similar native schemes in user-visible links. An approved card or drop can contain such a link. The app also deliberately generates `x-safari-https:` for ordinary outbound links in its iOS standalone mode. [Allowed schemes and iOS behavior](https://github.com/SamyBishay/reussite/blob/c6c922a/src/domain/links.ts#L1-L71)

**Proposal.** Separate user-supplied automation links from the app’s own browser-opening behavior. Consider removing, restricting or confirming higher-impact native links while preserving normal HTTPS navigation on iOS. Check existing uses before changing the allowlist.

**Acceptance.** The intended policy applies to links from the editor, imports, AI, and drops. Normal outbound links work on supported platforms. Report any link type users must replace or approve, and identify the iOS behavior still awaiting a real-device check.

## Opus operational checks

- **Privacy and calendar URLs.** Check that the sync and connector copy agrees across the README, manual and Settings. Verify whether deployed Workers Logs contain calendar capability URLs or authorization headers. Review D1 Time Travel retention before promising immediate key destruction. [Privacy manual](https://github.com/SamyBishay/reussite/blob/c6c922a/docs/manual/en/privacy.md#L11-L39) · [Logging configuration](https://github.com/SamyBishay/reussite/blob/c6c922a/relay/wrangler.jsonc#L49-L55)
- **Deploy and device access.** Confirm who can deploy app JavaScript through GitHub and Cloudflare, how those accounts are protected, and how production secrets are configured. Verify lock-screen notification content on a real device. [Relay infrastructure notes](https://github.com/SamyBishay/reussite/blob/c6c922a/docs/dev/infra.md) · [Notification code](https://github.com/SamyBishay/reussite/blob/c6c922a/src/push/notification.ts)
- **Connector activity and undo.** Check whether a person can see what changed and undo it from Réussite if the chat is unavailable. The current commit response gives the undo ID to the AI client. Consider this when designing issue 7 and report any new history or undo UI. [Connector undo receipt](https://github.com/SamyBishay/reussite/blob/c6c922a/relay/src/connector/changes.ts#L221-L240)
