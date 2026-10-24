# Client Management Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Automatically deliver quotes inside designer-approved rates and limits, escalating exceptions while preserving client consent and PayPal correctness.

**Architecture:** Existing single Node backend gains an additive SQLite agent store, a policy gate, a durable worker, and a private client portal. Scheduled Figma comment checks use the existing read integration. Portal delivery is always available; provider messaging is separately enabled and recorded.

**Tech Stack:** Node 24, TypeScript, node:sqlite, existing vanilla JS interfaces, Baseten, PayPal sandbox.

**Spec:** `docs/superpowers/specs/2026-10-23-client-agent-design.md`

## Global Constraints

- Preserve primary checkout and all pre-existing untracked files; stage exact allowlists only.
- Retain sandbox, USD, one configured file, approved revision continuity, shared $25 development budget and hosted allocation.
- No provider secrets or role credentials in public artifacts or Figma comments.
- Policies start disabled and require explicit authorization in the product.
- Keep real provider evidence separate from automated fixtures.

## Review Focus

- Reset, pause, revoke or policy edit during an awaited provider response must prevent later publication.
- Repeated/reordered input and process restarts must not duplicate quotes or outbound messages.
- Valid structured AI output with incomplete pricing or extra requests must be an exception.
- A portal cannot approve unpublished, stale, edited or cross-run orders.
- Missing write permissions and uncertain delivery must surface an actionable exception.

### Task 1: Policy and durable store

Files: new `app/src/backend/agentPolicy.ts`, `agentStore.ts`; tests `app/tests/agent-policy.test.mjs`; extend Figma comment user ID contract.
Interfaces: `saveAgentPolicy(session, input)`, `getAgentPolicy(runId)`, `evaluateAutoQuote(project,result,policy,alreadyQuotedMinor)`; durable request/message/outbox records scoped by run.
- [x] Write/run failing tests for exact rates, missing coverage, limits, scope mismatch, explicit consent and cumulative allowance.
- [x] Implement additive schema, typed policy validation and deterministic quote gate.
- [x] Run policy tests and commit reviewed files.

### Task 2: Portal authority and request lifecycle

Files: new `agentPortal.ts`; modify role/grant checks and reset lifecycle; tests `agent-portal.test.mjs`.
Interfaces: `createPortalAccess(session)`, `portalView(session)`, `addPortalRequest(session,text,parentId?)`, `approvePortalQuote(session,requestId,revision,consent)`.
- [x] Write/run failing authorization, expiry, reset, unpublished/stale/cross-run approval tests.
- [x] Implement hashed renewable portal grants and request/message storage, bounded text and immutable published quote references.
- [x] Run portal and existing judging/session tests; commit.

### Task 3: Autonomous worker and provider outbox

Files: new `agentWorker.ts`; extend `figma.ts`, `paypal.ts`; tests `agent-worker.test.mjs`.
Interfaces: `runAgentCycle(dependencies?)`, `startAgentWorker()`, Figma comment post/reconciliation and PayPal reminder adapter.
- [x] Write/run failing automatic intake, clarification, quote, exception, race, restart, cumulative limit and self-loop tests using isolated providers.
- [x] Implement single-flight worker, durable jobs/outbox, polling cursors, authority checks, payment tracking and opt-in reminders.
- [x] Run worker/provider tests; commit.

### Task 4: HTTP and browser experience

Files: server routes; new `app/web/agent.js`, `client.html`, `client.js`; designer UI/style; plugin packaging inputs as needed; tests `agent-http.test.mjs`.
Routes: designer `/api/agent` GET, `/api/agent/policy` POST, `/api/agent/portal-access` POST, `/api/agent/requests/:id/{retry,dismiss}` POST; portal `/api/portal` GET, `/api/portal/requests` POST, `/api/portal/requests/:id/{reply,approve}` POST. Client portal is `/client`.
- [x] Write/run failing endpoint isolation, consent and static asset tests.
- [x] Implement policy setup, activity, exceptions and private portal delivery with accessible controls.
- [x] Run whole suite and browser walkthrough; commit.

### Task 5: Review and release qualification

Files: current README, JUDGING, product/agent docs, version and release metadata.
- [x] Fresh independent review against spec and listed failure modes; fix material findings with regression tests.
- [x] Run full Windows suite and clean Linux release build; verify package checksums and preserved baseline.
- [x] Exercise actual available provider read/write paths without exposing secrets or spending outside the existing ledger; report unavailable permissions honestly.
- [x] Record new verification and deploy only qualified artifacts within existing authorization; preserve backups and existing paid evidence.
- [ ] Publish the reviewed source and exact qualified plugin as the public 0.3.0 release.
- [x] Update judging materials to distinguish the new autonomous path and previously recorded video; final Devpost submission remains pending user review.
