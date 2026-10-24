# Scope & Settle continuation verification

Checked October 22, 2026, approximately 19:28 UTC. This records the checks following the implementation handoff; it does not establish an end-to-end Figma or payment demonstration.

## Restart outcome

The running backend is PID 17860 on port 8787, started at 14:17:56 America/Chicago. Its compiled PayPal module was written at 14:18:53, after the process started. Before the attempted restart, both existing invoiced orders still returned a null invoice URL from the running server.

Automatic approval review rejected the command to stop that exact process, preserve the database, and restart the same application in a hidden window. The command was rejected before execution with `blocked by policy`; no more specific reason was supplied. The original process was subsequently confirmed still running. No alternative process-control route was attempted.

The updated compiled adapter was tested separately. This is not proof that the running server has loaded the fix. Restart must be performed locally before verifying that server's payment-status endpoint with the new code.

## Results

| Check | Result | Evidence boundary |
| --- | --- | --- |
| TypeScript validation | Passed, exit 0 | `app/node_modules/.bin/tsc.cmd --noEmit -p app/tsconfig.json` from the project root. |
| Existing sandbox invoice read | UNPAID; USD 370.00 total and due | Fresh compiled PayPal adapter, authenticated provider GET. No invoice creation, send, or payment performed. |
| Payer URL generation | Returned `https://www.sandbox.paypal.com/invoice/payerView/details/INV2-BQF2-B6ET-SFEJ-UBQE` | Fresh compiled adapter only; the hosted page and updated running-server endpoint were not tested in this continuation. |
| Figma comments through the running backend | HTTP 200; zero comments | Successful backend/provider read; actual plugin comment rendering remains unverified. |
| Reset creates a fresh run | Passed | Compiled reset function against an isolated copy of the database. |
| Reset preserves invoice tombstones | Passed for both copied invoice records | No reset or deletion in the original database. |
| Reset preserves other-run records | Passed for an explicit other-run fixture | This does not establish separate simultaneous judge sessions; the current application has a global active-run pointer. |
| Initial stale approval rejection | Passed | A baseline change moved the copied proposal to `needs_re_review` and rejected the old session. |
| Old approval remains invalid after resubmission | **Failed** | Resubmission retained revision 1; the old revision-1 client session successfully approved the proposal against the new baseline. |
| Resume after invoice creation but failed publication | **Failed** | An operation with a stored invoice ID and a change order without that ID returned `creating_invoice` with a null order invoice ID. |

The six isolated behavior checks produced **4 passes and 2 failures**. They ran with provider network calls disabled. The original database was preserved using SQLite's backup API before the isolated copy was modified.

## Confirmed defects

### Old approval survives resubmission

`submitForApproval` updates the scope reference and status without advancing the change-order revision or invalidating the previous invitation. After initial stale rejection, resubmitting against the new baseline lets the old session pass the order/revision check. See [orders.ts](../app/src/backend/orders.ts:69).

Required correction: renewed designer review after a baseline change must produce a newly identified proposal/approval context, and an already-issued client invitation must remain unusable for that context. Add a regression covering baseline change, rejection, resubmission, and reuse of the original invitation.

### Created invoice does not resume publication

`ensureInvoice` returns `refreshPaymentStatus` immediately when the operation contains an invoice ID. If publication failed before that ID was copied onto the change order, `refreshPaymentStatus` returns the order without fetching or publishing anything. See [orders.ts](../app/src/backend/orders.ts:154).

Required correction: resume the known invoice's publication/reconciliation using the operation's ID and restore the order association. Do not create another invoice. Test failure after creation and before successful publication.

### Authorization is incomplete at the HTTP boundary

Source inspection also shows that client approval checks a session, while session issuance, scope writes, proposal writes/submission, and demo reset do not require a designer session. `requireRole` exists but is not used by those routes. The server listens without a loopback-only host argument. See [server.ts](../app/src/backend/server.ts:68) and [sessions.ts](../app/src/backend/sessions.ts:56).

Thus, rejection of a revoked approval token does not establish the adopted requirement that role authorization is enforced on every relevant endpoint. This was a source finding, not an additional mutation test against the running database. It should be addressed before hosting or treating the demo links as an enforced access boundary.

## Preserved local evidence

All files below are under the ignored output directory:

- [Before-test order summary](../output/verification/continuation-2026-10-22T19-26-33-971Z/before-orders.json)
- [Isolated behavior results](../output/verification/continuation-2026-10-22T19-26-33-971Z/isolated-checks.json)
- [Provider read results](../output/verification/continuation-2026-10-22T19-26-33-971Z/provider-read.json)
- [Isolated verification script](../output/verification/continuation-2026-10-22T19-26-33-971Z/verify-isolated.mjs)
- [Provider read script](../output/verification/continuation-2026-10-22T19-26-33-971Z/verify-provider-read.mjs)

A consistent database backup and isolated compiled-code/database copy are retained beside those results. The backup contains local session state and is not a public submission artifact. Repeating the isolated script requires a fresh copy of the saved database; the first run intentionally changes only its isolated copy.

## Remaining verification

1. Correct the two reproduced state/recovery defects and the HTTP authorization gaps.
2. Restart the backend locally, then verify that its payment-status endpoint returns the updated payer URL.
3. Add an actual sample comment to the configured demo Figma file, load the development plugin, and verify the comment appears and is selectable.
4. Complete an actual hosted sandbox buyer payment and verify the plugin reflects authoritative payment status after reopening.
5. Exercise actual webhook delivery/verification separately; invoice tombstone storage alone does not establish webhook handling.

No application source was changed during this continuation. No existing invoice or original change order was reset, canceled, or paid.
