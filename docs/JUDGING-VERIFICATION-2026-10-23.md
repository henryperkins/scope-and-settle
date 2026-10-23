# Judging access verification — October 23, 2026 UTC

Judging implementation is deployed, with webhook and native bridge fixes in `codex/paypal-webhook-delivery`. A fresh isolated judge run completed live assessment, client approval, sandbox payment, and automatic signed PAID delivery. A separately verified Figma account can edit the designated file. Installation of the final ZIP in Figma Desktop under that second account remains the outstanding acceptance step; the owner-account candidate test does not substitute for it.

## Source and isolated local checks

- The baseline was 34 passing tests. The new entry/renewal/run tests failed before implementation because the new judging module did not exist. Browser renewal and plugin/provisioning tests likewise failed before their implementations existed.
- The initial judging release passed **49 tests, 0 failed, 0 skipped**. It exercises parent expiry/revocation, hashed entry/resume secrets, independent runs, frozen project snapshots, role/revision preservation, edited client links, per-run invoice/reset races, late assessment completion without evidence resurrection, preserved AI charges, client renewal without duplicate invoices, and deterministic plugin packaging/checksums. The native bridge release below adds three regressions, for **52 passing tests** on Windows and Linux.
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

The initial 0.2.0 release was built from a clean Git archive of reviewed commit `5a620f461bd7da89fc07377ef17709155b15ef1b` and deployed to the existing persistent service. The Linux image build also passed **49 tests, 0 failed, 0 skipped**. It used the frozen dependency lockfile and no local credentials/database. The 0.2.1 release below supersedes these artifact identities.

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

At the earlier `2026-10-23T02:42:10.989Z` check, PayPal reported PAID/$0 due while the webhook receipt table was empty. The subsequent ingress fix received and verified the real PAID event at `03:01:38.791Z`; the receipt and unchanged original Paid order survived an application restart at `03:06:59.839Z`. See [the completed webhook verification](PAYPAL-WEBHOOK-DIAGNOSTIC-2026-10-23.md).

## Independent live judge run

On October 23, a fresh isolated browser started run `judge-ce218f54-4d5f-4bd5-8caf-2845e342227b` through the actual judge entry UI. It selected real comment `1978367271`, obtained live assessment `96124582-bd32-429e-80c0-7460a2059ddf`, reviewed the $250 mobile-checkout proposal, and explicitly approved revision 1 / `scope-rev-1` on the separate client page at `03:47:57.041Z`.

PayPal checkout completed as the verified personal sandbox buyer. Invoice `INV2-6857-LMSK-HM4W-KUTT` reports **PAID / $0 due**, transaction `5FE84858PP3136926`. The associated change order is `52fd392f-8dc7-43c7-ab39-721d5eb43d58`. Both client and designer pages displayed Paid, and the client retained it after reloading. This was a new actual payment, distinct from the original demonstration invoice.

The real event `WH-2YL446797G5722536-59H99790AU2522846` arrived automatically and was reconciled at `03:56:27.120Z`. An independent PayPal event read returned HTTP 200 and `INVOICING.INVOICE.PAID` for that invoice. Receipt persistence follows the unchanged signature-verification gate; no event simulator, manually inserted receipt or payment-state override was used. At `10:12:25.543Z`, provider retrieval and the stored approval, invoice identity, Paid state and receipt were unchanged.

After more than six hours, the original short session returned 401. **Resume my demo on this browser** renewed the same designer role and run through the normal UI, then the browser workspace again showed the same Paid revision. This expiry occurred naturally; the prepared forced-expiry diagnostic was not executed.

A second isolated browser run, `judge-2c50fc24-aa66-466c-9e63-af25d045ac6e`, could not read the first run's order (403). Its **Reset my demo** control issued clean run `judge-cda78107-d2f3-4ceb-86ba-ad338de88463`; its previous resume credential returned 401, the shared budget response was unchanged, and the first run remained Paid/$0 due after a fresh provider check. This UI reset supplements the earlier hosted API checks of invoice tombstones, client revocation and restart persistence.

The initial downloaded prebuilt ZIP matched SHA-256 `9c8260c49b7966b013c17e2ec62fb6be21b4a311813b6be04b9a77baec89cb2c`. All four embedded file checksums matched `SOURCE.json`, which identifies source `5a620f461bd7da89fc07377ef17709155b15ef1b` and the hosted origin. Screenshots and sanitized JSON evidence are retained in the local `judging-acceptance` artifact directory; credentials remain in protected operator storage.

## Second-account file access

A dedicated Figma test account was created and email-verified in an isolated browser. The original Starter Drafts location gave that account view-only access, even with the intended link settings. Moving the existing file into a free Starter team folder and setting **Anyone can edit** resolved it. The file key, frame `5:2` and comment `1978367271` were preserved; no paid plan, trial or seat was purchased.

The second account opened the same file and changed the selected frame's X position from 0 to 1 and back to 0. This proves edit access without leaving the synthetic design changed. Account credentials and isolated browser state remain only in protected operator storage. See [the file setup and recovery record](FIGMA-JUDGING-FILE.md).

## Native bridge fix and 0.2.1 release

An actual owner-account desktop run exposed two separate issues. Figma could launch an older development registration with the same plugin ID; removing only the old registration allowed the downloaded kit to run. Then frame attachment remained disabled and saved access failed to restore on reopening. Metadata-only instrumentation showed that Figma Beta 126.11.5 delivers `context` and `session` messages from `https://www.figma.com` with `event.source === window.top`, while `event.source !== window.parent`. The old parent-only guard discarded those legitimate messages.

The bridge now accepts messages from the trusted Figma origin when the source is the containing editor or parent, while rejecting other origins and unrelated windows. A regression running the actual designer module failed with the original guard and passed with the fix. Additional cases cover stored-session restoration, designated-file attachment and clearing attachment after a file mismatch. A fresh reviewer identified that the browser also needed anonymous access to the new module; an HTTP regression reproduced the 401 and passed after adding its explicit public route. The plugin bundle remains self-contained.

At `10:44:55.073Z`, the fixed candidate in native Figma connected to the designated file, exported the selected frame as actual PNG evidence and displayed Paid on revision 1. Closing and reopening it restored the same session and Paid revision at `10:46:25.913Z`. The temporary diagnostic logger had been removed for this run. This was an **owner-account candidate under a temporary diagnostic manifest ID**, not installation of the final release ZIP from the second account.

The final release was built from a clean archive of committed source `99de2812193425b3c49c46b2faed91a4a40d8b57`, with no local secrets or database. Both the Windows suite and Linux image build passed **52 tests, 0 failed, 0 skipped**. The guarded activation verified source identity and health and retained the previous image configuration for rollback.

| Current release artifact | Verified identity |
| --- | --- |
| Version | `0.2.1` |
| Runtime image configuration ID | `sha256:07f7cf5e62ee9f597e3fea750d99d5d069657cf4ab44805203b964be7dcb94cf` |
| Uploaded image archive SHA-256 | `996092a76df7a8f890e052522a30ec718a85f84f5acb49a55597cf053f5f6272` |
| Prebuilt kit | `scope-and-settle-0.2.1-99de28121934.zip` |
| ZIP SHA-256 | `df4d05e4729d666291cf731acb7ec095b244bbe1429904ca924ce14f5512a55d` |

At `10:54:49.160Z`, the public ZIP was downloaded independently. Its archive hash and all four embedded file checksums matched the release metadata. The final kit is extracted locally and ready for native import. Health reported sandbox mode with no missing configuration. At `10:55:35.767Z`, isolated designer/client page reloads showed Paid, the separate reset run remained empty, all five requested browser assets returned 200, and no page errors occurred. The confirmed client reopening screenshot is `11-client-paid-reopened-confirmed.png`; an earlier capture made during loading is not treated as Paid evidence.

A consistent backup before this deployment passed integrity checking and was copied off the VM, SHA-256 `445aa70700e1457e04b0d7eba619a1d1193da35aa8fdb4654c9eb41eeb584ab2`. It contains both Paid orders and verified webhook receipts, the active durable entry, and the unchanged **44,203 micro-USD ($0.044203)** hosted AI ledger. The hosted cap remains $24.16. All 70 preserved primary-checkout file fingerprints matched; source changes remain in the attached worktree.

At `11:00:38.382Z`, a post-deployment check read both invoices directly from PayPal and asserted **PAID, $250 total, $0 due**. Both stored orders retained revision 1 / `scope-rev-1`, their original explicit client approvals and their reconciled real webhook receipts. SQLite integrity was `ok`, the AI ledger remained exactly 44,203 micro-USD, the reset run remained closed and its replacement remained open with zero orders. Sanitized evidence is recorded in `post-release-persistence.json`.

## Remaining native acceptance

The second account's browser edit access is verified, but its **Figma Desktop sign-in and final ZIP installation are pending**. Desktop sign-in opens the system browser, and the applicable computer-use guidance prohibits automating native authentication dialogs. A sign-in handoff was requested so the test can continue without opening the owner's personal browser. After that handoff, import the extracted 0.2.1 manifest, connect the existing judge run, attach its designated frame, check Paid, and reopen the plugin to verify persistence under that account. No second-account native installation or complete independent native walkthrough is claimed yet.
