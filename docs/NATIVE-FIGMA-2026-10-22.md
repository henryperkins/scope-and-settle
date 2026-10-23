# Native Figma verification — October 22, 2026

**Later continuation:** the AI-backed $250 invoice was paid through actual sandbox checkout. Native Figma shows Paid and $0 due on revision 1, including after closing and reopening the plugin. See [the payment and persistence record](PAYMENT-LOOP-2026-10-22.md). The observations below are preserved history.

Verified in Figma Beta desktop with the development plugin and the hosted backend at `https://scope-and-settle.hperkins.com`. The final independent provider/database check completed at 23:34:18 UTC (6:34 p.m. America/Chicago).

The user had connected the plugin successfully. Desktop automation then performed the following actions through the real Figma interface, without invoking AI.

| Check | Observed result |
| --- | --- |
| Synthetic design fixture | Created a 960 × 640 frame named **Desktop checkout — synthetic demo**, node `5:2`, with a checkout heading, order summary, delivery details, and a synthetic-content label. |
| Actual Figma comment | Posted **Can you add the mobile checkout?** on that frame. Figma displayed the posted comment with zero replies. The provider independently returned comment `1978367271`, associated with node `5:2`. |
| Plugin session restoration | Closed and reopened Scope & Settle through Figma's **Plugins → Run last plugin** menu. It loaded the authenticated project without another invitation or connection prompt. The existing change order also appeared. |
| Comment loading and selection | The plugin displayed the exact posted comment. Selecting it visibly highlighted the request and enabled the assessment action. The assessment action was not clicked. |
| Native frame selection | The plugin displayed **1 selected in Figma** with the parent checkout frame selected. |
| Native frame export and preview | Clicking **Attach selected frame** produced **Selected frame attached as supporting design evidence.**, a **Remove frame** control, and a visible preview matching the checkout frame. |
| No AI calls | A read-only query of the hosted database returned **0** rows in `ai_calls` after these actions. The user confirmed credits had not yet been added. |

The existing designer session was created at `2026-10-22T23:18:24.197Z`, remained unrevoked, and expires at `2026-10-23T00:18:24.197Z`. The check establishes restoration during that session's validity, not indefinite access or persistence of an unsubmitted frame attachment.

The plugin was left open with the actual comment selected and the frame attached. The visible existing invoice remained **Payment due**; this run did not create, send, pay, or reset any invoice.

## Evidence and remaining work

The sanitized independent provider/database result is saved locally at `output/gcp/native-figma-provider-check.json` (ignored by Git). Earlier zero-comment and unavailable-native-control records are historical snapshots; this run supersedes those limitations.

Still pending:

- Live AI assessment and the six-case evaluation, after credits are available.
- The complete AI-backed change-order flow using this real comment and frame.
- Actual sandbox buyer payment and authoritative paid status in the plugin.
- Receipt and successful verification of a real PayPal webhook callback.

No application code changed for this check. No AI accuracy, live payment, or webhook-delivery result is implied by the native plugin results above.
