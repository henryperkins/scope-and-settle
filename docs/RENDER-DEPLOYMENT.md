# Render deployment

Selected by the entrant on October 22, 2026. The configuration is prepared and locally tested; a Render service has not yet been created.

## Concrete configuration

| Setting | Value |
| --- | --- |
| Service | `scope-and-settle`, Docker web service |
| Region | Oregon |
| Compute | `0.5c-512mb` (0.5 CPU, 512 MB RAM) |
| Instances | One; SQLite and the invoice-operation lock assume one process |
| Persistent disk | 1 GB at `/var/data` |
| Stored data | SQLite records, sessions, snapshots, AI ledger, backups |
| Health path | `/health` (liveness and missing-config report) |
| Auto deployment | Off; deploy a reviewed commit deliberately |
| Payment environment | Sandbox only, enforced at startup |
| Host URL | Render's `RENDER_EXTERNAL_URL`; optional `PUBLIC_BASE_URL` override |

At the current published prices, the small compute plan is $7/month and a 1 GB disk adds $0.25/month, or approximately **$7.25/month before other workspace, usage, tax, or AI charges**. Confirm the actual Render creation screen before purchasing. Sources: [Render pricing](https://render.com/pricing) and [Render's storage-cost explanation](https://render.com/articles/how-much-does-cloud-application-hosting-cost-for-small-businesses).

The [Blueprint reference](https://render.com/docs/blueprint-spec) defines the configuration. Render's [disk documentation](https://render.com/docs/disks) explains persistence, the one-instance limit, and brief downtime during redeployments. Do not use the free service tier for this disk-backed build.

## Create the service

1. Sign into Render and select the intended workspace.
2. Create a Blueprint from the public Scope & Settle repository, using its root `render.yaml` and `main` branch. Review the service and disk estimate.
3. Set these values in Render's secret environment fields, from the existing local configuration:

   - `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`: the sandbox REST application.
   - `PAYPAL_SANDBOX_MERCHANT_EMAIL` and `PAYPAL_SANDBOX_BUYER_EMAIL`: the matching sandbox accounts.
   - `FIGMA_PERSONAL_ACCESS_TOKEN` and `FIGMA_FILE_KEY`: the synthetic demo file and read-only comment token.
   - `OPENAI_API_KEY`: the already approved existing project key.
   - `AI_BUDGET_USD`: the **remaining** development allowance, not a fresh independent $25.

4. Create the service after reviewing its cost and secret configuration. The Docker build installs locked dependencies and runs the automated tests before producing a runtime image. The runtime does not contain local credentials, local database state, or build dependencies.
5. Check `/health`. HTTP 200 establishes liveness; `ok: true` means required Figma/PayPal configuration is present. Neither proves that a provider accepts the credentials or that AI credits exist.
6. In the service Shell, from `/opt/scope-and-settle/app`, run `node scripts/create-demo-link.mjs`. Read `/var/data/designer-link.txt` privately. Open the link and verify that the designer UI loads the actual configured comments.

**Budget migration:** At the last recorded local attempt, conservative ledger consumption was $0.837288, including failed requests with unknown usage. If unchanged, `$24.16` is a safe rounded-down Render allocation and totals less than $25. Recompute if another live call occurs. Once allocated, stop live AI calls on the local instance. The application cannot account for spending in a different database or outside this app.

The hosted disk starts empty. Do not upload the development database with its old role tokens and experimental invoices. Create fresh approved demo orders using the updated invoice adapter. Old early-spike invoices lacking merchant details fail the current reconciliation check; do not weaken that check to accommodate them.

## Configure Figma and PayPal

Rebuild the development plugin locally with the actual hosted origin, then import the generated `app/plugin/dist/manifest.json` in Figma desktop. `PUBLIC_BASE_URL` must be set in the build shell, as shown in the README. Use a new designer invitation for the plugin. The source manifest is not the file to import.

In the existing PayPal sandbox application, register `https://YOUR-SERVICE.onrender.com/webhooks/paypal` for the applicable `INVOICING.INVOICE.*` events. Save the returned webhook ID as `PAYPAL_WEBHOOK_ID` in Render and redeploy. See [PayPal webhook setup](https://developer.paypal.com/api/rest/webhooks/rest/) and [event names](https://developer.paypal.com/api/rest/webhooks/event-names/). This project does not automatically modify the PayPal app's webhook subscriptions.

Verify one actual sandbox buyer checkout. Preserve the delivered event ID, signature-verification result and subsequent invoice GET result without exposing credentials. A simulated webhook or an invoice external-payment record does not establish that checkout worked.

## Acceptance and judging access

- An anonymous caller receives 401 for `/api/project`, `/api/comments` and `/api/change-orders`.
- A real Figma comment reaches the hosted designer/plugin interface.
- All six live AI cases produce recorded results and human-reviewed evidence; report errors and latency alongside classification.
- Designer review → exact client approval → one invoice → actual sandbox buyer payment → authoritative paid status works end-to-end.
- Duplicate clicks/events do not duplicate invoices or approvals. Reopening the plugin restores status.
- Restart/redeploy the Render service with a test order; confirm its session/order and AI ledger remain on `/var/data`.
- The deployed callback receives and verifies a real PayPal event. Manual refresh remains available if delivery is delayed.

The default invitations and sessions last one hour. They serve development and facilitated walkthroughs. Before submission, arrange durable, privately supplied judging access through December 15, 2026; a one-hour invitation alone is insufficient. The repository's local setup is the documented fallback. No reusable public designer credential is shipped.

## Backups and operations

Run `node scripts/backup-data.mjs` in the service Shell to create a consistent SQLite backup under `/var/data/backups`. Download backups privately. Do not rely on copying an active database file, and do not clear the AI ledger as part of a demo reset.

Reset affects only the active run, preserves invoice tombstones and never cancels PayPal invoices. Scope-baseline changes affect the one shared project; do not edit the baseline during another walkthrough. Keep one service instance and avoid concurrent CLI writes during backups or invoice operations.

Local Docker verification:

```sh
docker build --tag scope-and-settle:local .
cd app
node scripts/check-container.mjs
```

The smoke script uses placeholder credentials and disposable resources. It replaces a container on the same volume, verifies retained state, and removes only its own uniquely named container/volume. It does not test Render's actual mount or external provider access.
