# Client agent verification — October 23, 2026

Status: 0.3.0 candidate under qualification. This document separates the new agent from the existing 0.2.1 hosted payment evidence. No outside designer walkthrough has been completed, and the current public video predates automatic quoting.

## Implemented

- Explicit designer authorization for selected rates, quantity, per-quote cap and cumulative quote allowance. Code calculates USD integer amounts; AI does not set prices.
- Explicit requested-component → deliverable → rate coverage, exact agreement evidence and canonical rate descriptions. Unpriced, ambiguous, unsupported or over-limit work does not become an automatic quote.
- Hosted single-process worker, private client requests and clarification, new Figma client-thread intake with stable author IDs and exclusive routing, durable delivery records and bounded recovery.
- Private portal approval of the exact published revision before the existing PayPal invoice path. Revoked/reset/expired or cross-run access is rejected.
- Designer exceptions, manual override publication, pause, opt-in Figma replies, opt-in PayPal reminders (maximum two, at least 24 hours apart), and existing authoritative payment reconciliation.

## Automated and browser fixtures

After review fixes: Windows Node 24.15.0 suite **78 passed, 0 failed, 0 skipped**. Tests cover policy authority, canonical coverage, cumulative limits, client isolation/consent, pause/reset during assessment, duplicate intake, uncertain reply reconciliation, reminder rechecks, Paid continuity and the existing 52-test baseline. Added regressions cover stale cached evidence, invoice-in-flight recovery, separate delivery attention, OAuth authority races, immutable request/invoice associations, incomplete source coverage and exception editor context. All providers are fixtures in these checks.

Local browser operator walkthrough: approved a $250 rate / $250 quote cap / $500 cumulative policy, opened the private portal, submitted the mobile request, observed an automatically delivered $250 revision-1 quote without returning to the designer, explicitly approved as client, and observed payment-due with a sandbox checkout link from the fixture provider. A third request exceeded the $500 allowance and appeared in the exception queue; explicit designer review published the override to the same portal. At a 420px viewport, document width remained within the viewport. No actual payment or live inference was performed in this local walkthrough.

## Qualification still required

- Completed: independent review findings reproduced and fixed with regression tests.
- Clean-source Linux build and final release ZIP identity.
- Live Baseten automatic-assessment contract and actual available Figma capabilities.
- Additive deployment, preserved three Paid orders/receipts/AI ledger, and hosted agent/reopening checks.
- Final native release installation acceptance and a demonstration covering the new agent.

## Operational limits

One configured synthetic Figma file, USD, one sandbox merchant/buyer pair and one backend process per database. The portal is the primary delivery destination; it does not email clients. Optional Figma replies contain terms but no private links. Client routing is per stable author ID, and a shared author can belong to only one active run. Existing comments are not retroactively quoted.

The model supplies semantic classification and coverage; schema and deterministic checks cannot establish general model correctness. Automatic terms are restricted to the exact approved catalogue. Ambiguity and provider failures escalate. The selected-frame path remains manual; background work does not imply a fresh exported frame.

Judging delegation uses the parent grant's expiry; development-session delegation is limited to 24 hours. Expiry/revocation, changed briefs and paused policies stop new autonomous work. Published quotes remain subject to exact client consent. Restarted ambiguous AI operations become exceptions instead of automatically spending again. The shared development accounting remains capped across instances.

## Official Figma API basis

Rechecked the official [LLM index](https://developers.figma.com/llms.txt), [REST index](https://developers.figma.com/docs/rest-api/llms.txt) and [Plugin index](https://developers.figma.com/docs/plugins/llms.txt), then the detailed references. [Comments endpoints](https://developers.figma.com/docs/rest-api/comments-endpoints/) specify GET/POST under `/v1/files/:key/comments`, separate read/write scopes and root-only `comment_id` replies. [Rate limits](https://developers.figma.com/docs/rest-api/rate-limits/) depend on endpoint tier, seat and resource plan; the worker polls once per minute, spaces replies at least 30 seconds apart and honors returned retry timing. [Plugin execution](https://developers.figma.com/docs/plugins/how-plugins-run/) separates document access in the sandbox from browser APIs in the UI iframe. The hosted worker is therefore independent of the plugin lifecycle.

The connected Figma MCP tools expose design context and screenshots for development inspection. They are not used as a substitute for runtime comment intake or as proof that a designed screen's behavior is implemented. This project has no Code Connect mapping claim. The original actual frame/export evidence is recorded separately from these documented capabilities.
