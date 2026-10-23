# Signed webhook delivery investigation

The real $250 invoice remains **PAID / USD 0 due**. Signed webhook delivery is **unverified**. A redelivery accepted with HTTP 202 is not a callback receipt.

## Verified configuration and provider events

- Callback: `https://scope-and-settle.hperkins.com/webhooks/paypal`, webhook `27Y20713WH091884G`, with all nine available `INVOICING.INVOICE.*` event types including PAID.
- Real PAID event: `WH-55T41444RY3781407-8MT97325HA677920B`, created `2026-10-23T01:12:46.579Z`, invoice `INV2-MR5K-GT4U-9TF7-Q36T`.
- The account-to-app lookup was absent. Created lookup `3AB96519UL396963L` at `2026-10-23T02:04:21.626Z`, verified its REST app ID and read it back. This repairs a missing routing prerequisite; it does not establish that this caused the delivery failure. Provisioning now creates this mapping idempotently and refuses to replace another app's mapping. [PayPal lookup API](https://developer.paypal.com/api/webhooks/v1/webhooks-lookup-post).
- An **unsent, unpaid, $1 diagnostic draft**, `INV2-QRYX-5MT6-MQDA-APAA`, produced real CREATED event `WH-411794107A989990S-8NJ12922SE0269724` at `2026-10-23T02:05:37.099Z`. It is outside the application demo and was never published or paid.

## Delivery experiments

The real PAID event was redelivered after creating the lookup, then after a controlled subscription refresh. PayPal accepted both requests with 202. The refresh used a temporary query suffix on the same callback path. A fresh temporary subscription was also created and the real event redelivered specifically to it. No application callback was logged from these attempts. The temporary subscription was removed and the original callback URL restored at `2026-10-23T02:32:17.401Z`; the production verification ID was never switched.

A clearly labeled simulator network probe was accepted at `2026-10-23T02:20:13.680Z`, synthetic event `WH-0T490472X6099635W-7LJ29748BW389372K`. It did not arrive in app logs either. Simulator output is not evidence of a real payment or verified callback.

At `2026-10-23T02:30:40.717Z`, provider-only retrieval still showed the actual invoice PAID with zero due, while the hosted receipt table was empty. The app had no callback log after the single earlier unsigned diagnostic, which reached the public route and was rejected with 401. A Cloudflare Analytics query scoped to this hostname/path from 02:00–02:25 UTC returned no HTTP request groups and no firewall events. These sampled analytics do not establish PayPal's delivery failure cause. No Cloudflare security setting or application signature requirement was weakened.

Useful PayPal debug IDs: lookup create `f328821ed1804`; real redelivery after lookup `f7390126592b6`; refreshed-hook redelivery `f11035379dd51`; temporary-hook create `f522257450946`; its real redelivery `f4005533c74e2`; simulator request `f26198688e434`. Exact sanitized requests/results remain in ignored operator evidence. Do not include provider secrets in a support request.

## Required remaining proof

Receive the real PAID event with PayPal's signature headers, obtain verification SUCCESS using the registered webhook ID, reconcile the matching invoice via PayPal GET, and retain its receipt state/time. A fixture, simulator event, manual database record, direct payment refresh, or 202 response cannot substitute for that observation. The existing Paid UI flow uses authoritative invoice retrieval and remains working while this separate acceptance check is unresolved.
