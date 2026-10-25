# Factual evidence packets

In the designer workspace, open **Factual evidence export** on an approved order and select **Build metadata packet** (default) or **Review delivery images** to preview and explicitly attach current reviewed delivery snapshots. Inspect the preview, missing-evidence notices and redactions before downloading or sharing the JSON, portable HTML, digest manifest and any selected PNG attachments. Building and downloading use the authenticated designer session. Export URLs contain packet IDs, never access credentials.

Each packet is a stored, immutable, point-in-time snapshot. It performs no provider refresh, model inference, job dispatch, invoice action or dispute submission. A later payment observation or replacement delivery requires a new packet. Payment observations are stored evidence, not proof of a fresh provider retrieval or signed webhook receipt.

## Contents and provenance

- Approved proposal revisions and quoted terms, referenced original scope/rates, separate scope acknowledgements and recorded client approvals.
- Selected request source IDs, exact historical versions, timestamps, original hashes and linked request history. Legacy primary-pointer relationships are explicitly inferred. Unavailable history produces a gap; the current source or scope is never substituted.
- Whitelisted model suggestions, separate from human decisions. Prompts, hidden reasoning and raw provider payloads are omitted.
- Delivery briefs, both original and replacement snapshot metadata/hashes, review revisions, requested changes and exact acceptance records. Plugin node metadata and images retain client-supplied provenance; demo role access does not verify personal identity or establish client viewing.
- Exact installment/invoice associations and stored observation times, including cancellation, refund and reversal history. The summary uses current per-invoice projections, not a sum of historical observations. External/marked payments and refunds remain qualified, and no observation is called an application-processed settlement.

Metadata-only export (`schemaVersion: 1`) is the default and omits pixel bytes. When visual attachments are needed, the designer opens **Review delivery images**, previews each current submitted or accepted delivery review through `/api/delivery-snapshots/:id`, selects at most four reviewed snapshots, and explicitly acknowledges that selected image contents were reviewed and are not automatically redacted or independently verified. Building with reviewed images produces `schemaVersion: 2`. Accepted reviews remain explicitly identifiable; an unaccepted draft review is labeled as an unaccepted draft and never called accepted. Replaced reviews retain their metadata/history in the packet facts, while image selection binds to the current review and snapshot hash—if a review is replaced before build, a fresh preview and acknowledgement are required.

Credentials, configured provider secrets, known scoped session/renewal/portal/judging credentials, HTTP(S) links and email addresses are masked in supplied text. Redaction is a precaution, not a guarantee that every unfamiliar secret can be recognized, and no automatic visual redaction is applied to attached PNG bytes. Original source hashes identify the retained original records, not the redacted quotations. Review the export before sharing it.

## Access, integrity and retention

`GET /api/change-orders/:orderId/evidence-packets/image-choices` returns the order revision and current submitted/accepted review image descriptors for designer preview. `POST /api/change-orders/:orderId/evidence-packets` accepts `{}` for the default schema version 1 metadata-only packet, or `{ expectedRevision, images, imagesReviewed: true }` for a schema version 2 packet with immutable PNG attachments. `GET /api/evidence-packets/:packetId` retrieves the stored packet. Authenticated file endpoints are `GET /api/evidence-packets/:packetId/files/packet.json`, `packet.html`, `manifest.json` and `image-<64 lowercase hex sha256>.png`.

Every call rechecks active designer authority, project, run and order membership. Client and connector credentials cannot export. Revocation, expiry and run reset remove access; immutable packet and file rows remain retained. Future real-customer retention/deletion policy belongs to T18; this local implementation does not enable real-customer use.

The manifest records SHA-256 and byte counts for the exact JSON, HTML and any attached `image-<sha256>.png` files. Identical PNG bytes across selected milestones share one stored file row while every selected review/snapshot binding remains recorded. It deliberately has no circular self-digest. Every read and download validates all stored text and binary bytes against the manifest; the browser also verifies SHA-256 and byte counts before saving via Blob URLs. Metadata-only JSON/HTML is capped at 4,000,000 bytes; each selected PNG is capped at 1,500,000 bytes (at most 4 selections), and the complete image export representation (raw PNGs, JSON, HTML and manifest) is capped at 16,777,216 bytes (16 MiB). Refused builds store no partial packet or file rows.

Missing retained sources produce explicit notices. Conflicting scope associations, invalid source/delivery hashes and incomplete or tampered stored packet/attachment restores fail closed. Portable HTML escapes supplied text, permits only `img-src data:` when reviewed images are attached, has no scripts or external assets, and is previewed in a sandboxed frame. Downloaded copies are portable and are no longer protected by application authentication.

## Dispute and release gates

The current packet reports `disputeDraft.available: false`: no verified matched dispute/payment record is available. It neither invents a dispute nor submits evidence or initiates a refund. Verified matching and separately reviewed provider actions belong to T21.

Real sandbox installment checkout/reconciliation, native Figma output/readback and independent packet/designer review remain external Release C gates. Synthetic tests and browser fixtures do not satisfy them. See [Release C local qualification](verification/agent-integrations-c-through-t17-2026-10-24.md).
