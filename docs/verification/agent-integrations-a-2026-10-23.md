# Release A local candidate verification

Date: 2026-10-23 America/Chicago (work also falls on 2026-10-24 UTC).

This is a local implementation candidate, not a deployed release. Source baseline: `68623c0c728faf657b885a319320a539cd9c83db` (0.3.0). Changes remain uncommitted in an isolated implementation worktree. The original primary checkout and existing implementation worktree are preserved.

## Evidence categories

| Category | Result |
| --- | --- |
| Existing baseline | Node 24.15.0, 79 tests passed, 0 failed, 0 skipped; fresh run before implementation |
| New candidate automated checks | Full `npm test`: 217 passed, 0 failed/cancelled/skipped, including build; final representability/provider/jobs focused checks: 117 passed |
| Candidate browser checks | Real isolated Edge browser with synthetic providers: designer, exact client review and portal; six outcomes, session renewal, later partial refund and 440px layout |
| Existing actual provider evidence | Prior signed PayPal callbacks, buyer payments, Figma read/write, independent runs and native reopen are documented in the 0.2.1/0.3.0 records linked below |
| Candidate hosted callback/job proof | Not performed; requires deployment of this candidate and actual signed event processing |
| Candidate native Figma installation | Not performed; previous exact-ZIP acceptance remains historical |
| Production/customer access | Not established; synthetic project and sandbox only |

No PayPal/Figma/Baseten resource request, paid inference, new allowance, real database migration, hosted mutation or publication is part of this local batch. Isolated fixtures use fake credentials and temporary databases. A read-only Devpost date check is recorded below.

## Judging window

The authenticated Devpost dates tool for [PayPal AI Hackathon](https://paypalaihackathon.devpost.com) returned complete data at `2026-10-24T03:41:28Z`: judging closes `2026-12-15T16:00:00Z` (December 15, 10 a.m. America/Chicago). The existing default entry expiry `2026-12-16T16:00:00Z` covers that window with a 24-hour buffer. No entry credential was created or renewed and no expiry setting changed. Provider/runtime availability remains a separate operational requirement.

## Local implementation checks

| Increment | Observed result |
| --- | --- |
| T01 capability registry | Nine expected assertion failures before implementation; nine focused passes afterward; full `npm test` 88 passed, 0 failed, 0 skipped. Independent review approved spec compliance and quality. |
| T02 scoped services/migrations | 17 expected missing-interface/schema assertions plus two HTTP revocation regressions failed before implementation. Required focused files passed 35 tests; full `npm test` passed 107, 0 failed/skipped. Independent review approved spec compliance and quality with no material findings. |
| T02 recovery rehearsal | Existing backup script backed up a disposable seeded 0.3.0 fixture. Candidate migrated the working copy; the frozen prior application successfully opened its restored matching pre-migration backup. One test passed; no real database was opened. |
| T03 financial state and itemization | Initial full suite passed 173 tests. Independent review found a portal projection omission; an actual-response renderer regression failed before the fix. Fix-focused checks passed 73; full `npm test` passed 174, 0 failed/skipped. Scoped re-review approved the fix. |
| T04 durable reconciliation | Initial full suite passed 201 tests. Independent review reproduced a mid-body transport failure becoming permanently failed work. Seven real streamed-body regressions failed before the fix and passed afterward; focused checks 97 passed and full `npm test` 208 passed, 0 failed/skipped. Scoped re-review approved the fix. |
| Combined migration recovery | The candidate applied migrations 1–3 to a disposable seeded prior-app database while preserving original rows/indexes and explicit legacy representation. The existing backup script's matching pre-migration backup reopened successfully in the frozen prior application: 1 passed, 0 failed/skipped. |
| Whole-increment review | One Important early-validation gap was reproduced: an oversized item could be approved before invoice serialization rejected it. Shared validation now runs before draft/edit/submit/new approval and before a new operation changes status. RED: seven expected failures; GREEN: nine tests, focused 117, full 217. Final scoped review approved the fix with no new material findings. No migration or UI changed in that fix. |

Migration regression tests use a committed synthetic SQL fixture and need no private backup or Git history. Local prior-binary recovery artifacts stay ignored. Original source/worktree dependencies remain preserved. A local source manifest and checkpoint identify this uncommitted increment separately from later B–D implementation.

The final A Edge browser fixture used the real HTTP/portal projection and displayed due, partial, Paid, cancelled, refunded and unknown states in designer and portal views with approval retained. Cancelled/refunded/unknown states offered no payment link. At 440px document width was also 440px in both interfaces. The exact cancelled client revision remained readable and renewed after explicitly forced session expiry. A later provider-fixture partial refund changed both designer and portal from Paid to Partially refunded, preserving revision/approval and removing payment actions. Screenshots under ignored `output/playwright/final-a-*` contain only the synthetic record areas. These are synthetic provider results, not physical Figma or real payment proof. Missing favicon requests and deliberate expired-session requests returned 401; no application JavaScript exception was observed. The fixture and its isolated browser were closed after verification.

## Reconciliation operations

The server starts the durable job scheduler independently of approved AI policies. Test fixtures set `JOB_WORKER_DISABLED=true`; normal scheduling runs immediately at startup and then every five seconds. At most five sequential jobs are claimed per cycle with 90-second token leases. No network call runs inside a SQLite transaction. Shutdown stops new claims and drains current work before database close.

Retries are limited to eight claimed attempts per recovery generation and a 24-hour retry window. Exponential backoff starts at five seconds; valid provider Retry-After guidance is never shortened. Another event or poll cannot bypass a stored failure/backoff. Unresolved invoices poll every five minutes within a 30-day association window; recent Paid invoices use a fixed first-Paid window so later reversals can be observed. Financial review, cancellation and full refund stop periodic polling. Verified events remain accepted independently.

Authenticated designers can inspect safe per-run metadata at `GET /api/reconciliation` and retry a corrected failed job at `POST /api/reconciliation/:jobId/retry`. Other-run/client access is rejected or scoped; payloads, credentials and invoice IDs are excluded from diagnostics. Global/unmatched operator recovery uses the internal jobs service with the server stopped under the one-process-per-database contract. Recovery cannot revive reset tombstones or alter approval/invoice identity. Actual child-process fixtures verify restart after receipt acceptance and after claim, stale lease fencing, shutdown draining and scoped recovery.

Review minor deferred: designer cards retain the provider's reported due amount beside a cancelled/closed outcome; the caption could distinguish reported balance more clearly. Payment actions are suppressed correctly. The exact client review page displays cancellation and retained approval without a payment action.

The accepted local A source and compiled checkpoint is preserved separately from continuing B–D work. The final full suite is 217/217; the browser checks and matching-backup rehearsal above preceded only the final early input-validation hardening, whose positive/legacy compatibility is covered by its new integration tests. These local results do not turn the candidate hosted/native gates into passes.

## Inherited evidence

- [0.3.0 automatic quoting qualification](../CLIENT-AGENT-VERIFICATION-2026-10-23.md): approved policy, actual Figma comments/read-write and sandbox invoicing; synthetic limits and budget accounting.
- [Judging verification](../JUDGING-VERIFICATION-2026-10-23.md): independent runs, renewal, reset, real payments and exact prior ZIP/native acceptance.
- [Signed callback verification](../PAYPAL-WEBHOOK-DIAGNOSTIC-2026-10-23.md): actual callback receipt, successful signature verification, authoritative invoice read and restart persistence.

These are dated observations of earlier source. They establish previously observed access, not the behavior of changed migrations, financial projections or jobs in this candidate.

## Remaining release gate

After reviewed source is published and deployment is separately authorized: restore a matching backup on disposable storage, migrate the candidate, verify source/artifact identity, exercise a real signed callback through durable job processing and restart, then repeat the independent browser/native journey. Recheck final judging dates and access before setting delivery lifetimes. Do not call the local candidate Release A deployed or production-ready.
