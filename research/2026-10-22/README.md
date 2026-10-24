# Research provenance: October 22, 2026

The [capability map](../../PAYPAL-API-CAPABILITIES.md) organizes official documentation by what an external application can do. The [REST inventory](../../PAYPAL-REST-ENDPOINTS.csv) is a narrower, reproducible snapshot of published OpenAPI operations.

## Evidence and source selection

- Research used PayPal's developer portal, official PayPal product/support pages, and the official documentation of Braintree, Hyperwallet, Zettle/Point of Sale, Paidy, and Chargehound.
- `initial-sources.json` records retrieval timestamps, URLs, and SHA-256 hashes for the saved developer documentation indexes and GitHub metadata.
- `spec-sources.json` records 13 official GitHub schemas and three additional developer-site schemas. GitHub snapshots are pinned to commit `90e8041ffe02d80c452d2b476bedd59a8d219bdc` of `paypal/paypal-rest-api-specifications`.
- `docs-spec-sources.json` records a second pass against developer-site schemas: 12 were retrieved, while the attempted Payouts schema URL returned HTTP 404. This failed URL is preserved as an error, not counted as a successful retrieval.
- `selected-spec-sources.json` identifies the exact 16 snapshots used for the final CSV: 15 developer-site schemas and the pinned GitHub Payouts fallback. Current developer-site schemas take precedence over the older GitHub copy where both were retrieved.
- `specs/` and `docs-specs/` contain the original downloaded JSON. Hashes allow checking that the inventory was generated from those exact bytes.
- `capability-source-links.csv` extracts the unique HTTPS citations in the map for convenient follow-up. It is a citation index, not a report that each URL passed an independent live HTTP check.

The official GitHub repository is not exhaustive: the current developer-site invoice and reporting schemas contain additional operations, and other product families have separate documentation/contracts. Full HTML copies of every browsed page were not archived; the map links to those primary sources.

## Interpreting the CSV

Each row is an HTTP method/path entry in one of the selected specifications. Columns include API title, specification filename, method/path, operation ID, summary, published deprecation flag, declared server URLs, source URL, call direction, and manually curated access/implementation notes.

The inventory contains **222 operations across 16 schemas**, including:

- One order-update callback contract where PayPal calls the merchant's configured URL. Its appearance in an Orders schema does not make it an ordinary merchant-to-PayPal endpoint.
- Two explicitly sandbox-only dispute controls: adjudication and evidence-request state changes.
- 75 Usage Based Billing operations whose deployment routing and account availability were not verified. Their unprefixed paths are preserved verbatim.
- Expanded invoice and reporting contracts with untested feature access.
- A compatibility-era Payment Experience API that should not be assumed to configure current checkout SDKs.

A schema's `servers` array is reproduced as published. A sandbox-only server declaration does not, by itself, establish a product's production status. Similarly, a false/absent OpenAPI `deprecated` flag does not prove a whole product or SDK is suitable for a new integration.

OAuth/identity, Braintree GraphQL, Hyperwallet, Paidy, Point of Sale, Chargehound, partner-only contracts, SDK functions, and file-based reports are not included in the 222-operation count. Their broader capabilities are covered in the main document.

## Verification and reproduction

From any directory, run:

```powershell
python C:\Users\htper\paypal-hackathon\research\2026-10-22\build_endpoint_inventory.py
```

This rebuilds the CSV and selected-source manifest entirely offline. It checks snapshot hashes, per-schema/total counts, duplicate operations, the preserved draft hash, local document links, and Markdown table structure. It writes `verification.json` and the citation-link CSV.

These are document/schema checks. No merchant accounts were created; no API credentials were used; no authenticated sandbox or production operations were executed; no device tests were performed. Source dates and documented access requirements should be checked again when an implementation is selected.

## Earlier draft

`PAYPAL-API-CAPABILITIES.before-review.md` preserves the previous draft unchanged, with SHA-256 `b97eafc4469decbe97a8874380a3242dc094887d642f1e97b3c945eb8eb0ccea`. It is historical material, not the current reference. The reviewed map corrects endpoint names, distinguishes callback/test contracts, removes unsupported access assumptions, and separates authorization validity from the recommended honor period.
