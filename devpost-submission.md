# Scope & Settle

**Tagline:** Turn a Figma request into an evidence-backed scope decision, an approved change, and a paid PayPal sandbox invoice.

<!-- devpost-description:start -->
## Inspiration

“Can you add the mobile checkout?” looks like a small comment. For a freelance designer or small studio, the answer depends on what the client agreed to buy. A desktop-only brief makes it a different conversation from an agreement that already includes responsive layouts.

Scope & Settle connects that conversation to an explicit commercial decision. The goal is to keep the request, agreement evidence, reviewed deliverables, client consent and payment attached to the same revision, so neither side has to reconstruct the agreement from scattered messages.

## What it does

The designer selects an actual Figma comment and can attach the selected design frame. AI compares the request with the supplied brief and returns **included**, **new work**, or **needs clarification**, with quoted agreement evidence. The frame supports context about the design; an absent mobile frame does not prove that mobile work was excluded from the agreement.

For new work, the designer reviews deliverables and the price. In the synthetic example, mobile layouts are excluded from the desktop-only brief and the rate card proposes **$250**. The designer confirms the terms, then a separate client page presents that exact revision. The client must explicitly consent before an invoice is prepared.

PayPal completes the workflow: the client pays the real sandbox invoice, and authoritative **Paid / $0 due** status returns to the designer workspace and Figma. “Work begins after payment” is a commercial term; the plugin does not restrict Figma editing.

## How we built it

The Figma development plugin exports the selected frame and stores scoped access. A browser designer workspace and a separate client review page share a Node.js 24 / TypeScript backend with persistent SQLite storage on Google Cloud. A Cloudflare Worker forwards PayPal webhook bodies and signature headers to the backend verifier.

AI runs through **Baseten Model APIs**, using **deepseek-ai/DeepSeek-V4.1-Flash-1017-Fast** with **maximum reasoning** and structured output. The server checks quoted clause evidence and allowed rate identifiers. Application code calculates integer money amounts; the designer confirms commercial terms. AI cannot approve a proposal or create an invoice. Only final output and usage are retained, not raw model reasoning.

The **PayPal sandbox Invoicing API** creates and publishes an invoice only after explicit approval. Recovery preserves the same invoice instead of duplicating a charge. A real signed webhook triggers authoritative invoice retrieval; the backend checks the invoice identity, merchant, currency, approved total, status and amount due before showing Paid. Manual refresh uses the same retrieval path. Paid remains attached to the approved revision.

**OpenAI Codex** supported implementation, regression tests, debugging, documentation and release verification. Provider fixtures helped test failures and recovery; they were kept separate from actual model calls, buyer checkout and signed delivery evidence.

## Challenges we ran into

Reliable payment recovery was more demanding than creating an invoice. We handled uncertain creation, interrupted publication, repeated approval actions and delayed callbacks without silently replacing approved terms. A merchant-timezone date issue and an incorrect payer URL were found against the real sandbox and covered with regressions. A separate webhook ingress delivered the real signed event after the original route had no observed callback; this established a working route without claiming an unproven root cause.

Native Figma testing also exposed a bridge assumption: legitimate editor messages arrived from the containing editor window. Correcting the trusted-source check restored frame attachment and saved access. Independent judging required isolated runs, renewable access, reset boundaries and persistent AI accounting, rather than a single session on the developer's laptop.

## Accomplishments and evidence

Three actual $250 sandbox buyer payments are recorded with authoritative PAID / $0 due and reconciled real signed PAID receipts. The first two orders' approvals, invoice identities and payment evidence survived deployment. The exact released plugin was then installed under a separate Figma test account, attached the actual frame, refreshed payment from PayPal and restored the same Paid revision after reopening without reconnecting.

The final demonstration uses a fresh proposal assessed through that released native plugin, with the actual frame attached, followed by designer review, separate client consent and real sandbox checkout. The recording follows the same approved revision back to Paid in Figma and through reopening. Manual invoice retrieval established the recording run's first visible Paid state; its automatic signed PAID callback was independently verified afterward. The 2:49 edit labels condensed navigation and approval, omitted authentication and sandbox use.

Release 0.2.1 passed **52 automated tests with no failures or skips on Windows and Linux**. Those tests use simulated providers. Separate live model evaluation passed six known synthetic cases and three fresh paraphrases after two earlier 5/6 attempts; these small checks do not establish broad model reliability. Detailed dated evidence is in the public repository.

## Impact and limitations

The demonstrated value is a traceable path from an ambiguous design request to a mutually approved and paid change. This is a prototype for one configured synthetic Figma project, USD invoices and one sandbox merchant/buyer pair. Role links grant demo access, not verified identity. It is not legal advice, automatic arbitration or a production payment service.

No designer walkthrough findings, adoption numbers or time savings are claimed yet. The planned 2–3 designer sessions will measure completion, hesitation and interventions separately from self-reported estimates. The initial separate-account native acceptance reused an existing paid order; a subsequent recording run completed a fresh native assessment and actual checkout. These are operator checks, not validation by outside designers.

## What we learned and what is next

An AI recommendation is useful only when its evidence and authority are clear. Human review, explicit revision-bound consent, invoice recovery and provider-backed payment truth make the recommendation actionable. Small synthetic evaluations helped identify missing rate and evidence fields, but cannot replace observation of real designers.

Next steps are designer walkthroughs and fixes based on observed friction, confirmed private delivery of judge access, and the remaining submission details. Broader project support and production commerce would require separate validation beyond this hackathon's scope.

## Try it

Watch the [public 2:49 demonstration](https://www.youtube.com/watch?v=m29YNTdVUF4), with English captions, actual product footage and labeled time compression.

Start at [judge entry](https://scope-and-settle.hperkins.com/judge) and follow [JUDGING.md](https://github.com/henryperkins/scope-and-settle/blob/main/JUDGING.md). Hosted testing needs Figma desktop, your own Figma account, the judging code and the dedicated sandbox buyer supplied through the judge-access channel. No provider API keys or local backend are needed for that path. The [public MIT-licensed repository](https://github.com/henryperkins/scope-and-settle) includes source, synthetic assets and a local setup fallback.
<!-- devpost-description:end -->

## Submission preparation notes — not part of the public description

- Existing Devpost project ID: `1500728`. The name, writeup, technologies and links were saved on October 23, 2026. Devpost changed its state to **published** at `2026-10-23T18:40:20.996Z`, with public URL https://devpost.com/software/scope-settle. The hackathon's `submitted_at` remains empty: **published project, not submitted entry**. Continue this project; do not create another.
- Public demo: https://scope-and-settle.hperkins.com/judge
- Public source: https://github.com/henryperkins/scope-and-settle
- Public YouTube URL: https://www.youtube.com/watch?v=m29YNTdVUF4 — published October 23, 2026, with the reviewed thumbnail, chapter timestamps and uploaded English captions. The original MP4 and captions also remain [release assets](https://github.com/henryperkins/scope-and-settle/releases/tag/v0.2.1).
- Built with: Figma, TypeScript, JavaScript, Node.js, SQLite, PayPal, Baseten, DeepSeek, Google Cloud, Cloudflare, Docker, OpenAI Codex.
- Technical field answers: [DEVPOST-CUSTOM-ANSWERS.md](docs/DEVPOST-CUSTOM-ANSWERS.md).
- Completed video, provenance and upload copy: [DEMO-VIDEO.md](docs/DEMO-VIDEO.md). Participant observation guide: [DEMO-AND-WALKTHROUGH.md](docs/DEMO-AND-WALKTHROUGH.md).
- Four reviewed actual screenshots and a native Paid thumbnail were uploaded to the existing project. Captures and provenance are in [docs/media](docs/media/README.md). The final video contains actual buyer checkout and the same revision's payment return; its client approval transition is explicitly condensed between observed before/after views.
- Final readiness: **not ready** until designer observations, private access delivery and entrant answers are complete. Native final-ZIP acceptance and public YouTube publication are complete. Re-read the live form/rules before final submission. Updating the public project does not submit the entry.

The official dates and five judging criteria were checked through the Devpost connector on October 23, 2026. Submission closes November 12 at 2 p.m. America/Chicago; the internal target is November 10. Judging ends December 15 at 10 a.m. America/Chicago. The current entry expiry is December 16 at 16:00 UTC. Runtime/provider availability through that date remains an operating commitment, not a guarantee inferred from the expiry setting.
