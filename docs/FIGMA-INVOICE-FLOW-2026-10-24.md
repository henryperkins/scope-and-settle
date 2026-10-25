# Paid-team client approval and invoice flow — October 24, 2026

> Historical verification recorded October 24, 2026 in the `codex/paid-figma-connection` worktree, based on `68623c0c728faf657b885a319320a539cd9c83db` with local session-switch changes. Consolidated October 25 from those records; the results apply to that development build and the deployed 0.3.0 runtime.

The owner authorized confirming the assessed $250 mobile-checkout terms, creating the client review link, and testing client approval and PayPal sandbox invoice creation. The native Figma plugin submitted the terms, and a fresh browser tab opened the generated private review link.

| Evidence | Verified value |
| --- | --- |
| Change order | `a292ba1c-5456-455b-bc53-336313c56dcd` — Add mobile checkout |
| Designer run | `judge-154d206a-e5a4-4cd5-84a6-c66b7309f483` |
| Assessment | `f8ae555b-d069-4700-bca8-f74b5ffff789` |
| Figma request | `1980028284`, file `xu9KUICNauIGSzSepzGvBE`, frame `5:2` |
| Approved context | Proposal revision 1, brief `scope-rev-1` |
| Price | `mobile_checkout`, quantity 1 × $250.00 USD |
| Client approval | One approval of this revision, recorded `2026-10-24T09:00:11.761Z` |
| PayPal invoice | `INV2-2JCE-LWQA-NX3U-WJVH` |
| Invoice number/reference | `SS-a292ba1c` |
| Provider status at the check | `UNPAID`, $250.00 USD total and $250.00 due |
| App status at the check | `payment_due`, rendered as Payment due |

## Live verification

1. Before approval, the client page displayed the deliverable, $250 total, revision 1 and payment-before-work term. **Approve change & prepare invoice** was disabled until its consent checkbox was checked. The backend had one frozen proposal snapshot, no approval and no invoice operation for this order.
2. Checking consent enabled approval. Choosing the approval button recorded the client role against this exact revision and created the sandbox invoice. The app then showed **Approval recorded**, **Payment due**, and **Pay $250.00 in PayPal sandbox**.
3. An independent PayPal invoice GET confirmed the invoice ID, USD currency, $250 total, $250 balance, expected reference, configured sandbox merchant and buyer, and preserved provider recipient URL. The app's invoice operation was `sent`. PayPal reported `UNPAID`; see its [invoicing quick start](https://developer.paypal.com/api/invoicing/) for the sandbox publication status.
4. Opening the app's PayPal link rendered the actual recipient invoice page: **Test Store**, invoice **SS-a292ba1c**, **Add mobile checkout**, quantity 1 × $250, payment-before-work terms and **Amount due $250.00**, with payment options available.
5. Client payment refresh and native Figma order refresh both retained **Payment due** and the $250 balance. The existing three Paid orders remained intact. A fresh checksum check confirmed all preexisting business rows across 22 protected tables were unchanged, allowing the normal advancing worker heartbeat. At this checkpoint there were eight change orders, six approvals and 32 AI-call records.

The flow passed through invoice publication and recipient-page rendering. No payment was made. No additional AI assessment or automation policy was created.

The client review emitted two nonblocking console errors: the Content Security Policy blocked the Cloudflare analytics script, and `/favicon.ico` returned 401. Neither prevented the verified approval or invoice flow.

## Private links and evidence

The client review and PayPal recipient links were saved in the original `paid-figma-connection` worktree's ignored, access-restricted `output/figma-connection/private/MOBILE-CHECKOUT-LINKS.md`. Private URLs and access credentials are excluded from this report and Git.

Credential-free evidence was saved on the server at `/srv/scope-and-settle/data/figma-connection-2026-10-24/mobile-invoice-verification.json`. The corresponding operational check was retained as `output/figma-connection/check-mobile-invoice.mjs` in the original `paid-figma-connection` worktree. This test used the existing deployed application; it did not replace the server image or published plugin ZIP.
