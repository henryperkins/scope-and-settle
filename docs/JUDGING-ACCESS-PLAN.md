# Reproducible judging access

Recorded October 22, 2026. This is the agreed delivery plan, not evidence that judging access has been implemented or tested. Complete and verify the live product flow before implementing this access milestone.

**Status as of October 23:** the live payment loop, judging implementation and exact-ZIP native installation/reopening under the separate Figma account are verified; [the dated evidence](JUDGING-VERIFICATION-2026-10-23.md) is authoritative for current status. The plan below is preserved as the original requirements. The final submission/access package and outside-designer walkthroughs remain pending.

## Outcome

A judge following only the submitted instructions can select the real Figma comment, obtain an AI assessment, review a proposal, approve it as the demo client, complete a PayPal sandbox payment, observe authoritative Paid status, and start again without contacting the entrant.

Judges must not depend on the entrant's laptop, an administrator issuing fresh invitations, or the entrant sharing provider API keys. The hosted path requires no local backend build. Figma desktop and a Figma account are required for the native plugin path; sandbox-buyer credentials are supplied for checkout.

## Existing foundation and gaps

| Area | Existing behavior | Remaining work |
| --- | --- | --- |
| Hosting | Google Cloud VM, persistent SQLite storage, HTTPS at `https://scope-and-settle.hperkins.com` | Test the complete judging journey and keep provider access usable through judging |
| Sessions | Project/run/role scoping; client access bound to a proposal revision | Replace manual one-hour invitation provisioning with a durable judge entry mechanism |
| Plugin | Build produces `manifest.json`, `code.js`, and `ui.html`; hosted origin is fixed at build time | Package a versioned, prebuilt ZIP and test installation from that artifact |
| Figma | One configured file supplies actual comments; plugin exports a selected frame | Prepare and permission a dedicated synthetic judging file; verify access from another account |
| Isolation | Assessments and orders are scoped to a demo run | Allocate independent runs at judge entry and prevent judge sessions changing the shared brief |
| Reset | Revokes old-run access, clears local run data, retains invoice tombstones and AI ledger | Exercise hosted reset, replacement access, concurrent runs, and late provider events |
| Browser | Designer and client interfaces use the same backend as the plugin | Document it as an additional testing path; native frame selection/export remains specific to Figma |

## 1. Durable entry and role access

- Add a `/judge` entry page on the existing HTTPS origin.
- Supply a revocable judging credential usable through at least December 15, 2026, 8:00 a.m. Pacific / 10:00 a.m. Central, the scheduled end of judging. Confirm the final availability window before submission.
- The entry page lets a judge start a fresh run or resume their own existing run. A fresh visit must not expose another judge's records.
- Exchange judging access for bounded server-side sessions; do not make the current ordinary session token globally reusable or permanently valid.
- Provide a clear renewal path when a session expires, including inside the plugin, without requiring an administrator or accidentally creating another invoice.
- Keep designer and client roles separate. Opening the client review page and explicitly approving the exact revision remain visible steps, even when one judge plays both synthetic roles.
- Renewal must not revive revoked access, obsolete proposal revisions, or reset runs. Resume credentials remain scoped to the original run and role.
- Choose and document the final credential storage and renewal lifetimes during implementation. Judge access grants demo authority, not a claim of verified identity.

## 2. Native Figma demo kit

- Produce a versioned ZIP containing the built `manifest.json`, `code.js`, and `ui.html`, already targeting `https://scope-and-settle.hperkins.com`.
- Pin the ZIP to the reviewed source commit and publish its checksum with the release instructions.
- Document the desktop menu path: **Plugins -> Development -> Import plugin from manifest**, then select the extracted manifest and run Scope & Settle.
- Create a dedicated synthetic judging file containing the polished desktop checkout and the actual comment `Can you add the mobile checkout?`.
- Bind the hosted demo to that exact Figma file. The current backend permits only its configured file; an arbitrary duplicate is not a substitute without explicit support for that file.
- Verify the file's edit permissions from another Figma account. Ordinary Design plugins need edit access; a view-only link is insufficient for the native path.
- Keep a recoverable copy of the synthetic design and document how to restore the judging file if it is edited. Include the editable design asset or complete recreation instructions in the repository/release.
- Verify that the selected frame and displayed comment refer to the intended judging file. Do not silently combine a frame from one file with a comment from another.
- Keep the existing browser interface available for testing the same AI, proposal, approval and payment endpoints. Clearly distinguish browser testing from native selection/frame-export evidence.

Figma references: [development plugin import](https://help.figma.com/hc/en-us/articles/38457121114263-Create-a-Figma-Design-plugin-with-the-Figma-MCP-server-and-agentic-tools), [plugin permissions](https://help.figma.com/hc/en-us/articles/22012921621015-Guide-to-inspecting).

## 3. Independent runs and reset

- Allocate a distinct run for each new judging attempt. Scope assessments, snapshots, proposals, approvals, sessions, and invoice references to that run.
- Keep the supplied brief and rate card fixed for the hosted judging scenario. Enforce this on the server for judge-issued sessions; hiding an edit control is insufficient.
- Preserve the existing development capability to revise scope without allowing one judge to invalidate another judge's pending proposal.
- Label the control **Reset my demo** and explain that it clears this run's local records, not PayPal's sandbox invoice history.
- Reset invalidates that run's old sessions and approval links, clears its local evidence/orders, and supplies access to a fresh run.
- Preserve invoice tombstones so late or duplicated webhooks cannot recreate cleared orders or update another run.
- Preserve the shared AI spending ledger. Reset, redeploy, and new judge runs must not recreate the development allowance.
- Do not alter or delete another active run. Preserve in-flight invoice operations and show a recoverable wait state where necessary.

## 4. Walkthrough and access delivery

Prepare one short `JUDGING.md` walkthrough with expected results at every step:

1. Open the judge entry page and start a demo.
2. Download/import the prebuilt plugin and open the designated Figma file/frame.
3. Connect using the issued designer access and select the actual mobile-checkout comment.
4. Attach the frame and run a live assessment against the supplied desktop-only brief.
5. Review the scope evidence, deliverables, and $250 rate-card price.
6. Open the separate client link, inspect the exact revision, and explicitly approve.
7. Open the PayPal sandbox invoice and pay with the provided personal sandbox buyer.
8. Retrieve payment status and confirm Paid; reopen the plugin and confirm persistence.
9. Reset the run and begin again.

Include recovery instructions for expired sessions, interrupted invoice creation, delayed webhooks, and manual payment-status refresh. Keep any manual proposal route explicitly labeled; it cannot stand in for a live AI assessment.

Confirm the visibility of Devpost's testing-instructions field before using it for access credentials. Deliver judge access and dedicated sandbox-buyer details through an appropriate judge-access channel. Do not commit personal account credentials, provider keys, or live role tokens to the public repository or show them in the video.

The public repository must also retain complete local setup instructions, the MIT license, source, and required synthetic assets. The hosted demo is the convenient path; a tested local build is the fallback permitted by the rules.

## 5. Availability and AI allowance

- Keep the existing persistent hosted service available through the judging window.
- Verify Figma token validity, PayPal sandbox access, model access, and the callback subscription before submission and before judging.
- Reserve sufficient allowance from the already agreed total $25 development cap for live judging. Do not increase the cap or create a second independent allowance silently.
- If the remaining allowance cannot support reliable judging, resolve the provider/budget decision before submission. Do not substitute prerecorded model responses while presenting them as live.
- Retain a recoverable database backup outside the VM's data disk and verify the pinned release remains available.

## 6. Acceptance evidence

| Check | Required observation |
| --- | --- |
| Fresh installation | Another Figma account can obtain the ZIP, import it, access the designated file, and connect using only the documented steps |
| Independent walkthrough | A fresh browser profile and plugin session complete comment -> AI -> proposal -> approval -> sandbox payment -> Paid |
| Provider truth | Actual model output, actual PayPal sandbox checkout, authoritative invoice retrieval, and separately verified real webhook delivery |
| Session expiry | Judge entry can renew the intended access without administrator intervention or widening role/revision/run scope |
| Two concurrent runs | One run cannot read, approve, reset, or invalidate the other run's work |
| Reset | The reset run's old links fail; new run starts clean; other runs and the AI ledger remain intact |
| Late events | Old invoice events are safely handled after reset without recreating cleared records |
| Restart | Approved terms, invoice identity, payment state, sessions, and AI accounting persist across a hosted restart |
| Local fallback | A clean checkout follows the public instructions successfully with explicitly configured sandbox/provider access |

Record artifact/source identity, environment, timestamp, actual results, and remaining limitations. A source build, fixture test, successful health endpoint, or existing logged-in session alone does not satisfy this milestone.

## Delivery order

1. Finish the live working flow and preserve its evidence.
2. Implement judge entry, scoped renewal, and independent run provisioning.
3. Package and permission the Figma demo kit.
4. Exercise the acceptance checks and write the final judging walkthrough.
5. Freeze the reviewed release and supply access with the submission.

See [product contract](PRODUCT-SPEC.md), [Google Cloud deployment](GOOGLE-CLOUD-DEPLOYMENT.md), [native Figma evidence](NATIVE-FIGMA-2026-10-22.md), and [video/walkthrough outline](DEMO-AND-WALKTHROUGH.md).
