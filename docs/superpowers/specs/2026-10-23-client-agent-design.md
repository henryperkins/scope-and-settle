# Scope & Settle client management agent

Approved direction: October 23, 2026. The entrant explicitly authorized automatic quotes when requests match approved rates and limits, and wants only exceptions escalated. This extends the working sandbox product; it does not change the requirement for explicit client approval of each exact revision.

## Product contract

The designer configures a project once, explicitly authorizes a rate-card subset and limits, and shares private client-portal access. A hosted worker observes new requests, assesses them against the frozen brief, asks for clarification, publishes permitted quotes, and keeps the client conversation and payment status together. The plugin can be closed throughout. The designer sees exceptions and a readable activity history.

The first version retains one configured synthetic Figma file, USD, the existing sandbox merchant/buyer pair, Node 24, TypeScript, SQLite, Baseten maximum reasoning and the existing Google Cloud deployment. Existing payment evidence, approvals, judge runs, invoice tombstones and shared AI accounting must survive additive migrations.

## Approaches and decisions

1. Figma-only webhooks: fastest event delivery but current Starter file access and new webhook permissions are not established.
2. Hosted scheduled comment ingestion plus a private client portal: use the existing comment-read capability, work with the plugin closed, support clients without Figma, and retain a future webhook-compatible ingestion boundary. Selected implementation approach under the user's authorization to build; polling latency is displayed honestly.
3. Plugin-only automation: depends on an open editor/plugin and cannot meet the unattended requirement.

Use one backend worker and durable SQLite records. Fetch the configured file once per polling cycle, then route new comments only to enabled runs with matching configured client user IDs. Keep Figma user IDs, not handles, as routing identity. Initialize a cursor at enablement so old shared-file comments are not automatically re-billed. Portal requests are scoped directly to one run and require private renewable access. Figma ingestion is optional per run; portal intake is always available after setup.

## Approved policy

Policy starts disabled. An owner explicitly enables it after reviewing allowed rate IDs, maximum quote in cents, cumulative quote allowance in cents, quantity limit per rate, and whether Figma replies and PayPal reminders are authorized. The UI may prefill synthetic example values ($250 per quote, $500 cumulative, quantity 1); these are examples until the owner approves them. Policy records preserve approver, version, brief/rate snapshot and expiry. Missing, changed, expired, revoked or paused authority prevents new outbound actions.

Quotes require a current validated `new_work` assessment, exact allowed rate IDs, integer quantities, complete rate coverage, no outstanding clarification question, and totals calculated by application code. Auto-quoted deliverables use the approved rate descriptions; unmatched or underspecified work is an exception. Limits include previously published agent quotes; changing policy cannot erase spend. Unknown prices, disputed scope, delivery commitments outside the brief, inconsistent evidence, repeated clarification, provider errors and uncertain message delivery become exceptions.

Client approval remains a deliberate action showing the exact revision, terms and price. The agent never approves on the client's behalf or charges a saved payment method. The existing invoice creation/recovery and authoritative Paid reconciliation remain the only payment path.

## Conversation and delivery

The private client portal supports requests, clarification replies, quotes, exact-revision approval and PayPal checkout. Access is a random, hashed, expiring run-scoped credential. It is separate from designer and per-order client sessions. All endpoints enforce the run and role; a portal can only approve an order actually published to that portal and must provide its current revision and explicit consent.

The project activity log distinguishes received, assessing, clarification, included, quoted, exception, approved, payment due and paid. Automatically publishing a quote into the client's private portal is recorded as portal delivery. Optional Figma replies mirror nonsecret text and direct clients to their already shared portal; they never contain a role credential or private approval link. Credentials are never inserted into public comments, source, logs, screenshots or recordings.

Provider writes use a durable outbox. A marker allows uncertain Figma comment posts to be reconciled before retry. Do not automatically retry an uncertain PayPal reminder; flag an exception. Ignore the agent's own comment IDs/markers and internal authors. Cap clarification attempts and messages. Client/AI text is untrusted evidence, never policy. Included decisions create work-list entries, not invented delivery promises.

## Reliability and lifecycle

Persist pending requests, assessment results, published quote IDs, messages, outbox attempts and exception state. Recover interrupted work after restart without duplicate quotes. Record a policy version before inference; recheck authority and cumulative limits immediately before publishing. Check the run is active after every awaited provider operation. Reset/revocation disables the old run and all its intake/access/jobs while preserving payment tombstones and the shared AI ledger.

Process one AI assessment at a time with bounded input, existing provider timeout and existing budget reservation. Coalesce replies into the same request; a reply after a quote requires designer review rather than silently changing terms. Respect Figma Retry-After and back off failures. Expose last successful poll and provider/worker errors. A failure must not look like quiet success. Poll payment only for agent orders at a bounded interval and use existing verification.

## Scope of this delivery

Implement autonomous request intake, clarification, permitted portal quotes, exception review/dismiss/retry, optional Figma reply delivery, exact-revision portal approval, payment status synchronization, and optional scheduled PayPal reminders. Existing manually reviewed proposals remain usable. No new payment products, live-money activation, arbitrary email/Slack integration or multi-merchant onboarding.

Use the private portal to accept client text without requiring a Figma account. The existing frame attachment remains available to the designer; automatic analysis must not claim to have seen a current frame unless one was actually supplied. Design snapshot upload/sharing is a separate follow-up if it cannot be implemented and verified without widening access.

## Acceptance

- A new permitted request is assessed and quoted with all designer pages/plugin closed; its quote persists after restart.
- An over-limit, unknown-price, ambiguous, internally authored or duplicate request cannot cause an unauthorized quote or invoice.
- Clarification replies resume the same request; changing scope/policy while inference runs prevents stale publication.
- A client explicitly approves the published exact revision; existing PayPal create/retry/read/webhook logic establishes payment.
- Run isolation, expiry, pause, reset, worker restart, outbound uncertainty, AI budget exhaustion and self-reply loops are exercised by deterministic tests.
- Browser walkthrough verifies policy enablement, client portal, automatic quote, exception review, approval and reopening. Actual provider observations are reported separately from fixtures.
- Preserve the 0.2.1 artifact/evidence; new source, package and judging claims receive a new version. Devpost final submission still awaits entrant answers and final approval.
