# Factual evidence packets

In the designer workspace, open **Factual evidence export** on an approved order and select **Build evidence packet**. Inspect the preview, missing-evidence notices and redactions before downloading or sharing the JSON, portable HTML and digest manifest. Building and downloading use the authenticated designer session. Export URLs contain packet IDs, never access credentials.

Each packet is a stored, immutable, point-in-time snapshot. It performs no provider refresh, model inference, job dispatch, invoice action or dispute submission. A later payment observation or replacement delivery requires a new packet. Payment observations are stored evidence, not proof of a fresh provider retrieval or signed webhook receipt.

## Contents and provenance

- Approved proposal revisions and quoted terms, referenced original scope/rates, separate scope acknowledgements and recorded client approvals.
- Selected request source IDs, exact historical versions, timestamps, original hashes and linked request history. Legacy primary-pointer relationships are explicitly inferred. Unavailable history produces a gap; the current source or scope is never substituted.
- Whitelisted model suggestions, separate from human decisions. Prompts, hidden reasoning and raw provider payloads are omitted.
- Delivery briefs, both original and replacement snapshot metadata/hashes, review revisions, requested changes and exact acceptance records. Plugin node metadata and images retain client-supplied provenance; demo role access does not verify personal identity or establish client viewing.
- Exact installment/invoice associations and stored observation times, including cancellation, refund and reversal history. The summary uses current per-invoice projections, not a sum of historical observations. External/marked payments and refunds remain qualified, and no observation is called an application-processed settlement.

Pixel bytes are omitted from exports. Review the exact retained image through the authenticated delivery interface when visual inspection is needed. The packet validates retained delivery image hashes but cannot independently verify what the plugin captured. Omitting pixels also avoids suggesting that arbitrary image contents were inspected or redacted.

Credentials, configured provider secrets, known scoped session/renewal/portal/judging credentials, HTTP(S) links and email addresses are masked in supplied text. Redaction is a precaution, not a guarantee that every unfamiliar secret can be recognized. Original source hashes identify the retained original records, not the redacted quotations. Review the export before sharing it.

## Access, integrity and retention

`POST /api/change-orders/:orderId/evidence-packets` accepts an empty JSON object and returns schema version 1, the manifest and preview HTML. `GET /api/evidence-packets/:packetId` retrieves it. Authenticated file endpoints are `GET /api/evidence-packets/:packetId/files/packet.json`, `packet.html` and `manifest.json`.

Every call rechecks active designer authority, project, run and order membership. Client and connector credentials cannot export. Revocation, expiry and run reset remove access; immutable packet rows remain retained. Future real-customer retention/deletion policy belongs to T18; this local implementation does not enable real-customer use.

The manifest records SHA-256 and UTF-8 byte counts for the exact JSON and HTML. It deliberately has no circular self-digest. Downloads validate stored bytes against those entries; the browser also compares JSON/HTML bytes before saving. These digests detect changes relative to the manifest, not independent authorship or authenticity. Combined JSON/HTML size is limited to 4 MB.

Missing retained sources produce explicit notices. Conflicting scope associations, invalid source/delivery hashes and incomplete stored packet restores fail closed. HTML escapes supplied text, has no scripts or external assets, and is previewed in a sandboxed frame. Downloaded copies are portable and are no longer protected by application authentication.

## Dispute and release gates

The current packet reports `disputeDraft.available: false`: no verified matched dispute/payment record is available. It neither invents a dispute nor submits evidence or initiates a refund. Verified matching and separately reviewed provider actions belong to T21.

Real sandbox installment checkout/reconciliation, native Figma output/readback and independent packet/designer review remain external Release C gates. Synthetic tests and browser fixtures do not satisfy them. See [Release C local qualification](verification/agent-integrations-c-through-t17-2026-10-24.md).
