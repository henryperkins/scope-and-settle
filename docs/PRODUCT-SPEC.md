# Scope & Settle — v1 product contract

## Audience and outcome

Freelance designers and small studios working with a client in Figma need to decide whether a casual request is included, additional work, or too ambiguous to price. The product links **agreement → evidence → designer review → client approval → PayPal invoice → payment status** in one small workflow.

## Boundary

One configured synthetic Figma project, one designer role, one client role, one sandbox merchant/buyer pair and USD invoices. Two-party change orders are the product unit. Group buying, payouts, multi-merchant onboarding, subscriptions, automatic arbitration and Figma marketplace publication are outside v1.

## Adopted decisions

| Topic | Decision |
| --- | --- |
| Original agreement | Begin with a supplied synthetic brief labeled “Agreed brief (provided by designer)”. Do not claim it was acknowledged in this app. |
| Payment | Client approves the new work; payment follows. State “Work begins after payment.” The plugin does not restrict Figma editing. |
| AI | One server-side provider with structured output and optional vision. Current candidate: OpenAI `gpt-6-luna`, awaiting completed live evaluation. |
| Judgment | Classify as included, new work or needs clarification. Decisive classifications need quoted agreement evidence. An absent mobile frame never proves scope exclusion. |
| Quality | Target approximately 15 seconds. Evaluate both false billable decisions and recognition of legitimate new work; an always-clarify result is inadequate. |
| Context | Selected comment and direct replies, optionally one selected frame. Post clarification questions manually in Figma and capture the reply for reassessment. |
| Pricing | Code resolves known rate IDs and calculates integer amounts. Fixture rates: $250 mobile checkout and $100 onboarding screen. Designer-set amounts stay visibly distinguished from rate-card prices. |
| Review | The designer confirms deliverables and price. The client explicitly approves that exact proposal revision. AI cannot approve or invoice anything. |
| Revisions | Approved/invoiced terms are immutable. A baseline change invalidates pending approval until designer re-review. Never silently rebase. |
| Access | Expiring, revocable role links redeemed into project/run-scoped server sessions; client access binds to one revision. Links grant demo authority, not verified identity. |
| Persistence | One Node 24 process and SQLite database. Render hosts the HTTPS service with a persistent disk; local setup is the fallback. |
| Reset | Clear only the active run's local evidence and orders. Keep invoice tombstones and the AI budget ledger; PayPal invoices remain at PayPal. |
| Budget | Reserve before calls, limit output and concurrency, record usage, and refuse calls above the configured remaining allowance. Maximum $25 per database; moving deployments requires allocating the remaining total development budget. |
| Content | Synthetic data only. Project roles control access to records. Do not expose provider credentials through a public repo or demo. |
| License | MIT. Repository identity is the authenticated entrant account; final Devpost team attribution must match the actual entrant(s). |
| Impact | Observe 2–3 designers using the workflow. Report measured task times separately from self-reported estimates and avoid unsupported market claims. |

## Payment correctness

Invoice creation requires client approval of the current immutable revision. Repeated actions reuse the same operation and invoice. If creation is uncertain, reconcile by invoice number before attempting another creation. An invoice that was created but not published can resume publication without duplication.

Treat a verified payment event as a reason to retrieve the invoice. Confirm invoice ID, merchant, currency, total, status and amount due before declaring payment complete. Duplicate events and late events after reset must be safe. Manual refresh uses the same authoritative retrieval path.

The positive payment acceptance test requires an actual personal sandbox buyer checkout. Recording an external payment or injecting a simulated event cannot substitute for it.

## Acceptance still requiring external evidence

1. Actual comment → frame export → live assessment works inside Figma desktop.
2. Six recorded AI cases show correct classifications and meaningful clause evidence, with latency and failures reported.
3. Designer review → separate client approval → actual sandbox checkout → paid status survives reopening the plugin.
4. Hosted HTTPS callback verifies a real PayPal event, and Render state survives a restart/redeploy.
5. Judges can run or interact with the build through the end of judging; source, license, setup and a public YouTube video under three minutes are available.

See [current verification](IMPLEMENTATION-2026-10-22.md), [Render deployment](RENDER-DEPLOYMENT.md) and [demo/walkthrough outline](DEMO-AND-WALKTHROUGH.md). Requirements describe intended behavior; verification records describe what has actually been observed.
