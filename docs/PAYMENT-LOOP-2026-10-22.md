# Completed sandbox payment and Figma Paid verification

Verified October 22, 2026, Chicago time (October 23 UTC). The existing $250 invoice was paid through actual PayPal sandbox buyer checkout. Authoritative invoice retrieval, the client page, and the native Figma plugin all show Paid. Its real signed PAID webhook was subsequently verified and reconciled at `2026-10-23T03:01:38.791Z`; see [the completed delivery verification](PAYPAL-WEBHOOK-DIAGNOSTIC-2026-10-23.md).

## Identity and provider result

| Record | Verified value |
| --- | --- |
| Hosted app | `https://scope-and-settle.hperkins.com` |
| Change order | `3d1b634f-446b-4c49-abd1-4e4d7d535486` |
| Approved proposal / brief | Revision **1** / `scope-rev-1` |
| Existing approval | Client approval at `2026-10-23T00:36:12.086Z`; preserved |
| Actual Figma assessment | `7e60b5ab-f24f-4c1e-b893-38bcd21c4a32`; preserved |
| Existing invoice | `INV2-MR5K-GT4U-9TF7-Q36T` |
| Hosted payer URL | `https://www.sandbox.paypal.com/invoice/p/#MR5KGT4U9TF7Q36T` |
| Approved deliverable | Mobile layouts for the existing checkout flow |
| Buyer | `sb-4djfk53508124@personal.example.com` |
| Total / remaining due | **USD 250.00 / USD 0.00** |
| Authoritative status | **PAID** |
| PayPal transaction | `18297492HY688862V`, type `PAYPAL`, transaction status `SUCCESS` |
| Pay submitted | `2026-10-23T01:12:34.736Z` (8:12 p.m. Chicago) |
| First independent PAID read | `2026-10-23T01:12:52.470Z` |

No replacement invoice, external-payment record, simulated payment, or direct database Paid override was used. Existing approved terms and invoice association were retained. No additional AI inference was needed.

## Checkout and UI observations

1. The existing invoice in the normal Edge session showed the correct buyer and $250 due, but its PayPal button reproduced the empty popup. The buyer session had expired; credentials from the earlier setup chat restored sign-in successfully. This does not establish why the earlier popup was blank.
2. At the user's request, browser work moved to an isolated Browserbase session. Checkout was completed entirely in that isolated session. The user's personal browser was not used for the payment.
3. PayPal's separate checkout popup opened with the buyer login. After sign-in, **Pay in full $250.00 today** was selected. Clicking **Pay** completed the sandbox transaction. The invoice showed **Payment successful!**, then **Paid**, **$0.00**, and **Total paid $250.00**.
4. A provider-only read confirmed `PAID`, zero due, and the successful PayPal transaction before any application payment refresh. The app still showed `payment_due` at that instant; no webhook receipt existed.
5. The existing client session for this exact order and revision was restored in an isolated browser. **Refresh payment status** retrieved PayPal's invoice and rendered **Paid**, **Proposal revision 1**, and `scope-rev-1`. Reloading the page retained Paid.
6. In the native Figma Beta development plugin, **Check payment** on **Mobile layouts for the existing checkout flow** changed the card to **Paid** with **$0.00 due**, revision 1 and `scope-rev-1`.
7. The plugin was closed and reopened through **Main menu -> Plugins -> Run last plugin**. It restored its existing designer session and the same Paid change order without another payment check or sign-in.

The earlier **Manual hosting check: mobile checkout** invoice remains a separate unpaid record. Its Payment due label must not be confused with the paid AI-backed order.

These checks establish persistence across client-page reload and plugin reopening during valid sessions. Durable judging access, expired-session renewal, another-account installation, and a post-payment hosted restart are separate acceptance checks.

## Historical webhook attempts before the delivery fix

PayPal generated real event `WH-55T41444RY3781407-8MT97325HA677920B`, type `INVOICING.INVOICE.PAID`, for this invoice at `2026-10-23T01:12:46.579Z`.

At this earlier check, webhook `27Y20713WH091884G` pointed to `https://scope-and-settle.hperkins.com/webhooks/paypal` and included the PAID event subscription. A redelivery of the real PAID event was requested at `2026-10-23T01:17:02.877Z`; PayPal returned HTTP 202. An earlier redelivery of this invoice's real UNPAID event also returned 202. These were accepted delivery requests, not verified callback receipts. [PayPal redelivery API](https://developer.paypal.com/api/webhooks/v1/webhooks-events-resend).

The final read at `2026-10-23T01:19:23.321Z` (8:19 p.m. Chicago) confirmed the persisted Paid order, PayPal PAID with zero due, and **zero webhook receipts**. A deliberately unsigned diagnostic POST reached the public callback and returned HTTP 401 with `Webhook verification failed`. It did not create a receipt or change payment state. A narrowly filtered Cloudflare firewall-event query returned no matching events; this sampled result does not prove that PayPal attempted delivery or establish the cause of missing callbacks.

The later workers.dev ingress fix received the real PAID callback and passed signature verification. The successful UI refresh remains a separate observation; [the delivery record](PAYPAL-WEBHOOK-DIAGNOSTIC-2026-10-23.md) contains the exact event, stored receipt and forwarding log.

## Preserved local artifacts

Sanitized observations are under the ignored `output/gcp/` directory:

- `payment-loop-before-checkout.json`
- `payment-loop-after-redelivery.json`
- `payment-loop-after-payment.json`
- `payment-loop-final.json`
- `payment-loop-redelivery.json`
- `payment-loop-paid-redelivery.json`
- `payment-loop-unsigned-route-probe.json`

Screenshots are under ignored `output/playwright/`:

- `sandbox-payment-review.png`
- `sandbox-invoice-after-payment.png`
- `sandbox-invoice-paid.png`
- `client-paid.png`
- `client-paid-reopened.png`
- `figma-payment-checked.jpg`
- `figma-paid-reopened.jpg`

Session credentials and the isolated browser connection are private artifacts, not release assets. The private client-session restoration was diagnostic setup; it is not evidence that the planned self-service judge entry already exists.

## Work remaining when this payment record was first captured

1. Observe and successfully verify a real PayPal callback; retain event identity and server receipt evidence.
2. Implement and test [durable judging access](JUDGING-ACCESS-PLAN.md), independent runs, renewal, reset, and a versioned prebuilt plugin tested from another Figma account.
3. Conduct the actual designer walkthroughs and finish the under-three-minute recording and public submission materials described in [the demonstration guide](DEMO-AND-WALKTHROUGH.md).

**October 23 update:** real signed callback verification, the deployed judging implementation and exact release-ZIP installation under the separate Figma account are complete. A subsequent native recording run also completed live AI, client approval, actual checkout and payment return/reopening. See [current judging verification](JUDGING-VERIFICATION-2026-10-23.md) and the [reviewed 2:49 video](DEMO-VIDEO.md). Designer walkthroughs, public YouTube publication and remaining submission requirements are still pending.
