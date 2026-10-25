# Devpost technical answers and remaining entrant inputs

Local review draft refreshed October 25, 2026, using the repository's record of the PayPal AI Hackathon form checked October 23. No live Devpost form/state was read or changed for this refresh. Field identifiers and official requirements must be rechecked before use. No credentials or personal attestations are included.

**Verified release:** **0.3.1 / Good Terms** was deployed October 25, 2026 at source/tag `ebbed27123f33d2ba6f30d7ea9a35c5d2df2d16c`. The hosted runtime, public ZIP and [GitHub release](https://github.com/henryperkins/scope-and-settle/releases/tag/v0.3.1) match. Artifact `scope-and-settle-0.3.1-ebbed27123f3.zip` has SHA-256 `5f2f2f92eea71337a18b3def9ba81a9b01d01bf90d0041bb0794a5021a96aaaf`. See [release evidence](GOOD-TERMS-RELEASE-2026-10-25.md). The 0.3.0 automatic-quoting qualification and historical 0.2.1 payment/video evidence remain identified separately.

## 28784 — PayPal and AI technology requirement

Scope & Settle integrates PayPal sandbox Invoicing with Baseten's DeepSeek model to handle client change requests within designer-approved rates and limits. The designer authorizes catalogue rates, quantities, a per-quote limit and a cumulative allowance. A private portal accepts requests and clarification; optional Figma intake handles new threads from specifically authorized client authors. The hosted worker continues while the plugin is closed.

Requests and supplied agreement clauses are sent to `deepseek-ai/DeepSeek-V4.1-Flash-1017-Fast` through Baseten Model APIs with maximum reasoning and structured output. AI classifies included work, new work or clarification and quotes agreement evidence. The server validates clause quotations and requested-component coverage against the approved catalogue, then calculates integer money amounts. Supported work within the policy can receive a quote automatically. Unpriced, unsupported, ambiguous or over-limit work requires clarification or designer review. The separate manual path can include an actual selected Figma frame; background assessment does not silently export a fresh frame.

The client must explicitly approve the exact published revision before the backend creates/publishes a PayPal sandbox invoice. Retry/recovery reconciles and reuses that invoice. A Cloudflare Worker forwards original webhook bodies and signature headers; the backend verifies the signature and retrieves the authoritative invoice before showing Paid. It checks invoice identity, merchant, currency, approved total, status and amount due. AI cannot enlarge the approved policy, consent for the client or mark an invoice paid.

The dated evidence records three actual $250 buyer payments and real signed PAID receipts from the earlier manual workflow. The later 0.3.0 qualification separately verified a live automatically delivered $250 quote, an over-limit exception and invoice creation after client consent, plus an authorized automatic Figma reply while the plugin was closed. That automatic-quote qualification did not include a new buyer payment. Release 0.3.1's exact public ZIP was subsequently verified in native Figma against an existing hosted run: actual frame export/preview, explicit Light/Dark, invoice/footer scrolling and session restoration passed, retaining the same $250 Payment due revision. Those release checks created no new AI call, invoice, payment or client reply. [Release evidence](https://github.com/henryperkins/scope-and-settle/blob/main/docs/GOOD-TERMS-RELEASE-2026-10-25.md).

## 28786 — Additional sponsor tools

**None, used other AI tools.** Baseten supplies runtime inference and Google Cloud hosts the application. They were not options in the official sponsor-category list recorded October 23. The implemented runtime does not establish use of AG Grid, APIMatic, Astropods, Bryntum, Channel3, Elastic, KERNEL, Postman, Render or Zapier. Historical Render setup notes do not establish actual Render usage. Refresh the live field choices before pasting this answer.

## 28788 — Public repository

https://github.com/henryperkins/scope-and-settle

## 28787 — Working demo/test build

https://scope-and-settle.hperkins.com/judge

## 28798 — Testing instructions (public-safe draft)

**Before using this answer:** release 0.3.1 and its public ZIP are qualified; recheck that judge entry still links the release and confirm that the exact linked Figma file is independently accessible to judges. Operator acceptance of the current file does not establish a judge's edit access. Do not promise no paid seat or anyone-can-edit access based on the older file's acceptance evidence.

Use https://scope-and-settle.hperkins.com/judge with the separately supplied judging code. Start a new demo and save its private designer access. Download/extract the plugin ZIP linked by entry, then import `manifest.json` in Figma Desktop via Plugins → Development → Import plugin from manifest. Keep `code.js` and `ui.html` alongside it. Open the exact Figma file linked by entry using your own Figma account, and run Scope & Settle. Paste designer access and Connect. If file access is unavailable, use Open browser workspace for the portal workflow; selected-frame export specifically needs Figma Desktop and edit access.

In **Rates, limits and client access**, select the $250 mobile-layout rate, a $250 per-quote maximum, $500 cumulative allowance and quantity 1. Leave optional Figma authors/replies and invoice reminders off for the first test. Check the explicit authorization box and choose **Approve & enable agent**. Copy the generated private client-portal link and open it in a separate tab.

As the client, send “Can you add the mobile checkout?” The plugin can be closed while the hosted worker processes it. Expect a live AI assessment and an automatic $250 quote, or a clarification/exception if full coverage cannot be established. Review the exact deliverables, revision and total. Check client consent, then choose **Approve revision 1 & prepare PayPal invoice**. Open the sandbox invoice and complete the $250 test payment using only the dedicated personal sandbox buyer supplied privately. Return to the portal and Refresh payment; expect authoritative Paid. Reopen the plugin and refresh Change orders or Check payment; verify the same revision and $0 due.

For a limit check, use a fresh run with a $200 per-quote maximum and the $250 rate. Expect an exception rather than an automatic quote; no additional payment is needed. The optional **Assess a request** tool supports manual comment selection and selected-frame context. **Demo controls → Reset my demo** intentionally replaces only the current run's local evidence/orders and access; PayPal retains its sandbox invoices. Do not reset a run whose evidence should be preserved. Full steps and recovery: https://github.com/henryperkins/scope-and-settle/blob/main/JUDGING.md. Hosted testing requires no provider API secrets.

**Private delivery gate:** the recorded connector field metadata does not expose a visibility flag. The event's private-testing requirement does not itself prove this field is private. Confirm the event-specific submission UI or obtain an organizer answer before adding the judging code or sandbox-buyer password. Do not put credentials or private role links in this file, the public description, repository, screenshots or video. General guidance recorded for reference: https://help.devpost.com/article/190-testing-guide. No organizer message was sent by this refresh.

## 29053 — AI tools used during development

OpenAI Codex assisted with implementation, regression tests, debugging, release checks and documentation. Baseten Model APIs provided live runtime inference using DeepSeek-V4.1-Flash-1017-Fast at maximum reasoning. An early automatic-quoting candidate failed closed on incomplete rate/evidence coverage; the generation contract and deterministic checks were tightened before a fresh live released-worker quote was verified. The bounded model evaluation used six synthetic cases and three fresh paraphrases, retained earlier failures, and did not claim broad reliability. Provider fixtures, actual model calls and live payment evidence were kept separate.

The 0.3.0 release passed 79 automated tests with no failures or skips on Windows and clean-source Linux. Deployed release 0.3.1 passed **81/81 on both Windows and clean-source Linux, with no failures or skips**, including the reconnection regression. Its exact public plugin ZIP passed native Figma frame export/preview, explicit Light/Dark, scrolling and session restoration against an existing hosted run. The hosted source/version, public ZIP and GitHub release asset matched. All 24 SQLite tables were preserved apart from the advancing worker heartbeat, with the AI ledger unchanged. Automated tests use simulated providers; the final public-ZIP check used the hosted application and created no new provider transaction. [Release verification](https://github.com/henryperkins/scope-and-settle/blob/main/docs/GOOD-TERMS-RELEASE-2026-10-25.md).

ElevenLabs was used by the entrant for presentation narration. Twelve supplied MP3 clips were synchronized with the unchanged 2:49 0.2.1 product footage, with 45 English caption cues. This is separate from the application's runtime AI. The [audio revision record](DEMO-VIDEO.md#current-studio-narration-revision--october-23-2026) records publication and signed-out playback. The existing video does not demonstrate automatic quoting or Good Terms. The entrant's generation cost and unspecified model settings are not inferred.

## Entrant answers still required

These are personal or eligibility answers. Do not infer them from a profile, location setting, code history or tool use.

| Field ID | Required human answer |
| --- | --- |
| 28778 | Individual, Team or Organization; actual team attribution if applicable |
| 28779 | Country of residence |
| 28780 | Canadian province for any Canadian team member, otherwise N/A |
| 28781 | Organization represented, otherwise N/A |
| 28782 / 28783 | New or Existing before October 1, 2026 at 9:15 a.m. Pacific; prior work and hackathon changes if Existing |
| 28790 / 28791 | Personal PayPal experience rating 1–10 and explanation |
| 28792 | Permission to contact for feedback: Yes or No |
| 29054 | Learning level: None, Moderate or Significant |
| 29055 | Career AI value: Yes or No |
| 28794 | Age-of-majority attestation for entrant and all teammates |
| 28795 | Eligible-jurisdiction attestation for entrant and all teammates |
| 28796 | Promotion-entity employee/representative/agent eligibility attestation |

Optional APIMatic and AG Grid experience questions should remain unanswered unless actual use is established. Refresh the official rules and form before the final submit action. No claim is made here that the entrant is eligible or the entry is complete.

## Package gates outside these text answers

- Release 0.3.1 source, tag, deployment, artifact digests, Windows/Linux tests, native public-ZIP acceptance and database preservation are verified in [the release record](GOOD-TERMS-RELEASE-2026-10-25.md). Recheck public links and availability before final submission.
- Confirm independent judge access to the currently configured Figma copy and private delivery of the judging code/buyer credentials.
- Capture/review an updated or supplementary automatic-quoting and Good Terms video; keep the existing 0.2.1 video's provenance intact.
- Complete 2–3 outside-designer walkthroughs and report observed completion, hesitation and interventions without inventing time savings.
- Refresh Devpost project `1500728` and the live event form before any update. The dated October 23 record says published project, with no hackathon submission timestamp; this local refresh did not verify live submission state.
- Keep the separate A–C integration branch's MCP, installment and evidence-packet work out of deployed-feature claims until separately qualified and promoted.
