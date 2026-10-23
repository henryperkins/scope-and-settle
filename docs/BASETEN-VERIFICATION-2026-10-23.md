# Baseten and working-flow verification

**Later continuation:** actual sandbox payment and Paid persistence on the client page and in native Figma are now verified. See [the completed payment record](PAYMENT-LOOP-2026-10-22.md). The checkout and unpaid observations below describe the earlier run; signed webhook receipt remains unverified.

Recorded October 22, 2026, Chicago time (October 23 UTC). This supersedes earlier statements that live AI was blocked on OpenAI credits. It does not establish a completed sandbox payment or verified webhook delivery.

## Verified AI configuration

- Provider: Baseten Model APIs at `https://inference.baseten.co/v1`.
- Model: `deepseek-ai/DeepSeek-V4.1-Flash-1017-Fast`.
- Reasoning: `max`; no fallback model, provider, or reduced effort.
- Final prompt version: `scope-assessment-v3`; temperature 0.1; strict structured JSON; 16,384 tokens shared by reasoning and final output; 90-second timeout.
- The authenticated model catalog returned this exact model with vision and structured-output support. Model output from actual paid inference independently confirmed access.
- The key is server-side in ignored/private environment configuration. OpenAI and generic key variables are not used. No credentials belong in source, the plugin, evaluation reports, or this document.

Contract references: [Baseten reasoning](https://docs.baseten.co/inference/model-apis/reasoning), [Chat Completions](https://docs.baseten.co/reference/inference-api/chat-completions), [structured outputs](https://docs.baseten.co/inference/structured-outputs), and [vision](https://docs.baseten.co/inference/model-apis/vision).

The server verifies clause IDs and exact quoted evidence, resolves allowed rate IDs to integer prices, and rejects malformed or incomplete responses. Included/ambiguous work cannot generate billable rate entries. AI does not approve work or create invoices. Only final answers and usage counts are retained; raw model reasoning is discarded.

## Evaluation, including failed attempts

All calls below used the hosted persistent budget ledger. Reports are retained under `/var/data/evaluations` and copied into the ignored local `output/gcp` directory. Times in this table are UTC.

| Run | Result | What was observed |
| --- | --- | --- |
| 00:27:49, initial prompt | 5/6 | All classifications were correct. The new-work paraphrase omitted the matching $250 rate. |
| 00:30:58, revised rate guidance | 5/6 | The same paraphrase failed server validation because decisive agreement evidence was missing. The error and budget record remain; the rejected final JSON was not retained by that evaluator version. |
| 00:34:08, final v3 | 6/6 | Correct classifications, matching clause evidence, and prices on all six fixtures; latency 524–1,117 ms. |
| 00:41:42, three fresh paraphrases | 3/3 | New phone-width layouts under a desktop-only brief: new work, $250. Narrow-screen layout under an inclusive brief: included, $0. Undefined mobile support/fee: clarification, $0. Latencies 1,436 / 636 / 637 ms. |

The final schema requires evidence for decisive classifications and questions for clarification, while preserving the server's independent evidence checks. The evaluator now retains rejected final JSON when available. No raw reasoning is saved. Final outputs were also read for semantic agreement with the quoted clauses, not merely counted as schema passes.

The final nine cases are small synthetic checks, including six known fixtures used during tuning. They do not establish broad reliability or measured market impact. Earlier failures remain part of the evidence.

Local report files:

- `output/gcp/baseten-evaluation-first.json`
- `output/gcp/baseten-evaluation-second.json`
- `output/gcp/baseten-evaluation-third.json`
- `output/gcp/baseten-unseen-results.json`

## Actual Figma-to-invoice flow

1. In Figma desktop, the plugin read the actual comment “Can you add the mobile checkout?” (comment `1978367271`) and exported the selected 1,200 × 982 desktop checkout frame (`5:2`).
2. The hosted backend sent the comment, supplied agreement and selected PNG to Baseten. Assessment `7e60b5ab-f24f-4c1e-b893-38bcd21c4a32` returned `new_work`, cited the desktop-only and additional-deliverable clauses, and selected `mobile_checkout`, quantity 1, $250. Latency: 681 ms.
3. The frame was attached and accepted. The model returned no design observations, so this run does not independently prove visual understanding or that the image affected its judgment.
4. The designer reviewed and submitted the proposal in the native plugin. The separate client page recorded explicit approval of revision 1 at 00:36:12 UTC.
5. That approved order (`3d1b634f-446b-4c49-abd1-4e4d7d535486`) created sandbox invoice `INV2-MR5K-GT4U-9TF7-Q36T`, for $250 USD, with “Work begins after payment.”

Three integration corrections were required:

- **Invoice date:** Supplying the UTC date shortly after midnight scheduled the invoice for the next day in the merchant's timezone. New invoices now omit the explicit date so PayPal chooses the merchant's current date. The existing invoice was corrected, preserving its approved items, amount and terms, and became payable. A regression test covers this boundary.
- **Buyer account:** The configured buyer address was not in the user's actual Sandbox Accounts list. It was incorrectly treated as verified during the handoff. The actual personal account `sb-4djfk53508124@personal.example.com` was verified in that list and successfully signed in. Local and hosted configuration were corrected, and the existing invoice recipient was updated with notifications disabled. Provider read-back confirmed the same $250 total and approved terms. No buyer password is stored in this document or committed configuration.
- **Recipient URL:** The adapter ignored `detail.metadata.recipient_view_url` and constructed an internal invoice route. It now preserves the authoritative URL and its opaque fragment through publication and payment refresh. A regression test verifies both paths. The live order now stores PayPal's returned `https://www.sandbox.paypal.com/invoice/p/#MR5KGT4U9TF7Q36T` URL.

Recipient updates use PayPal's documented [full invoice update](https://developer.paypal.com/api/invoicing/v2/invoices-update); the update is read back and checked against the original amount, currency, line items and terms.

At the latest provider read (00:55:06 UTC), the invoice was `SENT`, with $250 due; the application correctly displayed `payment_due`. The buyer checkout had not completed. In the controlled Edge session, the PayPal invoice page displayed the correct recipient and amount, but its payment button opened an empty popup and logged `prerender_initiate_payment_reject`. The same failure occurred with PayPal's authoritative recipient URL; correcting the URL did not prove checkout success. The buyer's activity independently showed the received invoice. A manual button check was requested to distinguish browser-control behavior from a failure visible to the user. No external-payment record or simulated paid event was used to bypass payment.

## Automated and deployment checks

- 34 automated tests passed on Windows and in the Linux image. They cover authorization, revision approval, invoice recovery, payment reconciliation, webhook parsing, reset/budget persistence, the Baseten request and usage contract, the invoice-date boundary, and the provider recipient URL. Provider fixtures remain distinct from live evidence.
- Deployed image configuration digest: `sha256:7297d12148612f62f96740815ae41d33ed18239f514ca458ba2349308c9a9f65`. The archive checksum was verified before loading. Compiled `assessment`, `aiBudget`, `baseten`, `env`, and `paypal` hashes match between local output and the running container.
- Public HTTPS health returned `ok: true`, no missing configuration, and sandbox mode. Both hosted services were active after the final update; the verified buyer address and unchanged budget allocation were read back from running configuration.
- The actual assessment, exact-revision approval and invoice association survived the image update on the persistent disk.
- At 00:55 UTC no signed PayPal callback receipt was present. A subscribed event or accepted resend is not proof of callback delivery or signature validation.

## Budget

The authenticated catalog quoted $0.60 per million input tokens and $2.40 per million output tokens. Accounting ignores cache discounts conservatively; output usage already includes reasoning, which is not charged twice. Calls reserve their bound before being issued. Unknown-cost failures retain their reservation.

After 22 Baseten calls, the hosted ledger recorded **$0.039855**, no active reservations, and **$24.120145** remaining from its $24.16 allocation. Prior local conservative usage/reservations remain **$0.837288**. Combined recorded consumption is **$0.877143**. This is application accounting, not a provider billing statement. Do not make new live calls against the old local database or reset either ledger to regain allowance.

## Remaining acceptance

- Complete actual sandbox buyer checkout, then verify PayPal's authoritative `PAID` state and zero amount due in both client page and native Figma plugin, including reopening the plugin.
- Observe a real signed callback and verify its processing independently of manual refresh.
- Implement and test the [judging-access plan](JUDGING-ACCESS-PLAN.md). Durable judge credentials, isolated judging runs and the final plugin download remain planned work.
- Finish the public submission materials and observed designer walkthroughs without inventing impact measurements.
