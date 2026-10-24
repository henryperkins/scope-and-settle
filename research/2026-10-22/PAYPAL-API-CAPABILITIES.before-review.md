# PayPal API Capability Map

Reference for the **PayPal AI Hackathon** (deadline Nov 12, 2026).
Compiled from `developer.paypal.com` docs, the official OpenAPI spec repo
(`paypal/paypal-rest-api-specifications`), and vendor docs. Verified Oct 22, 2026; patched same day to 19 entries.

Legend: **[V]** verified against official docs/spec · **[?]** believed accurate, confirm before relying on it.

---

## 0. How to read this

PayPal's API surface splits into five layers. Most hackathon projects only touch
layer 1 and miss the differentiated stuff in layers 3–4.

| Layer | What it is | Why it matters here |
|---|---|---|
| 1. Core REST APIs | 14 first-party REST APIs on `api-m.paypal.com` | The baseline "PayPal integration" requirement |
| 2. Payment rails | Wallets, cards, APMs, BNPL, crypto | Breadth = "Technological Implementation" points |
| 3. Platform/marketplace | Onboarding, split payments, payouts | Enables multi-party business models |
| 4. AI-native surfaces | Agent Toolkit, MCP server, Agent Ready | Directly targets the AI + Agentic Commerce prizes |
| 5. Adjacent brands | Braintree, Zettle, Hyperwallet, Venmo… | Escape hatches when core REST can't do the job |

---

## 1. Auth, environments, conventions

**Base URLs** [V]
- Sandbox: `https://api-m.sandbox.paypal.com`
- Production: `https://api-m.paypal.com`

**OAuth 2.0** [V]
```http
POST /v1/oauth2/token
Authorization: Basic base64(client_id:client_secret)
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials
```
Returns `access_token` (bearer, ~9h). Send as `Authorization: Bearer <token>`.

Three auth patterns exist:
1. **Client credentials** — server-to-server, your own merchant account. This is what 95% of hackathon projects need.
2. **Authorization code** — "Log in with PayPal" / third-party acting on a merchant's behalf.
3. **`PayPal-Auth-Assertion`** — a JWT letting a platform call APIs on behalf of a connected seller. Required for marketplace/multiparty flows. [V]

**Useful conventions** [V]
- `PayPal-Request-Id: <uuid>` — idempotency key on POSTs. Prevents double charges on retries.
- `Prefer: return=representation` — return the full object on create instead of a stub.
- `PayPal-Mock-Response` header — force error responses in sandbox for negative testing.
- Webhooks are signed; verify via `POST /v1/notifications/webhooks/{id}/verify-webhook-signature`.

**Sandbox** [V]
Free at `developer.paypal.com`. Gives you a business account (the "merchant") plus
personal accounts (the "buyers"). Test cards, negative-test triggers, and an IPN/webhook
simulator are all available. No real money, no approvals needed for layers 1–2.

---

## 2. Core REST APIs

These are the APIs with published OpenAPI specs plus documented extras.
This is the authoritative "what can I call" list (19 entries).

### 2.1 Orders v2 — `checkout_orders_v2` [V]
The center of gravity. Everything checkout-shaped starts here.

```
POST   /v2/checkout/orders              create
GET    /v2/checkout/orders/{id}         read
PATCH  /v2/checkout/orders/{id}         update amount/items/address pre-capture
POST   /v2/checkout/orders/{id}/confirm-payment-source
POST   /v2/checkout/orders/{id}/authorize    hold funds
POST   /v2/checkout/orders/{id}/capture      take funds
```

Handles: intent (`CAPTURE` | `AUTHORIZE`), line items, tax, shipping, discounts,
`purchase_units` (multiple = multi-seller), `payment_source` (paypal, card, venmo,
apple_pay, google_pay, and every APM), `payment_method_selection`, supplementary data
(Level 2/3 card data), `stored_credential` flags for MIT/merchant-initiated transactions.

**Hackathon note:** the order object is the single richest data structure PayPal exposes.
You can express a whole commerce transaction in one call.

### 2.2 Payments v2 — `payments_payment_v2` [V]
The post-order lifecycle. You'll need this for anything non-trivial.

```
GET  /v2/payments/authorizations/{id}
POST /v2/payments/authorizations/{id}/capture        capture all or part
POST /v2/payments/authorizations/{id}/reauthorize    extend an expiring hold
POST /v2/payments/authorizations/{id}/void           release the hold
GET  /v2/payments/captures/{id}
POST /v2/payments/captures/{id}/refund               full or partial
GET  /v2/payments/refunds/{id}
```

Authorization honor period is ~29 days, extendable. Partial captures allowed;
multiple captures allowed until the authorized amount is exhausted.

### 2.3 Payment Method Tokens v3 (Vault) — `vault_payment_tokens_v3` [V]
Store a payment method for later, **without** an initial transaction.

```
POST   /v3/vault/payment-tokens
GET    /v3/vault/payment-tokens/{id}
GET    /v3/vault/payment-tokens?customer_id={id}
DELETE /v3/vault/payment-tokens/{id}
```

Supports cards and PayPal wallets. Two modes:
- **Save with purchase** — token created as a side effect of checkout.
- **Save without purchase** — token created up front (free trials, "add card now, bill later").

This is the API that makes subscriptions, free trials, and 1-click reorder possible
without touching raw card data (keeps you out of PCI scope).

### 2.4 Subscriptions v1 — `billing_subscriptions_v1` [V]
Recurring billing, fully declarative.

```
POST /v1/billing/plans                              create plan
GET  /v1/billing/plans/{id}
POST /v1/billing/subscriptions                      subscribe a customer
GET  /v1/billing/subscriptions/{id}
POST /v1/billing/subscriptions/{id}/activate
POST /v1/billing/subscriptions/{id}/cancel
POST /v1/billing/subscriptions/{id}/suspend         pause
POST /v1/billing/subscriptions/{id}/capture         bill outstanding balance
POST /v1/billing/subscriptions/{id}/revise          change plan/qty/price
GET  /v1/billing/subscriptions/{id}/transactions
```

Plan features:
- Up to **2 trial cycles** + 1 regular cycle.
- Pricing models: **fixed, quantity, volume-based, tiered**.
- Setup fees, delayed start dates, custom billing intervals (day/week/month/year).
- Failed-payment retry (up to twice per cycle), outstanding balance rollover.
- Pause/resume instead of hard cancel (retention lever).
- Upgrade/downgrade between plans.

### 2.5 Catalog Products v1 — `catalogs_products_v1` [V]
```
POST /v1/catalogs/products
GET  /v1/catalogs/products/{id}
```
Products are the parent object for subscription plans. Also usable standalone as a
lightweight product catalog. Types: `PHYSICAL`, `DIGITAL`, `SERVICE`.

### 2.6 Invoicing v2 — `invoicing_v2` [V]
Full AR (accounts receivable) automation.

```
POST /v2/invoicing/invoices
GET  /v2/invoicing/invoices/{id}
PUT  /v2/invoicing/invoices/{id}
POST /v2/invoicing/invoices/{id}/send
POST /v2/invoicing/invoices/{id}/send-reminder
POST /v2/invoicing/invoices/{id}/cancel
POST /v2/invoicing/invoices/{id}/record-payment      mark paid out-of-band
POST /v2/invoicing/invoices/{id}/generate-qr-code
GET  /v2/invoicing/generate-next-invoice-number
POST /v2/invoicing/templates                          reusable templates
```

Supports line items, discounts, taxes, partial payments, attachments, CC/BCC,
custom email domain (send from your own address), and QR codes for in-person payment.
Invoices can be paid by PayPal or card via the hosted invoice page.

### 2.7 Payouts v1 — `payments_payouts_batch_v1` [V]
Send money out, at scale.

```
POST /v1/payments/payouts                      create batch (up to 15k items)
GET  /v1/payments/payouts/{payout_batch_id}
GET  /v1/payments/payouts-item/{payout_item_id}
POST /v1/payments/payouts-item/{payout_item_id}/cancel
```

- Recipients identified by **email or phone number** — no PayPal account required to receive (they claim it).
- ~96 countries, multi-currency, local-currency payouts.
- **Venmo payouts** supported in the US (phone/email).
- Unclaimed payouts auto-return after **30 days**.
- Alternative channels: Web UI CSV upload (up to 5,000), SFTP large-batch files.

This is the primitive behind affiliate payouts, creator revenue splits, refunds,
and gig-worker disbursement.

### 2.8 Transaction Search v1 — `reporting_transactions_v1` [V]
```
GET /v1/reporting/transactions?start_date=&end_date=&transaction_id=&status=
GET /v1/reporting/balances
```
Read-only ledger query. Filter by date range, transaction ID, status, payer, amount.
Returns transaction events with T-codes (see the T-code reference), fees, and
instrument details. Max 31-day window per query.

**This is the most under-used API in hackathons.** It's the only programmatic way to
read historical money movement, so it's the backbone of any reconciliation,
analytics, or "insights" product.

### 2.9 Disputes v1 — `customer_disputes_v1` [V]
```
GET  /v1/customer/disputes                          list, filterable by status
GET  /v1/customer/disputes/{id}
POST /v1/customer/disputes/{id}/accept-claim
POST /v1/customer/disputes/{id}/provide-evidence
POST /v1/customer/disputes/{id}/appeal
POST /v1/customer/disputes/{id}/escalate
POST /v1/customer/disputes/{id}/make-offer
POST /v1/customer/disputes/{id}/send-message
POST /v1/customer/disputes/{id}/update-status
POST /v1/customer/disputes/{id}/provide-supporting-info
```

Lifecycle: **inquiry → claim → settlement**. Evidence is uploaded as file
attachments (documents, images, tracking proof) with typed evidence reasons.
This is a genuinely automatable workflow — most merchants handle disputes manually.

### 2.10 Partner Referrals v2 — `customer_partner_referrals_v2` [V]
```
POST /v2/customer/partner-referrals
GET  /v2/customer/partner-referrals/{id}
```
Generates an onboarding URL that walks a seller through creating/linking a PayPal
business account under your platform. Returns the seller's merchant ID and
integration metadata on completion.

Requires a **platform/partner account** — apply through PayPal, not self-serve.
Practically out of reach for a 3-week hackathon unless you fake the seller side.

### 2.11 Webhooks v1 — `notifications_webhooks_v1` [V]
```
POST   /v1/notifications/webhooks
GET    /v1/notifications/webhooks
DELETE /v1/notifications/webhooks/{id}
GET    /v1/notifications/webhooks-event-types
POST   /v1/notifications/webhooks/{id}/verify-webhook-signature
POST   /v1/notifications/simulate-event
```

Event families: orders, payments (capture/refund/authorization), subscriptions
(activated/cancelled/suspended/payment failed), invoices, disputes, payouts,
vault tokens, shipment trackers, APM status changes.

`simulate-event` lets you fire fake events at your endpoint in sandbox — very useful
for demoing a webhook-driven flow without waiting for real state changes.

### 2.12 Shipment Tracking v1 — `shipping_shipment_tracking_v1` [V]
```
POST /v1/shipping/trackers-batch
GET  /v1/shipping/trackers/{tracker_id}
PUT  /v1/shipping/trackers/{tracker_id}
```
Push carrier + tracking number to PayPal. Statuses: `SHIPPED`, `ON_HOLD`,
`DELIVERED`, `CANCELLED`, `LOCAL_PICKUP`. Also settable inline on Orders v2.

Matters because tracking data drives **seller protection** and faster release of
held funds — a real business problem, not a toy.

### 2.13 Web Experience Profiles v1 — `payment-experience_web_experience_profiles_v1` [V]
```
POST/GET/PUT/DELETE /v1/payment-experience/web-profiles
```
Legacy-ish config object for branding, landing page type, shipping preference,
and allowed payment methods. Largely superseded by JS SDK options — deprioritize.

### 2.14 Payment Links & Buttons API [V]
```
POST   /v1/checkout/payment-resources
GET    /v1/checkout/payment-resources
GET    /v1/checkout/payment-resources/{id}
PUT    /v1/checkout/payment-resources/{id}
DELETE /v1/checkout/payment-resources/{id}
```

Create a shareable, hosted checkout URL with no frontend work. Supports:
- `type`: `BUY_NOW` (and cart variants)
- `reusable`: `SINGLE` | `MULTIPLE`
- Variants (color, size, warranty) with per-option pricing
- Taxes, shipping (flat + additional-unit), discounts, handling fees
- Adjustable quantity caps, custom customer notes fields
- `return_url` for post-payment redirect

Returns a `payment_link` like `https://www.paypal.com/ncp/payment/PLB-XXXX`.

**Highest leverage API in the whole set for a demo.** You can generate a working,
branded, hosted checkout in one POST — ideal for agents that need to "send someone
a link to pay."

### 2.15 Identity / Log in with PayPal (OIDC) [V]

### 2.16 Usage-Based Billing v1 — `usage_based_billing_v1` [V]
Meter-then-bill product: track arbitrary usage and auto-invoice against it.
This is the API you reach for when billing is a function of consumption
rather than calendar time.

```
# Billing entities (top-level org/customer grouping)
GET  /v1/usage-based-billing/billing-entities
POST /v1/usage-based-billing/billing-entities
GET  /v1/usage-based-billing/billing-entities/{code}
PUT  /v1/usage-based-billing/billing-entities/{code}

# Metrics (what you meter — API calls, minutes, seats, GB, etc.)
GET  /v1/usage-based-billing/metrics
POST /v1/usage-based-billing/metrics
GET  /v1/usage-based-billing/metrics/{code}
PUT  /v1/usage-based-billing/metrics/{code}
DELETE /v1/usage-based-billing/metrics/{code}

# Taxes
GET/POST/PUT/DELETE  /v1/usage-based-billing/taxes{/code}

# Plans (price per metric + billing cadence)
GET  /v1/usage-based-billing/plans
POST /v1/usage-based-billing/plans
GET  /v1/usage-based-billing/plans/{code}
PUT  /v1/usage-based-billing/plans/{code}
DELETE /v1/usage-based-billing/plans/{code}

# Customers + usage
GET  /v1/usage-based-billing/customers
POST /v1/usage-based-billing/customers
GET  /v1/usage-based-billing/customers/{id}
PUT  /v1/usage-based-billing/customers/{id}
DELETE /v1/usage-based-billing/customers/{id}
GET  /v1/usage-based-billing/customers/{id}/current-usage
GET  /v1/usage-based-billing/customers/{id}/past-usage

# Embeddable billing portal
GET  /v1/usage-based-billing/customers/{id}/embeddable-url

# Analytics
GET  /v1/usage-based-billing/customers/analytics/overdue-balance
GET  /v1/usage-based-billing/customers/analytics/gross-revenue
```

Flow: merchant activation → define metrics → build plans → subscribe
customers → post usage → PayPal invoices. Self-serve hosted customer portal
included (the embeddable URL).

**Hackathon note:** this is the natural pricing primitive for any AI
product (pay-per-token, pay-per-credit, pay-per-API-call). Combine with
Payouts for a usage-based revenue share and you have a complete business model
without touching Subscriptions.

### 2.17 Currency Exchange (FX Quote) v2 — `pricing_v2` [V]
```
POST /v2/exchange-rate-quotes           quote + lock rate for display
```
Generate a formal exchange rate quote to display multi-currency prices
before checkout. Supports `source_currency` → `target_currency` with
configurable validity window. Distinct from the implicit FX that happens
inside Orders when you pass a different presentment vs. settlement currency.

Useful for: storefronts, marketplaces, and any "show price in buyer's
currency" UX. Cheap to add, scores on Technological Implementation.

### 2.18 Identity / Log in with PayPal (OIDC) [V]
Not in the OpenAPI repo but fully documented.

```
GET  https://www.paypal.com/signin/authorize?client_id=...&response_type=code&scope=openid email profile ...
POST /v1/oauth2/token                      exchange code
GET  /v1/identity/openidconnect/userinfo   profile data        [canonical: /api/identity/v1]
```

Scopes: `openid`, `profile`, `email`, `address`, `phone`, `paypalattributes`
(returns payer_id, account status, verification status).

Useful for: pre-filling checkout, account linking, KYC-ish signals, and reducing
signup friction. `paypalattributes` is the interesting one — it exposes whether the
account is verified, which is a trust signal you can't get elsewhere.

### 2.19 SFTP reports + reconciliation [V]
PayPal's "old" bulk data surface — fixed-format files via
`sftp://reports.paypal.com` (or DropZone). Not REST, but part of the
integration story and relevant if your hackathon product touches ops/ops-analytics.

| Report | What it covers |
|---|---|
| **Settlement (STL)** | Net settlement per transaction, fees, reserves, chargebacks |
| **Transaction Detail (TDR)** | Every transaction that hit your balance, with fees + FX + dispute linkage |
| **Balance Reconciliation (BRR)** | Opening/closing balance, pending/held, multi-currency |
| **Disbursement Reconciliation (DRR)** | Payout-to-bank mapping for automated withdrawals |
| **Case (ACM)** | Dispute lifecycle events (formerly DDR) |
| **Order / Attempts & Declines** | Auth attempts, decline reasons, retry signals |
| **1099-K / tax** | Tax reporting artifacts |
| **User Audit / Preapproved Agreements / Recurring Profiles** | Compliance + subscription-profile audits |

Good raw material for an AI parsing/analysis product — the formats are
well-documented and stable.

---

## 3. Payment rails you can enable

The Orders API's `payment_source` object is the switchboard. Breadth here is cheap
to add and reads well in a demo.

### Wallets [V]
| Rail | Availability | Notes |
|---|---|---|
| PayPal Wallet | Global | Balance, bank, or card funded |
| Venmo | US | Via JS SDK v6 or Orders API |
| Apple Pay | 30+ countries | Domain verification required |
| Google Pay | 36 countries | |
| Pay Later / PayPal Credit | US, UK, AU, DE, FR, IT, ES | Pay in 4 + Pay Monthly; messaging components |
| Crypto (Pay with crypto) | US | Buyer pays in crypto, merchant settles in USD |

### Cards [V]
- **Advanced Credit & Debit Card (ACDC)** / **Expanded Checkout** — hosted card fields, 37 countries, 22 currencies.
- **Card Fields** — iframe-hosted inputs, your styling, no PCI burden.
- **3D Secure** — full 3DS2 with frictionless/challenge flows.
- **Network tokens** and **third-party network token processing**.
- **Real-Time Account Updater** — auto-refresh expired cards on file.
- **Level 2/3 processing** — pass additional data to cut interchange on B2B/commercial cards.
- **Fastlane** — one-click guest checkout for non-PayPal users.

### Alternative payment methods [V]
Each is a `payment_source` variant in Orders v2, plus a JS SDK module:

Alipay · Bancontact · BLIK · Boleto Bancário · EPS · GrabPay · iDEAL · MB WAY ·
Multibanco · MyBank · OXXO · Przelewy24 · Satispay · Swish · Trustly ·
Ratepay Pay Upon Invoice (DE, BNPL, no PayPal account needed)

Most are redirect-flow: create order → buyer redirected to bank → webhook confirms.
Good demo material because the flows look visibly different from each other.

### Cross-border [V]
- **FX as a Service** — explicit currency conversion at checkout.
- Multi-currency orders; merchant settles in a chosen currency.
- Payouts in local currency across ~96 countries.

---

## 4. Risk, trust & post-purchase

| Capability | What it does | API |
|---|---|---|
| **Fraud Protection Advanced (FPA)** | Rule engine: custom filters, allow/deny lists, manual review queue, ML scoring | Filters/lists/review endpoints [V] |
| **Chargeback Protection** | PayPal covers eligible chargebacks for a fee | Enablement + order flags [V] |
| **Disputes API** | Programmatic evidence submission, offers, appeals, messaging | §2.9 |
| **Seller Protection** | Eligibility driven by tracking + proof of delivery | Via Shipment Tracking |
| **Transaction Search** | Reconcile, audit, build analytics | §2.8 |
| **SFTP reports** | Settlement, transaction detail, fees, balance, disputes, 1099-K | SFTP + DropZone [V] |
| **Negative testing** | Force declines/errors in sandbox | `PayPal-Mock-Response` [V] |

The SFTP report suite is genuinely rich: Settlement, Transaction Detail, Balance
Reconciliation, Fees, Disbursement Reconciliation, Case Report, Order Report,
Attempts & Declines, Recurring Payments Profile, Preapproved Payments Agreements,
User Audit. All are fixed-format files — good raw material for an AI parsing product.

---

## 5. Platform / marketplace layer

For multi-party business models (marketplaces, platforms, franchisors).

**Multiparty checkout** [V]
- **Immediate capture** — platform captures and disburses instantly to sellers.
- **Delayed disbursement** — funds held, released later (escrow-like).
- **Multi-seller payments** — one buyer checkout spanning multiple sellers.
- **Overcharge handling** — PSD2/SCA-compliant re-authorization when the final amount exceeds the original.
- **Platform-level and merchant-level vaulting** — who owns the stored credential.
- **Issue refunds** on behalf of sellers.

**Embedded integration** [V]
Merchant onboarding workflow: create onboarding credentials → build the onboarding
flow → end-to-end verification. Includes **RBAC** configuration and **action widgets**
(beta) for letting merchants manage their own services.

**Partner Referrals** (§2.10) is the entry point — requires partner status.

---

## 6. AI-native surfaces — the differentiator for this hackathon

This is where PayPal has invested heavily and where the "Best Use of Agentic Commerce"
and "Best Use of PayPal + AI" prizes live.

### 6.1 Agent Toolkit [V]
Prebuilt function-calling wrappers over PayPal APIs. Two distributions:
- TypeScript: `npm install @paypal/agent-toolkit`
- Python: `pip install paypal-agent-toolkit`

Framework adapters: **Amazon Bedrock, CrewAI, LangChain, MCP, OpenAI Agents SDK,
Vercel AI SDK**. Actions are individually toggleable and sandbox-aware:

```ts
const toolkit = new PayPalAgentToolkit({
  clientId, clientSecret,
  configuration: {
    actions: {
      orders:            { create: true, get: true, capture: true },
      invoices:          { create: true, list: true, send: true, sendReminder: true },
      products:          { create: true, list: true },
      subscriptionPlans: { create: true, list: true, show: true },
      shipment:          { create: true, show: true, cancel: true },
      disputes:          { list: true, get: true },
    },
    context: { sandbox: true },
  },
});
```

### 6.2 MCP server [V]
Two forms:
- **Local**: `npx @paypal/mcp --tools=all` with `PAYPAL_ACCESS_TOKEN` + `PAYPAL_ENVIRONMENT=SANDBOX`
- **Remote**: `https://mcp.paypal.com/sse`

Exposed tools (full list from the agent tools reference):

| Domain | Tools |
|---|---|
| Catalog | `create_product`, `list_product`, `show_product_details` |
| Payments | `create_order`, `get_order`, `pay_order`, `create_refund`, `get_refund` |
| Invoices | `create_invoice`, `list_invoices`, `get_invoice`, `send_invoice`, `send_invoice_reminder`, `cancel_sent_invoice`, `generate_invoice_qr_code` |
| Subscriptions | `create_subscription_plan`, `list_subscription_plans`, `show_subscription_plan_details`, `create_subscription`, `show_subscription_details`, `update_subscription`, `cancel_subscription` |
| Disputes | `list_disputes`, `get_dispute`, `accept_dispute_claim` |
| Reporting | `get_merchant_insights` (ORDERS/SALES, DAILY→YEARLY granularity), `list_transaction` |
| Shipping | `create_shipment_tracking`, `get_shipment_tracking`, `update_shipment_tracking` |

Remote server also exposes **commerce tools** behind a feature flag
(`--header "x-feature-flags: commerce:true"`): `search_product`, `create_cart`,
`checkout_cart` — currently gift cards only, "more coming soon."

**Caveat:** the MCP toolset is a curated subset. Anything beyond it needs direct
REST calls. A strong project uses both.

### 6.3 Agent Ready / agentic commerce protocols [V]
Let merchants accept payments initiated by AI shopping assistants.

| Protocol | AI platform | Path | Mechanism |
|---|---|---|---|
| **ACP** (Agentic Commerce Protocol) | ChatGPT / OpenAI | Braintree | Delegated payment tokens |
| **UCP** with Braintree | Google AI Mode, Gemini | Braintree | Google Pay payment handler |
| **UCP** with PayPal | Google AI Mode, Gemini | Orders v2 | Encrypted Google Pay credential forwarded to PayPal |

### 6.4 Agentic Commerce Services [V]
Two products, both **gated behind an access request form** (`paypal.ai/us/home#form`):
- **Agent Ready** — accept agent-initiated payments (above).
- **Store Sync** — expose your catalog to AI assistants; orders land in your existing OMS. Integrates via Wix, BigCommerce/Feedonomics, Shopware.

Realistically not demoable in three weeks without partner access. Treat as a
narrative/commercial-context element, not a build target — unless you already have
an in.

---

## 7. Adjacent PayPal-owned platforms

Escape hatches when core REST doesn't fit, and sources of extra prize eligibility.

### Braintree [V]
GraphQL API at `https://payments.sandbox.braintree-api.com/graphql`.
Deeper card acquiring than PayPal REST: granular descriptor control, advanced
fraud tooling (Kount), 3D Secure orchestration, extensive local payment methods,
marketplace/split disbursement, subscription engine, and vault.
**ACP (ChatGPT) runs through Braintree**, so this is required for that path.

### Zettle (point of sale) [V]
REST APIs at `developer.zettle.com`, OAuth2. Distinct APIs for:
**Product** (catalog), **Inventory** (stock levels), **Purchase** (read-only receipts,
taxes, discounts), **Payout** (settlement batches), **Gift Card**.
In-person commerce data — good for an omnichannel story.

### Hyperwallet [V]
REST v4 at `docs.hyperwallet.com`. Payout platform for gig workers, creators,
affiliates, and cross-border disbursement. **Self-serve developer sandbox with open
registration** — unusually accessible. Handles tax forms, multi-currency, and
recipient onboarding. Braintree exposes a forwarding API to it.

### Others
| Brand | Integration surface | Notes |
|---|---|---|
| **Venmo** | JS SDK, Orders API, Payouts | US only; no standalone public API |
| **Xoom** | Partner-only | Cross-border remittance; not self-serve |
| **Paidy** | Japan BNPL, merchant API | Region-locked |
| **Simility** | Enterprise fraud/risk API | Sales-gated |
| **Honey** | None public | Consumer deals; browser extension |

---

## 8. Non-API / low-code surfaces

Useful for scaffolding a demo fast, or for a "real merchant would do this" beat.

- **Payment Links & Buttons UI** — no-code link/button builder in the dashboard.
- **Buy buttons** — paste-in HTML, no backend.
- **Donate SDK** — donation button with preset amounts.
- **Plugins** — WooCommerce, Magento 2, BigCommerce, OpenCart, PrestaShop, Salesforce
  Commerce Cloud, SAP, Shift4Shop, Wix, and ~40 more.
- **SFTP / DropZone** — bulk report and file transfer.
- **Dashboard** — invoicing, subscriptions, disputes (Resolution Center), payouts CSV.

---

## 9. Sandbox reality check

What you can actually build and demo by Nov 12, sorted by friction.

| Capability | Sandbox access | Effort | Demo-ability |
|---|---|---|---|
| Orders + Payments (capture/refund/void) | Instant, self-serve | Low | High |
| Payment Links API | Instant | Very low | Very high |
| Vault / Payment Method Tokens | Instant | Low | Medium |
| Subscriptions + Catalog Products | Instant | Low | High |
| Invoicing (+ templates, QR) | Instant | Low | High |
| Payouts (incl. Venmo) | Instant | Low | High |
| Transaction Search | Instant (needs history) | Low | Medium |
| Webhooks + `simulate-event` | Instant | Low | High |
| Disputes | Instant, but need seeded disputes | Medium | Medium |
| Shipment Tracking | Instant | Very low | Low |
| Identity / Log in with PayPal | Instant | Low | Medium |
| Agent Toolkit (TS/Python) | Instant | Low | High |
| MCP server (local + remote) | Instant | Low | Very high |
| Braintree | Instant sandbox | Medium | High |
| Hyperwallet | Self-serve sandbox | Medium | Medium |
| Zettle | Requires Zettle account | Medium | Low |
| Fraud Protection Advanced | Needs enablement | High | Low |
| Partner Referrals / multiparty | Partner status required | Very high | Low |
| Agent Ready (ACP/UCP) | Access request form | Very high | Low |
| Agentic Commerce Services | Access request form | Very high | Low |

**Practical implication:** the demoable core is
`Orders + Payment Links + Vault + Subscriptions + Invoicing + Payouts + Webhooks +
Transaction Search + MCP/Agent Toolkit`.
That's already enough for a complete product. Everything above the line in the table
is upside, not foundation.

---

## 10. Capability combinations worth building

Each of these strings together 3+ APIs, which is what "non-trivial implementation"
means to the judges. All are sandbox-viable.

**1. Agentic checkout for a niche vertical**
MCP server + Orders v2 + Payment Links + Webhooks.
Conversational agent that understands an intent, builds a cart, issues a payment
link, then confirms via webhook. Add Vault for repeat buyers.
*Targets: Best Use of Agentic Commerce, Best Use of PayPal + AI, Innovation.*

**2. Autonomous AR agent**
Invoicing v2 + Catalog + Transaction Search + Webhooks + Disputes.
Drafts and sends invoices, chases with escalating reminders, reconciles incoming
payments against open invoices, flags non-payers, and opens/answers disputes.
*Targets: Potential Impact, Technological Implementation.*

**3. Marketplace with real money flow**
Orders v2 (`purchase_units` multi-seller) + Payouts + Shipment Tracking.
Buyer pays once, sellers get disbursed, tracking feeds seller protection.
*Targets: Technological Implementation, Design. Caveat: Partner Referrals gated, so fake onboarding.*

**4. Subscription rescue agent**
Subscriptions v1 + Vault + Webhooks (`PAYMENT.SALE.DENIED`) + Invoicing.
Detects failed renewals, retries intelligently, offers plan downgrades, pauses
instead of cancelling, and emails a recovery payment link.
*Targets: Potential Impact, Most Creative.*

**5. Dispute defense copilot**
Disputes v1 + Shipment Tracking + Transaction Search.
Assembles evidence packets from order + tracking + comms history, drafts a response,
submits via API, tracks outcomes. Disputes are a real, expensive, manual problem.
*Targets: Potential Impact, Best Use of PayPal + AI.*

**6. Commerce ops analyst**
Transaction Search + `get_merchant_insights` + Payouts + SFTP reports.
Natural-language querying over real transaction data; anomaly detection on fees,
refund rates, and payout timing.
*Targets: Design, Presentation. Weak on Innovation unless the UX is novel.*

**7. Quote-to-cash for service businesses**
Catalog + Invoicing + Payment Links + Subscriptions.
Agent takes a scope of work, generates a quote, converts to invoice or payment link,
and sets up a retainer subscription on acceptance.
*Targets: Potential Impact, Design.*

**8. Cross-border payout engine**
Payouts + FX + Hyperwallet.
Route each recipient to the cheapest compliant rail, handle currency, track claims.
*Targets: Innovation, Technological Implementation. Highest build cost.*

---

## 11. Things that will bite you

- **Payouts requires a business account with funds.** Sandbox accounts start with a
  balance, but it's finite — plan your demo run-throughs.
- **Disputes need seeded data.** You can't create a dispute via API; you have to
  trigger one through a sandbox buyer flow. Budget a day for this.
- **Transaction Search caps at a 31-day window** per query and needs transactions to exist.
- **Webhooks need a public URL.** Use a tunnel; `simulate-event` covers you if the
  tunnel dies mid-demo.
- **Apple Pay requires domain registration** — skip unless you control a domain.
- **Partner Referrals, Agent Ready, and Agentic Commerce Services are all gated.**
  Don't architect around them.
- **Repo license must be visible in the GitHub About section** — a `LICENSE` file alone
  may not satisfy the rules' "detectable and visible at the top of the repository page."
- **Judges may not run your project.** The video and README are the product.

---

## 12. Source links

- Docs index for LLMs: `https://developer.paypal.com/llms.txt`
- Any docs page as markdown: append `.md` to the URL
- OpenAPI specs: `https://github.com/paypal/paypal-rest-api-specifications/tree/main/openapi`
- Agent tools reference: `https://developer.paypal.com/ai-tools/agent-tools`
- Agent toolkit: `https://developer.paypal.com/ai-tools/toolkit`
- MCP server: `https://developer.paypal.com/ai-tools/mcp-server`
- Agent Ready: `https://developer.paypal.com/agent-ready/overview`
- Zettle: `https://developer.zettle.com/docs/api`
- Hyperwallet: `https://docs.hyperwallet.com`
- Braintree GraphQL: `https://developer.paypal.com/braintree/graphql/reference/`
- Usage-Based Billing docs: `https://developer.paypal.com/api/usage-based-billing/v1`
- Currency Exchange docs: `https://developer.paypal.com/api/pricing/v2`
