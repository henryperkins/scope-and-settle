# Implementation and verification — October 22, 2026

This continuation implements the adopted product decisions and the approved next steps. Earlier findings in `VERIFICATION-2026-10-22.md` are historical and remain preserved. This record separates application behavior, simulated providers and real provider observations.

## Implemented

- Server-enforced project, run and role authorization. Client sessions bind to one proposal revision. Invitation links are single-use, expiring and revocable.
- Immutable approved terms; baseline changes reject stale approval, and re-review produces a new approval context.
- Server-resolved rate-card pricing and clearly distinguished designer-set prices. An AI assessment without a matched rate requires explicit custom pricing, with no automatically filled amount.
- Invoice operation persistence, coalesced concurrent actions, reconciliation after uncertain creation, and resumption of the same invoice after failed publication.
- Invoice merchant, ID, currency and total validation before publishing a recovered draft and before accepting payment status.
- Verified-webhook handling, event deduplication, authoritative invoice retrieval, and tombstones for late events after a run reset.
- Persistent reserve-before-call AI budget, structured assessment contract, exact evidence-quote checks, optional image input and six-case evaluation runner.
- Shared browser/Figma designer UI, separate client approval page, manual clarification, frame export and persisted plugin session plumbing.
- Render Blueprint, non-root Docker runtime, persistent-disk configuration, MIT license and local/hosted setup instructions.

## Verification

| Layer | Observed result | Limit |
| --- | --- | --- |
| TypeScript + plugin bundle | Backend and plugin type checks and bundle passed | Native plugin execution is not established by compilation |
| Automated behavior tests | **24 passed, 0 failed, 0 skipped**, on Windows and Linux | Fresh temporary databases and simulated provider boundaries |
| Browser flow | Manual custom-price proposal ($370) → separate client session → approval → payment-due view; reload retained the revision | Explicitly labeled synthetic Figma/PayPal responses; no AI or real checkout |
| Latest browser price guard | Empty designer-set amount keeps submission disabled, with a visible request for a price | Same disposable provider-fixture mode; no live AI result |
| Docker persistence | Replacing a container on the same volume retained a session, order and AI-budget ledger; anonymous access denied; runtime UID 1000 | Local Docker, not a Render deployment; this smoke check preceded the final PayPal-response parser fix |
| Render Blueprint | Passed the current official JSON Schema validation | Dashboard/service creation has not occurred |
| Fresh Figma comment read | HTTP request succeeded; **zero comments**, October 22 around 20:25 UTC | The requested real demo comment is still missing |
| Existing sandbox invoice read | Existing $370 invoice remains UNPAID with $370 due; hosted payer URL returned | Its early-scaffold creation omitted merchant details, so current strict reconciliation rejects it |
| New sandbox draft | A single $1 verification draft exists as DRAFT; merchant email, currency and total match | It was not published or paid |
| Live AI | No successful model output; latest failure was HTTP 429 `credit_balance_exhausted` | No accuracy or latency claim can be made |

The fresh draft creation returned a top-level `{ rel, href, method }` object rather than the link-array fixture. The initial parser rejected it after PayPal had created the draft. We retrieved that **same** draft, confirmed its details, and added a failing regression before accepting the documented/observed response forms. No replacement draft was created for that error. Its reference is retained under ignored local evidence.

The first Docker build failed because the context included Windows-installed dependencies, which replaced the Linux installation. The build allowlist was corrected; the clean Linux build then passed. Local environment files, development databases and generated bundles are excluded from the current build context.

## Local evidence and preserved failures

These paths are ignored runtime artifacts, not public credentials or judging fixtures:

- `output/implementation-20261022-145301/source-before.zip`: source checkpoint before this continuation.
- `output/backups/scope-and-settle-2026-10-22T20-03-21.672Z.db`: consistent pre-change database backup.
- `output/evaluations/ai-2026-10-22T20-03-22.508Z.json`: initial model-access failure.
- `output/evaluations/ai-2026-10-22T20-04-40.032Z.json`: first rate/credit failure.
- `output/evaluations/ai-2026-10-22T20-05-07.059Z.json`: explicit exhausted-credit failure.
- `output/browser/client-payment-due.jpg`: client review with visible fixture labeling.
- `output/browser/unpriced-proposal.jpg`: required-price guard in the updated browser build.
- `output/container/verification.json`: Docker persistence checks.
- `output/provider-checks/draft-merchant-verification.json`: the actual new draft's redacted result.

Conservative local AI ledger consumption is $0.837288 from unsuccessful attempts; it is **not a statement of actual provider charges**. The app does not silently retry provider access failures. The user chose to add credits to the existing project; funding has not been confirmed.

## Still outstanding

1. Sign into Render, review the service estimate, set secrets and deploy; then verify the actual persistent mount and HTTPS callback.
2. Add an actual comment to the synthetic Figma file and run the generated plugin inside Figma desktop.
3. Complete real sandbox buyer payment against a correctly created invoice, receive/verify its event, and restore status in the plugin.
4. Restore OpenAI credit availability and complete the six-case evaluation, including semantic evidence review. Test one real frame image separately.
5. Arrange judging access that stays usable through the judging period, publish the under-three-minute video, and observe 2–3 designer walkthroughs. No impact metrics have been collected or invented.

The original local backend process has not been restarted. Automatic approval review previously rejected stopping/restarting that process with the reason **“blocked by policy.”** The process was left untouched. New source builds and isolated test servers do not prove that the older running process has loaded these fixes.
