# Scope & Settle

**Tagline:** Let clients request changes, approve the exact terms and pay through PayPal—within the rates and limits their designer approved.

> Local submission draft refreshed October 25, 2026 for deployed release **0.3.1 / Good Terms**. The hosted runtime, public plugin ZIP and GitHub release were verified at source `ebbed27123f33d2ba6f30d7ea9a35c5d2df2d16c`. See the [release evidence](docs/GOOD-TERMS-RELEASE-2026-10-25.md). No live Devpost update was performed for this refresh.

<!-- devpost-description:start -->
## Inspiration

“Can you add the mobile checkout?” looks like a small comment. For a freelance designer or small studio, the answer depends on what the client agreed to buy. A desktop-only brief makes it a different conversation from an agreement that already includes responsive layouts.

Scope & Settle connects that conversation to an explicit commercial decision. It keeps the request, agreement evidence, permitted rates, client consent and payment attached to the same revision, so neither side has to reconstruct the agreement from scattered messages. Designers should be able to delegate routine quoting without delegating unlimited authority; clients should understand exactly what they are approving and paying for.

## What it does

The designer selects the catalogue rates they allow, a per-quote limit, a cumulative allowance and a quantity limit, then explicitly enables the client agent. A private client portal accepts change requests and clarification answers. Optional Figma intake watches newly created threads from specifically authorized client authors. The hosted worker continues while the plugin and designer page are closed.

AI compares a request with the supplied brief and returns **included**, **new work**, or **needs clarification**, with quoted agreement evidence and coverage for the requested deliverables. Application code validates that coverage, calculates integer money amounts and enforces the approved limits. A supported request within the policy can receive a quote without another designer click. Unsupported, ambiguous, unpriced or over-limit work comes back for clarification or designer review.

In the synthetic example, mobile layouts are excluded from a desktop-only brief and the approved catalogue rate is **$250**. The client sees the exact deliverables, total and revision in the private portal. Explicit client consent is still required before PayPal invoicing. Designer permission to quote is not client approval, and approval is not payment.

The designer can also assess an actual Figma comment manually and attach the selected design frame. The frame supplies design context; an absent mobile frame does not prove that mobile work was excluded from the agreement. This path retains designer review of the proposed terms.

PayPal completes the workflow: the client opens the actual sandbox invoice, and authoritative **Paid / $0 due** status returns to the client portal, designer workspace and Figma. “Work begins after payment” is a commercial term; the plugin does not restrict Figma editing.

## The Good Terms interface

Release **0.3.1 / Good Terms** makes the client's money decision the clearest part of the interface. The client portal presents each change alongside its exact terms and consent control. The designer's **Request → Quote → Approval → Payment** board puts exceptions at the stage they block. The same workspace fits a 440 × 720 Figma panel and a full browser, with native Light and Dark appearance and a self-hosted, bundled typeface.

The exact public release ZIP was imported into Figma Desktop and connected to an existing hosted run. Actual frame export and preview, explicit Light/Dark switching, scrolling through the invoice and footer, and restoring the session after reopening all passed. The existing **$250 Payment due / revision 1** state remained visible after reopening without re-entering access. The original System theme was restored. These release checks created no new AI assessment, invoice, payment or client reply. [Release verification](https://github.com/henryperkins/scope-and-settle/blob/main/docs/GOOD-TERMS-RELEASE-2026-10-25.md).

## How we built it

The Figma development plugin exports the selected frame and stores scoped access. The browser designer workspace, private client portal and separate review page share a Node.js 24 / TypeScript backend with persistent SQLite storage on Google Cloud. A hosted worker handles authorized intake, assessment and delivery. A Cloudflare Worker forwards PayPal webhook bodies and signature headers to the backend verifier.

AI runs through **Baseten Model APIs**, using **deepseek-ai/DeepSeek-V4.1-Flash-1017-Fast** with **maximum reasoning** and structured output. The server checks quoted clause evidence, requested-component coverage and allowed catalogue identifiers. Application code calculates the permitted price. The model cannot expand the designer's authorization, consent for the client or mark an invoice paid. Only final output and usage are retained, not raw model reasoning.

The **PayPal sandbox Invoicing API** creates and publishes an invoice only after explicit approval of its exact revision. Recovery preserves the same invoice instead of duplicating a charge. A real signed webhook triggers authoritative invoice retrieval; the backend checks invoice identity, merchant, currency, approved total, status and amount due before showing Paid. Manual refresh uses the same retrieval path and is identified separately from webhook delivery evidence.

**OpenAI Codex** supported implementation, regression tests, debugging, documentation and release verification. Provider fixtures helped test failure and recovery without creating live invoices or sending real messages. Source checks, fixture tests, native UI checks, actual model calls, buyer checkout and signed webhook delivery were recorded as distinct evidence.

## Challenges we ran into

Reliable recovery was more demanding than creating an invoice. We handled uncertain creation, interrupted publication, repeated approval actions and delayed callbacks without silently replacing approved terms. A merchant-timezone date issue and an incorrect payer URL were found against the real sandbox and covered with regressions. A separate webhook ingress delivered the real signed event after the original route had no observed callback; this established a working route without claiming an unproven root cause.

Automatic quoting introduced a different boundary: every requested component must be supported by the agreement and the designer-approved catalogue. An early live candidate failed closed when its result cited the request as agreement evidence and omitted a priced deliverable. The generation contract was tightened, and the released worker then delivered a fresh live quote within the approved policy. Ambiguous or unsupported work remains an exception, not an invitation to invent a price.

Native Figma testing exposed a bridge assumption: legitimate editor messages arrived from the containing editor window. Correcting the trusted-source check restored frame attachment and saved access. The Good Terms desktop check also found a stale expired-session notice after a successful reconnection; release 0.3.1 clears the old notice without hiding a new loading failure.

## Accomplishments and evidence

Three actual **$250 sandbox buyer payments** are documented with authoritative **PAID / $0 due** and reconciled real signed PAID receipts. In the earlier manual-workflow qualification, the plugin was installed under a separate Figma test account, attached the actual frame, refreshed payment from PayPal and restored the same Paid revision after reopening. This is operator verification with synthetic content, not outside-designer research.

The **0.3.0 client agent** was independently qualified with a live automatic $250 portal quote, a request escalated by a $200 limit, and a sandbox invoice created only after the client's explicit consent. An authorized Figma comment also received an actual automatic reply while the plugin and designer page were closed. That qualification did **not** include a new buyer payment on the automatically generated invoice; the three completed payments are earlier, separately identified evidence.

Release 0.3.0 passed **79 automated tests with no failures or skips on Windows and clean-source Linux**. Release **0.3.1 passed 81/81 tests on both Windows and clean-source Linux, with no failures or skips**, including the reconnection regression. Automated tests use simulated providers. The deployed source, downloadable plugin and GitHub release match; all 24 database tables were preserved apart from the advancing worker heartbeat, with AI accounting unchanged. [October 25 release evidence](https://github.com/henryperkins/scope-and-settle/blob/main/docs/GOOD-TERMS-RELEASE-2026-10-25.md).

Separate live model evaluation passed six known synthetic cases and three fresh paraphrases after two earlier 5/6 attempts. These small checks and the later live agent cases do not establish broad model reliability. Dated evidence is retained in the public repository.

The published **2:49 video is a 0.2.1 manual-workflow demonstration**. It shows a fresh native assessment, actual frame context, designer review, separate client consent, real sandbox checkout and the same Paid revision restored in Figma. Its edit labels condensed navigation and approval, omitted authentication and sandbox use. Manual retrieval established the recording run's first visible Paid state; its automatic signed callback was independently verified afterward. The entrant-supplied ElevenLabs narration is presentation audio, separate from the product's Baseten inference. The video does not show automatic quoting or Good Terms.

## Impact and limitations

The demonstrated value is a traceable path from an ambiguous request to a mutually approved and paid change, with routine quoting bounded by an explicit designer policy. This prototype supports one configured synthetic Figma project, USD invoices, one sandbox merchant/buyer pair and one backend process per database. Role links grant demo authority, not verified identity. It is not legal advice, automatic arbitration or a production payment service.

The private portal is the primary delivery destination and does not send email notifications. Optional Figma replies have a separate opt-in and never include the private portal link. Background assessment uses the request and brief; it does not silently export a fresh selected frame while Figma is closed.

No designer walkthrough findings, adoption numbers or time savings are claimed. The planned 2–3 outside-designer sessions will measure completion, hesitation and interventions separately from self-reported estimates. Advanced agent-integration work in another development branch is not part of this hosted-release claim.

## What we learned and what is next

An AI recommendation is useful only when its evidence and authority are clear. Designer-approved boundaries, explicit revision-bound client consent, invoice recovery and provider-backed payment truth make it actionable. Small synthetic evaluations help expose contract gaps but cannot replace observation of real designers.

The next package steps are recording a demonstration of automatic quoting and the updated interface, conducting outside-designer walkthroughs, confirming independent access to the current Figma file and private judge-access delivery, and completing the entrant's remaining form answers. Broader project support and production commerce require separate validation.

## Try it

Watch the [public 2:49 manual-workflow demonstration](https://www.youtube.com/watch?v=AF8HFogZvsY), with English captions, actual 0.2.1 product footage and labeled time compression.

Start at [judge entry](https://scope-and-settle.hperkins.com/judge) and follow [JUDGING.md](https://github.com/henryperkins/scope-and-settle/blob/main/JUDGING.md). Use the plugin ZIP and exact Figma file linked by entry. Native frame export needs Figma Desktop and edit access to that file; the browser workspace is available for the request, approval and payment workflow. The judging code and dedicated sandbox buyer are supplied through the private testing channel. Hosted testing requires no provider API keys or local backend. The [public MIT-licensed repository](https://github.com/henryperkins/scope-and-settle) includes source, synthetic assets and a local setup fallback.
<!-- devpost-description:end -->

## Submission preparation notes — not part of the public description

### Verified release and evidence

- **Deployed release:** [v0.3.1 / Good Terms](https://github.com/henryperkins/scope-and-settle/releases/tag/v0.3.1), verified October 25, 2026. Source and tag: `ebbed27123f33d2ba6f30d7ea9a35c5d2df2d16c`; hosted health passed in PayPal sandbox mode and public plugin metadata matched this source/version.
- **Qualified artifact:** `scope-and-settle-0.3.1-ebbed27123f3.zip`; SHA-256 `5f2f2f92eea71337a18b3def9ba81a9b01d01bf90d0041bb0794a5021a96aaaf`. The hosted public ZIP and published GitHub release asset matched this digest. Windows and clean-source Linux each passed **81/81**, with **0 failures and 0 skips**.
- **Release evidence:** [GOOD-TERMS-RELEASE-2026-10-25.md](docs/GOOD-TERMS-RELEASE-2026-10-25.md) records artifact/runtime identity, all 48 runtime files readable by UID 1000, exact response bytes and MIME types across 15 HTTP routes, native acceptance of the public ZIP, and preservation of all 24 database tables except the worker heartbeat. Hosted AI accounting stayed at **32 calls / 135,269 micro-USD spent**; that is the hosted ledger, not a combined cross-environment budget total.
- **Existing baseline evidence:** [0.3.0 qualification](docs/CLIENT-AGENT-VERIFICATION-2026-10-23.md), [earlier payment/native qualification](docs/JUDGING-VERIFICATION-2026-10-23.md), and [video provenance](docs/DEMO-VIDEO.md).
- **Earlier local checks:** `output/track1-native-2026-10-25/verification.md` and `banner-full-suite.log` retain the isolated-fixture appearance and regression checks. These ignored files are not public evidence links; the reviewed release document above records the final hosted/public-ZIP acceptance.
- **Retained deployment failure:** the first image preparation failed on file readability (`EACCES`) before activation after archive extraction under `umask 077`. The image was rebuilt with permissions preserved and passed the final qualification. The failed attempt remains part of the evidence; it was not activated.
- Preserve the distinction between earlier completed payments, the later automatically quoted unpaid invoice, isolated-fixture checks and the final hosted/public-ZIP acceptance. No new AI call, invoice, payment or client reply was created during the Good Terms release checks.
- The separate A–C integration branch contains local development work. Its MCP connector, installment workflows, evidence packets and other advanced capabilities must not be described as deployed merely because its tests pass.

### Existing project and assets

- Existing Devpost project: `1500728`, https://devpost.com/software/scope-settle. The dated October 23 record says the project was published and its hackathon `submitted_at` was empty. Continue that project; do not create another. This refresh did not read or change live Devpost state.
- Public demo: https://scope-and-settle.hperkins.com/judge
- Public source: https://github.com/henryperkins/scope-and-settle
- Public video: https://www.youtube.com/watch?v=AF8HFogZvsY. Devpost project version 6 used this URL in the October 23 record. It remains 0.2.1 manual-workflow footage: twelve ElevenLabs narration clips, 45 English captions and unchanged 2:49 product footage. The original and revised MP4s/captions remain [v0.2.1 release assets](https://github.com/henryperkins/scope-and-settle/releases/tag/v0.2.1).
- Built with: Figma, TypeScript, JavaScript, Node.js, SQLite, PayPal, Baseten, DeepSeek, Google Cloud, Cloudflare, Docker, OpenAI Codex. ElevenLabs was used for demo narration, not runtime inference.
- Technical form drafts and entrant-only fields: [DEVPOST-CUSTOM-ANSWERS.md](docs/DEVPOST-CUSTOM-ANSWERS.md).
- Four actual product screenshots and the native Paid thumbnail in the existing project belong to the earlier 0.2.1 evidence. Their provenance is in [docs/media](docs/media/README.md); do not relabel them as 0.3.1 captures.

### Screenshot shot list for the refreshed release

1. Client request and a fresh automatically delivered quote, with private links and credentials excluded.
2. Exact revision, deliverables, total and explicit client-consent control in Good Terms.
3. Designer stage board showing a genuine over-limit exception and its reason.
4. Native Figma plugin in Light and Dark, with the same run and visible stage labels.
5. Authoritative Paid / $0 due on its actual revision. Label a reused earlier paid order as earlier evidence; do not imply it is the new automatic quote.

### Updated or supplementary demo outline

Use the [0.3.0 agent recording outline](docs/DEMO-AND-WALKTHROUGH.md) with the verified Good Terms release. Show policy approval, a new request, the actual automatic quote while the plugin is closed, an exception, exact client consent and PayPal invoice creation. Show Paid only for the actual paid order, with provenance explicit if reusing historical evidence. Keep authentication and role links out of the capture; label sandbox use and time compression. Record and review the new footage before replacing or supplementing the public 0.2.1 video.

### Remaining package work

- [x] Verify 0.3.1 deployment, source/tag, exact public and GitHub ZIP digests, Windows/Linux tests, native acceptance and database preservation; [release evidence](docs/GOOD-TERMS-RELEASE-2026-10-25.md).
- [ ] Verify a judge's independent edit access to the currently configured paid-team Figma copy. Earlier anyone-can-edit acceptance on a different file is not proof for this copy.
- [ ] Record/review a new or supplementary demo covering automatic quoting and Good Terms; keep the existing video's version label accurate until then.
- [ ] Conduct 2–3 outside-designer walkthroughs using [the observation guide](docs/DEMO-AND-WALKTHROUGH.md); record real outcomes and limitations.
- [ ] Confirm whether testing-instructions field `28798` is private in the live event UI or through an organizer answer before putting credentials there. No organizer message has been sent by this refresh.
- [ ] Obtain the entrant-only identity, prior-work, experience, feedback and eligibility answers listed in the technical-answer draft.
- [ ] Refresh official form, rules, dates, registration and entry state through Devpost before the final submission action. Saving a public project is not hackathon submission.

The October 23 connector record listed November 12 at 2 p.m. America/Chicago as the close, with November 10 as the internal target, and December 15 at 10 a.m. America/Chicago as the end of judging. These dates were not freshly checked for this local draft. The recorded entry expiry of December 16 at 16:00 UTC is not a guarantee that runtime/providers will remain available; hosting and private access need an operating check through the judging period.
