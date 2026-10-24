# Linked Figma status cards

The designer plugin has an explicit **Create / refresh Figma status card** button for each change order. It reads stored application status and creates or updates one application-managed card for that file, project, run and order. It never refreshes PayPal, runs an assessment, publishes a proposal or issues an invoice. Use the separate **Check payment** action to request a provider observation, then refresh the card.

The card distinguishes the proposal revision and scope references, client approval, invoice/payment state and delivery. Delivery is **Not recorded** until a delivery workflow exists; Paid does not imply delivered. Unapproved proposals are labeled as unapproved. Financial refunds and cancellation do not erase approved scope.

Every card permanently says **Cached snapshot — refresh in plugin/app**. Payment-observed time comes from the stored provider observation and can be unavailable. App-status-read time and native-card-update time have separate meanings. Closing the plugin stops its work; no background canvas freshness is claimed.

## Monetary display

Amounts default off in each project/run. An authenticated designer can change **Show monetary amounts on this run’s Figma cards** on the browser designer page, with explicit consent and an exact settings version. The plugin, canvas messages, connector credentials and MCP tools cannot enable this setting. Independent judging runs do not inherit each other's opt-in.

When amounts are off, the projection removes monetary fields before crossing the native bridge. Explicit USD/dollar monetary wording in the title and deliverables is masked; the original approved source remains unchanged in the application. The native boundary rejects hidden-policy payloads containing those monetary values. Card names and mapping/plugin data never hold amounts, prices, private access links or credentials. Turning the setting off removes previously rendered amounts on the next successful card update; previously saved/shared copies cannot be retroactively changed.

## Identity, updates and recovery

The card's link is an application-origin `/designer?order=<opaque-id>&run=<opaque-id>` URL. It contains no invitation, renewal, portal, payer or session credential. The viewer needs their own eligible designer session; a wrong-run landing fails before displaying the target order. Visiting the link never confirms an action.

The plugin persists a versioned document mapping. Repeated and concurrent updates reuse the same canonical node, including after reopening. Existing mapped cards can be updated on another page without moving them. Deleted mapped nodes are replaced; a mapping pointing at a foreign or unmarked node produces a repair error. Exact orphan-marker recovery searches only the loaded current page, with a 2,000-node bound. Multiple candidates require repair. At most 100 scoped card mappings are retained. No full-document scan or arbitrary duplicate deletion runs.

New cards are placed beside the selected design bounds and never inserted into or selected in place of the design. Updates preserve card position and unrelated children. Font/node/page awaits are followed by file, page, selection and UI-epoch checks. Old revisions, old display policies and old projection sequences cannot overwrite newer accepted content. Per-order queues and a fresh document-map merge preserve independent orders. Failed creation cleans up only nodes created by that attempt; failed existing-card updates report failure and attempt to restore their prior application-owned text/metadata.

Switching sessions, requests, proposals, files or selection, hiding the page or ending access invalidates pending UI work. Card and evidence-export messages are separate. Existing editor-origin/ancestor checks and export correlation remain in force. Cards do not select nodes or disturb a pending export. Dev Resource and Code Layers writes remain disabled.

## Local interfaces

- `GET /api/change-orders/:id/status-card?revision=<exact-revision>`: designer-only bounded `StatusCardView`, no provider calls or business effects. Unknown arguments, stale revisions and wrong scope are rejected.
- `GET /api/project/card-display`: current scoped policy, default `{showAmounts:false,version:0}` without creating a row.
- `POST /api/project/card-display`: authenticated browser Origin, `{showAmounts,expectedVersion,consent:true}`; optimistic policy update only.
- Additive migration 11 creates `status_card_settings`. Approved terms, invoice operations, existing credentials and budget history are retained.

The installed Plugin API supports [asynchronous font/node work](https://developers.figma.com/docs/plugins/async-tasks/) and [plugin-private node data](https://developers.figma.com/docs/plugins/api/properties/nodes-setplugindata/). These APIs are exercised locally against the real built main bundle with a deterministic API fake. They do not establish native execution or target-file entitlement.

## Native qualification still required

In the authorized target file, create the card, refresh the same order, close/reopen the plugin and refresh again. Record the stable node ID and exact file/run/order/revision. Compare approval, payment, delivery, provider time and cached labels with the authenticated application. Test default-off amounts, browser opt-in and later removal, deletion/replacement, wrong-file denial, failed refresh and an evidence export during a card update. Verify that the safe link needs the viewer's own access.

Native creation, real connector/chat invocation, supported-client instruction installation and target-file write permission remain separate external gates. Local browser and Plugin API fake results are not native Figma proof.
