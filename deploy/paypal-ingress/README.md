# PayPal sandbox webhook ingress

The hosted app stays at `https://scope-and-settle.hperkins.com`. PayPal delivers invoice notifications to `https://scope-settle-paypal-ingress.lfd.workers.dev/webhooks/paypal`.

This Worker streams the original request body and all five PayPal signature headers to the fixed app callback. The backend still calls PayPal's signature-verification API with its registered webhook ID, retrieves the authoritative invoice, and stores a receipt before returning success. The Worker preserves rejection and failure status codes, rejects redirects, and logs only forwarding status. It contains no credentials, payment state, or alternate verification path.

## Deploy

Run `node --test deploy/paypal-ingress/worker.test.mjs deploy/gcp/webhook-subscription.test.mjs app/tests/webhook-provisioning.test.mjs`. Authenticate Wrangler to the account in `wrangler.jsonc`, then run `npx wrangler deploy --config deploy/paypal-ingress/wrangler.jsonc` from the repository root. The app hostname is intentionally fixed in the source; review it before deploying elsewhere.

Verify `GET /health` returns the upstream sandbox health, an unsigned `POST /webhooks/paypal` returns 401, and unrelated paths return 404.

After building the app backend and preparing the protected runtime environment, register or move the subscription:

```powershell
node deploy/gcp/register-paypal-webhook.mjs https://scope-and-settle.hperkins.com https://scope-settle-paypal-ingress.lfd.workers.dev/webhooks/paypal 27Y20713WH091884G
```

The final argument selects the existing subscription when migrating its URL. Omit it for a new installation. An existing ID in the private runtime environment is reused automatically. The script refuses an unknown ID or a conflicting callback subscription, retains unrelated event types, and reads the selected hook back. It saves both `PAYPAL_WEBHOOK_ID` and `PAYPAL_WEBHOOK_URL`; subsequent runs preserve the saved callback even when the optional URL is omitted. The app's public URL remains independent of webhook delivery.

If a new subscription ID was allocated, transfer the protected environment and restart the application so signature verification uses that ID. Moving this existing subscription kept ID `27Y20713WH091884G`, so the deployed verifier did not need a different ID or image.

## Verify actual delivery

Request redelivery of a real invoice event to the selected webhook ID. HTTP 202 only acknowledges that request. Confirm an actual Worker forwarding log, a successful backend verification and reconciliation, and a matching row in `webhook_receipts`. For the PAID event also independently retrieve the invoice and check PAID with zero due. Never substitute a simulator event or database edit for this check.

The first real signed PAID receipt on this route was stored at `2026-10-23T03:01:38.791Z`. See [the verification record](../../docs/PAYPAL-WEBHOOK-DIAGNOSTIC-2026-10-23.md) for event identity and the earlier failed delivery experiments.
