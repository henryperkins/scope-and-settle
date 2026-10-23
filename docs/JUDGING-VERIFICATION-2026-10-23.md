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

The release was built from a clean Git archive of reviewed commit `5a620f461bd7da89fc07377ef17709155b15ef1b` and deployed to the existing persistent service. The Linux image build also passed **49 tests, 0 failed, 0 skipped**. It used the frozen dependency lockfile and no local credentials/database.

| Release artifact | Verified identity |
| --- | --- |
| Runtime image configuration ID | `sha256:488466daad1b504a73498b4c336edb552a4aa0292a085c6be93cdab8610c72c8` |
| Uploaded image archive SHA-256 | `ff6e4caa6230411cf1aeb3407bcd82d22a925e12f56056c43326eee16256e01e` |
| Prebuilt kit | `scope-and-settle-0.2.0-5a620f461bd7.zip` |
| ZIP SHA-256 | `9c8260c49b7966b013c17e2ec62fb6be21b4a311813b6be04b9a77baec89cb2c` |

The public download was retrieved independently and its ZIP hash matched the image metadata. `/judge`, the versioned download, `/api/demo-info`, and `/JUDGING.md` are served by this release. A protected durable entry was provisioned through December 16. Its code, entry URL and the previously verified sandbox buyer are kept only in the operator's private delivery file; they are absent from source, image and ZIP.

At `2026-10-23T02:39:50.058Z`, direct hosted API acceptance confirmed:

- Two fresh judge entries allocated separate runs. Foreign-order access returned 403 and judge scope changes returned 403.
- Figma returned actual comment `1978367271` from the designated file. One live Baseten assessment, `b340292c-9500-459f-920b-06f5f7278401`, returned new work and the $250 rate-card total.
- The revision-bound client approved that proposal through the client API. PayPal created real sandbox invoice `INV2-XQY4-5PPV-JNB5-KKA8`. It was deliberately left unpaid for reset testing; it is separate from the already completed $250 payment.
- Expired sessions returned 401. Resume access renewed the original designer/client role and run; caller-supplied role/run overrides were ignored. Reopening preserved the same invoice association.
- Reset cleared only the tested run, invalidated its designer/client resume access, retained its invoice tombstone, and issued a clean run. The other run's order remained readable.
- The original Paid order, revision, brief, approval and invoice association remained unchanged. Reset preserved the shared AI ledger exactly.

The first operator check stopped after the successful assessment because its diagnostic script expected HTTP 200 instead of the endpoint's correct 201. The saved assessment was recovered and reused; the continuation made **no second inference call**. The failed diagnostic and its checkpoint were retained. This was a verification-script error, not a failed assessment.

At `2026-10-23T02:41:21.726Z`, an additional hosted restart preserved the original Paid record, separate run/order, renewable grant, invoice tombstone and exact AI ledger. The temporary acceptance entry was then revoked. Hosted spending moved from $0.039855 to $0.042347 for the one inference; the hosted cap remains $24.16, leaving $24.117653 under conservative accounting. The older local allocation is unchanged and no live local inference was run.

A consistent pre-release backup was downloaded off the VM and passed SQLite integrity checking. Its SHA-256 is `24f6e5c44b0a434b101e202615df9db73440412b9007f983e605efee841e6900`. It contains the original Paid record and pre-release ledger; private state stays outside public artifacts.

The post-release backup also passed integrity checking at `2026-10-23T02:46:14.412Z`, SHA-256 `a5ce86b87c87372f07c5029e29cd499b77fbb22da92e0f10092fe96bd9075341`. It includes the active durable entry (hashed credential verified against the private delivery file), original Paid order, $0.042347 AI ledger and reset invoice tombstone. The Windows private files inherit access only for SYSTEM and the user. All 70 fingerprinted pre-existing primary-checkout files remained byte-for-byte unchanged; implementation stays in the attached worktree.

At `2026-10-23T02:42:10.989Z`, PayPal still reported PAID/$0 due for the original invoice and the webhook receipt table was empty. See [the separate webhook investigation](PAYPAL-WEBHOOK-DIAGNOSTIC-2026-10-23.md). Actual callbacks remain unresolved.

## Remaining native acceptance

Computer control of native Figma was stopped during the permission/installation check, and no further native interactions were made. The new ZIP has not been installed in a second Figma account; that account's edit access remains unverified. Owner-account success, an exported SVG or fixture tests cannot establish those results. The new hosted backend path is verified through direct API acceptance; its new UI was exercised separately in isolated local browser contexts with provider fixtures. No new live browser payment or second-account native walkthrough is claimed.
