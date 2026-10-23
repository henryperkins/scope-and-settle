# Judging access verification — October 23, 2026 UTC

Judging implementation is deployed, with webhook and native bridge fixes in `codex/paypal-webhook-delivery`. A fresh isolated judge run completed live assessment, client approval, sandbox payment, and automatic signed PAID delivery. The exact final 0.2.1 ZIP was then installed in Figma Desktop under a separate test account: actual frame attachment, authoritative payment refresh and restoration of the same Paid revision after reopening passed. The separate native acceptance below reuses the completed judge payment; it does not claim a second fresh native AI-to-checkout sequence or a walkthrough by an outside designer.

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

## Final ZIP acceptance under the separate Figma account

On October 23, the existing **Scope Settle Judge Test** account completed the Desktop sign-in flow using an isolated browser. The editor's **Multiplayer tools** identified that account as **You**, with frame `5:2` selected in the designated file. Switching the Home account alone was insufficient: an already-open file retained the owner's account. Opening the same file with the test account selected corrected that before installation.

The exact extracted `scope-and-settle-0.2.1-99de28121934.zip` manifest was imported through **Plugins → Development → Import plugin from manifest**. Its SHA-256 remained `df4d05e4729d666291cf731acb7ec095b244bbe1429904ca924ce14f5512a55d`. The import UI showed the `plugin-0.2.1/manifest.json` path. The conflicting older `plugin/manifest.json` development registration was removed through its menu; its files were preserved. The separate diagnostic registration was not used for this test.

Using the existing judge run's privately saved resume access, the release loaded the real comment and **Paid / revision 1 / scope-rev-1** order. **Attach selected frame** exported the actual selected checkout frame and displayed its PNG with the confirmation “Selected frame attached as supporting design evidence.” No assessment was rerun and no new invoice or payment was created.

**Check payment** retrieved PayPal status at approximately `2026-10-23T18:37:15Z`, retaining **Paid, $250.00 total, $0.00 due**, and the original approved revision. Closing the plugin and reopening it with Figma's **Run last plugin** shortcut restored access, the real comment and the same Paid revision without another connection step. The unsubmitted frame attachment was not retained after reopening; the verified persistence is the session and approved paid order.

Seven numbered screenshot/text evidence stages are retained in the local `submission-check/native-acceptance` artifact directory: secondary account, exact import, final registration, frame attachment, refreshed payment, reopening, and the restored paid revision. Credentials and role links are excluded from the retained captures.

## Fresh source and provider recheck

A clean Git export of `ba4423f` installed with `pnpm install --frozen-lockfile` under Node 24.15.0 and passed **52 tests, 0 failed, 0 skipped**. The standalone ingress/subscription helpers passed another **9 tests, 0 failed, 0 skipped**. These remain local checks with provider fixtures, separate from the live observations.

At `18:42:11.927Z`, that exported build started on a separate loopback port with provider credentials deliberately blank. The designer page returned 200, anonymous order access returned 401, the documented invitation command generated usable designer access, and authenticated `/api/change-orders` returned 200 with an empty list. Health correctly listed missing provider configuration. This verifies local startup and access, not live provider setup. An initial diagnostic used the nonexistent `/api/orders` route and returned 404; its failed record was preserved before correcting the diagnostic route.

At `2026-10-23T18:28:12.574Z`, read-only hosted/provider checks confirmed SQLite integrity `ok`, both invoices **PAID / $250 total / $0 due**, unchanged approvals/revisions and reconciled signed receipts. The durable entry remained active through `2026-12-16T16:00:00Z`; its 24 recorded AI calls still totaled **44,203 micro-USD**, within the $24.16 hosted share of the overall $25 cap. PayPal returned the configured webhook subscription, Figma returned the designated comment, and Baseten's model catalog returned the configured model. No inference charge was incurred. The Figma response did not expose token expiry, so present access is not proof of future token validity.

At this pre-recording checkpoint, outside-designer walkthroughs, the final public video, private judge-access delivery, entrant answers and final Devpost submission remained outstanding. The recording and publication notes below supersede the video status. Current provider responses and access expiry support readiness today; operating availability through the judging close still requires maintenance.

## Final native recording run and reviewed video

Later on October 23, the exact released plugin under the separate Figma test account completed a fresh live assessment with the actual selected frame attached. Baseten returned new work, quoted the desktop-only agreement clauses and described the exported desktop design in approximately 1.2 seconds. The designer reviewed the mobile deliverable and $250 rate-card price and confirmed the terms. This was a new proposal in the existing judge run, preserving its earlier paid order.

The resulting order is `0d53e64a-2236-4342-bf85-8ff3411c5c7f`, revision 1 / `scope-rev-1`. The separate client page required its consent checkbox before approval; the stored client approval time is `2026-10-23T18:50:20.166Z`. Actual checkout by the dedicated personal sandbox buyer paid invoice `INV2-WXFF-4GMD-L86F-PPFX` for **$250**.

Manual invoice retrieval showed Paid on the client page at approximately `18:55:22Z`. The automatic signed PAID event `WH-9W0280606C9968053-3FA58456V4830070N` was reconciled at `18:55:38.239Z`. An independent PayPal event read at `19:08:12.370Z` returned HTTP 200, `INVOICING.INVOICE.PAID`, the same invoice identity and `PAID`. The earlier visible UI transition is attributed to manual refresh, not to the later callback. No simulated webhook, payment override or manually inserted receipt was used.

At `18:56:48.305Z`, a read-only hosted check returned **PAID / $250 total / $0 due** for all three completed invoices, with each original approval and revision intact. SQLite integrity remained `ok`. The new order's **Check payment** in Figma confirmed Paid, and closing/reopening restored the same paid revision without reconnecting. This third order was created after the earlier deployment-persistence checks; it is not claimed to have survived a subsequent deployment.

The shared hosted AI ledger now contains **25 calls / 45,819 micro-USD ($0.045819)**, an increase of **$0.001616** for the new assessment. The hosted allocation remains **$24.16**. Together with the previously recorded **$0.837288** local spending, known combined spending is **$0.883107** under the overall **$25** cap. No separate allowance was created. PayPal webhook configuration, Figma comment access and Baseten model availability were rechecked without another inference call. The durable entry remains active through `2026-12-16T16:00:00Z`.

A consistent post-recording backup was created at `18:57:11.580Z` and copied off-host to protected operator storage. Its SHA-256 is `5483e8c41f639d6408b3021cbfb16884ade455a790e621ba58d09a8b0ffccd97`; the off-host copy passes SQLite integrity checking and contains all three Paid orders and all 25 AI calls. Database contents and private access remain outside public artifacts.

The reviewed [demonstration video](DEMO-VIDEO.md) is **2:49.021**, with English narration and captions. It follows this same new order from the actual native assessment through client approval, real checkout, Paid in Figma and reopening. The edit explicitly labels time compression; its approval transition uses actual before/after views, authentication is omitted and account details are redacted. The real assessment result is shown without rerunning inference for the camera. The MP4 and captions are public GitHub release assets. The [original YouTube video](https://www.youtube.com/watch?v=m29YNTdVUF4) was published publicly later on October 23 with uploaded English captions; a separate signed-out browser successfully played it.

The entrant subsequently supplied revised ElevenLabs narration. The [current public YouTube version](https://www.youtube.com/watch?v=RUJ26fRetd8) uses that audio with the identical H.264 footage, unchanged runtime and matching English captions. YouTube confirmed publication and no issues in its initial checks. At `21:13:41Z`, signed-out playback reached 71 seconds at 1920 × 1080 with visible uploaded captions and no media error. Devpost project version 5 was read back at `21:13:23Z` with this new URL and the narration credit; its hackathon submission timestamp remained empty. The new MP4 and SRT downloads also matched their local hashes. No additional paid model call or payment was performed for this audio revision.

Outside-designer walkthroughs, confirmed private credential delivery, deferred entrant answers and final hackathon submission remain outstanding. The Devpost project is public at https://devpost.com/software/scope-settle, but its hackathon submission timestamp is empty.
