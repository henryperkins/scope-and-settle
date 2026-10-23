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
| AI | Baseten Model API, `deepseek-ai/DeepSeek-V4.1-Flash-1017-Fast`, maximum reasoning, structured JSON and optional frame vision. Final six fixtures and three fresh paraphrases passed; earlier failures and limits are preserved in the verification record. |
| Judgment | Classify as included, new work or needs clarification. Decisive classifications need quoted agreement evidence. An absent mobile frame never proves scope exclusion. |
| Quality | Target approximately 15 seconds. Evaluate both false billable decisions and recognition of legitimate new work; an always-clarify result is inadequate. |
| Context | Selected comment and direct replies, optionally one selected frame. Post clarification questions manually in Figma and capture the reply for reassessment. |
| Pricing | Code resolves known rate IDs and calculates integer amounts. Fixture rates: $250 mobile checkout and $100 onboarding screen. Designer-set amounts stay visibly distinguished from rate-card prices. |
| Review | The designer confirms deliverables and price. The client explicitly approves that exact proposal revision. AI cannot approve or invoice anything. |
| Revisions | Approved/invoiced terms are immutable. A baseline change invalidates pending approval until designer re-review. Never silently rebase. |
| Access | Expiring, revocable role links redeemed into project/run-scoped server sessions; client access binds to one revision. Links grant demo authority, not verified identity. |
| Persistence | One Node 24 process and SQLite database. The selected Google Cloud VM hosts the HTTPS service with a persistent data disk; local setup is the fallback. |
| Reset | Clear only the active run's local evidence and orders. Keep invoice tombstones and the AI budget ledger; PayPal invoices remain at PayPal. |
| Budget | Reserve before calls, limit output and concurrency, record usage, and refuse calls above the configured remaining allowance. Maximum $25 per database; moving deployments requires allocating the remaining total development budget. |
| Content | Synthetic data only. Project roles control access to records. Do not expose provider credentials through a public repo or demo. |
| License | MIT. Repository identity is the authenticated entrant account; final Devpost team attribution must match the actual entrant(s). |
| Impact | Observe 2–3 designers using the workflow. Report measured task times separately from self-reported estimates and avoid unsupported market claims. |

## Payment correctness

Invoice creation requires client approval of the current immutable revision. Repeated actions reuse the same operation and invoice. If creation is uncertain, reconcile by invoice number before attempting another creation. An invoice that was created but not published can resume publication without duplication.

Treat a verified payment event as a reason to retrieve the invoice. Confirm invoice ID, merchant, currency, total, status and amount due before declaring payment complete. Duplicate events and late events after reset must be safe. Manual refresh uses the same authoritative retrieval path.

The positive payment acceptance test requires an actual personal sandbox buyer checkout. Recording an external payment or injecting a simulated event cannot substitute for it.

## Acceptance status

1. Verified: actual comment → frame export → live assessment inside Figma desktop. Image attachment is proven; visual reasoning quality is not independently established.
2. Verified for the bounded synthetic cases: final six fixtures and three fresh paraphrases have correct classifications, meaningful clause evidence and rates. Latencies and earlier failures are recorded.
3. Verified through designer review → separate client approval → real sandbox invoice. Actual buyer checkout and paid status after reopening the plugin remain outstanding.
4. Persistent state survives restart/redeploy. A real signed HTTPS webhook callback remains outstanding.
5. Durable judging access and final submission materials remain outstanding; follow the documented judging-access plan.

See [current verification](BASETEN-VERIFICATION-2026-10-23.md), [Google Cloud deployment](GOOGLE-CLOUD-DEPLOYMENT.md), [judging-access plan](JUDGING-ACCESS-PLAN.md), and [demo/walkthrough outline](DEMO-AND-WALKTHROUGH.md). Requirements describe intended behavior; verification records describe what has actually been observed.
