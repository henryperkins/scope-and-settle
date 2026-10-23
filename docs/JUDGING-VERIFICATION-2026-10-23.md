# Judging access verification — October 23, 2026 UTC

Implementation is in `codex/judging-access`. This record distinguishes source/fixture checks from hosted provider and native-account acceptance. It does not claim a real webhook was received or another Figma account was tested.

## Source and isolated local checks

- The baseline was 34 passing tests. The new entry/renewal/run tests failed before implementation because the new judging module did not exist. Browser renewal and plugin/provisioning tests likewise failed before their implementations existed.
- The current Windows suite passes **49 tests, 0 failed, 0 skipped**. It exercises parent expiry/revocation, hashed entry/resume secrets, independent runs, frozen project snapshots, role/revision preservation, edited client links, per-run invoice/reset races, late assessment completion without evidence resurrection, preserved AI charges, client renewal without duplicate invoices, and deterministic plugin packaging/checksums.
- A fresh Chromium process with two separate browser contexts completed entry → assessment display → proposal → explicit client approval → Paid display → session expiry/renewal → reset at `2026-10-23T02:24:51.063Z`. The second context resumed its own unchanged run; the reset client's access failed and its private content cleared. No page errors occurred. **All providers in this UI check were fixtures.** It is not a second actual payment or live AI result.
- The isolated UI run exercised desktop and 440-pixel viewports. Screenshots and its sanitized result are in ignored `output/playwright` in the implementation worktree.
- Native frame messages include the real file key. Attachment checks it in the plugin and again at the assessment endpoint. Development manifest private APIs expose the file key; another file cannot be silently combined with the supplied comments.
- The synthetic file's actual 1200 × 982 frame was exported through Figma on this date. The included self-contained editable SVG and original 157-node REST snapshot provide a recoverable visual asset. See [recovery steps](FIGMA-JUDGING-FILE.md).

## Access lifetime and storage

Default entry expiry is `2026-12-16T16:00:00Z`. It covers the planned December 15 judging close plus a buffer; confirm the final event window before submission. Ordinary sessions last at most one hour and never outlive their parent entry. Entry and resume secrets use 256-bit random values and are stored as SHA-256 hashes in SQLite. Raw private access is written only to a protected operator file or returned to the intended caller.

Entry creates independent runs. Each entry freezes the supplied project/brief/rate card/file at provisioning. Judge sessions cannot change the shared scope; developer sessions retain the existing development behavior. Resume access preserves run, role and client revision and does not create or reapprove an invoice. Reset revokes that run's grants/sessions, tombstones its invoices, clears its local evidence/orders, and issues a replacement run. AI spending remains shared and persistent.

The browser keeps its own resume access in local/session storage; Figma uses `clientStorage`. These are demo bearer credentials, not verified identities. Use private browser profiles, keep credentials out of recordings/public source, and revoke parent entry to invalidate all its grants.

## Hosted and external acceptance

The existing real payment remains documented in [the payment record](PAYMENT-LOOP-2026-10-22.md): invoice `INV2-MR5K-GT4U-9TF7-Q36T`, $250, PAID/$0 due, same approved revision, client and native Figma persistence.

The updated image, its exact source/ZIP identity, hosted restart/persistence, live entry/renewal/reset, and remaining provider checks will be recorded here after deployment. Another-account Figma edit access and installation remain a separate required acceptance check. Owner-account success, an exported SVG or fixture tests cannot establish that result.
