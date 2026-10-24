# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Clients of a freelance designer or small studio.** Non-designers who receive a private portal link, ask for changes in plain language, answer clarification questions, review the exact revision, approve it and pay through PayPal sandbox. They need no Figma account or design vocabulary. When designer and client needs conflict, the client's experience wins: the portal and review page carry the money moment (confirmed October 24, 2026).
- **Freelance designers and small studios.** The operators. They approve a rate selection, per-quote limit and cumulative allowance once, share client access, handle only exceptions, and track change orders and payment from the browser workspace or the Figma desktop plugin.
- **Hackathon judges.** During the judging window they play both roles in isolated demo runs started from judge entry, install the plugin from a ZIP and pay as a dedicated sandbox buyer.

## Product Purpose

Scope & Settle handles client change requests within designer-approved rates and limits, then settles them with PayPal. It links agreement → evidence → approved policy or designer exception review → client approval → PayPal invoice → payment status, keeping all of it attached to one immutable revision so neither side has to reconstruct the agreement from scattered messages.

Success: a request becomes a mutually approved, paid change with its evidence attached. The client understands exactly what they approve and pay for; the designer touches only exceptions.

## Positioning

The AI recommends, code enforces, people consent and PayPal confirms. AI classifies a request as included, new work or needs clarification, quoting agreement evidence. Application code checks rate coverage and limits and calculates integer amounts. The client explicitly approves the exact revision. Only authoritative PayPal invoice retrieval marks a change Paid. "Work begins after payment" is the commercial term.

## Operating Context

- **Designer:** `/designer` in a browser, or the same interface bundled into a Figma desktop development plugin (440 × 720 panel beside the canvas) that can export the selected frame as evidence. The hosted worker keeps running while the plugin and pages are closed; Figma comments are polled about once a minute.
- **Client:** the private portal at `/client` (requests, replies, quotes, consent, PayPal checkout, payment refresh) and per-order review links at `/review`. Pages poll for updates while open.
- **Judges:** `/judge` with a private judging code. Each start creates an isolated run; access ends December 16, 2026 at 16:00 UTC. Devpost submission closes November 12, 2026 (internal target November 10); judging ends December 15, 2026.
- Hosted at `https://scope-and-settle.hperkins.com` on Google Cloud; a local build on `http://localhost:8787` is the fallback.

## Capabilities and Constraints

- **Horizon:** a hackathon entry for the PayPal hackathon on Devpost, built for its judging window (confirmed October 24, 2026). Sandbox payments, synthetic content and judge entry are the product's real context, not temporary scaffolding.
- **Boundary:** one configured synthetic Figma file, one designer role, one client role, one sandbox merchant/buyer pair, USD. Role links grant demo authority, not verified identity. The plugin does not restrict Figma editing. Group buying, payouts, multi-merchant onboarding, subscriptions, arbitration and marketplace publication are out of scope.
- **Client request states:** Request received, Assessing your request, Quote ready, Your answer is needed, Covered by the brief, Your designer is reviewing this, Your designer is handling this directly, Paid.
- **Change-order states:** Draft, Awaiting client approval, Designer re-review needed, Approved (unpaid), Preparing invoice, Payment due, Paid, Partially paid, Payment pending, Payment needs review.
- **Price provenance stays visible:** rate-card price versus designer-set price, on every line item.
- **Surfaces:** the designer interface must work at the plugin's 440 px width and in a full browser; client pages must work on phones.
- **Technical:** vanilla HTML, CSS and ES modules served by a Node 24 / TypeScript backend with SQLite. One shared stylesheet is inlined into the plugin's `ui.html` at build. Page CSP allows only same-origin scripts, styles, connections and images (plus `data:` images); the plugin may reach only the backend origin. Fonts and assets must be system, same-origin or inlined.

## Brand Commitments

- **Name:** Scope & Settle. The wordmark with its accented ampersand and the existing teal stay as identity anchors while the system evolves (confirmed October 24, 2026).
- **Voice:** plain, exact and honest about limits. It separates evidence from claims and never overstates, for example "Synthetic project · PayPal sandbox · Work begins after payment." Existing lines: "Keep good work on good terms." "Good work starts with clear agreement." "Let's agree on the extra work." "A client comment. A clear agreement. Paid."
- Manual or demo paths are labeled as such and never presented as AI results. PayPal names and marks belong to PayPal; the product refers to PayPal without imitating its brand.

## Evidence on Hand

- `docs/media/`: four reviewed product screenshots (live assessment, native frame, client paid, native paid), demo captions and transcript; the public 2:49 demonstration on YouTube.
- Dated verification records in `docs/` (October 22–23, 2026); release 0.3.0 passed 79 automated tests.
- `fixtures/`: the synthetic brief, the editable checkout SVG and six scope-judgment cases.
- **Absent, never to be fabricated:** testimonials, designer walkthrough findings, adoption numbers, time savings, real customers and claims of broad model reliability.

## Product Principles

1. **Evidence before price.** Every decision shows the agreement clause behind it and every amount shows its price source.
2. **Consent is explicit and exact.** The client approves one immutable revision, its deliverables and its total; nothing is approved on their behalf.
3. **PayPal is the payment truth.** Paid appears only after authoritative invoice retrieval.
4. **Honest states over smooth ones.** Waiting, exceptions and failures are shown plainly; unattended does not mean maintenance-free.
5. **The client never needs Figma to know where things stand.**
