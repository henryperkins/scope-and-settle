# A–C deferred-work closeout design

Status: user approved direct local implementation and verified-increment commit/push, October 24, 2026. Base: `7020cb06c24406ca7b59eaaa795c6bb6fca0f714`, accepted local T17 with 524/524 tests. This document is not implementation or external release approval.

## Intent and agreed scope

Finish the existing scope → approval → installment payment → draft → delivery review → acceptance → balance → evidence workflow. Resolve its carried code/test findings and establish a repeatable qualification path before expanding the product.

The user selected **A–C closeout first, then extensions**. T18–T22 remain on the roadmap. Orders direct checkout, partial-payment configuration, usage billing, multi-currency, payouts/platform fees, agency-wide connector publication and broader native/beta generation retain separate feature plans and access gates. This sequencing does not delete them from the roadmap.

The user also selected **add both opt-in automatic installment reminders and reviewed image attachments, retaining manual and metadata-only defaults**. Their precise contracts and implementation choices are below.

Success means a disposition for every carried finding, passing appropriate local checks, an honest source-bound artifact, and separately recorded external evidence. A passing fixture never supplies provider access, personal identity, human review or native-client proof.

## Approaches and choice

1. **Close A–C, then extensions — selected.** Repair current authority/recovery/protocol/QA debt, finish the agreed small workflow additions, build the reviewed artifact, then qualify the exact candidate. Optional products do not delay current-workflow acceptance.
2. **Expand every optional capability now — not selected.** This introduces new identity, merchant, currency and billing designs before the current candidate is qualified.
3. **Only relabel limitations in documentation — not selected.** Correct stale records, but retain actual defects as open until corrected and tested. An intentionally retained behavior needs an explicit rationale and acceptance.

## Constraints

- Sole implementation workspace: `C:\Users\htper\.codex\worktrees\ab1b\paypal-hackathon`. Work directly without subagents. Preserve the primary, judging-access and paid-figma-connection checkouts, accepted checkpoints and historical failed evidence.
- Keep Node 24, TypeScript, SQLite, one process per database, the current vanilla browser/plugin interfaces and existing PayPal invoice route.
- Exact-revision approval, immutable approved terms, scoped human authority, due-trigger eligibility, known create acknowledgements, shared outbound cadence/locks, reset tombstones and durable budget history remain mandatory.
- Unknown provider sends never become fresh notification retries. Reconciliation uses verified read-back; local bookkeeping never manufactures financial proof.
- Preserve Baseten `deepseek-ai/DeepSeek-V4.1-Flash-1017-Fast`, reasoning `max`, original T13 freeze/labels and generation implementation. No held-out tuning or silent replacement of the historical contract.
- The combined development AI cap remains $25 across existing allocations/history. No fresh allowance, empty ledger or inferred approval to spend. Local fixtures use fake providers.
- Existing feature-branch commit/push authorization permits reviewed explicit path allowlists. Deployment, paid inference, real provider/account actions and native writes retain their separate authorization boundaries.

## Work packages and closure evidence

| Package | Work | Required closure |
| --- | --- | --- |
| C1: source and action recovery | Read-start ordering for missing/recovered source observations; stale source UI; cancellation retry guidance and authority loss after awaited read; upgrade-safe assessment uncertainty | Deterministic old-read/new-recovery and same-byte recovery tests; stale links suppressed while server guards stay effective; post-read revocation denied; interrupted/uncertain paid work cannot be silently redispatched by a code-only upgrade |
| C2: connector and test contract | Disabled credential status; malformed revoke path; transport timeout/error responses; typed errors at owned domain boundaries; immutable production limits; narrow MCP module extraction; stronger protocol/auth/waiter/browser tests | Correct bounded status/error replies for both pinned protocol eras; no echoed untrusted details; admitted work remains counted after disconnect; explicit authority assertions and deterministic join/response signals; unchanged legitimate client workflow |
| C3: installment reminder automation | Exact-record, freshly consented reminder policy, described below | Shared manual/automatic cadence, exact installment/revision/recipient/merchant binding, no reminder for paid/cancelled/not-yet-due/unknown records, no notification replay after uncertainty |
| C4: reviewed image attachment | Optional exact retained delivery snapshot attachment, described below | Authenticated scope/revision/hash checks; exact image/manifest byte agreement; safe portable preview; changed/missing/oversized source refuses without storing a partial packet; default remains metadata-only |
| C5: artifact and recovery proof | Repair stale container smoke proposal fixture; include the four exact public T13 test inputs and Git in the build stage; reviewed-commit packaging, runtime smoke and disposable backup/restore rehearsal; reconcile stale public task statuses | Production canonical-item guards and frozen generation bytes unchanged; no provider traffic; full build-stage test closure; Git/test-only inputs excluded from non-root runtime; session/order/budget persistence across container replacement; manifest/source identity and restore isolation recorded |
| C6: provider/native/human qualification | Candidate-bound real installment and signed-event walkthrough, Figma connector/inbox/card/delivery proof, bounded live evaluation, independent evidence review and designer trials | Actual observations with exact candidate/resource/time identities; recorded failures and unknowns; no substitution of fixtures or historical release proof |

C1 and C2 are independently reviewable local increments. C3 and C4 follow their relevant authority and recovery fixes. C5 follows stable local source. Evaluation/native procedures and reviewer checklists can be prepared earlier; executing external steps depends on their access and authorization. Remedial code changes return to the affected local package before that proof is repeated.

The new assessment reference must travel through explicitly versioned automatic-job serialization/validation, including recoverable old jobs. Evaluator uncertainty uses a separate CLI-owned semantic-case binding while full runtime identities/caches and ordinary project/run isolation remain intact; unprovable legacy associations require review. These are part of C1, not assumptions left to later qualification.

## Carried findings: explicit disposition

| Inventory group | Disposition |
| --- | --- |
| B01 old source-loss observations; B03 missing/weak source tests; B04 unavailable-source review link | C1 fixes and pins the behavior |
| B02 legacy consented changed-source automatic assessment | Retain existing explicit policy delegation; add a contract regression and explain it. Recovery alone must not create a new authorization or reset spend/counts |
| B05 duplicated freshness checks and dense request-item logic | Consolidate touched authority/freshness predicates behind focused helpers. Avoid a whole-service rewrite or unrelated formatting |
| B06 cancellation projection hint and swallowed authority loss | C1 distinguishes retryable read failure, changed association and ended authority; preserves known provider outcome and never resends |
| B07 connector forbidden-call/portal coverage and timed waiter | C2 checks exact denied authority with an eligible-designer positive control and deterministic scheduling signals |
| B08 implementation-hash/cache behavior across upgrades | Preserve audit provenance separately from unresolved logical work. A code-only identity change must not authorize a duplicate uncertain dispatch; conservative incomplete historical association requires review, not fabricated migration proof |
| B09 malformed revoke URI and active label while endpoint disabled | C2 returns a sanitized client error and truthful inactive/disabled presentation; no credential gains authority |
| B10 legacy timeout, unknown-tool reflection and message-pattern error mapping | C2 uses the pinned SDK's actual transport contract and stable sanitized codes. Typed owned-domain errors replace fragile matching; any unavoidable legacy adapter is named and covered |
| B11 dense MCP module, mutable test limits and incomplete protocol coverage | Extract focused schema/error/transport boundaries where touched; freeze production limits and use a trusted fixture configuration seam; cover both eras |
| B12 historical browser timing races | New closeout runners wait for the actual HTTP/DB condition. Preserve original runners/logs as historical evidence |
| B13 container smoke uses old proposal body | C5 seeds a synthetic canonical request/assessment in disposable storage, then exercises the real public draft route with item IDs/operation identity. No production legacy-draft fallback |
| Already fixed budget/retry/source-binding/wording/loading/caption findings | Mark resolved with their existing evidence; do not repeat their implementation or rewrite accepted history |

Earlier Minor severity is historical, not a promise that current triage cannot find something more serious. Newly reproduced financial/authority defects block their local package and relevant release proof until fixed.

## Installment-reminder contract

- Explicit designer opt-in is new, versioned consent for installment reminders. Existing `paypalReminders` policies do not silently gain installment authority. Manual actions remain available; AI/MCP cannot opt in or send reminders.
- Bind automation to the scoped run, active policy owner/version, exact approved order revision, exact installment/invoice record and reviewed recipient/merchant. A fresh revision, reset, disconnect/revocation or disabled/expired policy prevents dispatch, including after awaited reads.
- Remind only an already issued, currently payable installment after its approved due trigger. A deposit and balance are separate records. The balance receives no reminder before delivery acceptance; age is measured from its actual eligibility/issue time, not the earlier proposal approval.
- Preserve the existing 24-hour minimum cadence and two-automatic-reminder lifetime cap per invoice. Human and automatic attempts share outbound locking/cadence and coalesce pending work; paid, refunded, cancelled, externally marked or uncertain/review-required states refuse automation.
- Retrieve and validate the authoritative invoice immediately before sending. Persist dispatch before the non-idempotent effect; retain a known acknowledgement. Lost/unknown responses require read-only reconciliation or human review, never blind replay.
- Show which installment was reminded, when, by which policy and whether the provider acknowledged it. Acknowledgement does not establish recipient delivery.

## Image-attachment contract

- Metadata-only export stays the default. The designer first sees the exact saved delivery image and separately elects to attach it. No automatic visual redaction, independent verification or client-viewing claim is introduced.
- Selection binds snapshot ID/hash, order revision, review revision and current authenticated scope. Select the current submitted/accepted review for each delivery milestone; replaced versions retain their metadata/history. Replacement or stale selection requires a fresh preview and consent. An accepted version remains explicitly identifiable; an unaccepted draft is never labeled accepted.
- Read only the selected immutable stored PNG bytes, validate them against the existing snapshot/image hashes and preserve `client_supplied` / `client_plugin_claim` provenance. Never fetch arbitrary URLs or export an entire Figma file.
- Store immutable attachment bytes with the packet. A versioned manifest covers every downloadable attachment plus exact JSON/HTML bytes. Old version-1 metadata packets remain readable and unchanged.
- Keep portable HTML self-contained and escape every supplied string. Permit only the specific local/data image representation needed by the renderer; scripts, remote assets, navigation and credential-bearing links remain unavailable. Preview remains sandboxed and downloads remain authenticated fetch/blob operations.
- Implementer-selected limits for review: at most four selected PNGs, each at most the existing `1_500_000` validated PNG bytes, and no more than `16_777_216` bytes (16 MiB) for the complete export representation including embedded HTML image data, downloadable attachments and manifest. Keep the existing 4,000,000-byte JSON/HTML cap for metadata-only packets. Validate the total before storing; refuse with a clear message and preserve metadata-only fallback. Do not resize, replace, truncate or silently drop evidence.
- Downloaded copies are shareable local artifacts. Require an explicit acknowledgement that selected image contents were reviewed and are not automatically redacted. Retention/customer enablement remains T18; existing demo access is not real identity.

The attachment limits and current-review selection are implementation choices proposed by the implementer, rather than additional requirements attributed to the user. They are explicit in the companion plan for review.

## Qualification, ownership and prerequisites

The main session owns code, fixture tests, browser runners, local artifact/restore proof and evidence preparation. The user supplies account access/explicit authorization when an actual external action is due. A separate human reviewer supplies independent native/packet judgment; the main session cannot self-certify independence. Designer observations must come from actual participants; no messages are sent to recruit them without authorization.

For each external step, prepare the exact candidate artifact, minimal action list, expected resources, recovery procedure and sanitized evidence fields before asking for its final authorization. No credentials, private bearer links, raw provider bodies or hidden reasoning go into reports.

1. Build the reviewed commit with a real 40-character source identity; exercise container start, health, canonical draft, restart and budget persistence on uniquely named disposable storage. Rehearse matching-backup restore/migration and run isolation without touching protected data.
   Prepare the exact candidate on a public HTTPS qualification endpoint before native/signed-callback walkthroughs, and execute that staging deployment only with explicit deployment/account authority. Use isolated synthetic storage or an explicitly approved existing target, source/image identity checks and rollback. An older hosted release cannot qualify new routes. Production promotion follows qualification rather than being the first deployment.
2. Freeze a separately reviewed current evaluation manifest without changing the original T13 freeze/labels. Audit all existing designated ledger allocations/history, estimate reservations, and execute only within the remaining approved combined $25 allowance. If the complete run cannot fit, report an incomplete gate and the concrete budget gap; do not reset or invent a budget. Review each conclusion/quote against the held-out label and retain full denominators, cost and failures.
3. Qualify actual supported-client Figma discovery/invocation, background inbox/replies with the plugin closed, status-card refresh/reopen and native draft/output readback in the intended file/account. Designer review determines whether the standard draft meets the agreed criteria; any failed criterion becomes a bounded correction before a pass is recorded. Broader native/beta generation remains a separate extension.
4. Exercise real sandbox deposit checkout, authoritative signed-event/job reconciliation, work start, changes/replacement, exact client acceptance, balance invoice, eligible reminder, balance checkout and restart persistence. Before the reminder, keep its invoice fully unpaid for at least 24 actual hours from the later due/issue eligibility time, then freshly confirm/renew its bounded policy under a parent valid at dispatch. A separately authorized already-eligible candidate invoice is an alternative. Record real timestamps; never backdate, shorten cadence, extend authority or refill lifetime counts. Keep the timer gate pending while unrelated work continues. Repeated events/actions must preserve one identity and history. Refund/cancellation/reversal claims need actual eligible evidence; fixtures remain separately labeled.
5. Have a separate reviewer trace an export to the saved scope/request/review/payment records and inspect selected images where included. Observe 2–3 designers completing the workflow; record task time, decisions, recovery and feedback without invented impact metrics.
6. After local and required external proof is accepted, prepare production promotion/rollback and fresh isolated-user/judging checks. Actual promotion remains a separate final authorization; previous dated deployment evidence is retained with its original source identity. Origin/configuration changes require updated artifact hashes and the affected access checks.

## Acceptance record

Every item records its original finding, chosen contract, changed paths, RED/GREEN or existing closure evidence, reviewer identity, source/artifact identity and residual limitation. Use separate states for locally fixed, deliberately retained/accepted, externally verified and blocked with a named prerequisite. An unavailable optional capability is not called a verified feature.

Run focused tests for each meaningful correction, only the browser flows touched by it, and one full suite for each stable reviewable increment. Repeat only after changes or failures justify it. Update checkpoint/hash/protected-checkout evidence after modifications, preserve failed logs, and publish only reviewed path allowlists. Main-session review is explicitly self-review.

Closeout ends when C1–C5 are locally accepted and every required C6/deployment gate has its actual evidence, or a clearly named external blocker remains. T18–T22 and separately scoped optional features retain their roadmap entries and dependencies. No carried issue disappears solely because a document calls the release complete.

## Design review

The A–C-first sequence and both reminder/image additions are confirmed by the user. The companion [implementation plan](../plans/2026-10-24-a-c-closeout.md) specifies files, interfaces, regression assertions and commands. Execute directly without subagents. Main-session design review maps all B01–B13 findings and C1–C6 packages; independent external review is still a separate gate.

The requested Astra max review is complete. Its whole-plan pass found one Important container build-closure omission and one Minor timed-reminder qualification issue; both were source-validated and incorporated. The same reviewer's focused recheck marked the design and plan Ready, with no remaining Critical, Important or Minor findings. The initial interrupted pass, reviewed input versions and both completed reports remain preserved in the private review workspace. The user subsequently authorized direct local implementation and verified-increment commit/push. Task results remain separately recorded; this technical design review supplies no product test result or external/human qualification.
