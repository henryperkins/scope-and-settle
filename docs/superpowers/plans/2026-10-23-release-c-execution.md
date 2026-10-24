# Release C execution supplement

Read-only architectural supplement for T14-T17, authored while A is verified and B is prepared. Task briefs and current product contract remain authoritative. No source/runtime behavior is changed by these notes.

## Shared interfaces and decisions

| Task boundary | Required adaptation |
| --- | --- |
| T14 / T03-T04 | Existing order has one provider invoice and refresh path. Introduce an internal invoice-record/installment boundary; preserve legacy fields and invoice IDs for single-installment consumers. Jobs must resolve an exact invoice record, not accidentally refresh an order's primary invoice for a balance event. |
| T14 / T10-T12 | Reminder/cancel/invoice previews identify the exact installment, order revision, merchant, currency and amount. A balance cannot be issued by a generic prepare action before delivery acceptance. |
| T15 / T08 | Work brief records immutable scope/rate/request/evidence references and explicit allowed file/work area. Plugin PNG/output reports retain client-supplied provenance until actual readback. |
| T16 / T06 | Distinct delivery resource grants need the generalized server-persisted grant machinery established for scope acknowledgement. Proposal grants never authorize replacement delivery acceptance. |
| T17 / all | Packets contain facts and provenance, never hidden reasoning, access credentials, raw provider payloads or unsupported claims about what a client saw. |

## T14 installment subsystem

- Append a recorded migration. Model installment terms with order/revision bindings and invoice records with immutable operation identity, expected provider representation, provider ID and observations. Backfill a legacy order/invoice as exactly one installment without creating a provider invoice or changing approved terms/history.
- New drafts default to the current single upfront payment. An explicit designer schedule edit checks expected revision, editable status, positive integer USD amounts, unique milestone IDs, exact sum to order total, and valid work-start prerequisite references. It bumps revision and invalidates prior review links. Store the complete schedule in the immutable submitted snapshot and display it in client consent.
- New installment invoice numbers derive deterministically from order/revision/milestone and remain within the provider length limit; persist them before network effects. Keep old numbers unchanged. A per-installment operation reuses known provider ID and searches before retry after an uncertain create.
- An installment invoice can represent the approved milestone as its own explicit item (quantity one, approved installment amount). The client still sees the full approved deliverables and original price breakdown plus payment schedule; do not silently reprice or proportionally round original line items.
- Extract the authoritative invoice validation/observation path so both manual order refresh and jobs can reconcile a specific invoice record. Preserve T04 lease/completion hooks and no network transaction. Webhook matching/tombstones/reset cover all installment IDs and operations.
- Do not project an aggregate application summary as a fabricated raw provider status. Add an explicit installment summary. Single-installment legacy DTO fields remain compatible; multiple-installment UIs render each invoice/action separately and suppress a misleading whole-order Pay link.
- Distinguish approved total, currently invoiced/due, future unbilled balance, paid and refunded amounts. A paid deposit authorizes work only through the approved prerequisite list. An agent must not announce the entire order Paid because only its deposit is paid.

## T15 work start and output

- Refresh every invoice referenced by approved proposal-approval work-start prerequisites. Require coherent unreversed payment and recheck exact revision/observation identities inside the transaction that creates one idempotent DeliveryRun.
- Never require the delivery-acceptance balance before starting the work whose acceptance releases it. Missing, reversed or uncertain deposit evidence requires review.
- Persist a delivery brief from approved facts: scope/revision, relevant evidence/nodes, criteria, satisfied payment observations, allowed file/work area and operation identity. Designer explicitly starts work.
- Standard Plugin API output creates a dedicated draft page/area and preserves original nodes. Validate file/area before mutation and record generated node IDs plus a review-image snapshot. Loading fonts/generation completion is not client acceptance. Specs/beta MCP generation/Code Connect remain unavailable unless independently verified.
- A later reversal preserves generated/accepted historical facts and sets financial review; it does not delete design work or claim Figma editing access is restricted.

## T16 delivery acceptance

- DeliveryReview binds exact output snapshot/hash, order revision and review revision. Issue a client delivery grant for that resource/revision. Replacement output creates a new review revision and cannot be accepted through an obsolete link.
- Client sees the actual snapshot and checklist, may request changes, or explicitly accepts with the consequence of releasing the approved balance invoice shown in the UI. Use a unique acceptance key and transactional compare-and-set to prevent concurrent duplicate acceptance.
- Save acceptance before network creation; recover the same balance operation after failure. No balance POST before the required acceptance. Approval, delivery, payment and later reversal remain separate fields/history.

## T17 evidence packets

- Export versioned JSON plus escaped portable HTML (or a ZIP containing both) with a manifest/digests. The server stores a scoped packet identity and serves downloads through authenticated fetch/blob flow, never a bearer credential embedded in a shared URL.
- Include only selected authorized original brief/acknowledgements, approved additions/items, exact revisions, consent/delivery acceptance, invoice associations and authoritative observation times. Label provided/demo identity, client-supplied image provenance and inferred relationships.
- Redact credentials/tokens, provider secrets, private links, hidden reasoning and unrelated files. Retain cancellation/refund/reversal and changed-delivery history; do not claim payment, delivery, settlement or client viewing from an approval alone.
- Tests cover wrong-run exports, replaced snapshots, partial/refunded installments, an interrupted restore and source-to-packet fact/hash comparison. Real installment payment, native output/readback and independent packet review remain external release gates.

## Local progression rule

Full roadmap implementation is authorized, but actual hosted/native/account-access/human-evaluation gates are separate. Preserve each release's reviewed local source checkpoint and evidence. Unverified capabilities remain disabled rather than gaining authority from a passing fixture.
