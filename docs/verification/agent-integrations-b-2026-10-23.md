# Release B local implementation record

Current-status supersession, October 25: the [A–C closeout record](agent-integrations-a-c-closeout-2026-10-24.md) records the completed local review/fixes, current evaluation freeze/validation and exact remaining external gates. The dated results and stopping points below remain historical; they do not replace the current 575-test candidate record.

Status, updated 2026-10-24: accepted locally through T12b at `controller-t12b-approved` (T01-T10, T11a/T11b/T11c, T12a/T12b). T13 and the whole-Release-B review/minors wave remain pending. The external Release B acceptance gate has not passed. The earlier stopping-point and T12a sections below are historical.

This record covers local changes based on `68623c0c728faf657b885a319320a539cd9c83db`, following the [roadmap](../superpowers/plans/2026-10-23-agent-integrations-checklist.md) and [Release B execution decisions](../superpowers/plans/2026-10-23-release-b-execution.md). Changes remain uncommitted in an isolated worktree. The [accepted local Release A record](agent-integrations-a-2026-10-23.md) provides the 217-test starting point; its changed-candidate external gates remain separate.

## Local checks

| Task | Implementation/review status | Observed checks |
| --- | --- | --- |
| T06 scope ledger | Complete locally; independently reviewed after portal projection fix | Final suite 244/244; focused scope/order/service/portal/HTTP checks 64/64; zero failed, skipped or cancelled |
| T07 request items | Complete locally; independently reviewed after three-boundary fix | Final suite 286/286; focused 140/140; zero failed, skipped or cancelled. Exact-review-reference and two-partial browser checks passed |
| T08 design evidence/cache | Complete locally; independently reviewed | Full suite 307/307; focused 161/161; zero failed, skipped or cancelled. Evidence UI and retained two-partial browser checks passed |
| T09 background inbox | Complete locally; independently reviewed after three-boundary fix | Fix suite 350/350; focused 233/233; zero failed, skipped or cancelled. Four browser flows passed; all three findings closed |
| T10 reviewed actions | Complete locally after delayed-cancellation projection fix and scoped re-review | Full 385/385; focused 167/167; four fixture browser flows passed |
| T11 connector | T11a, T11b and T11c complete locally; T11c scoped re-review ran in the main session | Accepted full suites 399/399, 417/417 and 434/434 respectively; schema migration 10; connector disabled by default; actual Figma invocation and container start remain external gates |
| T12a human-confirmed preparation | Complete locally after main-session review and recovery authority fix | Final full 441/441; focused 112/112; zero failures, skips, cancellations or todos. Legacy action regression and new preparation/outcome-check browser flows passed at desktop and 390px |
| T12b linked status card | Complete locally after main-session review; actual native execution remains unverified | Final full 459/459; focused 67/67 plus final native-bundle 11/11; zero failures/skips/cancellations/todos. Evidence-export, legacy reviewed-action and new card browser flows pass, including 390px. Native tests use the actual built bundle with an API fake |
| T13 | Pending implementation | Held-out evaluation and remaining Release B qualification |

T06 browser checks used a disposable synthetic application with outbound provider fetches blocked and both workers disabled. Two exact scope-version views, explicit v1 acknowledgement, unacknowledged v2, same-tab navigation, designer link issuance and 390px mobile layout passed without browser errors. These checks establish local Chromium behavior. Scope acknowledgement remains separate from proposal approval and invoice execution. Migration 4 preserves immutable scope/rate versions and historical provenance without inventing client acknowledgements.

Independent review identified portal action responses that bypassed scope-context redaction. The fix uses the same safe projection for every approval/recovery/refresh response. Six real-HTTP regressions failed on disclosure before the fix and now pass; scoped re-review closed the finding without new blocking issues. An existing portal authority-revalidation limitation was carried into T07, which changes these actions for partial proposals.

T07's isolated browser flow used fixture-only Figma/model/PayPal transports and a fresh SQLite database. The designer selected two separately priced additions while an included correction remained disabled and unpriced. At 390px the portal showed two exact consent forms; approving one left its sibling unapproved. Two distinct fixture invoices and exact per-order refresh produced two independent Paid cards. No overflow or browser errors were observed. This does not establish real inference accuracy or provider execution.

The T07 review reproduced three additional local failures: omitted item references permitted an unreserved manual draft, a stale split child could overlap a newly reserved combined item, and a stale pricing/duplicate-decision form could authorize a newer assessment. The fix requires canonical item IDs and an operation ID for every new manual draft, rechecks live conflicts inside the reservation transaction, and compares the exact displayed assessment/source/context/terms reference before recording a decision or price. The raw creation affordance now leads to authoritative request-item review; existing-order editing remains available. Fourteen regressions/integration cases were added, and scoped re-review closed all three findings without new blocking issues. The updated browser flow verifies actual pricing/decision HTTP bodies carry the displayed references.

T08 adds immutable source-bound design snapshots and shared durable assessment attempts. Node identity is verified separately from client-supplied pixels. Local checks cover file/node/anchor/relevance binding, PNG bounds and decoding, byte-free read responses, revocation during shared work, stale native exports, financial-only cache stability and a real fresh-Node recovery with no repeated inference. Its isolated browser flow verifies explicit relevance, evidence provenance, cache reuse and 390px layout; the T07 two-partial/Paid flow also remains green. Independent review approved the local gate without blocking findings. After the final suite, a nonfunctional plugin comment encoding fix rebuilt to the same SHA-256 values for all 35 compiled outputs; no executable behavior changed. Diff checking passed with informational LF/CRLF warnings.

T09 adds authenticated durable Figma intake, authoritative thread refresh, explicit versioned owner consent, independent bounded scheduler lanes and scoped recovery. Review closed three reproduced defects: inbox-owned work is fenced from legacy automatic notifications/reminders, typed per-thread bounds/cap failures preserve valid peers while real database failures remain atomic, and manual Figma assessment persists exact request/source linkage across reload and human publication. Four browser flows and 350 tests pass. Native/provider delivery remains unverified. A regression initially refreshed an older private screenshot folder; original logs and accepted source snapshots remain separate, and fix regressions now use unique timestamped folders with original-runner hash checks.

An inherited, source-inspected freshness gap remains assigned to T11: known unavailable source state does not itself fence every old-item reservation/submission/pending-approval path. T11 must close and regression-test it before connector exposure and the local Release B gate, preserving approved history and commitments. This does not reopen the three T09 fix findings or establish a deployed acceptance pass.

## External evidence still required

Account access update, 2026-10-24 05:06:56 UTC: the connected official Figma account tool confirmed the user's purchased Professional Dev seat on the main team. The separate judging team remains Starter/View. This verifies the seat, with team-specific Code Layers availability, but does not establish target-file permissions, webhook access or actual connector operation.

- Changed-candidate hosted callback, native plugin and fresh-user acceptance from Release A.
- Actual Figma selection/export with verified file/node access and the supported native bridge.
- Actual comment webhook delivery updating the inbox while the plugin is closed.
- Discovery and read → assessment → draft through the actual supported Figma custom connector, followed by the human-confirmation and canvas-card checks.
- Frozen held-out evaluation through the existing designated budget ledger and remaining allocation. No paid model evaluation has run in this implementation batch.
- Observed trials with 2–3 designers. No task-time, impact or willingness-to-pay observations are claimed.

Fixture tests, synthetic browser checks, provider documentation and inherited historical evidence do not satisfy these gates. No new provider/account mutation, financial action, publication or deployment occurred.


## Historical stopping point — 2026-10-24, before T10 fix and T11

The user requested a stopping point before T11. T10 source and generated outputs are preserved in a local recovery checkpoint; no fix batch or T11 implementation was started. All 24 maintained-file hashes and 40 build hashes match the final tested candidate. Existing primary-checkout files and Git status remain unchanged.

Independent T10 review found one Important defect: a later retry can reconcile an uncertain cancellation as authoritative `CANCELLED` while leaving the local order `payment_due`/payable. The private synthetic reproducer makes one provider write and no resend, then fails the financial-projection assertion. The existing 379-test suite passes but does not cover this delayed path. Next work is a maintained regression and fix, preserving single-send recovery, authority checks and approved commitments, followed by focused/full tests and scoped re-review. T10 remains unaccepted.

T11-T13 remain unimplemented; T11 has read-only source-freshness and SDK preparation. T14-T22 remain pending. No commit, push, deployment, paid inference or real financial action occurred. The uncommitted worktree, reports, failing reproducer and checkpoints are retained for resumption.

## Resumed local acceptance — 2026-10-24

T10's delayed cancellation projection is fixed and accepted. T11 adds a persistent known-unavailable source fence, digest-only operation-bound connector authority and budget reservations, and the pinned SDK v2 Streamable HTTP endpoint. The runtime production-dependency closure and Linux build-stage suite were checked previously; container start remains deferred until a reviewed commit can be packaged. The endpoint remains disabled by default.

T12a adds opt-in submission/invoice preparation tools with zero publication, approval, invoice, provider or inference effects during preparation. The separately authenticated owning designer reviews exact terms and confirms once through the existing same-origin reviewed-action route. Invoicing additionally requires persisted client approval of the exact revision and reuses the existing invoice operation. Private client links appear only in the human confirmation response. Uncertain actions expose a read-only outcome check; the browser fixture creates and sends one invoice across recovery and reload.

Fresh verification corrected the supplied build-complete claim: the saved T12a build log contained two TypeScript errors. Those interface errors were fixed, and the initial passing full suite was 440/440. Main-session review then reproduced an invoice-reconciliation fallback returning a saved result after the owner session was revoked during provider retrieval. A maintained failing regression preceded the scoped fix. Final focused/full results are 112/112 and 441/441; the accepted T10 acknowledgement contract remains unchanged. No independent reviewer is claimed for this main-session review.

The legacy browser runner's immediate database assertions failed twice before refresh requests completed. A new task-local copy waits for the exact successful refresh response; the original runner and failure logs remain intact. Its four action flows then passed. The new browser runner covers default-off permission selection, both exact previews, consent, two partial proposals, private-link redaction, uncertainty recovery and 390px layout, with no browser errors or external provider actions.

At T12a acceptance, portable agent instructions were written but not installed or invoked in the actual supported Figma client; T12b card work, the sealed T13 evaluation and designer observations remained pending. The Release B minors wave included the two required T11b budget/attempt fixes and a diagnostic correction: an invalid-allowlist message still says four connector operations although six are available. No commit, push, deployment, paid inference, live financial action or provider/account mutation occurred.

## T12b local acceptance — 2026-10-24

The linked card uses a designer-only, exact-revision stored-status projection and an authenticated nonsecret order/run landing URL. Migration 11 adds a versioned project/run display setting, default off. Only an authenticated browser designer can opt in; the plugin, connector and native messages cannot enable it. Hidden monetary fields and explicit monetary text are removed before native projection. Original approval terms remain unchanged. Approval, invoice/payment, unknown delivery and provider/app/card timestamps remain separate; the card always carries a cached-snapshot label.

The async native operation is exercised through the real built main bundle with a small Plugin API fake. It preserves one scoped node across repeated/concurrent updates, other pages and reopen; replaces a deleted mapped node; recovers a current-page orphan; rejects foreign/ambiguous mappings and stale projections/policies; and preserves selection, card position, unrelated children and held evidence export. Font/mapping failures do not report success or delete existing cards. No Dev Resource or Code Layers writes are implemented.

Maintained regressions reproduced and closed overlapping document-map loss, placement over selected designs, explicit monetary text escaping an off policy, and an unapproved card saying Approved total. A real browser regression also reproduced and closed an older card read completing after another proposal was opened. Final full verification passes 459/459, with no failures/skips/cancellations/todos; the prior focused set passes 67/67 and the final native set 11/11. Three browser flows pass without browser errors. All provider/model transports were synthetic, and the card browser flow causes no additional provider or AI work.

One UI feedback minor is deferred: cancelling a held card read can leave its earlier loading message until the next invocation; no native edit occurs. The two mandatory T11b budget/attempt fixes and the T12a diagnostic minor remain queued. T13 held-out labels have not been opened. Actual native Figma execution, target-file access, connector/chat comparison, instruction installation, paid evaluation, designer observations and deployment remain unverified. The protected primary checkout remains unchanged. No Git write, provider/account mutation, native Figma write, paid inference or deployment occurred.
