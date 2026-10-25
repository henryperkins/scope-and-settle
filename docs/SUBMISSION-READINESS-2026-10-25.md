# Submission readiness — October 25, 2026

**Not ready for final submission.** The judge-entry revision is implemented and passes 83 automated tests, but live inference is blocked by Baseten HTTP 402. The entrant chose to continue package preparation while leaving live verification blocked. No new successful assessment, quote, invoice or buyer payment was produced by this check. The deployed release remains 0.3.1; the judge-entry changes in this branch are not deployed.

## Completion gates

| Gate | Current evidence | Remaining work |
| --- | --- | --- |
| Clear judge entry | Browser-first instructions, explicit designer/client roles, same-revision payment checks, optional Figma setup and safer resume recovery implemented locally | Release the reviewed patch and verify hosted entry |
| Current automatic workflow through Paid | Hosted run starts, policy saves and portal accepts a request; assessment fails closed | Restore provider billing, then obtain a fresh automatic quote, explicit client approval, real sandbox payment, authoritative Paid / $0 due and reopened same-revision state |
| Public source and build | Existing MIT source, 0.3.1 release and public ZIP remain available; local patch passes 83/83 | Publish the reviewed source and qualify its matching hosted artifact; do not relabel the 0.3.1 ZIP as this patch |
| Native Figma access | Owner saved **Anyone can edit** for the current synthetic file; independent account can open it | Independent account still reports **You can only view and comment on this file** with **Ask to edit**; native editing/export remains unqualified |
| Private judge credentials | Existing scoped access and sandbox-buyer records remain private | Confirm the event's actual testing-field visibility before placing credentials there |
| Demonstration | Public 2:49 video remains accurate historical 0.2.1 manual-workflow evidence; revised recording script is prepared | Record and review the current automatic workflow after live verification; publish a public video under three minutes and verify playback/captions |
| Outside-designer observation | Observation guide and acceptance questions prepared | Conduct 2–3 sessions, or explicitly defer this internal quality gate and retain the no-validation disclosure; this is not an official event submission requirement |
| Devpost form | Live rules, fields, dates and existing project reviewed October 25; technical answer drafts prepared | Obtain entrant identity, prior-work, experience and eligibility answers; update the reviewed package and complete final attestation/submission |

## Live inference failure

Hosted health returned `ok: true`, no missing configuration and PayPal sandbox mode. `/api/demo-info` reported release 0.3.1, source `ebbed27123f33d2ba6f30d7ea9a35c5d2df2d16c`, and the current Figma file `xu9KUICNauIGSzSepzGvBE`. A passing health endpoint does not establish provider billing or successful inference.

The isolated run `judge-2f5f8582-5ed7-4693-8334-db9d98e821b5` approved the $250 mobile-layout catalogue item, a $250 per-quote maximum, $500 cumulative allowance and quantity 1. Optional Figma replies and PayPal reminders remained off. Its client request `29681174-6f78-4cbe-9467-212b784c1494` was **Can you add the mobile checkout?** The designer tab was closed after submission to exercise the hosted worker.

The initial worker attempt and one explicit retry both entered the same designer-review exception. The database showed no assessment or order attached to the request. Their accounting entries settled after 458 ms and 792 ms, with no authoritative token usage. One isolated diagnostic assessment, which could not publish a quote or create an invoice, then returned **Baseten HTTP 402** at `2026-10-25T13:18:18.631Z` after 515 ms. Authenticated model discovery returned HTTP 200 and listed the configured model; neither a missing key nor a missing model explains the observed failure.

[Baseten's own error-code guidance](https://github.com/basetenlabs/Hack-the-North-2026#error-codes) identifies 402 as payment required and points to workspace credits/billing. No billing change, new payment method, model substitution or additional inference retry was attempted after diagnosis.

The application ledger reserves conservatively and retains the full reservation when the provider supplies no usage. Each failed call recorded 668,468 micro-USD. The resulting hosted totals were **2,140,673 micro-USD accounted**, **0 reserved**, and **22,019,327 micro-USD remaining** under the **24,160,000 micro-USD** application cap. These are application accounting figures, not confirmed provider charges or available Baseten credits. The ledger was not reset or edited.

Resume this same preserved request only after inference access is restored. Record the actual new quote/order/revision and invoice identifiers, then follow the browser journey through payment. Keep manual refresh and signed webhook receipt evidence separate. Do not use the failed-run captures as successful automatic-quote footage.

## Figma access check

The existing independent test account initially received **Request access** on the exact current file. After the entrant explicitly authorized public-link editing, the owner changed that file's audience from the team to **Anyone**, retained **Edit**, and saved. Both owner and independent-account sharing dialogs then displayed **Anyone can edit**.

The independent account successfully opened the file and its real comment, but the editor still displayed **You can only view and comment on this file** and **Ask to edit**. This proves public visibility, not operational edit access, native plugin operation or frame export under that account. No edit request, invitation, paid seat, account upgrade or design-content edit was performed. The browser portal journey remains independent of Figma editor access. Recheck native access without assuming that the sharing label alone is sufficient.

## Local verification and evidence limits

- `npm test` from `app`: **83 passed, 0 failed, 0 skipped** on Windows, including saved-run visibility, cross-tab replacement and stale-access clearing after failed resume. Providers in this suite are simulated.
- `git diff --check`: passed. The Impeccable detector returned no findings; linked stylesheet resolution limited its color checks.
- Local browser inspection covered the guide, optional Figma disclosure, start/resume state and a 390 px layout with no horizontal overflow. Some viewport captures were malformed by the browser host; they are not full mobile visual acceptance or physical-device proof.
- Native public-ZIP qualification and clean-source Linux **81/81** are historical 0.3.1 evidence in [the release record](GOOD-TERMS-RELEASE-2026-10-25.md), not tests of this new patch.
- Ignored `output/judge-submission-2026-10-25/` retains local captures and sanitized diagnostic scripts. Private role URLs and account records stay in access-restricted `private/` locations and are excluded from Git. The saved owner-sharing screenshot shows the actual permission change; the independent-account screenshot records its remaining view-only limitation.

## Devpost and human inputs

The existing project is [Scope & Settle](https://devpost.com/software/scope-settle), ID `1500728`; it must not be duplicated. Live project readback on October 25 remained `published` with the PayPal hackathon's `submitted_at: null`. A separate event relationship label included `submitted`, so final submission is **not verified** from the conflicting signals. No final submit action was performed in this preparation pass.

The live event deadline is **November 12, 2026, 20:00 UTC / 2 p.m. America/Chicago**; the internal target is November 10. Judging runs December 1–15. The existing access expiry of December 16 at 16:00 UTC covers the recorded judging window, but does not establish provider uptime or funding.

The official package needs a functioning PayPal-and-AI application, public source with an OSI-approved license and setup instructions, a public YouTube demonstration under three minutes showing actual execution, and completed event fields. Browser judging is a valid app path; independent native editing remains required before promising that optional test works. The submission must describe the old video's provenance until a replacement is published.

Entrant-only answers are listed in [DEVPOST-CUSTOM-ANSWERS.md](DEVPOST-CUSTOM-ANSWERS.md). They include entrant type/country/province/organization, new versus existing work before the event cutoff, prior-work disclosure, personal PayPal experience, contact preference, learning/career answers and eligibility attestations. Do not infer those from the repository, profile or machine location. Testing field `28798` still has no connector visibility flag; inspect the signed-in event UI before adding credentials. No organizer outreach was sent.

Use [the prepared recording script](DEMO-RECORDING-SCRIPT-2026-10-25.md) and [the walkthrough guide](DEMO-AND-WALKTHROUGH.md) to finish the remaining evidence. Final submission follows a reviewed complete package and explicit entrant attestation; a published project page alone is not proof of a completed hackathon entry.
