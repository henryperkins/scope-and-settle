# A–C Deferred-Work Closeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Work directly without subagents, as the user specified. Steps use checkbox (`- [ ]`) syntax for tracking. Preserve private evidence/checkpoints despite skill cleanup defaults.

**Goal:** Close the carried A–C findings, add explicitly consented installment reminders and reviewed image attachments, and prepare/prove the exact candidate for release qualification.

**Architecture:** Retain the one-process Node/SQLite authority and current plugin/browser/MCP domain entrances. Add durable exact-record reminder policies/jobs, immutable packet attachments and narrow recovery/protocol corrections. Provider, native, evaluation and human proof remain separately recorded from synthetic checks.

**Tech Stack:** Node.js `>=24.0.0 <25`, TypeScript, `node:sqlite`, vanilla browser JavaScript, existing pinned MCP SDK and existing PayPal/Figma adapters. No new runtime dependency is planned.

**Spec:** [A–C closeout design](../specs/2026-10-24-a-c-closeout-design.md), [product contract](../../PRODUCT-SPEC.md), [current local qualification](../../verification/agent-integrations-c-through-t17-2026-10-24.md). User confirmed A–C first and both additions with existing defaults preserved. Implementation-plan review remains distinct from external-action approval.

## Global Constraints

- Work only in `C:\Users\htper\.codex\worktrees\ab1b\paypal-hackathon`; application commands run from `app/`. Preserve primary, judging-access and paid-figma-connection checkouts and all accepted evidence. No subagents.
- Start from `7020cb06c24406ca7b59eaaa795c6bb6fca0f714`; accepted T17 schema is 16 and last full suite is 524/524. Inspect current changes before execution and preserve the reviewed design/plan documents.
- Preserve exact-revision human consent, immutable approved terms, exact invoice identity, due triggers, retained acknowledgements, unknown-send safety, shared cadence/locks, reset tombstones and budget history.
- Preserve Baseten `deepseek-ai/DeepSeek-V4.1-Flash-1017-Fast`, reasoning `max`, original T13 freeze/labels and generation implementation. Do not modify `assessment.ts`/its compiled generation bytes or tune against held-out labels.
- Combined development AI ceiling is $25 across existing allocations/history. Local checks use fake providers. Paid/provider/native/deployment steps require their existing separate authority; a plan checkbox does not supply it.
- Manual reminder and metadata-only export remain defaults. Existing policies gain no new installment authority. No automatic image redaction or independent image verification claim.
- New image limits: four selected current-review snapshots, `1_500_000` PNG bytes each, complete image export at most `16_777_216` bytes; metadata-only JSON/HTML remains at most `4_000_000` bytes. Refuse rather than truncate or replace.
- Use reviewed explicit Git allowlists on the existing feature branch; publication authorization persists. No merge or deployment is implied. Retain failed RED/build/browser logs and historical runners.
- No pre-change baseline suite/hash gate. Write the regression first, observe meaningful RED, implement, then run the appropriate checks. Full suites run at stable package boundaries, not after unchanged documentation.

## Review Focus

1. Old provider reads finishing after newer source recovery must not re-fence current evidence; only fresh trusted reads recover unavailable sources — Task 1.
2. Authority ending after an awaited read and code-only upgrades must not expose a saved result or redispatch unresolved paid work — Tasks 2–3.
3. Disconnects, legacy SSE deadlines and test limit overrides must not bypass domain-work bounds or leak raw arguments — Task 5.
4. New reminder consent must not authorize another invoice, a premature balance, an automatic replay, or a third policy reminder — Task 6.
5. Image selection becoming stale, restored wrong-run bytes, tampering, aggregate size and exported identity must remain checked through preview/build/download — Task 7.

## File boundaries and execution record

Keep current domain services responsible for their authority. New focused modules: `mcpErrors.ts` for sanitized codes, `mcpSchemas.ts` for strict schemas, `mcpTransport.ts` for negotiated HTTP/SSE lifecycle, and `installmentReminders.ts` for consent/scheduling/execution. `evidencePackets.ts` owns packet assembly and immutable attachment validation. Do not rewrite unrelated formatting or the generation service.

Use `.superpowers/sdd/2026-10-24-a-c-closeout/` for this plan's ledger, task logs, review packages and checkpoints. First ledger line names this plan. Read the prior plan's accepted manifests/protection fingerprints as historical inputs; do not edit its checkpoints or helpers. Copy/adapt checkpoint/protection helpers into this workspace so all new output stays here. No cleanup of either workspace.

Each task ends with a direct main-session review, the listed tests and an explicit path-allowlist commit. Run one full `npm.cmd test` at the ends of Tasks 3, 5, 6, 7 and 8. Record actual counts, zero/nonzero skips and manifest identities; do not predict the new denominator. After a package passes, checkpoint/prove primary protection and push under existing authorization. Tasks 9–12 retain access/approval gates and do not fabricate completion.

---

### Task 1: Order source observations and finish source recovery coverage (B01–B05)

**Files:** modify `app/src/backend/requestSources.ts`, `requestInbox.ts`, `requestItems.ts`, `orders.ts`, `app/web/designer.js`, `app/scripts/eval-assessments.mjs`; tests `app/tests/source-freshness.test.mjs`, `source-freshness-fixture.mjs`, `designer-exceptions.test.mjs`, `agent-recovery.test.mjs`, `evaluator.test.mjs`.

**Interfaces:** extend trusted internal `recordSourceUnavailable(runId,rootId,reason,readMark)` and `recordMissingSource(runId,requestedId,comments,readMark)`. All authoritative fetch paths capture `observationMark()` before awaiting. `acquireRequestSource` records successful observation ordering even for unchanged available bytes. Generic `captureRequestSource` never clears a fence. Keep public source-reference shape unchanged.

- [x] Write `C1 old missing read cannot overwrite newer recovery`, `C1 old successful read cannot roll back a newer source`, `C1 direct manual same-byte recovery advances version without reviving old approval`, and `C1 unavailable-source card offers recovery rather than a review link`. Use held promises and actual scoped HTTP/domain paths, not timing sleeps. Assert `sourceUnavailable(id) === false` after the newer success and delayed old loss; the canonical hash/version never rolls back; exact recovered version increases; old approval remains denied with 409; approved history remains unchanged.
- [x] Retain a real current-loss positive control: after a fresh missing read, assert the fence is true and new reservation/submit/approval are denied. Strengthen broad assertions and let fixture DB errors propagate. Add the retained legacy-policy case proving changed-content auto-assessment requires the existing live designer policy and does not reset counters/budget.
- [x] Update every internal caller of the changed observation functions, including the evaluator's explicit unavailable-source case. That synthetic CLI case supplies a trusted current observation mark and remains blocked with zero dispatch; a missing argument must not turn its proof into a generic validation error or skip ordering checks.

  Assertion contract for the held-read/recovery scenario:
  ```js
  assert.equal(sourceUnavailable(sourceId), false);
  assert.equal(canonicalHead.contentHash, newerHash);
  assert.equal(oldApprovalResponse.status, 409);
  assert.deepEqual(approvedHistoryAfter, approvedHistoryBefore);
  ```
- [x] Build then run `node --test tests/source-freshness.test.mjs tests/designer-exceptions.test.mjs tests/agent-recovery.test.mjs tests/evaluator.test.mjs`; retain RED showing the old-loss ordering or stale-control defect. If a historical finding already passes, attach its proof and fix the remaining demonstrated defect.
- [x] Apply ordering checks transactionally per source before either available/unavailable observations mutate the canonical head, availability or inbox projection. Propagate stale-observation refusal so a rejected old loss cannot still overwrite the UI projection. Route touched duplicate freshness/version checks through `requireAssessedSourceCurrent`; preserve approved commitments and immutable versions. Suppress only source-stale/unavailable review-link controls; keep authenticated recovery available.
- [x] Rebuild and rerun the same group; expected all pass with no new model/provider calls beyond counted fixture work. Commit only this task's reviewed files plus the reviewed design/plan and private ledger entry. Preserve old runner evidence.

### Task 2: Make read-only action reconciliation authority-aware (B06)

**Files:** modify `app/src/backend/reviewedActions.ts`, `app/web/reviewed-actions.js`, `docs/REVIEWED-ACTIONS.md`; tests `app/tests/reviewed-actions.test.mjs`, `reviewed-actions-fixture.mjs`.

**Interfaces:** retain existing prepare/confirm/read-only outcome APIs and `ActionResult`; add `localProjectionReason?: 'retryable_read'|'association_changed'` only if needed to render truthful recovery. Ended authority throws the existing 401/403 scoped error rather than returning an earlier result. Known provider acknowledgement remains durable.

- [x] Add `C1 revoked owner cannot receive saved reconciliation after held GET`, `C1 changed invoice projection does not promise Check payment can repair it`, and a retryable-read control. Assert 401/403 after revocation, no additional outbound writes, the original CANCELLED acknowledgement retained, and association-change text directing review rather than a send/retry claim.

  ```js
  assert.equal(revokedResponse.status, 401);
  assert.equal(outboundWritesAfter, outboundWritesBefore);
  assert.equal(savedOutcome.providerStatus, 'CANCELLED');
  assert.doesNotMatch(associationChanged.message, /Check payment retries it/);
  ```
- [x] Build/run `node --test tests/reviewed-actions.test.mjs` and retain meaningful RED. Correct post-await authority checks before returning/saving a response; do not erase a previously known outcome when the caller loses access.
- [x] Rebuild/rerun; expected all pass. Exercise only the affected uncertain-outcome browser control using successful-response waits. Review and commit the exact task allowlist.

### Task 3: Preserve unresolved logical assessment work across code upgrades (B08)

**Files:** modify `app/src/backend/assessmentWork.ts`, `requestInbox.ts`, `migrations.ts`, `app/scripts/eval-assessments.mjs`; tests `app/tests/design-evidence.test.mjs` where shared work already lives, `source-freshness.test.mjs`, `evaluator.test.mjs`, `migrations.test.mjs`. Locate existing shared-work tests with `rg` before adding the new regression there; use a new `assessment-work-upgrade.test.mjs` only if it makes the fixture smaller.

**Interfaces:** add `logicalKey:string` to newly prepared `AssessmentWorkReference`, retaining full `fingerprint`/inference audit identity. Logical identity includes current project/run/source/version/scope/rates/commitments/lineage/evidence and inference settings except `promptImplementation`. Cache success still requires the full runtime fingerprint. Migration 17 adds nullable `logical_key` and a unique unresolved-logical-work index for `prepared`, `dispatched`, `rejected`, `uncertain`; `not_dispatched` stays nonblocking. Existing positional inserts must become explicit-column inserts.

**Queue compatibility:** new `scope_assess` payloads use version 2 and require the new 64-hex `logicalKey` in the strict work shape. Keep a distinct version-1 validator with its original allowed fields. A v1 job may acquire the derived key in memory only after rebuilding current source/context/inference and matching its complete old fingerprint. A changed fingerprint is review-only. Requeue of an equivalent persisted v1 job reuses that durable job after exact validation, rather than conflicting with `enqueueJob`'s immutable payload/key check or rewriting its history.

**Evaluator compatibility:** preserve full-inference evaluator run IDs and exact-runtime success-cache isolation. Add a separate CLI-owned `evaluationCaseKey` hashing the validated complete input and inference with only `promptImplementation` omitted. Migration 17 also adds `evaluation_work_bindings(case_key,run_id,fingerprint,created_at)` with a unique triple. Under the existing exclusive evaluator runtime ownership, save the binding before execution and check unresolved attempts through that binding. This safety comparison is limited to explicitly marked `synthetic-evaluation-no-access` runs, never ordinary project/judging runs. Known-success work from another runtime is not reused. Legacy unresolved evaluator attempts without provable case bindings require operator review before live inference; never guess equivalence or clear reservations. Do not reuse the connector-only budget participant as this guard, because participant presence controls accepted `not_dispatched` semantics.

- [x] Add upgrade regressions with the same logical work and differing implementation identity: an interrupted/dispatched/uncertain or terminal rejected attempt refuses another dispatch (`assert.equal(dispatches,1)`); a known-zero connector attempt permits the later valid dispatch and keeps consumed count/audit; succeeded cache is reused only for exact runtime identity. Genuine changed source/context is a separate logical request.
- [x] Add migration preservation and legacy-job tests: old rows/AI accounting are byte-equivalent; absent old logical metadata is never fabricated. An unresolved legacy row for the same project/run/source/version conservatively requires review when exact association cannot be proven. A queued old reference is revalidated against the current constructor before use; changed full identity refuses it.
- [x] Add automatic-queue integration regressions: a newly queued v2 payload passes the real strict validator and executes once; a matching v1 payload remains recoverable; requeue does not throw `Conflicting reconciliation job key`; changed/forged/missing logical keys fail closed. Keep both versioned allowlists strict rather than allowing arbitrary new work fields.
- [x] Add evaluator tests for the same semantic case under different implementation identities/run IDs: a prior unresolved bound attempt blocks another dispatch; a known success does not become a cross-runtime cache hit; genuine input/prompt-version/schema/model/mode changes remain separate cases; ordinary judge/project runs are untouched. Test unbound legacy uncertainty refusing live work without releasing its original budget reservation.

  ```js
  await assert.rejects(retryAfterImplementationChange, error => error.status === 409);
  assert.equal(dispatches, 1);
  assert.deepEqual(originalAiCallsAfter, originalAiCallsBefore);
  assert.equal(legacyAttempt.logical_key, null);
  ```
- [x] Build/run the affected shared-work tests plus `tests/source-freshness.test.mjs tests/evaluator.test.mjs tests/migrations.test.mjs`; retain RED. Implement the transactional unresolved-work guard, queue compatibility and evaluator-only binding without editing generation/prompt/schema code or clearing old rows.
- [x] Rebuild/focused GREEN, then `npm.cmd test`. Expected full suite passes; record actual counts and verify original generation bytes still match their historical freeze. Main-session C1 review, checkpoint/protection proof and reviewed allowlist commit/push. This closes the C1 package.

### Task 4: Finish connector status, route and authority tests (B07, B09)

**Files:** modify `app/src/backend/mcpAuth.ts`, `server.ts`; tests `app/tests/mcp-auth.test.mjs`, `http.test.mjs`; adjust `app/web/connectors.js` only if inactive/disabled wording needs it.

**Interfaces:** retain `ConnectorSummary.status` and existing route/body contracts. Global disable reports inactive with a clear server-disabled explanation; it does not revoke or broaden a credential. Malformed percent encoding in revoke IDs returns sanitized 400 after normal designer/origin/consent checks.

- [x] Add `C2 disabled endpoint does not list usable active credentials` and `C2 malformed revoke identity returns 400`. Assert the disabled connector cannot invoke, re-enable preserves its existing allowed operations, malformed input causes no revocation, and cross-run/client/forged contexts remain 401/403/404 as appropriate.
- [x] Replace generic forbidden-call `assert.throws` checks with exact status and zero-side-effect assertions. Include portal approval/payment-refresh paths with an eligible real designer/portal positive control. Replace the 150 ms waiter assumption with a promise resolved at the actual join/dispatch boundary.

  ```js
  assert.equal(disabledSummary.status, 'inactive');
  assert.equal(malformedRevokeResponse.status, 400);
  assert.deepEqual(credentialsAfterMalformedInput, credentialsBefore);
  assert.equal(forbiddenProviderWrites, 0);
  ```
- [x] Build/run `node --test tests/mcp-auth.test.mjs tests/http.test.mjs`; observe the new defect RED before production changes. Correct only the identified seams, rerun GREEN, review and commit the exact paths.

### Task 5: Close MCP protocol/error/test-control debt (B10–B11)

**Files:** modify `app/src/backend/mcp.ts`; create `mcpSchemas.ts`, `mcpErrors.ts`, `mcpTransport.ts` beside it; update owned refusal sites in `context.ts`, `requestItems.ts`, `assessmentWork.ts`, `connectorStore.ts` only where needed. Tests `app/tests/mcp.test.mjs`, `mcp-auth.test.mjs`; docs `docs/FIGMA-AGENT-CONNECTOR.md`.

**Interfaces:** keep `MCP_PATH`, `handleMcpRequest`, `drainMcp` and all public tool schemas unchanged. Add an optional typed domain `code` to `ScopedAccessError` in `context.ts`; existing two-argument callers and HTTP statuses stay compatible. Owned domain modules import that type from context, never from MCP, preventing a circular dependency. Extract schema exports and `codeFor(error):string` with typed owned-domain codes plus a named, tested legacy-adapter fallback. Introduce trusted `createMcpTransport(options)` returning `{handle,drain}` with immutable per-instance limits. Existing production limits remain 64 KiB body, 64 header lines, 8 admitted executions, 10,000 ms body timeout, 150,000 ms exchange deadline, 2,000 ms drain grace, 60,000 output bytes. Test configuration enters the constructor, never HTTP/job JSON or a mutable production export.

- [x] Add both-era regressions for deadline before/after headers, unknown/non-allowlisted tool names carrying a canary, and unsupported resource/subscription methods. Assert one bounded sanitized timeout/error carrying the matching request ID where the negotiated transport supports it, no raw-name canary or secret in responses/logs, and no second response after closure.
- [x] Preserve the existing batch/disconnect execution-cap tests: a disconnected request keeps admitted domain work counted until settlement; a late known result is saved without another dispatch; draining waits for work. Test frozen production limits and two independently configured fixture transports.

  ```js
  assert.ok(admittedExecutions <= limits.maxConcurrent);
  assert.ok(!responseText.includes(untrustedToolCanary));
  assert.ok(!capturedLogs.includes(untrustedToolCanary));
  assert.equal(Object.isFrozen(productionLimits), true);
  ```
- [x] Build/run `node --test tests/mcp.test.mjs tests/mcp-auth.test.mjs`; retain meaningful RED. Inspect the pinned SDK's actual transport implementation before choosing terminal SSE framing; do not invent unsupported protocol behavior or patch dependencies. Extract only the named boundaries and add typed codes at owned entrances; keep legacy message compatibility inside the documented adapter.
- [x] Rebuild/focused GREEN, then `npm.cmd test`. Expected full pass and disabled-by-default endpoint preserved. Main-session C2 review, checkpoint/protection proof and reviewed allowlist commit/push.

### Task 6: Add opt-in exact-installment reminder policies and jobs (C3, L01)

**Files:** create `app/src/backend/installmentReminders.ts`, `app/web/installment-reminders.js`, `app/tests/installment-reminders.test.mjs`; modify `jobs.ts`, `outboundActions.ts`, `server.ts`, `orders.ts` reset fencing, shared `types.ts`, `migrations.ts`, `app/web/designer.js`; reuse milestone fixtures and update VM import stubs only as required. Docs `docs/INSTALLMENT-PAYMENTS.md`.

**Interfaces:** `prepareInstallmentReminderPolicy(ctx,orderId,expectedRevision):Promise<ReminderPolicyPreview>`; `confirmInstallmentReminderPolicy(ctx,id,{previewHash,consent:true}):ReminderPolicyView`; `pauseInstallmentReminderPolicy(ctx,id,expectedVersion):ReminderPolicyView`; `getInstallmentReminderPolicy(ctx,orderId):ReminderPolicyView|null`; trusted `queueInstallmentReminders(at:Date):number`. Preview/view binds project/run/order/revision, version, parent authority, approved record IDs, merchant/recipients, expiry, cadence and count limits; never returns a secret. Migration 18 adds versioned policy/immutable preview bindings and a current-policy head. Existing agent policy JSON is unchanged.

- [x] Write domain/HTTP tests proving prepare causes zero sends, old `paypalReminders:true` grants no installment authority, client/MCP/cross-run/cloned contexts cannot consent, confirmation needs same-origin explicit consent, and pause/revision/reset/parent revocation prevents queue/dispatch. Natural session expiry follows the existing explicit delegation contract only until the policy's stated expiry (at most 24 hours or parent grant expiry).
- [x] For the $250 split, assert only the eligible $100 record is reminded; $150 receives no reminder before acceptance. Its 24-hour clock starts at the later of due-trigger and issue/send eligibility, not original approval. Bind recipient/merchant/config changes before dispatch and after held GETs; mismatch refuses without sending. Include manually created canonical orders without an agent request.
- [x] Pin shared behavior: duplicate worker cycles and manual/policy races produce one claim; minimum 86,400,000 ms between attempts; at most two automatic reminders per invoice across legacy/new paths and policy renewals; changing/reconfirming a policy never refills that count. Human attempts affect cadence but not the automatic count. Paid/cancelled/refunded/external/review/unknown states refuse. A lost response leaves one dispatch, durable uncertainty and no replay after restart or job retry.

  ```js
  assert.equal(balanceRemindersBeforeAcceptance, 0);
  assert.equal(remindersAtEligibilityPlus24HoursMinus1Ms, 0);
  assert.equal(remindersAfterUnknownSendAndRestart, 1);
  assert.equal(automaticReminderDispatchesAfterPolicyRenewal, 2);
  ```
- [x] Build/run `node --test tests/installment-reminders.test.mjs tests/agent-actions.test.mjs tests/jobs.test.mjs tests/milestones.test.mjs`; retain RED. Register an `installment_reminder` internal job lane with strict versioned payload, exact policy/record lookup and lease/authority guards. It must work independently of agent-request ownership. Update JobKind, handler validation, supported-kind checks, lane ticking and shutdown draining together.
- [x] Queue through persisted policies; execute through the shared `claimOutbound`/`beginOutbound`/`finishOutbound` fence and exact validated PayPal notify path. Derive the lifetime/cadence history from deduplicated durable outbound records plus retained legacy history, not an uncoordinated second counter. Dispatch uncertainty is terminal until read-only review. Reset prevents/tombstones new work without deleting audit.
- [x] Add designer prepare/confirm/pause controls, default off, showing all covered installment IDs/amounts, recipient summary, expiry and limits. Existing policies are never upgraded automatically. HTTP routes: scoped order `/installment-reminder-policy` GET and `/installment-reminder-policy/prepare` POST; `/api/installment-reminder-policies/:id/confirm` and `/pause` POST. Recheck active designer/origin/body/expected version at every await boundary.
- [x] Rebuild/focused GREEN; browser covers opt-in, exact deposit reminder, premature-balance refusal, pause and 390px layout using fake providers/clock. Run `npm.cmd test`, review C3, checkpoint/prove protection and commit/push reviewed paths. Real notification proof remains Task 11.

### Task 7: Add reviewed immutable image exports (C4, L03)

**Files:** modify `app/src/backend/evidencePackets.ts`, `server.ts`, shared `types.ts`, `migrations.ts`, `app/web/evidence-packets.js`; tests `app/tests/evidence-packets.test.mjs`, `evidence-packet-fixture.mjs`, `migrations.test.mjs`; docs `docs/EVIDENCE-PACKETS.md`.

**Interfaces:** `listEvidenceImageChoices(ctx,orderId)` returns current submitted/accepted review descriptors and order revision; descriptors include review ID/revision, snapshot ID/hash, image hash/state and authenticated `/api/delivery-snapshots/:id` preview path. `PacketImageSelection={reviewId,reviewRevision,snapshotId,snapshotHash}`; `buildEvidencePacket(ctx,orderId,options?:{expectedRevision:number,images:PacketImageSelection[],imagesReviewed:true})`. No options preserves version-1 metadata behavior. Images create schema version 2. File return exposes `body:string|Uint8Array`, preserving `text` for existing JSON/HTML callers.

- [x] Add tests for exact PNG inclusion/hash/byte counts and immutable read-back after source availability changes. Require explicit reviewed acknowledgement, current order/review revision and no more than four unique selections. Reject stale/replaced review, wrong run/project/order, revoked actor, missing/changed bytes, five selections, a PNG above 1,500,000 bytes and a complete representation above 16,777,216 bytes. Assert no partial packet/file row is stored.
- [x] Preserve v1 reads, unchanged metadata-only default and its 4,000,000-byte cap. Assert no image pixels appear without opt-in, no automatic redaction/independent-verification claim, no unaccepted draft labeled accepted, and no model/provider/outbound effects. Tampering with any stored attachment/manifest digest refuses download.

  ```js
  assert.equal(defaultPacket.schemaVersion, 1);
  assert.equal(imagePacket.schemaVersion, 2);
  assert.equal(sha256(downloadedPng), selectedSnapshot.imageHash);
  assert.equal(pngManifestEntry.bytes, downloadedPng.byteLength);
  assert.equal(packetRowsAfterRefusedBuild, packetRowsBefore);
  ```
- [x] Build/run `node --test tests/evidence-packets.test.mjs tests/migrations.test.mjs`; retain RED. Migration 19 adds immutable retained `evidence_packet_files` keyed by packet and filename. Store exact PNG bytes transactionally with packet text/manifest. Filename is `image-<64 lowercase hex image SHA256>.png`; identical bytes may share a file while every selected snapshot binding remains recorded.
- [x] Add authenticated designer image-choice GET and strict build options. Extend file routes only to the exact hash filename pattern. Verify every stored text/binary byte against its manifest on every read; old v1 packets remain unchanged. Render validated image data URLs in portable HTML with an `img-src data:` allowance, escaped captions, no remote assets/scripts and the existing sandbox. Include raw PNG, JSON, HTML and manifest bytes in the aggregate limit without a circular manifest digest.
- [x] Add explicit per-image preview/selection and reviewed-content acknowledgement; reset these on changed selection/review/session. Keep Build metadata packet as default. Download and verify PNG bytes with Authorization and blob URLs; no bearer URL. Replacement before build forces a fresh preview.
- [x] Rebuild/focused GREEN; browser checks preview, stale selection, all selected downloads/digests, script/private-link redaction, inert HTML, default pixel omission and 390px standalone image rendering. Run `npm.cmd test`, review C4, checkpoint/prove protection and commit/push reviewed paths.

### Task 8: Modernize container smoke and rehearse backup recovery (C5, B13)

**Files:** modify root `Dockerfile`, root `.dockerignore`, and `app/scripts/check-container.mjs`; create `app/tests/container-smoke.test.mjs` and a narrow reusable test fixture module under `app/tests/` if needed; extend `app/tests/migrations.test.mjs` only for actual new preservation assertions. Update `docs/FIGMA-AGENT-CONNECTOR.md` and the closeout qualification record.

**Interfaces:** keep `node scripts/check-container.mjs <image>` and its unique disposable container/volume ownership. Seed canonical synthetic source/assessment/items through the reviewed fixture factory inside disposable storage; return real public draft input with item IDs and operation ID. Never add a public unreserved draft fallback or ship a test bypass.

- [x] Add `C5 smoke fixture satisfies the current public draft contract` using the real isolated server. Assert fixture input has canonical item IDs/operation identity, POST creates exactly one scoped order, a repeated operation reuses it, cross-run reads fail and provider/model counters remain zero. Current old body must reproduce the canonical-item refusal before correction.

  ```js
  assert.ok(input.itemIds.length && input.operationId);
  assert.equal(createdResponse.status, 201);
  assert.equal(repeatedOrder.id, createdOrder.id);
  assert.deepEqual(providerAndModelCountersAfter, providerAndModelCountersBefore);
  ```
- [x] Build/run `node --test tests/container-smoke.test.mjs tests/migrations.test.mjs tests/plugin-package.test.mjs`; observe and retain the meaningful canonical-draft RED before correcting the smoke fixture. No extra unchanged Docker baseline build is required for the source-confirmed build-closure finding.
- [x] Correct the smoke fixture by injecting only the reviewed helper/setup program into disposable storage using argument-array subprocess APIs; no shell interpolation of secrets, no real database and no dev credential file. Exercise existing budget reserve/settle API without inference. Do not include session tokens in reports.
- [x] Close the build-stage test prerequisites before `RUN pnpm test`: provision Git in the build stage only; narrowly admit parent directories and exactly `fixtures/scope-held-out-cases.json`, `fixtures/scope-baseline-cases.json`, `docs/verification/scope-evaluation-contract.json` and `docs/verification/scope-evaluation-case-notes.json` in `.dockerignore`, then copy those exact four public files into the build stage. Preserve the existing source/test checks, case labels and frozen generation bytes. Do not admit whole docs/evidence/private directories or skip failing tests. Because the context now admits additional fixtures, replace the broad final runtime `COPY fixtures/` with the existing runtime-required `scope-judgment-cases.json` only. Keep Git and the four test-only inputs out of the final runtime; verify their absence in the runtime smoke footprint.
- [x] Rebuild/rerun the focused group GREEN, then `npm.cmd test`. Review the C5 changes including `Dockerfile`/`.dockerignore` and commit/push its explicit allowlist before packaging so a truthful reviewed SHA exists. The following exact-commit Docker build proves the complete current build-stage test/input/tool closure; a host-only suite does not supply that proof.
- [ ] Run Docker build with that exact `SOURCE_COMMIT` and intended `PUBLIC_BASE_URL`, a task-specific image tag, then `node scripts/check-container.mjs <tag>`. Expected: health/anonymous denial, disabled MCP 404, non-root exact runtime production dependency closure, canonical order/session/100000-micro-USD synthetic ledger persistence across container replacement. No real provider traffic. If Docker is unavailable, record the exact blocker; do not call start verified.
- [x] Rehearse backup via `backup-data.mjs` with `SCOPE_SETTLE_DATA_DIR` set only to disposable fixture storage. Restore that matching backup into another disposable directory, migrate/start it, and verify immutable approvals/acceptance/packet attachments, budget, reset tombstones and cross-run denial. The existing budget ledger is never reset or copied to create spend capacity.
- [ ] Record image ID/digests, source SHA, plugin ZIP/checksum, schema version, persistence/restore results and no-provider evidence. Clean only uniquely named disposable runtime resources created by the runner; preserve images/logs/checkpoints as needed, never prune unrelated resources. Reconcile stale public B/C task statuses against actual closure evidence.

### Task 9: Finish local acceptance and prepare the exact qualification bundle

**Files:** create `docs/verification/agent-integrations-a-c-closeout-2026-10-24.md`, `docs/verification/a-c-closeout-runbook.md`; update the main roadmap's current status and relevant setup/judging docs. Private artifacts stay in this plan's workspace.

**Interfaces:** one sanitized gate register with fields `{gate,requiredEvidence,candidateCommit,status,artifactRefs,observedAt,reviewer,blocker}`. Distinguish `local_pass`, `external_pass`, `pending_access`, `pending_authorization`, `pending_eligibility`, `failed`. Package source/ZIP hashes and evidence without credentials, hidden reasoning or raw provider bodies.

- [x] Reconcile B01–B13 and L01–L05 individually: fixed with regression, already closed with original evidence, retained contract with rationale, or external gate with named prerequisite. Include all remaining optional/T18–T22 roadmap entries without claiming them implemented.
- [x] Perform a whole-closeout main-session review; no independence claim. Verify final tested source/build identities, exact checkpoint and all primary protection fingerprints/status. Do not rerun an unchanged full suite solely for documentation; cite the last matching tested candidate.
- [ ] Publish the reviewed documentation allowlist; refresh source/artifact identity if the packaging contract includes these files. Prepare minimal exact external actions, expected observations and rollback before requesting their final authority. A local blocker in one external tool does not stop unrelated local preparation.
- [ ] Prepare a candidate qualification deployment before Task 11: exact reviewed image/plugin, public HTTPS origin, isolated synthetic database, callback routing, scoped access, sandbox credential configuration and rollback. After explicit deployment/account authority, stage that candidate on an isolated qualification endpoint or an explicitly approved existing target; verify its source/image identity, health and flags. Do not assume the older hosted release contains new routes. If staging authority/access is absent, keep Task 11 pending while local preparation continues. This is a separately gated deployment prerequisite, not production promotion or implied permission to mutate provider configuration.

### Task 10: Qualify the current evaluation runtime and budget (C6)

**Files:** new dated current contract under `docs/verification/`; private history-bound allocation, results and semantic-review worksheet. Use the Task-3-updated `app/scripts/eval-assessments.mjs` / existing `evaluate-ai.mjs`; the generation request/prompt/schema implementation remains unchanged.

**Interfaces:** existing `freezeEvaluationContract({root,files,inference})`, `verifyEvaluationContract`, `createProductionEvaluator` and `verifyEvaluationAllocation`; retain original `scope-evaluation-contract.json` unchanged. New identity must honestly say current source manifest and point to the reviewed commit, rather than relabel the old freeze.

- [x] Freeze the final current runtime file set and actual runtime inference identity; verify every hash. Run validation-only CLI with `--fixtures ../fixtures/scope-held-out-cases.json --output-label a-c-closeout-validation --contract <new-contract>` from `app/`. Expected 34 held-out scenarios/43 items validated, original unsupported exclusions retained, zero provider calls; no performance/accuracy claim from validation.
- [x] Audit the existing designated ledger and all other allocations without printing secrets or resetting history. Prepare a history-hash-bound allocation, remaining balance, per-call conservative reservation estimate and full-run affordability. Stop/drain the server before any approved live CLI takes ownership of the same ledger.
- [ ] Only after explicit paid-run authority, execute the existing `--live --ledger <existing-path> --allocation <reviewed-private-json>` invocation against the new contract. Record full/partial actual denominators, caching, failures, latency and charged cost; remain under combined $25. If it cannot fit, record budget-blocked/incomplete and the concrete gap; never invent a new allowance.
- [ ] Review each quote/conclusion against frozen labels. Required proposed bar: zero false billable included/ambiguous decisions, zero duplicate-proposal invariant failures and at least 90% recognition of clearly new work. Failed semantic cases stay visible; no tuning on these held-out labels. Attach qualified review/results or record the exact unresolved gate.

### Task 11: Prove provider/native behavior and independent usability (C6)

**Files:** evidence/runbook sections prepared in Task 9; sanitized dated verification results. **Prerequisite:** Task 9's authorized qualification deployment is reachable at the intended public HTTPS origin and matches the reviewed candidate; source/artifact identity and callback routing are checked before any claimed provider/native proof. Product code changes only if a reproduced failure returns to its owning local task.

- [x] Prepare one exact candidate-bound sandbox/native script: fresh isolated access → approved $100/$150 schedule → real deposit buyer checkout → signed callback receipt/verification → durable exact-invoice retrieval → start work/native readback → requested changes/replacement → exact client acceptance → one unpaid balance invoice → timed reminder qualification below → actual balance checkout → restart/reopen. Expected record identities, amounts, review hashes and durable history agree. Separate automatic callback proof from manual refresh.
- [ ] Schedule the real reminder before the selected invoice's checkout. Leave the balance fully unpaid until at least 24 actual hours after the later due-trigger/issue eligibility timestamp; alternatively identify a separately authorized candidate-compatible fully unpaid invoice already old enough. Use renewable designer access whose parent remains valid at dispatch, and freshly confirm/renew the exact reminder policy after the waiting period so its bounded expiry does not precede eligibility. Record actual eligibility, policy consent/expiry, dispatch and provider-acknowledgement times, then continue checkout. While waiting, mark only this gate `pending_eligibility` with its actual earliest time and continue unrelated work. Do not backdate records, change clocks/cadence, lengthen authority, refill lifetime counts or label simulated sends as external proof.
- [ ] With explicit external authority/access, execute it in the intended sandbox and Figma account/file. Prove actual MCP discovery/assessment/draft, plugin-closed inbox/replies, status-card refresh/reopen, native draft criteria and the eligible new exact-installment reminder. Use approved existing AI allocation for any real assessment; no hidden paid work. Keep notification acknowledgement separate from recipient delivery.
- [ ] Prepare the exact image-containing export for a separate human reviewer. They trace scope/version/consent, replacement acceptance, image hashes, invoice associations, timestamps and external/refund qualifications against authenticated originals. Record their identity and verdict; the main session cannot self-supply independence.
- [ ] Observe 2–3 real designers completing the flow and record task time, mistakes, recovery and feedback. Request no recruitment messages without explicit authorization. If native draft quality fails agreed criteria, make a bounded standard-PluginAPI correction and repeat that proof; do not enable unverified beta generation.
- [x] Record each actual pass/failure or access/authorization/human prerequisite separately. No missing actual dispute/refund resource is invented: that functionality remains T21. No fixture, historical payment or successful redirect substitutes for this candidate's required evidence.

### Task 12: Promote the qualified candidate and verify fresh judging access

**Files:** deployment/rollback and judging runbook updates, final source-bound qualification record. Preserve the primary checkout and original data/backups.

- [ ] Prepare the exact reviewed image/plugin artifact, matching backup, migration/recovery commands, flag settings and rollback procedure. Recheck required judging access/window through its official source before changing credential lifetimes. Unverified capabilities remain disabled.
- [ ] Obtain only the still-required production-promotion/account authority after this concrete bundle is ready. Promote the candidate qualified under Tasks 9–11 through the established target, then prove image/source identity, health, persistent state, backup recovery, signed-event processing and the relevant browser/native journey. If the final origin/configuration changes plugin or image bytes, record the new artifact identity and repeat the affected origin/access checks; never call different bytes the same qualified artifact. Deployment success alone is not a release gate pass.
- [ ] Repeat with a fresh user/account session and a second isolated run: no shared reset or record/credential visibility; install the checksummed plugin, recover from expiry/reconnect and reopen the same paid revision. Independent reviewer/user acceptance is recorded, not inferred.
- [x] Final register has actual evidence for every required A–C gate or a named blocker. Declare local implementation, Git publication, container proof, hosted/provider/native/evaluation/human evidence separately. Preserve all checkpoints and leave optional extensions/T18–T22 ready for their own next plans.

## October 25 execution status

Tasks 1–7 are locally accepted and published. Task 8 source and disposable restore pass; current Docker build/start remains pending engine access. Tasks 9–12 have a candidate runbook, current contract validation, read-only ledger audit and named gates. Staging, paid inference, actual provider/native walkthroughs, timed reminder eligibility, independent human review/trials and promotion have not occurred. See the current qualification record and canonical gate register. Unchecked external action boxes remain unchecked deliberately.

## Plan self-review and execution handoff

Coverage: B01/B03/B04 → Task 1 fixes; B02 → Task 1 retained-policy contract; B05 → Task 1 targeted predicate consolidation and Task 5 touched domain boundaries; B06 → Task 2; B08 → Task 3; B07/B09 → Task 4; B10/B11 → Task 5; B12 → corrected package browser runners and Task 9; B13 → Task 8. L01/L03 → Tasks 6–7; draft/native usefulness → Task 11; real disputes/customer identity/retention → explicit T21/T18–T22 follow-on entries. All five review-focus failures have named regressions.

Migrations 17/18/19 follow the accepted schema-16 checkpoint. Task 3 updates both the automatic-queue validator/version handling and evaluator-only safety binding; it preserves ordinary run isolation and full-runtime success-cache identity. Task 6 consumes the shared outbound fence and internal job-handler interface, not a proposal/client grant. Task 7 preserves version-1 packets and the existing authenticated snapshot preview. Task 8 covers canonical draft setup, complete build-stage test inputs/Git, a lean runtime and a reviewed commit. Task 9 prepares and separately gates a public qualification deployment before Task 11; Task 11 schedules an actual eligible unpaid reminder with live consent before checkout; Task 12 is later production promotion. Task 10 uses a new manifest while preserving the original freeze. No unresolved provider, native, budget or human prerequisite is assumed to exist.

Execution remains direct in this session without subagents. User review of this concrete plan precedes product changes; thereafter execute local tasks continuously without between-task approval pauses. Ask only at still-unapproved external/paid/native/deployment boundaries after their concrete preparation is complete. Preserve private workspaces regardless of skill cleanup defaults.
