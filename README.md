# Scope & Settle

Turn a Figma comment into a clear agreement and a PayPal sandbox invoice.

A freelance designer selects a client request. AI compares it with an agreed brief, cites the relevant clauses, and proposes **included**, **new work**, or **needs clarification**. The designer reviews additional deliverables and prices; the client approves that exact revision. PayPal then provides the invoice and authoritative payment status. **Work begins after payment.**

This is a hackathon prototype with synthetic project content, one configured Figma file, one sandbox merchant/buyer pair, and USD pricing. It does not control Figma editing access. Demo links grant roles rather than verified personal identities.

## Current evidence

- Release 0.2.1 passed **52 tests, 0 failed, 0 skipped** on Windows and in the clean-source Linux image build. A fresh source export repeated all 52 passes on October 23. These checks use isolated SQLite and simulated providers; they cover authorization, revisions, invoice recovery, reconciliation, webhook verification, reset/budget persistence, durable judging access, native bridge messages and plugin packaging.
- Baseten's selected DeepSeek model runs with maximum reasoning. The final six fixtures and three fresh paraphrases passed, with 524–1,436 ms latency. Two earlier 5/6 runs and their failures remain documented.
- The actual Figma desktop comment and exported frame produced a live assessment, a designer-reviewed $250 proposal, separate client approval, and a real PayPal sandbox invoice.
- The Google Cloud deployment passes HTTPS, authorization and persistent-state checks. The live assessment, approval and invoice association survived redeployment. Judging access implementation and hosted acceptance are tracked separately in the judging verification record.
- An actual $250 PayPal sandbox buyer payment completed in an isolated browser. PayPal reports PAID with $0 due; the client page and native Figma plugin show Paid on the same approved revision, including after reload/reopening. [Real signed webhook delivery is verified](docs/PAYPAL-WEBHOOK-DIAGNOSTIC-2026-10-23.md). A separate judge run also completed live AI, explicit client approval and sandbox checkout, with automatic signed PAID delivery.
- The exact released 0.2.1 ZIP was installed under a separate Figma test account. It exported the actual selected frame, refreshed the existing judge run's payment from PayPal, and restored the same Paid revision after closing/reopening without reconnecting. This operator acceptance is separate from the still-pending designer walkthroughs.
- A subsequent native recording run completed live AI with the actual frame, designer review, separate client consent and a third real $250 sandbox payment. The [reviewed 2:49 demonstration](docs/DEMO-VIDEO.md) follows that same revision through payment return and plugin reopening. The MP4 and English captions are public release assets; the required YouTube upload is pending channel access.

See [the completed payment and Figma verification](docs/PAYMENT-LOOP-2026-10-22.md), [the Baseten and working-flow record](docs/BASETEN-VERIFICATION-2026-10-23.md), and [earlier implementation checks](docs/IMPLEMENTATION-2026-10-22.md). Automated/provider-fixture checks are separate from actual AI and payment evidence.

## Local setup

Requirements: **Node.js 24**, **pnpm 10.34.5**, Figma desktop, a Figma personal access token with `file_comments:read`, a PayPal sandbox REST app with business and personal sandbox accounts, and a Baseten key with access to `deepseek-ai/DeepSeek-V4.1-Flash-1017-Fast`.

1. Clone the public source: `git clone https://github.com/henryperkins/scope-and-settle.git`, then `cd scope-and-settle`. Copy `.env.example` to `.env.local` in this repository root (`Copy-Item .env.example .env.local` in PowerShell, or `cp .env.example .env.local` in a POSIX shell).
2. Before the first server start, fill `FIGMA_PERSONAL_ACCESS_TOKEN` and `FIGMA_FILE_KEY` for a synthetic file your token can read. Import [the editable checkout SVG](fixtures/figma-checkout.svg), wrap it in a frame, and add **“Can you add the mobile checkout?”** as an actual comment on that frame. See [Figma recovery/setup](docs/FIGMA-JUDGING-FILE.md). Fill the sandbox REST app's `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`, the business merchant email, and a **different personal sandbox buyer** email. Obtain both sandbox accounts from your PayPal developer dashboard; a merchant cannot pay its own invoice. Add your own `BASETEN_API_KEY`. Keep `PAYPAL_ENVIRONMENT=sandbox`, the pinned model, and `AI_REASONING_EFFORT=max`. Keys stay server-side; OpenAI and generic key variables are never used. The first start saves the configured file into SQLite, so changing the environment later does not migrate existing runs.
3. Install and build:

   ```sh
   cd app
   pnpm install --frozen-lockfile
   npm test        # builds backend and plugin; 52 tests use simulated providers
   npm start
   ```

   If pnpm is absent, install the pinned version with `npm install --global pnpm@10.34.5`.

4. In a second terminal in `app`, run `npm run demo:link`. Read the generated `app/data/designer-link.txt` locally and open its invitation URL. The link is single-use and expires in one hour; the resulting session also lasts one hour. Run the command again if access expires. Treat the link as a credential.
5. Open the same configured Figma file in Figma desktop and select its synthetic desktop checkout frame. Keep the backend running on `http://localhost:8787`.
6. In Figma desktop, choose **Plugins → Development → Import plugin from manifest**, then select `app/plugin/dist/manifest.json`. Run Scope & Settle. Paste a fresh designer invitation into the plugin. A link already redeemed in the browser needs to be replaced with a new one for the plugin.

`http://localhost:8787/designer` exposes the same designer interface in a browser. Frame export is available only inside Figma. `/health` reports missing configuration without showing secret values; it is a liveness endpoint, not proof of provider access.

The server defaults to loopback. Set `HOST=0.0.0.0` only for a deliberate deployment. `SCOPE_SETTLE_DATA_DIR` is read from the process environment; locally it defaults to `app/data`. Runtime environment variables override `.env.local`.

The local setup can retrieve authoritative payment status with **Check payment** without an inbound webhook. To test real signed callbacks, expose the backend through your own HTTPS deployment/tunnel, register its `/webhooks/paypal` URL on the **same** sandbox REST app, set `PAYPAL_WEBHOOK_ID`, and restart. See [webhook deployment](docs/GOOGLE-CLOUD-DEPLOYMENT.md#budget-and-provider-setup). A localhost URL cannot receive PayPal delivery. Do not copy the hosted project's webhook ID or provider secrets into your own installation.

For a build-only check, credentials can remain blank: installation, compilation and the fixture suite make no paid inference or payment requests. Provider-dependent actions need your configuration. A green build does not prove your provider accounts work. Judges can use the [hosted path](JUDGING.md) with the separately supplied access and buyer credentials instead.

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
npm run eval:ai   # real Baseten calls against all six synthetic cases; consumes the budget
npm run backup   # consistent SQLite backup under the configured data directory
```

Evaluation preserves final outputs, latency, failures and token counts under `SCOPE_SETTLE_DATA_DIR/evaluations` (locally, ignored `app/data/evaluations`). Raw model reasoning is not stored. Check the meaning of cited evidence manually as well as the automated results. Fixture expectations alone do not establish model quality. The target is about 15 seconds; the maximum-reasoning request timeout is 90 seconds, with a 16,384-token limit shared by reasoning and the final answer.

Baseten catalog pricing verified on October 23, 2026 UTC is $0.60 per million input tokens and $2.40 per million output tokens. Accounting conservatively ignores cache discounts and charges output reasoning tokens once. `node scripts/check-ai-access.mjs` checks model availability and the configured prices without making an inference call.

The AI ledger persists across server restarts and demo resets. Unknown-cost failures keep their conservative reservation. This is conservative application accounting, not a provider billing statement. The code caps each database at $25, but this project's **overall development cap is $25 across all instances**. The hosted allocation is $24.16 after earlier local usage; no further live inference runs against the old local database. When moving hosting, allocate only the remaining overall budget. Never start another independent allowance with the same key.

## Hosting and judging

[Judge entry](https://scope-and-settle.hperkins.com/judge) provides independent demo runs, renewable designer/client access, and the prebuilt plugin download. Follow [JUDGING.md](JUDGING.md); the private judging code and sandbox buyer are delivered separately. The current native installation and provider acceptance status is recorded in [judging verification](docs/JUDGING-VERIFICATION-2026-10-23.md).

The deployed plugin is **0.2.1**, built from `99de2812193425b3c49c46b2faed91a4a40d8b57`. [Download the exact ZIP](https://scope-and-settle.hperkins.com/downloads/scope-and-settle-0.2.1-99de28121934.zip); SHA-256: `df4d05e4729d666291cf731acb7ec095b244bbe1429904ca924ce14f5512a55d`. Documentation commits after that source revision do not change these released bytes. The ZIP's `SOURCE.json` supplies checksums for its manifest, code, UI and bundled instructions.

[Google Cloud deployment instructions](docs/GOOGLE-CLOUD-DEPLOYMENT.md) describe the selected tiny VM, persistent data disk, HTTPS tunnel, sandbox webhook registration and acceptance checks. A complete local build is the fallback for judges. Do not publish provider keys, sandbox buyer passwords or role links in this repository.

The plugin's backend URL is fixed at build time. For a hosted build, set `PUBLIC_BASE_URL` in the shell before `npm run build` and import the generated manifest again. In PowerShell:

```powershell
$env:PUBLIC_BASE_URL = 'https://scope-and-settle.hperkins.com'
npm run build
Remove-Item Env:PUBLIC_BASE_URL
```

Provision durable access with `npm run judge:access` in `app` after building. It writes a private JSON file under the configured data directory and prints only its path, ID and expiry. Default access ends **December 16, 2026 at 16:00 UTC**, covering the planned judging window with a buffer. Each entry creates a fresh run; separate resume credentials renew one-hour sessions within their original run/role and exact client revision. Revoke an entry and all its grants with `npm run judge:revoke -- ENTRY_ID`. Keep the private files outside public releases and recordings.

For a reviewed plugin ZIP, commit the release inputs, set `PUBLIC_BASE_URL`, build, then run `npm run package:plugin`. The package includes built manifest/code/UI, the walkthrough, source identity and per-file checksums; `app/downloads` holds the versioned ZIP and SHA-256. The Docker build requires `--build-arg SOURCE_COMMIT=<full-reviewed-commit>` and uses the chosen hosted origin. The kit contains no provider keys or judging credentials. See [the plan](docs/JUDGING-ACCESS-PLAN.md) for acceptance requirements and [synthetic design recovery](docs/FIGMA-JUDGING-FILE.md) for the included editable SVG and node snapshot.

## Implementation

- `app/plugin`: Figma selection, PNG export and session storage.
- `app/web`: shared designer UI and separate client review page.
- `app/src/backend`: Node HTTP server, SQLite, role sessions, evidence, AI, PayPal and webhooks.
- `fixtures`: six synthetic scope-judgment cases.
- `docs/PRODUCT-SPEC.md`: adopted product decisions and acceptance criteria for this build.

Run a single backend process per database. Judge entries freeze the supplied brief/rate card/file; developer scope changes do not invalidate other judging runs. Orders, approvals and resets are isolated by run. Approved revisions are immutable. Reset deletes local evidence/orders in that run and keeps invoice tombstones; it does not cancel PayPal invoices or reset the shared AI budget.

[MIT license](LICENSE). Third-party APIs, SDKs and tools retain their own terms and licenses.
