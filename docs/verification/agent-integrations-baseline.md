# Agent integrations baseline

Recorded October 23, 2026, America/Chicago. Local source review and fixture tests only; no provider account, token, real database, deployment, paid inference or money movement was used for this baseline. Fresh official-document reads occurred on October 23 Chicago time (October 24 UTC). Historical provider observations retain their original dates and scope.

## Source and working-copy inventory

Implementation starts from **`68623c0c728faf657b885a319320a539cd9c83db`**, branch `codex/client-management-agent`, package version **0.3.0**, in the isolated worktree `C:/Users/htper/.codex/worktrees/ab1b/paypal-hackathon`. The primary checkout `C:/Users/htper/paypal-hackathon` is the older `06b9dd7` with intentional uncommitted work. Its implementation is not the baseline.

The controller captured primary status and SHA-256 fingerprints for **71 existing modified/untracked files** in `.superpowers/sdd/2026-10-23-agent-integrations-checklist/primary-status.txt` and `primary-fingerprints.json`. These local audit artifacts are not provider evidence or deployable source. Primary status at preflight:

| State | Paths |
| --- | --- |
| Modified | `.env.example`, `README.md`, `app/scripts/check-ai-access.mjs`, `app/scripts/evaluate-ai.mjs`, `app/src/backend/aiBudget.ts`, `app/src/backend/assessment.ts`, `app/src/backend/env.ts`, `app/src/backend/paypal.ts`, `app/tests/config.test.mjs`, `app/tests/helpers.mjs`, `deploy/gcp/prepare-runtime.mjs`, `docs/GOOGLE-CLOUD-DEPLOYMENT.md`, `docs/PRODUCT-SPEC.md` |
| Untracked files | `PAYPAL-API-CAPABILITIES.md`, `PAYPAL-REST-ENDPOINTS.csv`, `app/src/backend/baseten.ts`, `app/tests/baseten.test.mjs`, `app/tests/paypal-date.test.mjs`, `app/tests/paypal-links.test.mjs`, `docs/BASETEN-VERIFICATION-2026-10-23.md`, `docs/JUDGING-ACCESS-PLAN.md`, `docs/NATIVE-FIGMA-2026-10-22.md`, `docs/PAYMENT-LOOP-2026-10-22.md`, `docs/SCOPE-AND-SETTLE-SPEC.md`, `docs/SETUP-STATUS.md`, `docs/VERIFICATION-2026-10-22.md` |
| Untracked directories | `docs/superpowers/`, `research/` (the fingerprint inventory expands directories to individual files) |

At T01 start the isolated worktree had four untracked carry files: the two root PayPal inventories, `docs/SCOPE-AND-SETTLE-SPEC.md`, and `docs/superpowers/plans/2026-10-23-agent-integrations-checklist.md`. Existing 0.3.0 application code and current qualification records come from the baseline commit, rather than copied older dirty implementation files. The controller subsequently carried **43 public `research/` provenance/snapshot files unchanged** so the inventory's source links resolve. Future integration work depends on these inventories/provenance and the reconciled plan; it does not depend on unreviewed primary-checkout source edits. The consolidated specification is preserved with narrow current-status corrections. The controller also froze the baseline compiled application in the plan workspace's `prior-app/` for T02 rollback rehearsal; it is a local verification artifact.

The two historical dependencies linked by the consolidated specification were also carried unchanged: `docs/VERIFICATION-2026-10-22.md` and `docs/superpowers/specs/2026-10-22-scope-and-settle-design.md`. They preserve earlier records rather than adding current acceptance claims.

Carried inventory SHA-256 values, before T01 edits:

| File | SHA-256 |
| --- | --- |
| `PAYPAL-API-CAPABILITIES.md` | `45148E39E68C3DDA22DB8984A48909B5DB27CF69566B6049449266FFA02DE0B2` |
| `PAYPAL-REST-ENDPOINTS.csv` | `AA7F594BDDDF1B3C303C0B75F19A834A2D1BFAF875814C8B4F5C5CD8BC5F0225` |
| `docs/SCOPE-AND-SETTLE-SPEC.md` | `22F986996EEA1D488DA8CDEA747630B08E0A835848F5AB021F008DE6DC45AE8F` |

## Baseline tests and evidence boundaries

Fresh **`npm test`** in `app/` on Node **24.15.0**, npm **11.13.0**: **79 passed, 0 failed, 0 skipped**, before registry implementation. Command builds backend/plugin and runs all `tests/*.test.mjs`. Logs: plan workspace `task-1-baseline-test.log`. Providers in automated tests are fixtures and SQLite is isolated in temporary test directories. This reproduces the controller's earlier 79-test source result; the older primary checkout's 34-test run is a different source baseline.

T01 validation: new tests first produced **9 expected assertion failures** before the registry existed. After implementation, build and focused tests passed **9/9**; a fresh full `npm test` passed **88 tests, 0 failed, 0 skipped**. Logs: `task-1-red-test.log`, `task-1-build.log`, `task-1-green-test.log`, `task-1-full-test.log` in the same private plan workspace. Read-only validation matched all **15 selected PayPal contracts** to unique CSV method/path/operation/source rows, checked every fixture reference exists, and confirmed all **20 default entries disabled**. This validates local policy and provenance, not new provider access.

`docs/PRODUCT-SPEC.md` already reflects newer acceptance and required no edit. Older October 22 setup tables remain historical; they do not override newer records:

- [Signed callback investigation](../PAYPAL-WEBHOOK-DIAGNOSTIC-2026-10-23.md): actual original sandbox payment event, five signature headers, PayPal verification `SUCCESS`, durable reconciliation and restart persistence. A resend acceptance or manual refresh alone is insufficient; the recorded receipt and verifier result establish the callback claim.
- [Judge/native qualification](../JUDGING-VERIFICATION-2026-10-23.md): three actual sandbox payments with authoritative Paid/$0-due readback, real signed callbacks, independent run/access and native ZIP installation under a separate Figma account. Earlier experiments are retained as dated history.
- [0.3.0 qualification](../CLIENT-AGENT-VERIFICATION-2026-10-23.md): actual automatic quote, explicit client approval and one additional unpaid sandbox invoice; actual Figma comment read/write with the plugin closed; prior Paid/native persistence retained. The new unpaid invoice does not invalidate the three earlier payments and is not itself a completed payment.

These are inherited, bounded observations of earlier deployed versions. They are **not a deployment or release pass for changed Release A source**, current token introspection, broad merchant entitlement, arbitrary customer-file access or outside-designer validation.

## Registry and deployment contract

`app/src/backend/capabilities.ts` selects **20 operations**, not the entire 222-operation PayPal inventory. Each entry retains its exact method/path, official `sourceUrl`, contract `checkedAt`, PayPal `operationId`/CSV provenance or Figma source provenance, required role, approval and retry rule. `implemented` and `fixtureEvidenceRefs` distinguish adapter/workflow implementation and synthetic checks from observed provider access. Worker dependency fixtures test orchestration; they do not by themselves establish REST adapter access.

`getCapability(id, environment)` is read-only metadata. `documented`, `sandbox_verified` and `production_verified` are application evidence labels, never provider response values. `checkedAt` dates the contract review; `evidenceCheckedAt` separately dates the inherited access record. Unknown IDs, invalid runtime environments, inherited object-property names and operations outside this list remain disabled.

All default deployment flags are false. A deployment may explicitly construct `createCapabilityRegistry({ sandbox: [ids], live: [ids] })`; the copied flag set is independent of evidence. `enabled` additionally requires implementation and verified access for the exact environment. Listing an unknown/documented operation does not enable it. Sandbox evidence cannot enable live, even when a live flag is explicitly supplied. This registry has no production access evidence and exposes no tools/routes; current service authorization remains authoritative. It does not silently switch existing 0.3.0 workflows to new flags. Later consumers must check registry policy alongside scoped service authorization.

For Figma, `sandbox` means this application's configured **synthetic project** on the actual Figma service; Figma has no separate sandbox host in this contract. The conservative `sandbox_verified` label records this bounded access without implying live customer-file authority. Every access record carries `evidenceScope: configured_synthetic_project`. Live entries remain documented/unverified. No environment can expand a provider credential's or a user's actual resource permissions.

| Selected operations | Implemented / fixture evidence | Synthetic/sandbox access | Live customer/production access |
| --- | --- | --- | --- |
| PayPal invoice create/send/get | Existing adapter; orders/PayPal/webhook suites | Historical actual invoice and checkout records | Unverified; disabled |
| PayPal invoice search | Existing recovery adapter; orders fixtures | Unverified for this exact operation; documented | Unverified; disabled |
| PayPal invoice remind | Existing opt-in worker/adapter; worker and OAuth-race fixtures | Unverified for actual provider delivery | Unverified; disabled |
| PayPal invoice cancel | Not implemented; no fixture claim | Unverified | Unverified; disabled |
| PayPal signature verification | Existing verifier; webhook fixtures | Historical actual signed callbacks, not simulation | Unverified; disabled |
| Figma comment read/write | Existing adapter and worker orchestration fixtures | Historical actual configured-file read/reply | Unverified outside synthetic project; disabled |
| Figma REST context nodes | Not implemented; native plugin export is a different operation | Unverified for this REST route | Unverified; disabled |
| Figma webhook create/get | Not implemented; no fixture claim | Unverified | Unverified; disabled |
| PayPal product create, plan create, subscription create/get/cancel | Later scope; not implemented | Unverified separately from invoicing | Unverified; disabled |
| PayPal Payments v2 refund create/get | Later scope; not implemented | Unverified; invoice transaction-to-capture association unknown | Unverified; disabled |
| PayPal invoice refund record | Later scope; bookkeeping only, no money movement | Unverified separately from a real refund | Unverified; disabled |

## Figma access

| Requirement | Checked evidence / remaining boundary |
| --- | --- |
| Plan and seat | Historical [judging file record](../FIGMA-JUDGING-FILE.md) used Starter access. At 2026-10-24 05:06:56 UTC, after the user reported purchasing a Dev seat, the connected official Figma `whoami` tool confirmed Professional/Dev/admin on the user's main team, with Code Layers enabled there. The separate Scope & Settle Judging team still reported Starter/View/admin, with Code Layers disabled there. Seat evidence is team-specific; target-file ownership and connector entitlement require their own checks. No billing or file setting was changed. |
| File edit and native plugin | Separate verified account edited the designated synthetic frame and reverted it; exact ZIP installation, frame export, refresh and reopen passed. Owner access alone was not used as independent proof. |
| `file_comments:read` / `file_comments:write` | Official scope contract plus actual configured-file comment read/reply in 0.3.0 record. No new token inspection; these checks do not grant other-file access. |
| `file_content:read` | [File endpoints](https://developers.figma.com/docs/rest-api/file-endpoints/) and [scopes](https://developers.figma.com/docs/rest-api/scopes/) read October 23 Chicago / October 24 UTC. `GET /v1/files/:key/nodes` requires this scope. Actual REST access is unverified; Plugin API export is separate. |
| `webhooks:read` / `webhooks:write` | [Webhook endpoints](https://developers.figma.com/docs/rest-api/webhooks-endpoints/) and scopes read October 23 Chicago / October 24 UTC. Create `POST /v2/webhooks`, inspect `GET /v2/webhooks/:webhook_id`; configured passcode and allowed context require verification. No account scope, plan eligibility, subscription or delivery was tested. |
| Custom MCP connector | Official connector reference is preserved in the plan. Availability for this account/seat/client, authentication, transport, tool discovery and actual invocation remain unverified and disabled. Existing connected Figma development tools do not establish that this application is a supported official Figma MCP client. |

Fresh source review did not create Figma comments or webhooks. Existing real comment evidence is inherited from the linked dated qualification. [Figma scopes](https://developers.figma.com/docs/rest-api/scopes/) explicitly preserve resource permissions and treat official MCP client access separately from REST scope setup.

## Unverified access

The October 22 [PayPal inventory](../../PAYPAL-API-CAPABILITIES.md) and [CSV](../../PAYPAL-REST-ENDPOINTS.csv) are documentation research: **222 operations from 16 published specifications**, with no entitlement testing in that research. Their historical disclaimer is retained; later specific invoicing evidence above is a distinct record. PayPal contract dates in the registry remain October 22; they were not falsely redated as a fresh online check.

Later product checks must separately establish sandbox **and** production access for Catalog Products, subscription plans/subscriptions, Payments v2 refunds and invoice-refund bookkeeping. An existing REST app, invoice OAuth token or successful sandbox checkout establishes none of those entitlements. Validate the actual refundable resource and merchant permissions before implementing money movement: an invoice transaction ID is not automatically a capture ID. Invoice `/refunds` records external bookkeeping and cannot serve as proof of a real refund. Broader deferred products such as Orders, vaulting, payouts, usage-based billing, disputes and partner onboarding remain outside the bounded registry and disabled; their inventory documentation is not verified access.

Before later feature enablement, record the exact operation, account/resource/environment, independently observed result, date and sanitized evidence reference. Preserve documented/fixture/access/deployment distinctions and obtain authorization for the actual external action. No secrets, role links, real database contents or raw provider payloads belong in this record.
