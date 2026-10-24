---
version: 1
slug: "app-web-client-html"
primary_target: "app/web/client.html"
related_targets: ["app/web/review.html"]
---

# Client portal and change review

Mode: Operate. Primary target `app/web/client.html` (private client portal, `client.js`); related `app/web/review.html` (exact-revision review link, `review.js`).

## Brief

- **Audience:** a designer's client, not a designer, on a laptop or phone, opening a private link from their designer. The product's priority audience.
- **Job:** see where every change stands, act on what needs them (approve a quote, answer a question, pay), and ask for new changes.
- **Content:** only what the portal API returns: project name, request text and state, messages, and published orders (deliverables, line items with price source, revision, totals, invoice link, payment status). The portal receives no agreement evidence; never show any.
- **Constraints:** every action, consent sentence and payment term stays verbatim; approval stays explicit and per revision; the 5-second poll must never wipe a draft, a checked consent or an open row.
- **Memorable moment:** the open quote row, where the change, its price source and the consent sit beside one lifted decision panel.
- **Review page:** the same anatomy as an open statement row, given a whole page for one change.
- **Unresolved:** none.

## Direction contract

THESIS: A friendly statement of changes. Every request is one row with its stage, amount and next action. It refuses the chat-transcript stack where each request repeats itself in bubbles.

OWN-WORLD: Good Terms. Cool teal-tinted ground `#f5f7f7`, white bordered rows, ink `#152d37`. Brand teal `#006b65` marks only the client's move; Paid is deep teal with a check. Hanken Grotesk with tabular figures. Flat everywhere except the one lifted decision panel.

STORY: The client reads one sentence and knows where the money stands. They open what needs them, approve an exact revision, pay through PayPal and watch it settle.

FIRST VIEWPORT: Header row: wordmark, divider, "Client portal", sandbox chip at right. The project name is the H1 (30 px) with a one-sentence money summary under it (17 px). The request box sits at the head's right. Below, one bordered statement with column heads Change · Stage · Amount, needs-you rows first. The first row needing the client is open: deliverables and term on the left, the lifted decision panel (36 px total, consent, approve) on the right. A change that moved since the last visit stays highlighted until seen. Phone: head, request box, stacked rows.

FORM: The change statement, my resonance rank 7 of 7, dealt as the lead and chosen. seed:5bbe64947c5a1578

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
