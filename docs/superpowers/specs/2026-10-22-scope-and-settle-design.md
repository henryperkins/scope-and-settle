# Scope & Settle: MVP design

Date: 2026-10-22

Status: Initial design retained for history. The consolidated [working product specification](../../SCOPE-AND-SETTLE-SPEC.md) now contains the decisions, proposed requirements, acceptance criteria, and open questions. See [setup status](../../SETUP-STATUS.md) for provider evidence. The plugin, invoice creation/payment round-trip, AI evaluation, and deployment remain unverified.

## Product and success criterion

Scope & Settle helps a freelance designer or small design studio turn a client request in Figma into a clear commercial decision. It compares the request with the agreed scope and relevant design evidence, proposes one of three outcomes, and connects approved additional work to a PayPal invoice.

The first version serves two parties working on one Figma file. Each approved change order has one invoice. The demonstration must show the complete sequence in under three minutes: agreement → evidence → proposed change → approval → invoice → confirmed sandbox payment.

PayPal payment state is part of the work order. The designer can see which additional work the client approved and whether the corresponding invoice is unpaid, pending, partially paid, or paid.

## MVP boundary

- One configured designer, one client, one editable Figma test file, and one PayPal sandbox merchant and buyer, using USD.
- A designer-entered scope brief and fixed-price rate card, saved as a versioned baseline.
- Selection of an actual Figma comment for analysis, with a relevant frame or selection supplied as design evidence.
- Three assessment outcomes: already included, new work, or needs clarification.
- A designer-reviewed change order, an explicit client approval, one invoice, and durable payment status.
- A client review page outside Figma, so the client can inspect the proposed change and approve it before opening PayPal's hosted invoice page.

Group purchases, payouts, multiple merchants, subscriptions, usage billing, automatic scope arbitration, and marketplace publication are later work. The MVP does not depend on those features.

## User flow

1. The designer associates a file with a scope brief and rate card. Saving creates an identifiable baseline revision; subsequent edits create a new revision.
2. The plugin retrieves comments through the Figma REST API. The designer selects a comment and, where needed, the relevant frame. The application snapshots the inputs used for this assessment.
3. The backend asks the model to classify the request using those inputs. The plugin displays the result, supporting scope clauses, design observations, and any unresolved questions.
4. For included work, the designer records that decision. For an ambiguous request, the plugin prepares a clarification for the designer to review. Neither path produces an invoice.
5. For additional work, the model proposes deliverables and matching rate-card entries. Application code calculates the total. The designer edits or accepts the proposal.
6. The client opens the review page and explicitly approves the displayed scope, price, and revision. Approval is recorded against that exact revision.
7. The backend creates and publishes the invoice for the approved revision. The client follows the hosted sandbox invoice link and pays as the sandbox buyer.
8. The backend verifies payment notifications, retrieves authoritative invoice details, and updates the work order. The open plugin displays the latest result; reopening retrieves persisted state.

An edit after approval requires a new approval. Once an invoice has been created, the corresponding revision is immutable in this MVP; subsequent additions become a separate change order.

## Architecture and access

Use TypeScript for the Figma plugin, backend, and client review UI. Keep the backend as one Node.js service with SQLite persistence. Exact packages and build commands belong in the implementation plan.

The plugin's main code reads the selected document content; its UI communicates with the backend. The backend owns Figma REST access, AI calls, pricing validation, approval records, invoice operations, and webhook handling. The client review UI calls the same backend. A shared contract defines assessments, change orders, and display states.

For the first spike, use a personal access token for the designer's account, with the backend allowlisting the one test file. The token's scopes do not themselves restrict access to that single file. Retrieve comments with `file_comments:read`. Use document content exported by the open plugin for the selected frame; additional REST scopes are added only for an actual required endpoint. A personal token is a single-user development configuration. Multi-user distribution would use Figma OAuth.

The designer and client have distinct authenticated demo sessions. Possession of a comment author name or a file URL does not authorize approval. Each session is restricted to its configured project and role. Public testing credentials, if supplied for judging, access sandbox fixtures only.

Provider credentials remain in server configuration. Local development uses an ignored environment file. The public repository contains placeholder configuration, setup instructions, and synthetic examples. An HTTPS development endpoint forwards PayPal webhooks to the backend during the spike. The app remains usable through explicit status refresh if notification delivery is delayed.

The status interface lives in the running Figma plugin. The backend continues tracking invoices when the plugin closes, and the plugin restores current status when reopened. Continuous background rewriting of the Figma canvas is outside this design.

## AI judgment and pricing

Use one server-side model integration supporting structured responses and a frame image when available. The configured provider/model is deployment configuration; the application contract remains the same.

The model receives the scope revision, selected comment, relevant design snapshot, and available rate-card entries. It returns a classification, source references, supporting text excerpts or visual observations, proposed deliverables, any applicable rate-card identifiers and quantities, and clarification questions.

The application validates the response shape, verifies source identifiers and quoted text, and checks rate-card identifiers and quantities. Totals are calculated in integer currency units. Unknown prices require designer input. Evidence and uncertainty are visible to the designer; the model has no payment or approval authority.

The primary judgment evaluation uses the same comment, “Can you add the mobile checkout?”, with three briefs:

| Baseline | Expected assessment | Required explanation |
| --- | --- | --- |
| Responsive checkout is explicitly included | Already included | Identify the clause that covers the request. |
| Deliverables explicitly cover desktop checkout only | New work | Identify the limitation and propose the additional deliverable. |
| The brief mentions mobile support without defining it | Needs clarification | Explain the ambiguity and ask a question that resolves it. |

Add unseen paraphrases and at least one request whose available evidence is insufficient. Record observed results and failures; do not describe a scripted response as a successful model evaluation.

## PayPal contract and payment correctness

The initial integration uses these entries from `PAYPAL-REST-ENDPOINTS.csv`:

| Operation | Purpose |
| --- | --- |
| `POST /v2/invoicing/invoices` | Create a draft invoice for the approved revision. |
| `POST /v2/invoicing/invoices/{invoice_id}/send` | Publish/send the invoice and obtain the hosted payment route. |
| `GET /v2/invoicing/invoices/{invoice_id}` | Read authoritative invoice and payment details. |
| `POST /v1/notifications/verify-webhook-signature` | Verify a received PayPal webhook. |

Register the sandbox webhook against the integration's app. Use the hosted invoice link for the spike, with invoice email notifications disabled. Link the change-order revision, merchant, invoice ID, and operation record in storage. Repeated clicks and repeated notifications must not create another invoice or another approval. If invoice creation times out with an uncertain result, stop automatic creation retries and reconcile the operation before proceeding.

Treat `INVOICING.INVOICE.PAID` as a reason to retrieve the invoice: PayPal documents that the event can also represent partial or pending payment. Display the retrieved status, amount due, and payment details; never infer full payment from the event name alone. Reconcile against the expected invoice, merchant, currency, and total.

The positive payment test must involve the buyer completing PayPal's sandbox payment flow. The invoice `/payments` operation records external payments and is not evidence of payment processing. Provider event simulation can test event handling, but cannot substitute for that end-to-end payment test.

## First validation and delivery sequence

Treat the first 48 hours of implementation as a feasibility spike. Its question is whether an actual Figma comment can be linked through the plugin and backend to a payable sandbox invoice, with confirmed payment returning to the plugin. Any exploratory code remains labeled as a prototype until reviewed for the product implementation.

| Stage | Passing evidence |
| --- | --- |
| Days 1–2: provider round-trip | Actual file/comment access; draft and published sandbox invoice; hosted buyer payment; verified notification or authoritative refresh; correct status after plugin reopen. Record provider IDs and redacted evidence. |
| Day 3: AI judgment | The three baseline cases classify correctly with source evidence. Held-out paraphrases and ambiguous inputs expose limitations. Rate-card arithmetic and approval remain application-controlled. |
| Days 4–5: complete workflow | Designer review, client approval of the exact revision, invoice creation, payment, recovery after reopening, and duplicate-action handling work together. Record a rough complete demo. |
| Following week | Refine the interface and explanations, improve observed judgment failures, test failure recovery, and have a fresh user follow the setup instructions. |
| Final preparation | Produce the public licensed repository, English submission materials, working judging access, and a public YouTube video under three minutes. Target submission by November 10 to preserve a buffer. |

The official deadline is November 12, 2026 at noon Pacific. Keep the judging build available through the judging period ending December 15. A working local build with complete run instructions is an allowed submission route; a hosted judging build can reduce setup friction. Publication and deployment are separate delivery steps.

Scope & Settle remains the first choice if the provider round-trip and the judgment demonstration both succeed. If a provider dependency prevents a credible implementation within the spike, document that result and run the already identified WooCommerce → Orders v2 checkout fallback before expanding either product.

## Access needed for the first spike

- Figma desktop, an editable test file, and a personal access token with comment-read access for the configured user.
- PayPal sandbox business and personal buyer accounts, a sandbox REST app, and its server-side client ID/secret.
- An AI API account with access to a model supporting the assessment contract; required for the judgment stage.
- A reachable HTTPS webhook endpoint for the round-trip test.

Figma and PayPal sandbox credentials are now configured in `.env.local`, with authenticated read access verified. AI configuration and a webhook endpoint remain outstanding. Keep credentials in local configuration or the deployment's secret store, never in this document or the public repository.

## Evidence and references

The existing capability map and endpoint inventory remain unchanged. This design uses documented contracts; the validation stages above establish actual account access and runtime behavior.

- [Local PayPal capability map](../../../PAYPAL-API-CAPABILITIES.md)
- [Local PayPal REST endpoint inventory](../../../PAYPAL-REST-ENDPOINTS.csv)
- [Figma plugin quickstart](https://developers.figma.com/docs/plugins/plugin-quickstart-guide/): local plugin development requires the desktop app.
- [Figma REST authentication](https://developers.figma.com/docs/rest-api/authentication/): personal tokens for individual tooling; OAuth for acting on behalf of other users.
- [Figma comment endpoints](https://developers.figma.com/docs/rest-api/comments-endpoints/): comment retrieval and its required scope.
- [Figma API comparison](https://developers.figma.com/compare-apis/): plugin/document access and REST integration boundaries.
- [PayPal Invoicing quickstart](https://developer.paypal.com/api/invoicing): documented sandbox create/send flow.
- [PayPal webhook event names](https://developer.paypal.com/api/rest/webhooks/event-names/): invoice event semantics.
- [Official hackathon rules](https://paypalaihackathon.devpost.com/rules): dates, working build, repository/license, video, and judging access requirements.
