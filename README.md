# Scope & Settle

Turn a Figma comment into a clear agreement and a PayPal sandbox invoice.

A freelance designer selects a client request. AI compares it with an agreed brief, cites the relevant clauses, and proposes **included**, **new work**, or **needs clarification**. The designer reviews additional deliverables and prices; the client approves that exact revision. PayPal then provides the invoice and authoritative payment status. **Work begins after payment.**

This is a hackathon prototype with synthetic project content, one configured Figma file, one sandbox merchant/buyer pair, and USD pricing. It does not control Figma editing access. Demo links grant roles rather than verified personal identities.

## Current evidence

- 24 automated tests pass on Windows and in the Linux container. They cover authorization, approval revisions, invoice recovery, concurrent actions, payment reconciliation, webhook handling, reset isolation, and budget persistence using simulated provider responses.
- The browser workflow has been exercised through client approval and payment-due display with explicitly labeled provider fixtures.
- Authenticated Figma comment access and real PayPal sandbox invoice creation/retrieval have been checked separately.
- Live AI evaluation is pending account credits. Native Figma plugin use, actual sandbox buyer payment, live webhook delivery, and hosted deployment are not yet verified.

See [the implementation verification record](docs/IMPLEMENTATION-2026-10-22.md). Automated/provider-fixture checks are not evidence of a completed real payment or successful AI judgment.

## Local setup

Requirements: **Node.js 24**, **pnpm 10.34.5**, Figma desktop, a Figma personal access token with `file_comments:read`, a PayPal sandbox REST app with business and personal sandbox accounts, and an OpenAI key with access to `gpt-6-luna`.

1. Copy `.env.example` to `.env.local` in the repository root. Fill the Figma and PayPal sandbox values. Use synthetic content only.
2. Add `OPENAI_API_KEY` locally or use an existing shell environment variable. Keys stay server-side. The optional `AI_API_KEY` environment variable takes precedence if already configured.
3. Install and build:

   ```sh
   cd app
   pnpm install --frozen-lockfile
   npm test
   npm start
   ```

   If pnpm is absent, install the pinned version with `npm install --global pnpm@10.34.5`.

4. In a second terminal in `app`, run `npm run demo:link`. Read the generated `app/data/designer-link.txt` locally and open its invitation URL. The link is single-use and expires in one hour; the resulting session also lasts one hour. Run the command again if access expires. Treat the link as a credential.
5. In the configured Figma file, add the comment **“Can you add the mobile checkout?”**. Open a desktop checkout frame containing synthetic design content.
6. In Figma desktop, choose **Plugins → Development → Import plugin from manifest**, then select `app/plugin/dist/manifest.json`. Run Scope & Settle. Paste a fresh designer invitation into the plugin. A link already redeemed in the browser needs to be replaced with a new one for the plugin.

`http://localhost:8787/designer` exposes the same designer interface in a browser. Frame export is available only inside Figma. `/health` reports missing configuration without showing secret values; it is a liveness endpoint, not proof of provider access.

The server defaults to loopback. Set `HOST=0.0.0.0` only for a deliberate deployment. `SCOPE_SETTLE_DATA_DIR` is read from the process environment; locally it defaults to `app/data`. Runtime environment variables override `.env.local`.

## Use the demo

1. Select the actual Figma comment and optionally attach one selected frame.
2. Assess it against the supplied brief. Included work produces no billable proposal. For uncertainty, post the drafted question manually in Figma, paste the reply, and reassess.
3. For new work, review the deliverables and rate-card price, or choose an explicitly labeled designer-set price. Confirm the terms to generate the client link.
4. Open the client review link in a separate tab. Inspect the exact revision and price provenance, check consent, and approve.
5. Follow the hosted **PayPal sandbox** invoice URL and complete checkout as the personal sandbox buyer. The merchant cannot pay its own invoice.
6. Refresh payment status in the client page or plugin. Only retrieved, matching invoice details can mark the order paid. Reopening the plugin restores its session and persisted orders.

The **Demo controls → Prepare a manual proposal** action tests approval/payment without AI. It is deliberately labeled manual and must not be presented as an AI result.

## Tests and evaluation

```sh
cd app
npm test          # isolated SQLite + simulated providers; no real credentials or charges
npm run eval:ai   # real OpenAI calls against all six synthetic cases; consumes the budget
npm run backup   # consistent SQLite backup under the configured data directory
```

Evaluation preserves actual outputs, latency, failures and usage under the ignored `output/evaluations` directory. Check the meaning of cited evidence manually as well as the automated results. Fixture expectations alone do not establish model quality. The target is about 15 seconds; the request timeout is 30 seconds.

The AI ledger persists across server restarts and demo resets. Unknown-cost failures keep their conservative reservation. This is conservative application accounting, not a provider billing statement. The $25 maximum applies **per persistent database**: when moving to hosting, allocate only the remaining development budget to the new database and stop live calls against the old instance. Do not run independent $25 budgets with the same key.

## Hosting and judging

[Render deployment instructions](docs/RENDER-DEPLOYMENT.md) describe the Docker service, 1 GB persistent disk, secret configuration, sandbox webhook registration and acceptance checks. A complete local build is the fallback for judges. Do not publish provider keys, sandbox buyer passwords or role links in this repository.

The plugin's backend URL is fixed at build time. For a hosted build, set `PUBLIC_BASE_URL` in the shell before `npm run build` and import the generated manifest again. In PowerShell:

```powershell
$env:PUBLIC_BASE_URL = 'https://YOUR-SERVICE.onrender.com'
npm run build
Remove-Item Env:PUBLIC_BASE_URL
```

Hosted judging access and test-account instructions must be supplied privately and verified before submission. Maintain access through December 15, 2026; do not submit an expired one-hour invitation as the sole judging-access mechanism.

## Implementation

- `app/plugin`: Figma selection, PNG export and session storage.
- `app/web`: shared designer UI and separate client review page.
- `app/src/backend`: Node HTTP server, SQLite, role sessions, evidence, AI, PayPal and webhooks.
- `fixtures`: six synthetic scope-judgment cases.
- `docs/PRODUCT-SPEC.md`: adopted product decisions and acceptance criteria for this build.

Run a single backend process per database. Scope revisions are shared within the one demo project; orders, approvals and resets are isolated by demo run. Approved revisions are immutable. Reset deletes local evidence/orders in that run and keeps invoice tombstones; it does not cancel invoices at PayPal or reset the AI budget.

[MIT license](LICENSE). Third-party APIs, SDKs and tools retain their own terms and licenses.
