# Judging Access Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this approved plan in this worktree. Steps use checkbox syntax for tracking.

**Goal:** Make the hosted demo usable by independent judges through the judging window, with renewable role access, isolated reset, and a prebuilt Figma kit.

**Architecture:** A private random entry credential creates independent persisted runs. Separately hashed resume credentials exchange for one-hour sessions bound to a run and role, and to an exact proposal revision for clients. Each entry credential freezes its supplied project; every run retains that snapshot. Existing development sessions retain their scope-editing capability.

**Tech Stack:** Node 24 HTTP server, SQLite, browser JavaScript, Figma development plugin, existing Google Cloud container deployment.

**Spec:** `docs/JUDGING-ACCESS-PLAN.md`.

## Global constraints

- Preserve the existing Paid order, invoice, approval, AI ledger and primary checkout.
- Sandbox only; no new independent AI allowance or local live inference.
- All browser work uses isolated sessions.
- Judge access ends at `2026-12-16T16:00:00Z` by default, covering the planned December 15 judging close with a one-day buffer. Sessions last 60 minutes; grants never outlive their entry credential.
- High-entropy entry and resume secrets are hashed in SQLite, kept out of source, and transported in URL fragments or POST bodies.
- No user approval is needed again for implementation of the already approved plan. Commit only a reviewed source allowlist; public publication remains separate.

## Review focus

- Expired, revoked, reset or obsolete-revision grants cannot renew authority.
- Two judges cannot read, mutate, reset or invalidate each other's runs.
- A developer changing the shared brief cannot change an existing judging scenario.
- Reset racing an invoice or AI call cannot resurrect cleared work or reset accounting.
- A native attachment must come from the configured Figma file; a new browser/account installation must not be claimed from fixtures.

## Task 1: Confirm real webhook delivery

**Files:** `deploy/gcp/register-paypal-webhook.mjs`, a reusable lookup helper and its tests, dated verification notes.

- [x] Inspect the real PAID event, hosted receipts, public callback and edge traffic.
- [x] Register the missing account-to-app webhook lookup after confirming the list was empty; read it back.
- [ ] Observe a real signed receipt and provider-backed reconciliation; preserve event ID, timestamps and receipt state.
- [x] Add an idempotent lookup step to provisioning that refuses to replace a mapping owned by another app; test the helper against fixture API responses.

## Task 2: Durable backend access

**Files:** `app/src/backend/db.ts`, `judgeAccess.ts`, `judging.ts`, `sessions.ts`, `orders.ts`, `assessment.ts`, `server.ts`; `app/tests/judging.test.mjs`; `app/scripts/create-judge-access.mjs`, `revoke-judge-access.mjs`.

**Interfaces:**
- `createJudgeAccess({expiresAt}): {id, credential, expiresAt}` provisions a revocable hashed entry credential and its project snapshot.
- `startJudgeRun(credential): Session & {renewalCredential}` allocates a fresh run and designer grant.
- `renewJudgeSession(credential): Session & {renewalCredential}` preserves grant scope and rotates the short-lived session.
- `createClientAccess(session, order): {approvalUrl, approvalExpiresAt}` issues revision-bound client access.
- `resetJudgeRun(session)` retires that run and its grants, tombstones its invoices, and returns a new run/session/grant under the same active entry credential.
- `getProjectForRun(runId)` resolves a frozen judging snapshot or the current development project.

- [x] Write tests for fresh independent runs and hashed secrets, one-hour expiry/renewal, parent revocation, client role/revision binding, frozen scope, reset/tombstones/budget preservation and concurrent work.
- [x] Run the new tests and retain their expected initial failure.
- [x] Implement additive schema changes and the interfaces above; expose `/api/judge/start`, `/api/session/renew` before ordinary-session authorization.
- [x] Derive authorization from persistent records; reject judge scope writes. Preserve development behavior.
- [x] Run the focused tests and the complete existing suite.

## Task 3: Browser and native access UI

**Files:** `app/web/judge.html`, `judge.js`, `common.js`, `designer.html`, `designer.js`, `review.js`; `app/plugin/code.ts`, `manifest.json`.

- [x] Add `/judge` with private entry, fresh-run and own-run resume actions, issued plugin access and explicit installation steps.
- [x] Implement one bounded renewal retry on HTTP 401, persist the resume credential in browser session storage or native clientStorage, and clear stale workspace content after authorization fails.
- [x] Keep client consent explicit and add a way to reopen the current client revision from a restored designer run.
- [x] Label reset **Reset my demo** and clear transient frame/proposal state after reset.
- [x] Bind native context and attachments to the designated file. Actual new-kit native checks remain separate after computer control was stopped.
- [x] Exercise the UI in isolated browser sessions, including expired access, two runs and reset (provider fixtures).

## Task 4: Demo kit and hosted acceptance

**Files:** `app/scripts/package-plugin.mjs`, `app/package.json`, lockfile, build/deployment inputs, `JUDGING.md`, synthetic design recreation instructions and verification notes.

- [x] Package built manifest, code and UI with source commit metadata and checksums; serve the generated ZIP from the hosted app.
- [x] Document exact installation, connection, renewal, approval, payment, reset and recovery steps. Keep credentials in private delivery artifacts.
- [x] Run the full suite, review the whole change with a fresh reviewer, and fix confirmed issues.
- [x] Commit a reviewed allowlist in this worktree, build and deploy the exact image after a consistent off-host backup, and verify persistence/restart/isolation on the hosted service.
- [x] Verify actual provider access and the configured Figma comment; package the recoverable synthetic design.
- [ ] Test installation from another Figma account when such an account is available; otherwise report that specific acceptance gap without claiming it passed.

## Execution ledger

- Baseline: 34 tests passed, 0 failed, 0 skipped on October 22 Chicago time. Primary changed files were copied and fingerprinted in the ignored primary `output/gcp/judging-access-baseline.json`; source checkout is preserved.
- Ruling: work in a managed worktree with the uncommitted Baseten/payment baseline copied in, because a clean HEAD alone would discard the already verified runtime changes.
- Ruling: use reusable, separately scoped resume grants for judge client links; keep legacy single-use developer invitations. Reopening an already approved judge client page must remain possible without reapproval or another invoice.
- Task 2 complete: initial six judging tests failed before the module existed; nine backend scenarios then passed, including invoice/AI reset races. Baseline development behavior remained green.
- Task 3 complete in source and isolated fixture UI: two fresh Chromium contexts completed entry, assessment display, explicit approval, Paid display, expiry renewal and scoped reset with no page errors. No live inference or second payment was made by that fixture check.
- Review: one fresh reviewer confirmed a stale entry-tab resume credential after reset in another tab. A new DOM regression failed with old-grant versus replacement-grant; storage/focus/resume synchronization fixed it. Full suite: 49 passed, 0 failed/skipped.
- Ruling: package an editable self-contained SVG plus the original synthetic frame REST snapshot for recovery; preserve the existing comment-bearing parent frame when restoring. Native second-account acceptance remains unverified.
- Consistent off-host pre-release backup verified: SQLite integrity ok, Paid invoice identity retained, SHA-256 `24f6e5c44b0a434b101e202615df9db73440412b9007f983e605efee841e6900`. Private file remains in ignored primary operator storage.
- Real webhook still absent after account lookup, fresh CREATED event, real redelivery, subscription refresh and a simulator network probe. No verification bypass was added; temporary callback/subscription experiments were restored/removed.
- Release: committed source `5a620f461bd7da89fc07377ef17709155b15ef1b`; clean archive Linux build 49/49; deployed image `sha256:488466daad1b504a73498b4c336edb552a4aa0292a085c6be93cdab8610c72c8`. Versioned ZIP and checksum retrieved from the public host and matched the image.
- Hosted acceptance: actual comment, one live assessment, real sandbox invoice, expired session renewal, independent reset/tombstone and preserved original Paid order passed. A diagnostic expectation (200 versus successful assessment 201) stopped the first check; resumed its saved assessment without another inference. Hosted restart then preserved roles, records and exact ledger. Temporary acceptance entry revoked; durable private entry issued through December 16.
- Remaining: real signed callback arrival and second-account native edit/install walkthrough. Native computer control was stopped, so no further computer-use interactions were attempted.
