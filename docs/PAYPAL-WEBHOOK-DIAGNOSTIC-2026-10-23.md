# Signed webhook delivery investigation

The real $250 invoice is **PAID / USD 0 due**, and its **real signed PAID webhook is verified and durably reconciled**. The receipt was stored at `2026-10-23T03:01:38.791Z` (10:01 p.m. October 22, Chicago). The earlier failed experiments below remain historical evidence.

## Verified delivery fix

The existing subscription `27Y20713WH091884G` now points to `https://scope-settle-paypal-ingress.lfd.workers.dev/webhooks/paypal`. Its nine invoice event types and backend verification ID are unchanged. A separate Cloudflare Worker forwards the original request body and five signature headers to the existing app verifier. The public app and plugin still use `https://scope-and-settle.hperkins.com`.

At `2026-10-23T03:01:28.869Z`, PayPal accepted redelivery of the existing real event `WH-55T41444RY3781407-8MT97325HA677920B`, type `INVOICING.INVOICE.PAID`, invoice `INV2-MR5K-GT4U-9TF7-Q36T`. The following independent observations establish receipt:

- At `03:01:38.791Z`, the backend stored that exact event and invoice with state `reconciled` in SQLite. Its application log reports the same event ID and state.
- At `03:01:39.694Z`, the Worker's delivery log recorded the actual POST, upstream HTTP 200, outcome `ok`, and no exception. This was provider delivery, not a local POST or simulator.
- The deployed backend permits reconciliation and receipt storage only after all five signature headers are present and PayPal's `/v1/notifications/verify-webhook-signature` returns HTTP 200 with `verification_status: SUCCESS`. No verifier bypass, fixture, manual receipt or payment-state override was introduced.
- At `03:01:49.360Z`, an independent provider-only retrieval still reported **PAID / 0 minor units due**. The stored order remained revision 1 / `scope-rev-1`, with its original approval and invoice association.

The new endpoint's health returned 200, unsigned requests returned 401, and unrelated paths returned 404. Eleven focused tests pass for exact body/header forwarding, failed verification/upstream errors, redirect rejection, safe callback migration, subscription ownership/conflicts, required event coverage/readback, repeat setup, and account mapping. Worker type checking also passed. A live read-only check of the new provisioning helper at `03:04:53.531Z` confirmed the same ID, callback and all nine events with no subscription mutation. The callback is saved separately in the private runtime configuration so later registration preserves it.

At `03:06:59.839Z`, after restarting the application, health remained 200 and the same reconciled receipt persisted. The order remained Paid on revision 1 / `scope-rev-1`; its most recent authoritative payment observation was PAID with zero due at `03:01:38.707Z`, recorded during webhook reconciliation. An initial read immediately after the restart raced container creation and reported `No such container`; the later successful check and failed diagnostic were kept separately. The app image was unchanged.

A consistent post-webhook SQLite backup was downloaded off the VM and verified at `03:09:33.540Z`. Integrity was `ok`, SHA-256 `db61f6b2fba764a844dbc316bcc50af59379cc0b53433f5505290c5023360802`, matching the VM copy. It contains the real reconciled receipt, original Paid revision, active hashed judge access and unchanged $0.042347 AI ledger. Its Windows ACL grants only SYSTEM and the user. All 70 fingerprinted pre-existing primary-checkout files remained byte-for-byte unchanged.

A second redelivery request at `03:02:34.100Z` returned 202 but produced no additional callback during the observation window; live duplicate acknowledgement is not claimed. The one real signed callback above is the acceptance evidence. Its receipt was neither synthesized nor inserted by an operator.

The new Worker deployment ID is `d1fbaad9c6754c4c8248088ef730d3d2`, compatibility date `2026-10-23`. The backend remains the reviewed judging image `sha256:488466daad1b504a73498b4c336edb552a4aa0292a085c6be93cdab8610c72c8`. No new payment, invoice or AI inference was needed. No browser was used during this repair. [Ingress source and operation instructions](../deploy/paypal-ingress/README.md).

This isolates a working delivery route: the original custom hostname had no observed callback during the controlled attempts, while the separate workers.dev route delivered the real event. It does not establish the exact PayPal/custom-hostname failure cause. PayPal debug IDs for the successful route change and redelivery are `f91945974bd27` and `f919459a5e88f`.

## Verified configuration and provider events

- Original callback during the failed attempts: `https://scope-and-settle.hperkins.com/webhooks/paypal`, webhook `27Y20713WH091884G`, with all nine available `INVOICING.INVOICE.*` event types including PAID.
- Real PAID event: `WH-55T41444RY3781407-8MT97325HA677920B`, created `2026-10-23T01:12:46.579Z`, invoice `INV2-MR5K-GT4U-9TF7-Q36T`.
- The account-to-app lookup was absent. Created lookup `3AB96519UL396963L` at `2026-10-23T02:04:21.626Z`, verified its REST app ID and read it back. This repairs a missing routing prerequisite; it does not establish that this caused the delivery failure. Provisioning now creates this mapping idempotently and refuses to replace another app's mapping. [PayPal lookup API](https://developer.paypal.com/api/webhooks/v1/webhooks-lookup-post).
- An **unsent, unpaid, $1 diagnostic draft**, `INV2-QRYX-5MT6-MQDA-APAA`, produced real CREATED event `WH-411794107A989990S-8NJ12922SE0269724` at `2026-10-23T02:05:37.099Z`. It is outside the application demo and was never published or paid.

## Delivery experiments

The real PAID event was redelivered after creating the lookup, then after a controlled subscription refresh. PayPal accepted both requests with 202. The refresh used a temporary query suffix on the same callback path. A fresh temporary subscription was also created and the real event redelivered specifically to it. No application callback was logged from these attempts. The temporary subscription was removed and the original callback URL restored at `2026-10-23T02:32:17.401Z`; the production verification ID was never switched.

A clearly labeled simulator network probe was accepted at `2026-10-23T02:20:13.680Z`, synthetic event `WH-0T490472X6099635W-7LJ29748BW389372K`. It did not arrive in app logs either. Simulator output is not evidence of a real payment or verified callback.

At `2026-10-23T02:30:40.717Z`, provider-only retrieval still showed the actual invoice PAID with zero due, while the hosted receipt table was empty. The app had no callback log after the single earlier unsigned diagnostic, which reached the public route and was rejected with 401. A Cloudflare Analytics query scoped to this hostname/path from 02:00–02:25 UTC returned no HTTP request groups and no firewall events. These sampled analytics do not establish PayPal's delivery failure cause. No Cloudflare security setting or application signature requirement was weakened.

Useful PayPal debug IDs: lookup create `f328821ed1804`; real redelivery after lookup `f7390126592b6`; refreshed-hook redelivery `f11035379dd51`; temporary-hook create `f522257450946`; its real redelivery `f4005533c74e2`; simulator request `f26198688e434`. Exact sanitized requests/results remain in ignored operator evidence. Do not include provider secrets in a support request.

## Acceptance criterion fulfilled

The real PAID event arrived with PayPal's signature headers, passed the registered-ID verification gate, reconciled the matching invoice via PayPal GET, and retained its receipt state/time. The earlier Paid UI verification and this signed delivery are distinct, now completed observations. A fixture, simulator event, manual database record, direct payment refresh, or 202 response was not used as a substitute.
