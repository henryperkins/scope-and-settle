# Scope & Settle Agent Integrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The user subsequently authorized reconciliation and implementation of the full roadmap. Work proceeds A through D as reviewable local increments; publication, deployment, paid provider actions and external acceptance retain their separate gates.

**Goal:** Extend Scope & Settle from a single-request change-order demo into a workflow covering accumulated scope, Figma agent access, payment operations, delivery milestones, and eventually recurring studio engagements.

**Architecture:** Keep the Node backend as the authority for scope, pricing, approval, and payment records. Add focused domain services used by both the existing plugin/browser interface and a custom MCP adapter; use durable SQLite jobs for provider events and reconciliation. Keep one process per database until a separately tested deployment change requires more.

**Tech Stack:** Node.js `>=24.0.0 <25`, TypeScript, `node:sqlite`, vanilla browser JavaScript, Figma Plugin/REST APIs, PayPal sandbox APIs, Baseten Model API, and an MCP SDK version selected and pinned during T11.

**Spec:** [Current product contract](../../PRODUCT-SPEC.md), [consolidated specification](../../SCOPE-AND-SETTLE-SPEC.md), [judging-access plan](../../JUDGING-ACCESS-PLAN.md), and the extension requirements below. Current verification records supersede historical acceptance claims in older specifications. Releases B-D are proposed extensions to v1, not claims about existing behavior or verified provider access.

**Planning date:** 2026-10-23. Reconciled against source `68623c0c728faf657b885a319320a539cd9c83db` (0.3.0). The older primary checkout at `06b9dd7` is preserved; implementation uses a separate checkout of the newer source. Existing judging access, plugin packaging, approved automatic quoting, and dated signed-callback/native acceptance are retained. A changed candidate requires its own deployment verification.

**Current source authority:** [Client agent product contract](../../PRODUCT-SPEC.md) and [0.3.0 qualification](../../CLIENT-AGENT-VERIFICATION-2026-10-23.md). Older specifications describe the earlier manual-review workflow. Existing automatic quoting requires an explicit designer-approved rate/limit policy, canonical terms and full coverage; exceptions require individual review. The client still explicitly approves the exact revision before invoicing. This batch preserves that policy.

## Global constraints

- Preserve the current contract: the designer explicitly approves rates and limits for automatic canonical quotes, or individually reviews exceptions. The client explicitly approves that exact proposal revision before invoice creation. AI cannot approve or invoice anything. Backend policy and authenticated human actions authorize execution.
- Preserve: “Approved/invoiced terms are immutable. A baseline change invalidates pending approval until designer re-review. Never silently rebase.”
- Preserve: “An absent mobile frame never proves scope exclusion.”
- Preserve the existing Baseten provider, exact model `deepseek-ai/DeepSeek-V4.1-Flash-1017-Fast`, and `AI_REASONING_EFFORT=max`. A provider/model change is a separate decision.
- Preserve the total $25 development allowance across allocated local/hosted ledgers, prior consumption, and reservations. Tests use isolated fake providers; paid evaluation uses the designated existing ledger and remaining allocation.
- Keep demo content synthetic, amounts in integer USD cents, provider credentials server-side, and exact provider recipient URLs intact. Multi-currency support is a separate extension.
- Preserve invoice identity, exact-revision approval, uncertain-create reconciliation, reset tombstones, and the AI budget ledger through migrations and retries.
- Work begins after the agreed payment condition. A milestone schedule can change that condition only through a new explicitly approved revision; the application does not restrict Figma editing access.
- Keep documented capability, account access, simulated tests, actual sandbox transactions, deployed behavior, and production readiness as separate evidence categories.
- Preserve unrelated dirty/untracked work. Use an isolated implementation checkout when appropriate, carrying only the reviewed dependency set. Do not commit, publish, deploy, or spend against a new allowance merely because this checklist exists.

## Extension requirements and release boundaries

| Release | Outcome | Tasks | Dependencies / exit condition |
| --- | --- | --- | --- |
| A — dependable foundation | Complete payment lifecycle, recoverable events, independent judging access | T01-T05 | Existing demo still works; real signed PayPal callback and fresh-user journey verified |
| B — scope-aware Figma agent | Project scope history, mixed requests, comment inbox, custom MCP connector, linked canvas status | T06-T13 | A passes; Figma access checks pass; held-out scope evaluation passes |
| C — payment through delivery | Milestones, delivery briefs, client acceptance, evidence exports | T14-T17 | B passes; exact-revision payment and delivery rules remain enforced |
| D — recurring studio product | Real accounts, connected projects/merchants, retainers, reporting | T18-T22 | C passes; identity/tenant isolation and feature-specific PayPal access verified before real customer use |

Implement each release as an independently reviewable increment. Expand a task into a separate subsystem plan when implementation choices exceed its stated interface; do not make all four releases one deployment prerequisite. Recommended first implementation batch: T01-T05.

### Coverage of the recommended features

| Recommendation | Checklist coverage |
| --- | --- |
| Accumulated project scope and acknowledged brief | T06-T08 |
| Figma native agent integration | T02, T11-T12 |
| Background request inbox and clarification | T09-T10 |
| Complete invoicing lifecycle | T03-T04, T10, T21 |
| Milestones and delivery | T14-T16 |
| Retainers and approved overages | T19-T20 |
| Delivery/dispute evidence | T17, T21 |
| Studio accounts and merchant connections | T18, T22 |
| PayPal capability registry | T01 |
| Reproducibility and model quality | T05, T13, release gates |

## Review focus

These failure modes must have explicit tests in their owning tasks:

1. A repeat or paraphrased request concerns work already approved: show the prior commitment and create no duplicate proposal automatically — T07.
2. Payment succeeds while a callback is delayed, duplicated, or races a reset: retrieve provider truth, retain the correct invoice, and leave reset records tombstoned — T04.
3. A frame, comment, approval, MCP token, or job belongs to a different project/run: reject the association before exposing evidence or causing effects — T02, T08, T11, T18.
4. Scope, price, or milestone terms change after a review link is issued: old approval and confirmation links cannot authorize the changed revision — T06, T12, T14-T16.
5. A renewal or payment reversal arrives late: preserve historical delivery facts, avoid granting allowance twice, and display financial review separately — T03, T19-T20.

## Verification convention

Paths below are relative to the repository root. New files are proposed, not present yet. Run application commands from `app/` using Node 24.

For a behavior task, first add its named regression cases, build, and run the focused test file; verify a meaningful assertion fails before implementing the new behavior. After implementation, rebuild and run the focused tests. At each release gate, run the existing full command:

```powershell
npm test
```

For example, the T03 focused cycle will use these commands after its test file exists:

```powershell
npm run build
node --test tests/payment-state.test.mjs tests/paypal.test.mjs tests/paypal-links.test.mjs
```

A passing mocked-provider test does not satisfy a live-provider gate. Record actual pass/fail/skip counts rather than assuming the historical 34-test count remains current. Documentation-only tasks require link/path and diff review, not new application tests.

Maintain sanitized release evidence in `docs/verification/agent-integrations-<release>-<date>.md`: source identity, environment, timestamp, checks, observed results, and unresolved limits. Keep raw private artifacts in ignored `output/`; do not include role tokens, credentials, or unredacted provider payloads in committed reports.

## Release A — dependable foundation

### T01 — Record the baseline and a bounded capability registry

**Depends on:** none.
**Files:** create `docs/verification/agent-integrations-baseline.md`, `app/src/backend/capabilities.ts`, `app/tests/capabilities.test.mjs`; consult the two root PayPal inventory files; update stale acceptance statements in `docs/PRODUCT-SPEC.md` and `docs/SCOPE-AND-SETTLE-SPEC.md` without rewriting historical records.
**Interface:** `getCapability(id: string, environment: "sandbox" | "live"): Capability`; `Capability` records `id`, `provider`, `method`, `path`, `sourceUrl`, `checkedAt`, `evidenceStatus`, `evidenceRef`, `requiredRole`, `approvalRule`, and `retryRule`. `evidenceStatus` is `documented`, `sandbox_verified`, or `production_verified`; these are application metadata, not provider response values. Deployment enablement is an explicit separate setting.

- [x] Record the current dirty/untracked inventory and the exact source used for the baseline; identify which existing uncommitted changes future work depends on.
- [x] Run `npm test`; record current results. Reconcile outdated “payment outstanding” and “webhook outstanding” statements with dated payment and signed-callback evidence in the newer checkout. Historical records stay intact; existing evidence does not verify this changed candidate.
- [x] Add registry entries only for the selected invoice create/send/get/search/remind/cancel, webhook verification, Figma comment/context/webhook, and later subscription/refund operations. Preserve inventory provenance; do not automatically expose all 222 operations as tools.
- [x] Add tests `unknown capability is disabled`, `documented is not verified access`, and `sandbox evidence does not enable live`; implement the registry and explicit feature enablement.
- [x] Record Figma seat/plan, file edit access, comment-write/webhook scopes, and custom-connector availability as checked or unverified. Record each later PayPal product's sandbox and production access separately.

**Verify:** `node --test tests/capabilities.test.mjs` after build; read the sanitized baseline record. **Done:** the team can identify which operations are implemented, tested with fixtures, or actually accessible without consulting secrets.

### T02 — Establish scoped service interfaces and safe migrations

**Depends on:** T01.
**Files:** create `app/src/backend/context.ts`, `app/src/backend/changeOrderService.ts`, `app/src/backend/migrations.ts`, `app/tests/service-scope.test.mjs`, `app/tests/migrations.test.mjs`; modify `app/src/backend/server.ts`, `orders.ts`, `db.ts`, `sessions.ts`, and `app/src/shared/types.ts`.
**Interfaces:** `ActorContext = { projectId: string; runId: string; role: "designer" | "client"; actorId: string; grant: ResourceGrant }`; `actorId` is a server-derived demo actor reference until T18 adds real identity. `ResourceGrant` contains `kind`, `resourceId`, and `revision`; initially support designer `project` grants and client `change_order` grants bound to the existing session's order and revision. T06, T16, and T20 add distinct `scope`, `delivery`, and `retainer_work` grants. Add `getScopedOrder(ctx: ActorContext, orderId: string): ChangeOrderView`, `draftChangeOrder(ctx, input: DraftChangeOrderInput): ChangeOrderView`, and `getSettlement(ctx, orderId: string): Promise<ChangeOrderView>`. Define `DraftChangeOrderInput` from the existing validated proposal fields. These wrap existing order logic; callers never supply merchant credentials or trusted actor fields.

- [x] Add tests rejecting cross-run/project reads, another order within the same client's run, wrong-revision access, wrong-role writes, and forged actor fields; run them before extracting the shared service boundary.
- [x] Route existing change-order HTTP handlers through scoped services, including list, edit, submit, approve, invoice and client-access issuance. Bind trusted context to server-side session provenance; revalidate after awaited operations before exposing scoped results. Preserve the existing separate portal/policy authority and frozen per-run project snapshots.
- [x] Introduce recorded, ordered schema migrations and migration tests using isolated database copies. Include import-time assessment, AI ledger, webhook and agent tables as well as judge/grant tables. Preserve all existing approved snapshots, invoice associations, tombstones, sessions, and AI ledger values. Fail on real migration errors rather than treating every ALTER error as an existing column.
- [x] Exercise backup/restore on a disposable fixture database using the existing backup script. Restore the prior application with its matching backup as a recovery rehearsal; do not assume every schema migration is backward compatible.

**Verify:** build, then `node --test tests/service-scope.test.mjs tests/migrations.test.mjs tests/orders.test.mjs tests/http.test.mjs`. **Done:** the current HTTP flow has unchanged approval/payment behavior and a reusable, scoped boundary for MCP and jobs.

### T03 — Preserve line items and model financial outcomes explicitly

**Depends on:** T02.
**Files:** create `app/src/backend/paymentState.ts`, `app/tests/payment-state.test.mjs`; modify `app/src/backend/paypal.ts`, `orders.ts`, recorded migrations as needed, `app/src/shared/types.ts`, `app/web/common.js`, `designer.js`, `review.js`, and `app/tests/helpers.mjs`. Include the newer `agentPortal.ts`, `agentWorker.ts`, `judgeAccess.ts`, `judging.ts` and `app/web/client.js` wherever financial-state changes affect published quote visibility, renewal, payment actions or previously paid work.
**Interface:** `deriveFinancialState(detail: InvoiceDetail, approved: ApprovedInvoiceTerms): FinancialState`. Define `ApprovedInvoiceTerms` with merchant, currency, total, and approved line items. `FinancialState` separates invoice state (`draft`, `scheduled`, `payable`, `closed`, `cancelled`, `unknown`) from payment state (`not_started`, `due`, `pending`, `partial`, `paid`, `partially_refunded`, `refunded`, `review_required`, `unknown`) and retains the raw provider status, due amount, and observation time. `closed` describes an invoice with no further payment action; it does not imply an unreversed successful payment. Add `ChangeOrderView.approvalStatus` (`draft`, `awaiting_client_approval`, `needs_re_review`, `approved`) derived from proposal/approval records independently of these financial fields. Map normalized states from verified provider contracts; unknown values remain unknown.

- [x] Add provider-fixture cases for two distinct approved items, partial payment, cancellation, full/partial refund, inconsistent PAID amounts, unknown status, and a later reversal after payment. Assert approval history survives every outcome.
- [x] Pass approved item descriptions, quantities, unit amounts, currency, and revision reference into invoice creation; verify the resulting total in integer cents. Update the fake provider to sum all items rather than using its current first-item shortcut.
- [x] Stop projecting every non-paid outcome to actionable `payment_due`. Keep an explicit compatibility mapping for existing consumers while updating both UIs to the new financial fields.
- [x] Offer the payment action only for an invoice state that supports payment; show unknown/mismatched results as requiring review. Preserve PayPal's opaque recipient URL and merchant-date behavior.
- [x] Serialize authoritative retrieval per invoice/order so a delayed manual refresh cannot overwrite a newer job/refund/reversal observation. Test reset while a retrieval is pending.
- [x] Preserve read/renewal access to an approved revision after cancellation/refund/reversal; these outcomes do not revoke approval or hide its portal quote. Update the portal as well as designer/review views so an earlier Paid activity label cannot contradict a later financial observation.
- [x] Version invoice representation locally: new itemized invoices validate exact approved items and revision reference; existing aggregate invoices retain their recorded representation without retroactively requiring fields that were never sent. A new invoice cannot downgrade to legacy validation because provider fields are missing.

**Verify:** focused payment, invoice, date, URL, and UI checks. Example invariant: `assert.equal(cancelled.invoiceState, "cancelled")`; `assert.equal(cancelledOrder.approvalStatus, "approved")` after adding `approvalStatus` to the shared contract. **Done:** each supported outcome has an accurate display and permitted action without altering approved terms.

### T04 — Add durable reconciliation and prove actual callback processing

**Depends on:** T03.
**Files:** create `app/src/backend/jobs.ts`, `app/tests/jobs.test.mjs`; modify `app/src/backend/webhooks.ts`, `server.ts`, `db.ts`, `app/tests/webhooks.test.mjs`, and deployment verification documentation.
**Interfaces:** `enqueueJob(input: { key: string; kind: JobKind; projectId: string; runId: string; payload: unknown; dueAt: string }): string`; `runDueJobs(now: Date): Promise<JobRunSummary>`. Define `JobKind` initially as `paypal_reconcile`; T09 adds `figma_refresh` and `scope_assess`. `JobRunSummary` contains completed, retried, and failed counts. Persist unique keys, attempts, due time, and lease expiry; never hold a SQLite transaction over a network call.

- [x] Test duplicate events, process restart between receipt and retrieval, expired job leases, provider 429/5xx, unmatched invoices, and reset racing a pending job.
- [x] Verify PayPal signatures before accepting an event for processing. Atomically persist the receipt and reconciliation job, then acknowledge; jobs retrieve the authoritative invoice through the same validation path as manual refresh.
- [x] Use bounded retry scheduling, honor provider retry guidance, expose exhausted jobs for recovery, and add periodic reconciliation for unresolved invoices. Retries must not issue a new invoice or repeat paid AI calls.
- [x] Start recovery/polling with the server, coalesce overlapping loops, stop scheduling on shutdown, and record scheduler failures. Prove that a persisted receipt/job executes after a fresh process start without a new incoming webhook.
- [x] Keep automatic recovery for previously unmatched invoices possible when their local association appears; reset tombstones remain terminal for old-run effects.
- [ ] On the hosted sandbox service, correlate a real provider event with callback arrival, successful signature verification, durable processing, invoice retrieval, and correct UI state. Record automatic processing separately from manual refresh; investigate delivery configuration if any link is absent.

**Verify:** `node --test tests/jobs.test.mjs tests/webhooks.test.mjs` after build, plus sanitized hosted evidence. **Done:** one real signed event completes the processing chain; duplicates/restarts do not duplicate financial effects. HTTP 202 from a resend request is not the completion check.

### T05 — Make independent judging access reproducible

**Depends on:** T02 and T04.
**Local reconciliation:** Existing implementation reused and covered by the 217-test aggregate suite, real browser fixtures, official judging-date recheck and disposable recovery rehearsal. A changed candidate ZIP/native/hosted walkthrough remains an external gate.
**Existing implementation:** 0.3.0 already contains `judging.ts`, `judgeAccess.ts`, entry/renewal/reset routes, prebuilt packaging, and judging regression suites. Reuse and verify these; do not replace them with a second credential/run system. Dated live evidence is in [judging verification](../../JUDGING-VERIFICATION-2026-10-23.md). The modified candidate's live acceptance remains a separate release gate.
**Files:** create `app/src/backend/judging.ts`, `app/web/judge.html`, `app/web/judge.js`, `app/tests/judging.test.mjs`, `app/scripts/package-plugin.mjs`, and `JUDGING.md`; modify `sessions.ts`, `server.ts`, `db.ts`, plugin session handling, and `docs/JUDGING-ACCESS-PLAN.md`.
**Interface:** `startJudgeRun(entryCredential: string): JudgeRunAccess` and `resumeJudgeRun(resumeCredential: string): JudgeRunAccess`; define `JudgeRunAccess` as run ID plus bounded role access, with no provider credentials. Store revocable resume/entry credential digests; ordinary sessions retain bounded expiry.

- [x] Add tests for independent runs, expiry/renewal, revocation, obsolete client revisions, shared-brief mutation attempts, and one run resetting while another invoices. Existing implementation reused and included in the local Release A gate.
- [x] Implement `/judge` entry and run-specific renewal using the existing judging-access plan. Judges cannot edit a shared baseline or regain access to revoked revisions through renewal. Existing implementation reused.
- [ ] Package a versioned prebuilt plugin with its intended hosted origin and checksum; add installation, recovery, and browser fallback instructions.
- [ ] Recheck the official judging window before setting credential expiry; test the designated Figma file from another account. Existing dates in project docs are planning inputs until rechecked.
- [ ] Complete comment -> live assessment -> review -> client approval -> actual sandbox checkout -> Paid -> plugin reopen from a fresh browser/plugin session, then repeat with a second isolated run.

**Verify:** `node --test tests/judging.test.mjs tests/http.test.mjs` after build and the independent hosted walkthrough. **Release A gate:** full `npm test`, real callback proof, restart persistence, and a fresh-user walkthrough pass with remaining limits recorded.

## Release B — scope-aware Figma agent

Implementation decisions and compatibility requirements: [Release B execution supplement](2026-10-23-release-b-execution.md). Local implementation proceeds while disabled capabilities retain their external access gates.

### T06 — Version the project scope and record explicit acknowledgement

**Depends on:** Release A.
**Files:** create `app/src/backend/scopeLedger.ts`, `app/tests/scope-ledger.test.mjs`; modify `db.ts`, `assessment.ts`, `orders.ts`, `server.ts`, shared types, and the designer/client interfaces.
**Interfaces:** `getScopeContext(ctx: ActorContext): ScopeContext`; `acknowledgeScope(ctx, snapshotId: string): ScopeAcknowledgement`. Define `ScopeContext` with immutable baseline/rate-card versions, provenance, acknowledgements, approved changes, and delivery references. A scope acknowledgement is distinct from a proposal approval and requires a client `scope` grant for that exact snapshot. T20 adds accepted retainer-work commitments to this context.

- [x] Test baseline edits after links are issued, old approvals remaining immutable, supplied-but-unacknowledged briefs, and acknowledgement of the wrong snapshot.
- [x] Persist immutable scope and rate-card versions; store the exact versions on assessments and approvals. Do not fabricate historical acknowledgements during migration.
- [x] Add a client review step for acknowledging an original scope snapshot and display its provenance and acknowledgement state.
- [x] Include existing approved additions in assessment context without silently rewriting the original agreement; pending, cancelled, superseded, and refunded records keep their separate meanings.

**Verify:** `node --test tests/scope-ledger.test.mjs tests/orders.test.mjs` after build; inspect two differently versioned client views. **Done:** every assessment can identify which agreed commitments it considered.

### T07 — Assess mixed requests and recognize existing commitments

**Depends on:** T06.
**Files:** create `app/src/backend/requestItems.ts`, `app/tests/request-items.test.mjs`, `fixtures/scope-request-items.json`; modify `assessment.ts`, shared types, `app/web/proposal.js`, `designer.js`, and proposal tests.
**Interfaces:** `AssessmentItem` has a server-assigned ID, requested deliverable, classification, clause evidence, rate references, questions, and optional existing-commitment reference. `assessRequest(ctx, input: { commentId: string; evidenceSnapshotId?: string }): Promise<RequestAssessment>` fetches the comment through the existing Figma adapter and returns items and immutable context references; T08 supplies optional design snapshots. `reserveProposalItems(ctx, itemIds: string[], operationId: string): ProposalReservation` transactionally binds selected eligible items to a proposal and prevents a second active binding. Persist request-item identities across reassessments; a new model response must not reset a prior reservation.

- [x] Add cases for a request mixing an included correction and excluded mobile work; ambiguous items must remain unpriced while the clear items can be reviewed independently.
- [x] Add cases for repeated assessment of the same comment, concurrent draft creation, a paraphrase of an approved addition, and reopened work after cancellation. Exact duplicate prevention is deterministic; semantic matches are reviewable suggestions.
- [x] Change structured generation/validation to per-item evidence and pricing. Quotes must resolve to server-identified scope clauses or immutable approved-change records. The server resolves rate IDs and computes totals; the designer chooses which eligible items enter the proposal.
- [x] Link already committed work to its original record. Require an explicit designer decision before treating a suspected duplicate as distinct additional work; record that decision.

**Verify:** `node --test tests/request-items.test.mjs tests/ai.test.mjs tests/proposal.test.mjs` after build. Assertions include zero priced items for included/ambiguous work and one active proposal reservation when two concurrent requests target the same item. **Done:** mixed requests can be handled without billing the whole comment as one category.

### T08 — Bind design evidence to the correct file, nodes, and time

**Depends on:** T06-T07.
**Files:** create `app/src/backend/designEvidence.ts`, `app/tests/design-evidence.test.mjs`; modify `app/plugin/code.ts`, `app/src/backend/figma.ts`, `server.ts`, `assessment.ts`, shared types, and `app/web/designer.js`.
**Interface:** `captureDesignEvidence(ctx, input: DesignEvidenceInput): Promise<DesignEvidenceSnapshot>`; define input with file key, node IDs, capture time, bounded selection metadata and optional PNG. The snapshot records server-verified file/node references, available version metadata, hash, and collection provenance. A plugin PNG is a client-supplied snapshot, not independently verified rendering evidence.

- [x] Test a frame from the wrong file, inaccessible/deleted nodes, oversized inputs, stale captures, and a comment whose anchor differs from the selected frame.
- [x] Include bounded selected text, component references, node IDs, and layout metadata where useful; fetch authoritative node/file information with the required read scopes. Adapter/fixture proof is local; actual target-file REST access remains an external gate.
- [x] Show the relationship between comment and selected evidence; require explicit selection of relevant context when anchors differ, rather than silently treating them as the same node.
- [x] Preserve immutable evidence references on each assessment and surface age/version information. Reusing a cached assessment requires identical request, scope, rate, commitment, model/prompt, and evidence fingerprints.

**Verify:** `node --test tests/design-evidence.test.mjs` after build, then a native Figma selection/export check. **Done:** the reviewer can trace every visual observation to an identified snapshot and see its limits.

### T09 — Build the background project inbox

**Depends on:** T04, T07-T08; Figma webhook access verified in T01.
**Files:** create `app/src/backend/figmaWebhooks.ts`, `app/src/backend/requestInbox.ts`, `app/tests/figma-webhooks.test.mjs`, `app/tests/request-inbox.test.mjs`; modify `jobs.ts`, `server.ts`, `db.ts`, `figma.ts`, and the designer interface.
**Interfaces:** `receiveFigmaEvent(payload: unknown): Promise<EventReceipt>`; `refreshRequestThread(ctx, commentId: string): Promise<RequestThread>`; `listRequestInbox(ctx): RequestThread[]`. Define thread state as `unreviewed`, `needs_clarification`, `ready_for_review`, or `linked_to_change_order`, with authoritative comment/reply references.

- [x] Verify the webhook passcode and configured file/project association before queuing a refresh. Use Figma's documented passcode mechanism; do not assume PayPal's signature scheme applies. Actual subscription/delivery access remains an external gate.
- [x] Deduplicate deliveries and group direct replies; refresh authoritative comments before assessment. Ignore self-authored notification loops and unrelated lifecycle events.
- [x] Default automatic paid assessment off. Add an explicit project setting and budget/concurrency checks before queuing `scope_assess`; unchanged evidence reuses a valid prior result.
- [x] Add inbox filters and recovery states. `FILE_COMMENT` drives request intake; `FILE_UPDATE` is not an immediate edit stream. Optional named-version/Dev Mode delivery suggestions remain deferred and are ignored by intake.

**Verify:** build, then run the two new test files with jobs tests; receive a real comment event and confirm the inbox updates while the plugin is closed. **Done:** a repeated event creates one request thread and no unintended model or messaging action.

### T10 — Add reviewed clarification, reminder, and cancellation actions

**Depends on:** T03, T09 and operation-specific access checks.
**Files:** create `app/src/backend/reviewedActions.ts`, `app/tests/reviewed-actions.test.mjs`; modify `figma.ts`, `paypal.ts`, `server.ts`, `db.ts`, and the designer interface.
**Interfaces:** `prepareReviewedAction(ctx, input: ReviewedActionInput): ActionPreview`; `confirmReviewedAction(ctx, actionId: string): Promise<ActionResult>`. Define actions initially as `post_clarification`, `remind_invoice`, or `cancel_invoice`. Bind previews to actor, project/run, resource, exact text/terms, revision, and expiry; confirmation occurs in the authenticated application UI and is single-use. A retry returns the stored result or reconciliation state.

- [ ] Test edited/expired previews, wrong actor, duplicate confirmation, already paid/cancelled invoices, and an uncertain provider response.
- [ ] Request Figma `file_comments:write` only when comment posting is enabled; post the reviewed question and link its actual reply thread back to reassessment.
- [ ] Implement PayPal `/remind` with current provider limits and supported message behavior; re-read invoice state before sending. Use an application cooldown to prevent duplicate reminders.
- [ ] Implement eligible `/cancel` with explicit designer confirmation and provider read-back. For uncertain non-idempotent sends, reconcile where possible and expose uncertainty instead of blindly sending again.

**Verify:** `node --test tests/reviewed-actions.test.mjs` after build plus deliberate sandbox/comment actions with recipient-aware review. **Done:** each outbound action has a preview, authorization record, provider result, and retry behavior.

### T11 — Expose read and draft tools through a custom Figma MCP connector

**Depends on:** T02, T07-T08; connector availability verified in T01.
**Files:** create `app/src/backend/mcp.ts`, `app/src/backend/mcpAuth.ts`, `app/tests/mcp.test.mjs`, `app/tests/mcp-auth.test.mjs`, and `docs/FIGMA-AGENT-CONNECTOR.md`; modify `server.ts`, `app/package.json`, and `app/pnpm-lock.yaml`.
**Interface:** Streamable HTTP `/mcp`; tools `get_project_scope`, `assess_change_request`, `draft_change_order`, and `get_payment_status`, with versioned JSON input/output schemas. Map calls to T02/T06/T07 services; the server derives `ActorContext` from authenticated access.

- [ ] Verify the current official MCP SDK's Node 24 compatibility and Figma transport/authentication requirements, then pin the selected dependency. Use the same backend business rules as the plugin.
- [ ] For the single-project synthetic connector, issue a dedicated expiring, revocable, scoped connector credential; store only its digest and configure it privately through Figma's supported header authentication. Do not reuse provider credentials or publish shared organization credentials. T18 replaces this demo path with per-user OAuth.
- [ ] Test malformed tool arguments, wrong project/run, expired/revoked credentials, stale revisions, injected actor fields, and instructions hidden in comments. Financial approval/execution tools must not be exposed by this initial adapter.
- [ ] Connect the remote endpoint in Figma, discover the actual tools, and complete read -> assessment -> draft. Budgeted assessment is an explicitly invoked tool, not a side effect of a read.
- [ ] Document that Figma connects to this application server; the custom Node backend does not acquire access to Figma's restricted official MCP server merely by supporting MCP.

**Verify:** `node --test tests/mcp.test.mjs tests/mcp-auth.test.mjs` after build and an actual Figma connector call. **Done:** the native agent creates the same reviewable draft as the plugin without approving or publishing it.

### T12 — Add human-confirmed agent actions and a linked Figma status card

**Depends on:** T10-T11.
**Files:** modify `mcp.ts`, `reviewedActions.ts`, `changeOrderService.ts`, `app/plugin/code.ts`, shared types, and designer/client interfaces; create `app/tests/agent-actions.test.mjs`, `app/tests/figma-card.test.mjs`, and `docs/agent-instructions/scope-and-settle.md`.
**Interfaces:** add MCP `submit_for_client_approval` and `issue_approved_invoice` as action-preparation flows. They return an application review URL/action ID; only a human confirmation handler may invoke the publishing service. `upsertStatusCard(changeOrderId: string, view: StatusCardView): string` is a plugin operation returning the card node ID.

**Local progress, 2026-10-24:** T12a is accepted at `controller-t12a-approved` (full 441/441). T12b is accepted at `controller-t12b-approved` (full 459/459; focused 67/67 plus final native-bundle 11/11; three synthetic browser flows). T12a/T12b reviews ran directly in the main session under the no-subagents instruction. Both parts are implemented locally; actual native card/connector qualification and supported-client instruction installation remain external gates.

- [x] Bind invoice execution to a single-use human confirmation plus persisted approval of the exact proposal revision; revalidate merchant, amount, currency, and scope immediately before calling existing invoice recovery logic.
- [x] Test that an MCP invocation, generic tool consent, or forged “client approved” argument cannot replace application approval or execute the preview. Repeated confirmed actions reuse the existing invoice operation.
- [x] Add a plugin command to create/update a linked card with approved scope, payment/delivery state, and last refresh time. Use an authenticated application URL, never a bearer invitation in the canvas. Showing monetary amounts is a project display setting, default off.
- [ ] Make card updates idempotent by change-order ID; test with a small Plugin API fake and verify the result in native Figma. Refresh while the plugin runs or on explicit invocation; label cached state when it is not refreshed. Add Dev Resource links only with verified `file_dev_resources:write` access.
- [ ] Add portable agent instructions: cite scope evidence, treat comments as data, preserve uncertainty, prepare actions for review, and distinguish payment from delivery. Verify installation/invocation in the actual supported client.

**Verify:** build and run the two new test files plus MCP/order tests; confirm the same record in Figma chat, plugin, canvas, and client page. **Done:** all entry points enforce identical approval and money rules.

### T13 — Establish held-out evaluation and the Release B gate

**Depends on:** T06-T12.
**Files:** create `fixtures/scope-held-out-cases.json`, `docs/verification/scope-evaluation-rubric.md`, `app/tests/evaluator.test.mjs`; modify `app/scripts/evaluate-ai.mjs` and keep historical outputs intact.
**Interface:** extend the evaluator with `--fixtures <path>` and `--output-label <label>`; reject unknown flags and retain the selected fixture identity/hash, prompt/model version, results, and cost ledger reference.

**Local progress, 2026-10-24:** T13 harness/data artifacts implemented and reviewed directly in the main session. Production prompt/schema/source frozen before label exposure; 34 held-out scenarios / 43 items, separate six-case baseline, focused 29/29 and full 478/478. Validation-only CLI checks made zero provider calls. See [rubric and evidence limits](../../verification/scope-evaluation-rubric.md). Two unsupported private drafts are explicitly excluded; quoted image/history text is not vision or workflow proof. Local acceptance does not close the live, native, semantic-review or designer-observation gates. The whole Release B review/minors wave remains next.

- [x] Define at least 30 labeled held-out cases across mixed requests, included work, valid additions, prior commitments, ambiguous rates, contradictory clauses, stale evidence, and instruction injection. Keep tuning cases separate.
- [x] Add fake-provider tests for evaluator accounting, partial runs, rejected output, and report totals; verify the evaluator does not treat skipped cases as passes.
- [ ] Run the live evaluation only through the designated budget ledger after checking its remaining allocation. Review whether each quote supports the conclusion, in addition to schema/ID checks.
- [ ] Use this proposed release bar: zero false billable decisions on the labeled included/ambiguous items, zero duplicate-proposal invariant failures, and at least 90% recognition of clearly new work. Report denominators, every failure, latency, and cost; small-set results are not a broad accuracy claim.
- [ ] Observe 2-3 designers completing the flow; record task time, mistaken decisions, recovery actions, and comments without inventing impact metrics.

**Verify:** mocked evaluator tests, then `npm run eval:ai -- --fixtures ../fixtures/scope-held-out-cases.json --output-label release-b --contract ../docs/verification/scope-evaluation-contract.json` for validation only. Paid inference additionally requires separately cleared `--live`, an explicit existing designated ledger and a reviewed history-bound allocation; see the rubric. **Release B gate:** whole-release review/minor fixes, full `npm test`, native connector/card proof, background inbox proof, substantive labeled evaluation and designer observations. Each remains separately recorded; synthetic fixture passes cannot satisfy the live gate.

## Release C — payment through delivery

Subsystem interfaces and invoice/delivery compatibility: [Release C execution supplement](2026-10-23-release-c-execution.md).

Local status (October 24, 2026): T14–T16 implementation and synthetic/browser checks are complete; final full build/test is 513/513. Real sandbox installment checkout, native output/readback and independent designer gates remain pending. See [local qualification](../../verification/agent-integrations-c-through-t16-2026-10-24.md). T17 is not started.

### T14 — Add approved milestone schedules and installment invoices

**Depends on:** Release B.
**Files:** create `app/src/backend/milestones.ts`, `app/tests/milestones.test.mjs`; modify `db.ts`, `orders.ts`, `paypal.ts`, shared types, and proposal/client review interfaces.
**Interfaces:** `MilestoneTerms = { id: string; title: string; amountMinor: number; dueTrigger: "proposal_approval" | "delivery_acceptance"; acceptanceCriteria: string[] }`; `MilestoneSchedule = { milestones: MilestoneTerms[]; workStartPaymentMilestoneIds: string[] }`; `setMilestoneSchedule(ctx, orderId, expectedRevision, schedule: MilestoneSchedule): ChangeOrderView`; `ensureMilestoneInvoice(ctx, milestoneId): Promise<MilestoneView>`. Work-start payment references must identify proposal-approval installments in the same schedule; delivery-acceptance installments cannot be prerequisites for starting their own work.

- [x] Test a $250 order split into $100 due on proposal approval and $150 due on delivery acceptance; set the $100 installment as the work-start prerequisite. Assert the schedule sums exactly to the approved total, work can start after that deposit, and the balance cannot be invoiced early.
- [x] Include milestone/payment terms in the immutable proposal snapshot and client consent. Changing a schedule creates a new revision and invalidates old approval links.
- [x] Create one recoverable invoice operation per milestone with a unique provider reference; migrate a legacy invoice as a single legacy installment without creating another provider invoice.
- [x] Track per-installment and aggregate amounts separately. Use explicit installment invoices for this release; partial-payment configuration can be a later access-verified option. Do not describe these flows as escrow.

**Verify:** `node --test tests/milestones.test.mjs tests/orders.test.mjs` after build and a sandbox installment flow. **Done:** duplicate attempts create one invoice per installment and total obligations remain exactly the approved amount.

### T15 — Generate the approved delivery brief and draft design work

**Depends on:** T08, T12, T14.
**Files:** create `app/src/backend/delivery.ts`, `app/tests/delivery.test.mjs`; modify `app/plugin/code.ts`, designer UI, shared types, and `docs/agent-instructions/scope-and-settle.md`.
**Interfaces:** `prepareDeliveryBrief(ctx, milestoneId: string): Promise<DeliveryBrief>`; `startApprovedWork(ctx, milestoneId: string): Promise<DeliveryRun>`. Define the brief with immutable scope/revision references, relevant nodes, acceptance criteria, paid-condition observation, and allowed work area. A run stores generated node IDs and its operation ID. Refresh the invoices referenced by the approved `workStartPaymentMilestoneIds` before authorizing start; do not require a delivery-acceptance balance invoice to be paid before the work it funds is reviewed.

- [x] Test an unpaid deposit, a reversed payment, changed scope, repeated start, and generated output outside the allowed work area; require review where the payment condition is no longer satisfied.
- [x] Add an explicit designer “Start approved work” action that generates a brief/checklist from approved facts. Draft new content on a dedicated page/area and preserve original design nodes.
- [x] Implement standard canvas output through the existing Plugin API. Add native Specs or supported-client MCP generation only after the relevant beta/access check passes; the standard brief remains usable without those features.
- [x] Read back generated node IDs and export a review image. Label generated work as draft until the designer reviews it; generation completion does not mark a milestone accepted.
- [x] If implementation is part of the engagement, attach existing Code Connect mappings and repository references to the brief. A coding-agent branch/PR and runtime validation are a separately scoped delivery action.

**Verify:** build, `node --test tests/delivery.test.mjs`, native generation/read-back, and designer review against the acceptance checklist. **Done:** paid approved work has a traceable, repeatable starting artifact with no automatic acceptance claim.

### T16 — Record delivery review and release the agreed balance invoice

**Depends on:** T14-T15.
**Files:** modify `delivery.ts`, `milestones.ts`, `reviewedActions.ts`, `server.ts`, shared types, and `app/web/review.js`; create `app/tests/delivery-acceptance.test.mjs`.
**Interfaces:** `submitDelivery(ctx, milestoneId, snapshotId): DeliveryReview`; `acceptDelivery(ctx, reviewId, expectedRevision): DeliveryAcceptance`; `requestDeliveryChanges(ctx, reviewId, comment): DeliveryReview`. Issue a client `delivery` grant bound to that review and revision. Acceptance is tied to the delivered snapshot and agreed criteria; an ordinary proposal review grant cannot accept a replacement delivery.

- [x] Test wrong-client acceptance, replaced delivery snapshots, a stale review link, concurrent acceptance, rejected delivery, and a late payment reversal after acceptance.
- [x] Present the exact delivery snapshot and checklist to the client; preserve requested changes and acceptance as append-only events.
- [x] Make a balance invoice eligible only after its approved due trigger occurs. Route execution through the same human authorization and recoverable invoice operation used elsewhere.
- [x] Keep delivery acceptance and payment state independent. A Figma “ready for dev” event can suggest review but cannot accept work or invoice it by itself.

**Verify:** `node --test tests/delivery-acceptance.test.mjs tests/milestones.test.mjs` after build and a real sandbox deposit -> review -> acceptance -> balance payment walkthrough. **Done:** the paid total, delivered version, acceptance, and outstanding balance agree across interfaces.

### T17 — Export factual delivery and dispute evidence

**Depends on:** T06, T08, T16.
**Files:** create `app/src/backend/evidencePackets.ts`, `app/tests/evidence-packets.test.mjs`; modify `server.ts` and the designer interface.
**Interface:** `buildEvidencePacket(ctx, orderId: string): EvidencePacket`; define a JSON manifest plus human-readable HTML containing source IDs, versions, timestamps, hashes, quoted scope, request history, approvals, delivery records, and payment observations. Generated summaries identify their source records and limitations.

- [ ] Test cross-project export denial, missing/deleted source content, redaction, tampered snapshot hashes, and an externally paid/refunded observation that must not be presented as an app-processed transaction.
- [ ] Assemble the packet from immutable stored records; separate supplied statements, observed design facts, model suggestions, and recorded human decisions.
- [ ] Provide an authenticated export and a preview for the designer. Apply the project's access and retention rules; no public bearer-link export by default.
- [ ] Prepare a dispute-specific draft only after matching an actual dispute/payment to the order. Provider evidence submission and refund actions belong to T21 and require a reviewed action.

**Verify:** `node --test tests/evidence-packets.test.mjs` after build and manual source-to-packet comparison. **Release C gate:** full tests, real installment lifecycle, native artifact review, and an independently readable evidence packet.

## Release D — recurring studio product

Identity, tenant, connection and provider-access architecture: [Release D execution supplement](2026-10-23-release-d-execution.md). Real-customer enablement remains gated by verified identity/provider access and retention policy.

### T18 — Add real identity, tenant boundaries, and connected accounts

**Depends on:** Release C; complete before using any release with real customer data.
**Files:** create `app/src/backend/identity.ts`, `tenancy.ts`, `connections.ts`, `app/tests/tenancy.test.mjs`, `connections.test.mjs`, and `docs/STUDIO-ACCESS-DESIGN.md`; modify session/context handling, every persisted project resource, jobs, MCP authentication, and designer/client interfaces.
**Interfaces:** `TenantActorContext` extends `ActorContext` with a server-derived `tenantId` and verified account identity; `resolveConnection(ctx, provider): ProviderConnectionRef` returns a credential reference rather than a secret. Scope database queries, job payload lookup, exports, and tool calls by tenant/project/run.

- [ ] Write the account/connection design: select a maintained identity/authorization provider with Node 24 support, document organization membership and client invitation behavior, and define retention/deletion for customer evidence. Preserve the synthetic demo as a separate tenant.
- [ ] Test cross-tenant IDs, jobs, caches, exports, connector tokens, and restore operations before generalizing the current hard-coded demo project and merchant.
- [ ] Implement Figma per-user OAuth and explicit project/file bindings with incremental scopes, reconnect/revocation behavior, and server-side encrypted credential storage.
- [ ] Replace the demo MCP credential with per-user OAuth access: protected-resource metadata, authorization-server discovery, scoped audience-bound tokens, and expiry/revocation checks. Use a maintained authorization implementation rather than hand-writing a new OAuth server.
- [ ] Add PayPal merchant connection/onboarding only through a supported consent/capability flow; keep account identity, merchant connection, and permission to act on a particular proposal distinct. Confirm that the chosen onboarding flow supports every required invoice/subscription operation.

**Verify:** build and run tenancy, connection, MCP-auth, HTTP, jobs, and export tests; connect two independent test identities and prove isolation. **Done:** a user can connect/disconnect their own project without gaining another tenant's records or credentials.

### T19 — Add subscription billing and a recurring allowance ledger

**Depends on:** T18 and accessible PayPal subscription sandbox operations.
**Files:** create `app/src/backend/subscriptions.ts`, `allowances.ts`, `app/tests/subscriptions.test.mjs`, `allowances.test.mjs`; modify PayPal adapter, event handling, migrations, and shared types.
**Interfaces:** `RetainerPlan` identifies a PayPal product/plan, billing cadence, currency, and explicit deliverable units; `reconcileSubscription(ctx, subscriptionId): Promise<SubscriptionView>`; `grantAllowanceForPaidCycle(ctx, subscriptionId, cycleKey): AllowanceBalance`.

- [ ] Verify product/plan/subscription creation, buyer approval, status retrieval, transaction association, and relevant event access in the selected sandbox account before making this release dependent on them.
- [ ] Test duplicate renewals, out-of-order events, pending/failed payments, suspension/cancellation, and a reversal after a cycle was credited.
- [ ] Grant allowance once per verified paid cycle. An ACTIVE status alone does not prove a renewal was paid; retain the provider transaction/cycle evidence.
- [ ] Define initial retainer rules in the approved customer terms: whole deliverable units, no rollover, no automatic overage charge, and existing accepted work retained after cancellation. Model a reversed credited cycle as requiring review rather than silently deleting history.

**Verify:** build and run subscription/allowance tests, then actual sandbox subscription approval and a supported cycle verification. Accelerated or simulated lifecycle evidence must be labeled separately. **Done:** one paid cycle produces one traceable allowance grant.

### T20 — Reserve allowance for accepted work and quote overages

**Depends on:** T07, T14-T16, T19.
**Files:** modify `allowances.ts`, `requestItems.ts`, `milestones.ts`, delivery/proposal interfaces; create `app/tests/retainer-work.test.mjs`.
**Interfaces:** `authorizeRetainerWork(ctx, workId, expectedRevision): RetainerWorkAuthorization`; `reserveAllowance(ctx, itemId, cycleKey, units): AllowanceReservation`; `consumeAllowance(ctx, reservationId, acceptanceId): AllowanceEntry`; `releaseAllowance(ctx, reservationId, reason): AllowanceEntry`. Define a versioned retainer-work record with deliverables, acceptance criteria, cycle, units, and reservation; use a revision-bound client `retainer_work` grant for authorization. This record enters the scope ledger as an existing commitment and uses the delivery review workflow without creating a zero-dollar PayPal invoice.

- [ ] Test two concurrent requests for the last unit, cancelled/rejected work, a billing-cycle boundary during delivery, duplicate acceptance, and a refund affecting a credited cycle.
- [ ] Reserve agreed units when the client authorizes work, consume on the defined acceptance event, and release unused reservations on cancellation. Use database transactions to prevent oversubscription. For retainer-funded delivery, verify the authorized reservation and paid-cycle basis instead of requiring a new deposit invoice.
- [ ] Show available/reserved/consumed units and the exact cycle. AI can suggest eligible work; code applies the approved unit rules.
- [ ] Route an overage into a separate approved change order and invoice. Never infer permission for an extra charge from subscription consent or a saved payment method.

**Verify:** `node --test tests/retainer-work.test.mjs tests/allowances.test.mjs` after build plus a retainer/overage client walkthrough. **Done:** the client can explain every consumed unit and every separately charged addition.

### T21 — Add eligible refund and dispute operations

**Depends on:** T03, T10, T17-T18 and feature-specific access proof.
**Files:** create `app/src/backend/disputes.ts`, `refunds.ts`, `app/tests/disputes.test.mjs`, `refunds.test.mjs`; modify PayPal adapter, reviewed actions, events, evidence packets, and financial display.
**Interfaces:** `prepareRefund(ctx, paymentRef, amountMinor): ActionPreview`; `prepareDisputeEvidence(ctx, disputeId, packetId): ActionPreview`. Execution uses the T10 human-confirmation handler and current provider eligibility.

- [ ] Verify the actual refundable payment resource produced by this integration and the supported API/merchant permissions. Do not treat an invoice transaction ID as a Payments v2 capture ID without proof.
- [ ] Implement actual money movement only through the verified route. Keep invoice `/refunds` bookkeeping distinct; if the required route is unavailable, provide a documented merchant-led refund and authoritative reconciliation path.
- [ ] Test duplicate/partial refunds, unknown outcomes, over-refunds, changed dispute state, wrong merchant, and unavailable action links; use provider-supported idempotency and read-back.
- [ ] Allow the designer to review evidence before submission. Claim acceptance, settlement offers, escalation, and financial actions require their own explicit authorization; sandbox adjudication controls are never exposed as live capabilities.

**Verify:** build and run refund/dispute tests, then an eligible sandbox refund and evidence submission with sanitized proof. **Done:** the UI distinguishes prepared, submitted, verified, failed, and unavailable operations without claiming a dispute outcome.

### T22 — Add studio reporting and validate commercial readiness

**Depends on:** T18-T21.
**Files:** create `app/src/backend/reports.ts`, `app/tests/reports.test.mjs`, and `docs/STUDIO-READINESS.md`; modify designer navigation and reporting views.
**Interface:** `getStudioReport(ctx, period: { from: string; to: string }): StudioReport`; report approved obligations, invoiced amounts, outstanding balances, refunds, allowance usage, delivery state, and approval-to-payment durations with explicit source/time semantics.

- [ ] Test multi-invoice orders, refunds, partial payments, subscriptions, missing timestamps, and tenant boundaries; avoid double-counting a proposal total and its installment invoices.
- [ ] Compute operational metrics from recorded events. Add PayPal reporting APIs only for verified access to required transaction/fee data; do not use delayed reports as immediate payment confirmation.
- [ ] Verify merchant onboarding readiness and required product permissions separately from a successful redirect. Production platform access requires the relevant PayPal approval; record that outcome before enabling delegated production operations.
- [ ] Complete real-customer retention/deletion controls, backup/restore, provider disconnect, audit access, and operational failure recovery. Preserve financial records required by the adopted policy when deleting optional design snapshots.
- [ ] Compare the proposed studio/retainer workflow with observed designer use, and record willingness-to-pay feedback separately from actual revenue or measured time savings.

**Verify:** `node --test tests/reports.test.mjs` after build, cross-tenant browser checks, backup/restore rehearsal, and an independently reviewed production-access record. **Release D gate:** full regression passes; account access, consent, tenant isolation, and the chosen production products have separate recorded evidence.

## Deferred capability checks

These are optional investigations, not prerequisites for Releases A-C and not automatically enabled by the CSV.

| Capability | Concrete prerequisite before adding it |
| --- | --- |
| Orders v2 direct checkout | Demonstrate a user benefit over hosted invoices; implement approval/capture reconciliation and refund mapping as a separately tested payment route |
| Invoice partial payments | Verify merchant availability and define how partial amounts satisfy approved milestone terms |
| Expanded recurring invoices / automatic reminders | Execute the exact documented operation with the intended account; distinguish invoice scheduling from subscription auto-billing |
| Usage-based billing | Verify deployment routing, account activation, metering correction, and billing access; keep the application allowance ledger usable independently |
| FX quotes / multi-currency | Verify product access and currencies; replace two-decimal assumptions and define rounding, settlement, and approved exchange-rate terms |
| Payouts / platform fees | Adopt a seller/subcontractor fund-flow design and verify the required production approvals and funding model |
| Figma native Specs / broader canvas generation | Verify rollout, seat/edit permissions, supported client, and actual available tools; keep standard plugin output available |
| Agency-wide connector publication | Verify organization controls and per-user authorization; do not publish a creator's shared financial credential |

## Release evidence and handoff checklist

- [ ] Each task has its focused checks and a reviewable diff; existing unrelated changes remain identifiable.
- [ ] The release's full `npm test` result is recorded with actual counts; new failures are resolved or explicitly prevent the relevant release gate.
- [ ] Browser and native Figma checks cover normal use, expiry, stale revisions, errors, and reopening. Mocked provider results are labeled.
- [ ] Required PayPal sandbox operations use actual provider resources; payment proof includes buyer checkout and authoritative read-back. Webhook proof includes actual receipt and successful verification.
- [ ] Required Figma connector/webhook/canvas operations are observed in the intended account and client. Documentation availability alone is not marked as passing access.
- [ ] Deployment verification records source/artifact identity, health, persistent state, backup recovery, and the release-specific journey after deployment.
- [ ] Feature flags leave unverified or inaccessible capabilities disabled; users see a useful unavailable/reconnect state.
- [ ] Update product/setup/judging documentation to describe implemented behavior and remaining limits, retaining historical verification records.
- [ ] Review only the intended publication allowlist when commit/push/deployment is requested; verify remote/deployed identity independently afterward.

## Official implementation references

- [PayPal capability inventory](../../../PAYPAL-API-CAPABILITIES.md) and [exact endpoint inventory](../../../PAYPAL-REST-ENDPOINTS.csv).
- [PayPal Invoicing v2](https://developer.paypal.com/api/invoicing/v2/), [invoice creation and partial-payment configuration](https://developer.paypal.com/api/invoicing/v2/invoices-create), and [reminders](https://developer.paypal.com/api/invoicing/v2/invoices-remind).
- [PayPal invoice refund records](https://developer.paypal.com/api/invoicing/v2/invoices-refunds) and [captured-payment refunds](https://developer.paypal.com/api/payments/v2/captures-refund).
- [PayPal Agent Toolkit tools](https://developer.paypal.com/ai-tools/agent-tools/), [Subscriptions](https://developer.paypal.com/subscriptions/about), [Disputes](https://developer.paypal.com/api/customer-disputes/v1/), and [platform onboarding](https://developer.paypal.com/platforms/get-started).
- [Figma custom MCP connectors](https://help.figma.com/hc/en-us/articles/38147204302743-Create-and-use-custom-MCP-connectors-in-the-Figma-agent-and-Figma-Make) and [official MCP client access](https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/).
- [Figma REST scopes](https://developers.figma.com/docs/rest-api/scopes/), [webhook events](https://developers.figma.com/docs/rest-api/webhooks-events/), and [webhook security](https://developers.figma.com/docs/rest-api/webhooks-security/).
- [Figma Plugin API](https://developers.figma.com/docs/plugins/), [write to canvas](https://developers.figma.com/docs/figma-mcp-server/write-to-canvas/), [Specs](https://help.figma.com/hc/en-us/articles/44049066011671-Guide-to-Specs-in-Figma), [Dev Resources](https://developers.figma.com/docs/rest-api/dev-resources/), and [Code Connect](https://developers.figma.com/docs/code-connect/).
- [MCP HTTP authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization). Recheck SDK/spec compatibility at implementation time; the demo header credential is not a production OAuth implementation.

Public documentation was checked during the 2026-10-23 investigation. This checklist does not establish account entitlements, perform new model/payment calls, or mark future work complete.






