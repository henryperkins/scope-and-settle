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
- Non-root Docker runtime, persistent-disk configuration, MIT license and local/hosted setup instructions. Google Cloud is the selected deployment; the Render Blueprint is retained as an unused alternative.

## Verification

| Layer | Observed result | Limit |
| --- | --- | --- |
| TypeScript + plugin bundle | Backend and plugin type checks and bundle passed | Native plugin execution is not established by compilation |
| Automated behavior tests | **26 passed, 0 failed, 0 skipped**, on Windows and Linux | Fresh temporary databases and simulated provider boundaries |
| Browser flow | Manual custom-price proposal ($370) → separate client session → approval → payment-due view; reload retained the revision | Explicitly labeled synthetic Figma/PayPal responses; no AI or real checkout |
| Latest browser price guard | Empty designer-set amount keeps submission disabled, with a visible request for a price | Same disposable provider-fixture mode; no live AI result |
| Docker persistence | Replacing a container on the same volume retained a session, order and AI-budget ledger; anonymous access denied; runtime UID 1000 | Local Docker, not a Render deployment; this smoke check preceded the final PayPal-response parser fix |
| Render Blueprint | Passed the current official JSON Schema validation | Dashboard/service creation has not occurred |
| Fresh Figma comment read | HTTP request succeeded; **zero comments**, October 22 around 20:25 UTC | The requested real demo comment is still missing |
| Existing sandbox invoice read | Existing $370 invoice remains UNPAID with $370 due; hosted payer URL returned | Its early-scaffold creation omitted merchant details, so current strict reconciliation rejects it |
| New sandbox draft | A single $1 verification draft exists as DRAFT; merchant email, currency and total match | It was not published or paid |
| Live AI | No successful model output; latest failure was HTTP 429 `credit_balance_exhausted` | No accuracy or latency claim can be made |
| Google Cloud hosting | One private e2-micro in us-central1-a, separate 10 GB data disk, HTTPS tunnel, required OS Login | Small single-VM demonstration; no high-availability claim |
| Hosted access and persistence | HTTPS health succeeded; three anonymous API paths denied; unsigned webhook denied; designer approval denied; session/proposal/budget settings retained after app restart | Live provider paths, fresh synthetic database; no model call |
| Hosted sandbox invoice | Manual synthetic $250 change order approved by a revision-bound demo client session, invoice published with notifications disabled; repeated approval returned the same invoice | Actual sandbox invoice is unpaid; this is not an AI assessment, human-client study, or buyer checkout |
| Hosted webhook subscription and resend | Nine invoice events subscribed; PayPal lists the invoice's CREATED and UNPAID events and accepted two resends with HTTP 202 at 21:49 UTC | No signed callback recorded by the 21:52 UTC check; provider event records and accepted resends do not prove delivery |

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

1. Observe a real PayPal notification reaching the registered Google Cloud callback and being signature-verified. HTTPS routing, unsigned-event rejection and webhook subscription have been verified; no delivery has been observed yet.
2. Add an actual comment to the synthetic Figma file and run the generated plugin inside Figma desktop.
3. Complete real sandbox buyer payment against a correctly created invoice, receive/verify its event, and restore status in the plugin.
4. Restore OpenAI credit availability and complete the six-case evaluation, including semantic evidence review. Test one real frame image separately.
5. Arrange judging access that stays usable through the judging period, publish the under-three-minute video, and observe 2–3 designer walkthroughs. No impact metrics have been collected or invented.

The original local backend process has not been restarted. Automatic approval review previously rejected stopping/restarting that process with the reason **“blocked by policy.”** The process was left untouched. New source builds and isolated test servers do not prove that the older running process has loaded these fixes.

## Google Cloud deployment evidence

See [deployment instructions](GOOGLE-CLOUD-DEPLOYMENT.md). Ignored `output/gcp/` records the resource configuration, archive checksum and image identity, real hosted request checks, restart result, and sandbox invoice ID. The private subdirectory contains access links, deployment environment files and recovery material and must not be published.

The initial VM requests were rejected by organization policies requiring OS Login and prohibiting external VM IP addresses. The final VM complies with both: it uses IAP for administration, Cloud NAT for outbound access, and a named Cloudflare Tunnel for HTTPS. No policy was weakened. An existing Cloud Connector routed new subdomains to an assets bucket; only this hostname was added to its exclusions. Rocket Loader was also disabled only for this hostname to preserve native module loading.

The container export matched its SHA-256 checksum after transfer. Docker Desktop reported an OCI descriptor ID while the VM's Docker reported the image configuration ID. The archive configuration digest and every root-filesystem layer matched the loaded image; the service is pinned to that configuration ID.

The real Invoicing events returned by PayPal's notification API contain `resource.invoice.id`. The prior fixture used `resource.id`. Regression tests first failed for nested-event reconciliation, replay of a previously ignored event, and nested tombstones; the adapter now handles both forms without changing signature verification or authoritative invoice retrieval. Previously ignored events with no recognized invoice can be retried once and are then deduplicated normally. Webhook logs contain event ID and processing state only, without payloads or signatures. All 26 tests passed on Windows and Linux after this fix. The updated image is deployed; changed module hashes match the local compiled output, and the existing session, proposal, invoice and budget survived redeployment. This API payload observation alone does not establish successful callback delivery.
