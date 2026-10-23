# Scope & Settle setup status

**Latest continuation:** the app is hosted at `https://scope-and-settle.hperkins.com`. Actual sandbox checkout completed for the approved $250 invoice: PayPal reports PAID with $0 due. Paid appears on the client page and in native Figma, including after reload/reopening on the same revision. The real signed PAID webhook is verified and reconciled through a separate workers.dev ingress, with its receipt preserved across restart. Durable judging entry, session renewal, independent runs/reset and the prebuilt plugin kit are implemented and deployed. Installation of the exact released ZIP, frame export and reopening under another Figma account are verified. Outside-designer walkthroughs remain outstanding. See [webhook verification](PAYPAL-WEBHOOK-DIAGNOSTIC-2026-10-23.md), [judging verification](JUDGING-VERIFICATION-2026-10-23.md), [payment verification](PAYMENT-LOOP-2026-10-22.md), and [Google Cloud setup](GOOGLE-CLOUD-DEPLOYMENT.md). The dated observations below are preserved history.

Checked October 22, 2026. These are historical provider-access checks for the approved feasibility spike, not the current release status. Current product decisions and acceptance status are consolidated in the [product specification](PRODUCT-SPEC.md). The separate-account native release check is now complete; outside-designer walkthroughs remain pending.

**October 23 publication update:** three actual $250 sandbox payments and their signed PAID receipts are now documented. A [reviewed 2:49 native demonstration](DEMO-VIDEO.md) is public on YouTube with English captions; the original MP4, captions and exact plugin kit are also public release assets. The public source is synchronized and MIT-licensed. The Devpost project is published but has not been submitted to the hackathon. Outside-designer observations, confirmed private judge credential delivery and deferred entrant answers remain outstanding.

| Check | Observed result |
| --- | --- |
| Figma comment API for the configured demo file | HTTP 200 at 18:35:16 UTC; zero comments returned. |
| PayPal sandbox OAuth | HTTP 200 at 18:50:16 UTC; authenticated successfully. |
| PayPal sandbox Invoicing permission | Invoicing scope present in the issued access token. |
| PayPal sandbox invoice listing | HTTP 200; no invoice creation or payment tested. |

Credentials are stored in the project-root `.env.local`. The prepared `.gitignore` excludes that file, and `.env.example` contains empty placeholders. This workspace has not been initialized as a Git repository. Provider secrets and access tokens are omitted from the evidence files.

The selected PayPal Default Application's sandbox business account is the merchant configured locally. No live PayPal settings were changed. The initial OAuth attempt returned `401 invalid_client` because the copied client ID contained only one of the two displayed text spans. The complete value was saved and the corrected check passed; the initial failure is retained separately.

## Local evidence

- `output/spikes/figma-access.json`
- `output/spikes/paypal-access.json`
- `output/spikes/paypal-access-attempt-1.json`

The output directory is excluded by the prepared `.gitignore`.

## Next validation

1. Load a development plugin in Figma desktop and retrieve an actual demo comment through the backend.
2. Create and publish a sandbox invoice with email notifications disabled; retain its provider ID and hosted payment URL.
3. Complete payment with the sandbox buyer, retrieve authoritative invoice status, and restore that status after reopening the plugin.
4. Configure the AI provider and run the existing scope-judgment cases, recording actual model results.

No AI evaluations have run. The fixtures define expected outcomes only. Webhook delivery/signature verification, approval handling, duplicate-action behavior, and end-to-end payment remain to be demonstrated.

## Implementation continuation at 19:28 UTC

A prototype backend and Figma plugin now exist under `app/`. A fresh TypeScript check passed. A fresh compiled PayPal adapter read confirmed the existing USD 370.00 invoice is unpaid and returned the expected hosted payer URL. The running backend returned HTTP 200 with zero Figma comments.

Automatic approval review blocked the backend restart before execution. Isolated database tests produced four passes and two failures: reset retained invoice tombstones and other-run records, but stale approval reuse after resubmission and recovery after invoice creation both failed. Source inspection also found incomplete route authorization. The original database and application source were preserved. This is the historical state before the fixes and release checks recorded in [implementation verification](IMPLEMENTATION-2026-10-22.md) and [judging verification](JUDGING-VERIFICATION-2026-10-23.md).
