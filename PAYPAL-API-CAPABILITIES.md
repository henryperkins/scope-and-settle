# PayPal API and integration capability map

Research date: **October 22, 2026**. Prepared as a technical reference for the PayPal AI Hackathon.

PayPal's developer ecosystem covers payment acceptance, billing, payouts, merchant operations, marketplace infrastructure, in-person commerce, and AI-agent tools. Several products have independent provisioning: a PayPal REST app does not automatically provide Braintree, Hyperwallet, Paidy, Point of Sale, or partner-program access.

This is an inventory of publicly documented capabilities and external-app integrations, not every optional request field or private commercial API. Documentation and specifications were checked. **No account entitlements, authenticated API calls, money movement, or hardware were tested.**

Companion files:

- [REST operation inventory](PAYPAL-REST-ENDPOINTS.csv): 222 method/path entries from 16 published specifications, including callbacks and sandbox-only operations.
- [Research provenance and limitations](research/2026-10-22/README.md): source selection, snapshots, and verification details.
- [Preserved earlier draft](research/2026-10-22/PAYPAL-API-CAPABILITIES.before-review.md).

## Reading the access notes

| Label | Meaning |
|---|---|
| **Documented sandbox** | Official instructions describe sandbox/test use. Account setup and feature configuration can still be required. |
| **Enabled merchant** | The product must be enabled and the merchant must meet its market, currency, and other eligibility requirements. |
| **Partner/program** | Onboarding, a commercial relationship, or specific permissions are involved. Sandbox and production conditions can differ. |
| **Pilot** | Official documentation explicitly describes limited availability. |
| **Specification only** | A published schema describes the operation; a complete, generally available integration path was not established here. |
| **Unverified public API** | A service exists, but a current public self-service API was not established. Private integrations may exist. |

## 1. Developer foundations

| Capability | What an external application can do | Interface and access |
|---|---|---|
| REST authentication | Obtain an access token for a merchant app and call authorized services. Use the returned token expiration. | OAuth 2.0 client credentials. [Authentication](https://developer.paypal.com/api/rest/authentication/). |
| Sandbox | Use test buyers, business accounts, credentials, and simulated funds for supported workflows. | [Sandbox tools](https://developer.paypal.com/sandbox-testing/overview). |
| Third-party merchant access | Perform approved operations for onboarded merchants with their permission. | Partner consent and third-party request headers. A merchant assertion does not itself grant authorization. [API requests](https://developer.paypal.com/api/make-api-requests). |
| Browser checkout | Render payment experiences, detect eligible methods, create payment sessions, and handle approval/cancellation. | Current documentation covers JavaScript SDK v6, with separate v5 guides. [JS SDK setup](https://developer.paypal.com/sdk/js/set-up), [reference](https://developer.paypal.com/sdk/js/reference). |
| React | Use PayPal's React components and SDK integration. | [React SDK](https://developer.paypal.com/sdk/react/reference). |
| Native mobile checkout | Add supported PayPal/card payment flows, return links, and saved-payment experiences. | [iOS SDK](https://developer.paypal.com/sdk/ios/overview), [Android SDK](https://developer.paypal.com/sdk/android/overview). Method support differs by SDK. |
| Backend SDKs and schemas | Call REST directly, use an appropriate server SDK, or generate clients from available schemas. | [Developer portal](https://developer.paypal.com/), [official OpenAPI repository](https://github.com/paypal/paypal-rest-api-specifications). The repository is not the complete ecosystem. |
| API reliability | Use supported idempotency headers, pagination, resource links, error details, and diagnostics. | Behavior is API-specific. [Requests](https://developer.paypal.com/api/rest/requests/), [idempotency](https://developer.paypal.com/api/rest/reference/idempotency/). |
| Events | Subscribe to supported payment and business events; verify and reconcile notifications. | Webhooks; section 6. |
| Commerce plugins | Connect existing commerce platforms without implementing all payment UI. Documented examples include Salesforce, Oracle, SAP Commerce, Braintree/commercetools, and Hyperwallet/Mirakl. | [Platform plugins](https://developer.paypal.com/platforms/plugins). Feature support varies by connector. |

Core REST normally uses `https://api-m.sandbox.paypal.com` or `https://api-m.paypal.com`. Other products can have different hosts and credentials. Browser-safe client identifiers/tokens and server secrets serve different purposes; follow the selected SDK flow. [API requests](https://developer.paypal.com/api/make-api-requests).

## 2. Online payment acceptance

### Checkout and payment lifecycle

| Capability | Integratable functionality | Interface and access |
|---|---|---|
| PayPal wallet checkout | Let a buyer approve a purchase, capture payment, and retrieve its status. | JavaScript/mobile SDK plus [Orders v2](https://developer.paypal.com/api/orders/v2/). Documented sandbox. |
| Order details | Supply items, quantities, shipping, discounts, taxes, descriptions, invoice references, and purchase units; update permitted fields. | Orders v2. Providing tax amounts is not a general tax-calculation service. |
| Dynamic shipping/totals | Recalculate shipping options and totals during checkout through the supported callback flow. | Orders v2 callback contract: PayPal calls the merchant endpoint. |
| Authorize and capture later | Inspect an authorization, capture it later, void it, or request supported reauthorization. | [Payments v2](https://developer.paypal.com/api/payments/v2/). Method/account constraints apply. |
| Partial capture and refunds | Capture supported amounts, issue full/partial refunds, and retrieve status. | Payments v2. Check eligibility for multiple/partial captures. |
| Advanced cards | Accept credit/debit cards through customizable hosted fields and handle processing/authentication responses. | [Card Fields](https://developer.paypal.com/expanded/card-fields). Enabled merchant. Hosted fields can reduce PCI scope, not eliminate all obligations. |
| Card optimization | Supply eligible Level 2/3 data, use supported third-party tokens, update stored cards, and retrieve acquirer references. | [Level 2/3](https://developer.paypal.com/expanded/level2-level3-processing), [account updater](https://developer.paypal.com/expanded/real-time-account-updater), [third-party tokens](https://developer.paypal.com/expanded/third-party-tokens), [acquirer reference](https://developer.paypal.com/expanded/acquirer-reference-number). Product-specific eligibility. |

PayPal documents a **29-day authorization period** and recommends capture within the **three-day honor period**. The honor period is not a guarantee that every capture succeeds. Reauthorization remains constrained by the original authorization period. [Authorization and honor periods](https://developer.paypal.com/payment-methods/auth-honor).

### Wallets, financing, and local methods

| Method | Integratable functionality | Important conditions |
|---|---|---|
| Venmo | Venmo checkout and eligible saved-payment flows; separate payout integrations can send to Venmo recipients. | Eligible US merchants and US buyers, in USD. [Venmo](https://developer.paypal.com/venmo). This is not arbitrary access to a consumer's feed or personal transaction history. |
| Pay Later / PayPal Credit | Show eligible financing at checkout and financing messages on product/cart pages. | Market and buyer eligibility determine availability. [Pay Later](https://developer.paypal.com/pay-later/overview), [messaging](https://developer.paypal.com/pay-later/integrate). |
| Apple Pay | Accept Apple Pay wallet payments through supported PayPal integrations. | Merchant, device/browser, and domain requirements. [Apple Pay](https://developer.paypal.com/apple-pay/integrate). |
| Google Pay | Accept Google Pay wallet payments through supported PayPal integrations. | Merchant and Google integration requirements. [Google Pay](https://developer.paypal.com/google-pay/integrate). |
| Fastlane | Recognize participating guest shoppers, authenticate them, and use saved card/shipping details. | Enablement required; PayPal and Braintree integration paths exist. [Fastlane](https://developer.paypal.com/fastlane/enable). |
| European methods | Supported options include Bancontact, BLIK, EPS, iDEAL, Multibanco, MyBank, Przelewy24, Trustly, Swish, BANCOMAT Pay, MB WAY, and Satispay. | Country, currency, account, and SDK support differ. Some flows settle asynchronously. [Payment methods](https://developer.paypal.com/payment-methods), [reference](https://developer.paypal.com/payment-methods/reference). |
| Other regional methods | Documented options include Alipay, GrabPay, Boleto Bancário, and OXXO. | Use each method's eligibility and integration instructions; they are not universally enabled buttons. [Payment methods](https://developer.paypal.com/payment-methods). |
| Pay upon Invoice / Ratepay | Offer the eligible German invoice-payment method and associated risk-data flow. | Distinct from creating merchant invoices through Invoicing v2. [Method reference](https://developer.paypal.com/payment-methods/reference), [FraudNet](https://developer.paypal.com/ratepay/fraudnet). |
| Pay with crypto | Accept supported buyer cryptocurrency funding, with merchant local-currency settlement. | Current documentation targets US merchants serving global buyers and describes PYUSD refunds. [Crypto](https://developer.paypal.com/crypto), [Orders integration](https://developer.paypal.com/api/orders-v2/crypto). Not a general custody API. |

### Hosted and low-code surfaces

| Surface | Integratable functionality | Important distinction |
|---|---|---|
| Payment Links API | Create/list/read/update/delete reusable payment resources with supported product, price, shipping, and tax options. | API currently generates **payment links**, not embeddable button code. Feature must be enabled for the app. [Integration](https://developer.paypal.com/api/payment-links-buttons), [reference](https://developer.paypal.com/api/payment-links-buttons/v1/). |
| Buttons and hosted carts | Embed generated Buy or Add to Cart/View Cart buttons; share links and QR codes. | Dashboard/product integration; not every feature is exposed through the Payment Links API. [Links and Buttons](https://developer.paypal.com/payment-links-buttons/overview/). |
| Donation checkout | Add a donation button/flow to an external website. | [Donate SDK](https://developer.paypal.com/sdk/donate). Giving Fund partner infrastructure is separate. |
| Invoice payment pages | Direct customers to hosted payable invoices from an app or email workflow. | Invoicing API; section 3. |

## 3. Saved payment methods, subscriptions, and invoices

| Capability | What an application can do | Interface and access |
|---|---|---|
| Payment-method vault | Create setup/payment tokens; list, retrieve, and delete stored methods; save during or separately from a purchase. | [Payment Method Tokens v3](https://developer.paypal.com/api/payment-tokens/v3/). Consent, method support, and merchant enablement determine future use. |
| Returning-customer checkout | Reuse authorized saved cards, PayPal wallets, or eligible Venmo methods. | [Save cards](https://developer.paypal.com/sdk/js/save-with-purchase/cards), [PayPal](https://developer.paypal.com/sdk/js/save-with-purchase/paypal), [Venmo](https://developer.paypal.com/sdk/js/save-with-purchase/venmo). Do not assume tokens transfer across products. |
| Catalog Products | Maintain product metadata used by subscription plans. | [Catalog Products v1](https://developer.paypal.com/api/catalog-products/v1/). This is not a general inventory or shopping-discovery catalog. |
| Subscription plans | Define cycles and supported fixed, quantity, volume, or tiered pricing; configure trials, setup fees, and future starts. | [Subscriptions](https://developer.paypal.com/subscriptions/about), [pricing](https://developer.paypal.com/subscriptions/pricing-plan). Documented sandbox. |
| Subscription lifecycle | Create/read subscriptions, revise supported terms, activate/suspend/cancel, inspect transactions, and collect permitted outstanding balances. | [Subscriptions v1](https://developer.paypal.com/api/subscriptions/v1/). Some changes require buyer approval. |
| Billing recovery | Configure supported retries/failure thresholds and respond to billing events. | [Payment failure and retry](https://developer.paypal.com/subscriptions/payment-failure-retry). |
| Merchant invoicing | Create/edit/send/schedule/search/remind/cancel eligible invoices; use templates, itemization, tax, discounts, partial-payment settings, numbers, and QR codes. | [Invoicing overview](https://developer.paypal.com/invoicing/about/), [Invoicing v2](https://developer.paypal.com/api/invoicing/v2/). |
| External invoice records | Record/remove an external payment or refund against an invoice. | Recording an external transaction does not move money. The API uses `/payments` and `/refunds` subresources. [Invoicing v2](https://developer.paypal.com/api/invoicing/v2/). |
| Recurring invoice series | Current schema includes series lifecycle, conditional rules, and automatic reminder configurations. | **Specification only for these expanded features:** availability was not tested. A recurring invoice series is not equivalent to automatic subscription charging. [Invoice schema](https://developer.paypal.com/api/invoicing/v2/schema.json). |
| Invoice email identity | Use the merchant's email domain in the supported invoice communications flow. | Setup/domain verification required. [Custom domain](https://developer.paypal.com/invoicing/use-your-email-domain/overview). |

## 4. Usage-based billing and entitlements

PayPal publishes a **Usage Based Billing API** with 75 operations. Its published server entry is sandbox and paths are unprefixed, such as `/events` and `/metrics`. **Activation, routing, account availability, and production access remain unverified.** Do not invent a `/v1/usage-based-billing/...` prefix. [Reference](https://developer.paypal.com/api/usage-based-billing/v1/), [schema](https://developer.paypal.com/api/usage-based-billing/v1/schema.json).

| Function group | Documented capabilities |
|---|---|
| Configuration | Billing entities, configured taxes, and activation. |
| Metering | Metrics, individual/batch usage events, current/past/lifetime usage. |
| Commercial model | Customers, plans, subscriptions, and cancellation. |
| Billing operations | Invoice retrieval, payment retries, credit notes, overdue/revenue analytics. |
| Prepaid balances | Credit wallets and wallet transactions within billing; not general bank or peer-to-peer accounts. |
| Product access | Features, privileges, plan entitlements, subscription overrides. |
| Customer experience | Usage alerts and a customer-portal URL. |

The exact contract is preserved in the research folder and CSV. Verify access before committing a project to this API family.

## 5. Payouts, disbursement, and currency

| Capability | What an application can do | Interface and access |
|---|---|---|
| PayPal Payouts | Send batches to supported recipients identified by email, phone, or PayPal ID; inspect batch/item status; cancel eligible unclaimed items. | [Payouts](https://developer.paypal.com/payouts/use-payouts/overview). Production requires approval, verification, and funding. |
| Venmo payouts | Send eligible USD payouts to US Venmo recipients. | Program/recipient requirements apply. Separate from checkout. [Payouts](https://developer.paypal.com/payouts/use-payouts/overview). |
| File-based payout batches | Submit supported large payout files or use web uploads. | [File transfer](https://developer.paypal.com/payouts/use-payouts/send-money/use-large-batch-file-transfer), [web UI](https://developer.paypal.com/payouts/use-payouts/send-money/use-web-ui). |
| Assisted recipient onboarding | Integrate the supported account-creation/consent flow for payout recipients. | [Assisted Account Creation](https://developer.paypal.com/payouts/use-payouts/customize/integrate-aac). Program-specific. |
| Global payout programs | Onboard payees, configure destinations, make payments, and track transfers. | Hyperwallet's separate program/API; section 10. |
| FX quotes | Request supported guaranteed/non-guaranteed currency-conversion quote structures. | [Pricing v2](https://developer.paypal.com/api/pricing/v2/): `POST /v2/pricing/quote-exchange-rates`. **Specification only** for access; listed server is sandbox. |
| Multi-currency checkout | Present supported currencies and use configured holding/settlement options. | Account and currency-pair constraints. [FX integration](https://developer.paypal.com/v5/checkout/fx/get-started). |

Payouts send new payments; refunds reverse eligible original payments. Marketplace settlement, recipient payouts, and FX quotes have different fund flows and permissions.

## 6. Merchant operations, identity, and risk

### Reporting, events, fulfillment, and disputes

| Capability | What an application can do | Interface and access |
|---|---|---|
| Transaction search | Query authorized merchant history, amounts, status, fees, and available details. | [Transaction Search v1](https://developer.paypal.com/api/transaction-search/v1/). Permissions/time windows apply; reporting is not an immediate capture-status signal. |
| Balance reporting | Retrieve supported balances; current schema also describes balance-net and daily summaries. | [Reporting schema](https://developer.paypal.com/api/transaction-search/v1/schema.json). Access to the two expanded summaries was not tested. |
| Financial reports | Consume available settlement, transaction, balance, fee, disbursement, decline, case, activity, and statement reports. | [Report catalog](https://developer.paypal.com/reports/overview), [access](https://developer.paypal.com/reports/access). Some are enabled SFTP/file products. |
| Webhook administration | Manage subscriptions, discover types, inspect/resend events, and simulate notifications. | [Webhooks v1](https://developer.paypal.com/api/webhooks/v1/). Coverage is app/event-specific. |
| Webhook verification | Verify received event signatures using the documented procedure or API. | `POST /v1/notifications/verify-webhook-signature`. Simulation tests delivery/handling, not actual payment-state changes. [Webhooks](https://developer.paypal.com/api/webhooks/v1/). |
| Shipment tracking | Add/update supported carrier and shipment tracking information on eligible payments/orders. | [Tracking](https://developer.paypal.com/track-orders), [Tracking v1](https://developer.paypal.com/api/tracking/v1/), or Orders v2. Does not purchase shipping labels. |
| Dispute handling | Read disputes, submit evidence, exchange permitted messages, make/respond to offers, accept claims, escalate, or appeal. | [Customer Disputes v1](https://developer.paypal.com/api/customer-disputes/v1/). Actions depend on role, stage, and returned links. |
| Dispute test controls | Simulate adjudication and evidence-request transitions. | `/adjudicate` and `/require-evidence` are **sandbox-only**; merchants cannot decide live disputes with them. [Dispute schema](https://developer.paypal.com/api/customer-disputes/v1/schema.json). |
| Chargeback automation | Connect supported processor disputes to evidence/response workflows. | Separate Chargehound service; section 12. |

### Authentication and risk

| Capability | Integratable functionality | Access boundary |
|---|---|---|
| Log in with PayPal | Authenticate a user and obtain consent to supported profile attributes for account linking. | OAuth/OpenID Connect. [How it works](https://developer.paypal.com/log-in/how-it-works), [reference](https://developer.paypal.com/log-in/references). Not unrestricted financial-history access or universal KYC. |
| 3D Secure / payer authentication | Handle eligible cardholder authentication flows. | [SCA](https://developer.paypal.com/expanded/SCA). Requirements vary by method/processor/jurisdiction. |
| Fraud Protection Advanced | Integrate risk/device data and supported decisions; use merchant rules, lists, and review tools. | Enabled product. [FPA](https://developer.paypal.com/expanded/fraud-protection-advanced), [lists](https://developer.paypal.com/expanded/fpa/lists). Public CRUD APIs for every dashboard rule/list were not verified. |
| FraudNet | Add browser/device data collection to documented risk flows. | [FraudNet](https://developer.paypal.com/ratepay/fraudnet). Not a general public machine-learning scoring API. |
| Chargeback Protection | Integrate eligible protection-product requirements. | Coverage depends on product and transaction eligibility. [Chargeback Protection](https://developer.paypal.com/expanded/chargeback-protection). |
| Seller-protection support | Provide relevant transaction/fulfillment evidence. | API use alone does not guarantee coverage. [Tracking integration](https://developer.paypal.com/track-orders). |

## 7. Platforms and marketplaces

PayPal explicitly permits **sandbox testing before partner approval**. Production platform calls require approval and appropriate capabilities. [Platform getting started](https://developer.paypal.com/platforms/get-started).

| Capability | What a platform can do | Interface and access |
|---|---|---|
| Seller onboarding | Generate referral/onboarding experiences and obtain consent for supported capabilities. | [Partner Referrals v2](https://developer.paypal.com/api/partner-referrals/v2/). |
| Readiness/status | Inspect supported merchant integration status and respond to onboarding events. | [Platform docs](https://developer.paypal.com/platforms/get-started). A redirect alone does not prove all capabilities are enabled. |
| Marketplace checkout | Route supported purchases to eligible sellers, including multi-seller purchase-unit flows. | Orders v2 and platform permissions. [Platform payments](https://developer.paypal.com/platforms/). |
| Platform fees | Charge supported partner/platform fees. | Approved capability and configured flow. [Platform payments](https://developer.paypal.com/platforms/). |
| Delayed disbursement | Delay and release seller disbursement within the supported window. | Requires `DELAY_FUNDS_DISBURSEMENT`; automatic release after 28 days is documented. [Delayed disbursement](https://developer.paypal.com/platforms/checkout/delayed-disbursement). Not unrestricted escrow. |
| Seller servicing | Perform authorized payment, refund, reporting, and vault operations for merchants. | Delegated scopes and capabilities apply. [API requests](https://developer.paypal.com/api/make-api-requests). |
| Embedded payments | Embed supported merchant onboarding and servicing experiences. | Current overview specifies US partners. [Embedded integration](https://developer.paypal.com/platforms/embedded-integration/overview). |

Braintree Marketplace and Hyperwallet have separate onboarding/fund-flow models and are not interchangeable implementations of these APIs.

## 8. AI agents and agentic commerce

| Product | What it enables | Integration and access |
|---|---|---|
| Agent Toolkit | Expose supported PayPal actions as tools in AI apps, with TypeScript/Python and documented framework integrations. | [Toolkit](https://developer.paypal.com/ai-tools/toolkit/). The app supplies the AI model/orchestration. |
| Local MCP server | Connect an MCP client to PayPal tools using configured credentials/environment. | [MCP server](https://developer.paypal.com/ai-tools/mcp-server/). Sandbox is supported. |
| Remote MCP server | Connect an authorized client to PayPal's hosted tool service. | The guide documents sandbox `https://mcp.sandbox.paypal.com/sse` and `/http`, with corresponding production hosts. [MCP server](https://developer.paypal.com/ai-tools/mcp-server/). |
| Agent business tools | Supported families include products, orders/capture/refund, invoices, subscriptions, disputes, tracking, transactions, and merchant insights. | [Tool reference](https://developer.paypal.com/ai-tools/agent-tools/). This is a subset of REST capabilities. |
| Agent Ready: ACP | Integrate supported delegated checkout/payment flows for Agentic Commerce Protocol, including a Braintree path. | [Overview](https://developer.paypal.com/agent-ready/overview/), [ACP](https://developer.paypal.com/agent-ready/agentic-commerce-protocol). Onboarding and test setup apply. |
| Agent Ready: UCP | Support documented Universal Commerce Protocol flows involving Google AI surfaces, through Braintree/Google Pay or the supported PayPal Orders path. | [Agent Ready](https://developer.paypal.com/agent-ready/overview/). Processor/protocol requirements differ. |
| Store Sync | Provide merchant product feeds and implement cart/order endpoints for supported AI-shopping experiences. | [Overview](https://developer.paypal.com/store-sync/overview), [integration](https://developer.paypal.com/store-sync/integrate/). Current scope: US buyers, USD, physical goods. Access request/onboarding required. |

Store Sync uses merchant data and merchant-implemented endpoints; it is not a public search API over every PayPal merchant's inventory. Agent tools retain the underlying permissions and approval/payment requirements. [Store Sync](https://developer.paypal.com/store-sync/integrate/), [AI tools](https://developer.paypal.com/ai-tools/get-started/).

## 9. Braintree / PayPal enterprise payments

Braintree has its own merchant configuration, credentials, sandbox, client/server SDKs, and GraphQL API. Check SDK/GraphQL feature parity for the selected operation. [Overview](https://developer.paypal.com/braintree/docs/start/overview), [GraphQL payment methods](https://developer.paypal.com/braintree/graphql/guides/payment_methods/).

| Capability | External-app functionality | Access and source |
|---|---|---|
| Payment acceptance | Cards, PayPal, Apple Pay, Google Pay, and eligible Venmo flows. | Country/method support varies. [Overview](https://developer.paypal.com/braintree/docs/start/overview). |
| In-person / omnichannel | Connect Braintree processing to Verifone terminals; support card-present sales, refunds, voids, authorizations/completions, shared vaulting, and consolidated reporting. Configured alternative methods can include gift cards and BNPL. | Separate merchant/hardware integration with device and payment-method requirements. [Braintree in-person](https://developer.paypal.com/braintree/in-person/about/overview/). |
| Transaction lifecycle | Tokenize, authorize, submit for settlement, void/refund, and inspect/search supported records. | SDK APIs and [GraphQL transactions](https://developer.paypal.com/braintree/graphql/guides/transactions/). |
| Vault/customers | Manage customers and reusable payment methods. | [GraphQL payment methods](https://developer.paypal.com/braintree/graphql/guides/payment_methods/). |
| Recurring billing | Supported subscriptions/plans, trials, add-ons, discounts, and failure handling. | [Recurring billing](https://developer.paypal.com/braintree/docs/guides/recurring-billing/overview). Separate from PayPal Subscriptions. |
| US ACH | Tokenize, verify, vault, and charge supported bank accounts; verification can involve network checks or micro-transfers. | Eligible merchants and custom integration. [ACH](https://developer.paypal.com/braintree/docs/guides/ach/overview). |
| SEPA Direct Debit | Supported bank-debit mandates, vaulting, and payment flows. | **Pilot / limited availability.** [SEPA](https://developer.paypal.com/braintree/docs/guides/sepa-direct-debit/overview/). |
| Risk/authentication | Supported 3D Secure, device data, fraud, and payment-method lifecycle services. | Product-specific setup. [Documentation](https://developer.paypal.com/braintree/docs/start/overview). |
| Payment orchestration | Route supported operations through configured payment-provider connectors. | Documented examples: Adyen, dLocal, EBANX, Fat Zebra, FlexFactor, Flutterwave, Stripe. Commercial setup required. [Orchestration](https://developer.paypal.com/braintree/docs/guides/orchestration/overview/). |
| Forward API | Forward eligible vaulted payment data to configured third-party destinations. | Restricted destination/configuration requirements. [Forward API](https://developer.paypal.com/braintree/docs/reference/forward-api/overview). |
| Optimized debit routing | Route eligible US debit transactions over supported PINless networks. | Merchant/network eligibility. [Debit routing](https://developer.paypal.com/braintree/docs/guides/pinless-debit/optimized-debit-routing/overview/). |
| Data Lens | Analyze shared payment data through Snowflake Secure Data Sharing. | Enterprise data integration, not generic REST. [Data Lens](https://developer.paypal.com/braintree/docs/guides/data-lens/overview/). |
| Marketplace | Onboard supported US sub-merchants and use service-fee/disbursement flows. | Sales contact for new integrations. Documented incompatibilities include PayPal and Braintree recurring billing; new Venmo funding is unsupported. [Marketplace](https://developer.paypal.com/braintree/docs/guides/braintree-marketplace/overview). |

**Lifecycle:** Braintree's overview marks Drop-in deprecated October 1, 2026, with unsupported status scheduled for October 1, 2027. Check its replacement path before starting a new integration. Samsung Pay is separately marked deprecated. [Overview](https://developer.paypal.com/braintree/docs/start/overview), [Samsung Pay](https://developer.paypal.com/braintree/docs/guides/samsung-pay/overview/).

## 10. Hyperwallet

Hyperwallet provides a separate REST v4 platform, embedded components, hosted Pay Portal experiences, webhooks, and payout-program integrations. Its developer site offers sandbox signup; this research did not create an account. Production requires program configuration. [Hyperwallet developers](https://www.hyperwallet.com/developers).

| Capability | External-app functionality | Access and source |
|---|---|---|
| Payee management | Create/manage supported individual/business payees and verification workflows. | Program-specific fields and verification. [Payee testing](https://docs.hyperwallet.com/content/testing/v1/payee-verification-testing/business-payees). |
| Destination configuration | Discover supported destination countries, currencies, and required fields. | [Transfer-method configurations](https://docs.hyperwallet.com/content/api/v4/resources/transfer-method-configurations/list). |
| Destination management | Configure supported bank, card, PayPal, Venmo, prepaid-card, check, cash-pickup, or other destinations. | Program/country-dependent. [Transfer methods](https://docs.hyperwallet.com/content/transfer-methods/v1/overview). |
| Payments/transfers | Create supported payouts, use configured transfer methods, and track lifecycle/status. | REST and program-specific flows. [Developer platform](https://www.hyperwallet.com/developers). |
| Embedded payout UI | Let payees configure destinations inside an app or use the hosted Pay Portal. | [Embedded transfer methods](https://www.hyperwallet.com/resources/developers-product-documentation/understanding-transfer-methods-in-an-embedded-experience/). |
| Events/reconciliation | Receive supported payee, destination, payment, transfer, and funding events. | [Webhook types](https://docs.hyperwallet.com/content/webhooks/v1/notification-types). |

## 11. PayPal Point of Sale / Zettle

Point of Sale offers payment integrations and merchant-data APIs. The current market table says merchant-data APIs are **not supported in the US**, while Android/iOS SDKs are supported there. Confirm the market table for the selected interface. [API/SDK catalog](https://developer.zettle.com/docs/get-started/concepts/zettle-apis-sdks).

| Capability | External-app functionality | Interface and access |
|---|---|---|
| Native in-person payments | Supported card/contactless/manual-entry/QR payments and refunds inside mobile POS apps. | iOS/Android SDKs; hardware/method compatibility varies. [Payment integrations](https://developer.zettle.com/docs/payment-integrations/overview). |
| Cloud-connected readers | Send payment requests from web, Windows, mobile, or other platforms to supported standalone readers. | Reader Connect REST/WebSocket interfaces. [Connection guide](https://developer.zettle.com/docs/payment-integrations/reader-connect/user-guides/create-a-websocket-connection). |
| Product Library | Manage merchant products, variants, and prices. | OAuth-scoped API. [API catalog](https://developer.zettle.com/docs/api). |
| Inventory | Read/update supported stock information for product variants. | Inventory API. [API catalog](https://developer.zettle.com/docs/api). |
| Product images | Upload images for the merchant library. | Image API. [API catalog](https://developer.zettle.com/docs/api). |
| Purchase data | Read exposed sales, item, tax, discount, and payment information. | Read-only Purchase API. [API catalog](https://developer.zettle.com/docs/api). |
| Finance | Read balances, transactions, and payouts. | Finance API. [API catalog](https://developer.zettle.com/docs/api). |
| Gift cards | Read supported gift-card information. | Read-oriented interface verified, not general issuance/redemption management. [Gift Card API](https://developer.zettle.com/docs/api/gift-card/overview). |
| Notifications | Subscribe to supported product, inventory, purchase, and related events. | Pusher API and OAuth scopes. [API catalog](https://developer.zettle.com/docs/api). |

SDK documentation describes payment/refund test mode without actual money or a reader. Test mode is separate from proving a real hardware integration. [Developer portal](https://developer.zettle.com/).

## 12. Other independently provisioned services

| Service | Integratable functionality | Access and evidence |
|---|---|---|
| Paidy | Japanese deferred-payment checkout; JavaScript UI, server payment lifecycle, supported recurring/token flows, webhooks. | Separate merchant/API keys and JPY-focused integration. Testing uses test keys in the same environment rather than a separate sandbox host. [Docs](https://paidy.com/docs/en/), [testing](https://paidy.com/docs/en/testing.html), [webhooks](https://paidy.com/docs/en/webhook.html). |
| Chargehound | Processor dispute retrieval and evidence/response automation, with configured templates. | Separate commercial API, not PayPal Disputes v1. [API](https://www.chargehound.com/docs/api/2020-02-28/), [support](https://www.chargehound.com/support). |
| PayPal Giving Fund | Charity Search API and giving integrations. Giving Fund receives donations, issues receipts, and grants funds to recommended eligible charities. | **Partner/program.** Public materials confirm the API; self-service keys/sandbox not established. [Giving Fund partners](https://www.paypal.com/us/paypal-giving-fund/partner). |
| PayPal Grant Payments | Charitable-grant distribution offering for eligible grantmakers. | Contact-led offering; public endpoint contract not verified. [Grant Payments](https://www.paypal.com/us/paypal-giving-fund/partner). |
| PayPal Ads | Advertising, offers, and shoppable storefront experiences. Integrations can involve pixels, SDKs, server integrations, and merchant catalog/order interfaces. | Partner specifications/eligibility apply. Public self-service campaign-management REST API not verified. [Ads](https://www.paypal.com/us/advertiser), [integration provisions](https://www.paypal.com/us/legalhub/paypal/merchant-ads-mgr-tnc). |
| PYUSD | Interact with PayPal USD on supported blockchains through their token interfaces. | Separate from PayPal REST/sandbox. Verify network support and issuer contracts for deployment. [PayPal USD](https://www.paypal.com/us/cshelp/article/what-is-paypal-usd-pyusd-help1005). |

## 13. Brands without a verified public self-service API here

The supplied hackathon rules name additional PayPal services. Competition scope does not establish developer credentials or sandbox availability.

| Brand/service | Relevant functionality | Research conclusion |
|---|---|---|
| Xoom | International remittances and supported payment/top-up services. | Current public self-service API and ordinary hackathon sandbox not verified. [Xoom app](https://help.xoom.com/s/article/learn-about-the-xoom-app). |
| Honey | Offers, coupons, merchant/affiliate relationships, rewards. | Merchant participation exists; public self-service coupon/rewards API not verified. [Honey guidance](https://help.joinhoney.com/article/44-can-i-add-a-coupon-code-to-honey). |
| Simility | Fraud/risk technology associated with PayPal risk products. | Current material directs users toward PayPal fraud solutions; separate new developer program not verified. [Simility](https://www.paypal.com/us/simility). |
| Swift Financial / business financing | Business loans and working-capital products. | Public self-service origination/underwriting API not established. A borrower application page is not an embedded lending API. [Business financing](https://www.paypal.com/us/business/financial-services/small-business-loan). |

This research also did not establish general consumer bank aggregation, arbitrary Venmo social-data access, unrestricted escrow, or general-purpose bank/card issuance through a basic PayPal REST app. Evaluate specialized payout/card programs on their own contracts.

## 14. Legacy and compatibility surfaces

| Surface | Functionality | How to treat it |
|---|---|---|
| Payflow Gateway | Gateway processing, authorization/capture/void/refund, hosted pages, reporting, optional recurring billing and fraud services. | Current official docs exist, with a separate pilot/account model. Verify product availability. [Gateway](https://developer.paypal.com/api/nvp-soap/payflow/payflow-gateway/), [getting started](https://developer.paypal.com/api/nvp-soap/payflow/gs-payflow). |
| Payflow ACH | ACH through the older Payflow service. | Official docs say new ACH accounts are no longer boarded. Separate from Braintree ACH. [Gateway](https://developer.paypal.com/api/nvp-soap/payflow/payflow-gateway/). |
| NVP/SOAP | Older checkout, payment, billing-agreement, and recurring-payment contracts. | Relevant to existing systems; consult current-resource/migration guidance for new work. [NVP/SOAP](https://developer.paypal.com/api/nvp-soap/), [current REST resources](https://developer.paypal.com/api/rest/current-resources/). |
| Payment Experience v1 | Saved web-experience profiles for older checkout integrations. | Included in schema inventory for completeness; not assumed to configure modern Orders/JS SDK v6. [Payment Experience](https://developer.paypal.com/api/payment-experience/v1/). |

## 15. Exact REST inventory

The CSV contains **222 distinct HTTP method/path entries across 16 selected specifications**. It includes a merchant-hosted callback and sandbox dispute-test controls; it is not a count of production features open to every account.

| Specification family | Operations | Source |
|---|---:|---|
| Subscriptions v1 | 17 | Current developer-site schema |
| Catalog Products v1 | 4 | Current developer-site schema |
| Orders v2 | 10 | Current schema; includes callback contract |
| Customer Disputes v1 | 15 | Current schema; two sandbox-only controls |
| Partner Referrals v2 | 2 | Current schema; not entire platform surface |
| Invoicing v2 | 44 | Current schema; includes expanded recurring/reminder contracts |
| Webhooks v1 | 16 | Current developer-site schema |
| Payment Experience v1 | 6 | Current schema; compatibility surface |
| Payments v2 | 8 | Current developer-site schema |
| Payouts v1 | 4 | Official GitHub specification pinned to a commit |
| Transaction Search v1 | 4 | Current developer-site schema |
| Shipment Tracking v1 | 5 | Current developer-site schema |
| Payment Method Tokens v3 | 6 | Current developer-site schema |
| Usage Based Billing v1 | 75 | Published schema; access/routing unverified |
| Pricing v2 | 1 | Published schema; access unverified |
| Payment Links and Buttons v1 | 5 | Published schema; API currently covers links |
| **Total** | **222** | **Bounded published-schema snapshot** |

OAuth/identity, Braintree GraphQL, Hyperwallet, Paidy, Point of Sale, Chargehound, private partner APIs, SDK methods, and file reports are outside this CSV count. Their capability families are covered above.

| Operation | Exact method/path or direction |
|---|---|
| Invoice reminder | `POST /v2/invoicing/invoices/{invoice_id}/remind` |
| Record external invoice payment | `POST /v2/invoicing/invoices/{invoice_id}/payments` |
| Next invoice number | `POST /v2/invoicing/generate-next-invoice-number` |
| Webhook verification | `POST /v1/notifications/verify-webhook-signature` |
| FX quote | `POST /v2/pricing/quote-exchange-rates` |
| Payment-link resource | `POST /v1/checkout/payment-resources` |
| Order-update callback | PayPal calls the merchant's configured callback URL. |
| Usage event ingestion | Schema says `POST /events`; confirm deployment/routing before implementation. |

Paths above come from preserved official schemas. The current developer-site invoice/reporting schemas contain more operations than the pinned GitHub versions; the CSV prefers the developer-site snapshots where retrieved. [Provenance and verification](research/2026-10-22/README.md).

## 16. Evidence for project planning

The supplied hackathon rules require a functioning sandbox integration with PayPal central to an application that also uses AI. A brand name, schema, or mock response does not establish working access. The rules do not say that using more API families automatically earns a higher implementation score. [Official rules](https://paypalaihackathon.devpost.com/rules).

Distinguish:

1. **Documented capability:** publicly described feature or contract, established by this inventory.
2. **Accessible sandbox integration:** the chosen account/app executes the needed workflow with test resources.
3. **Production readiness:** approvals, markets, configuration, and any device/operational requirements are satisfied.

Core checkout, billing, and merchant operations have documented sandbox paths. The platform getting-started guide permits sandbox use before partner approval. Usage billing, FX quotes, expanded invoice features, partner programs, and regional services warrant an early feature-specific access check before a project's scope depends on them.
