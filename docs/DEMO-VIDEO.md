# Scope & Settle demonstration — October 23, 2026

The reviewed demonstration is **2:49.021** (169.021354 seconds), with actual product captures, English narration and English captions. It is available as a [public MP4 release download](https://github.com/henryperkins/scope-and-settle/releases/download/v0.2.1/Scope-and-Settle-Demo.mp4). The required public YouTube upload is **pending channel access**; a release download does not satisfy that separate requirement.

## Artifact

| Item | Value |
| --- | --- |
| File | `Scope-and-Settle-Demo.mp4` |
| Video | 1920 × 1080, 30 fps, H.264 |
| Audio | AAC, offline synthetic English narration |
| Size | 5,861,460 bytes |
| SHA-256 | `8274beb13201d847bd6e96cfee92bb6b09fd6574792779257786dd07b3924848` |
| Captions | [English SRT](media/demo.en.srt), also a [release asset](https://github.com/henryperkins/scope-and-settle/releases/download/v0.2.1/Scope-and-Settle-Demo.en.srt) |
| Transcript | [Narration text](media/demo-transcript.txt) |
| Product | Exact released plugin 0.2.1, source `99de2812193425b3c49c46b2faed91a4a40d8b57` |

## Actual sequence

| Time | Evidence shown |
| --- | --- |
| 0:00 | Audience and request-to-payment workflow |
| 0:09 | Actual Figma comment and selected desktop checkout frame |
| 0:21 | Supplied agreement explicitly excludes mobile layouts and requires approval |
| 0:35 | Real Baseten/DeepSeek assessment, quoted clauses and design context |
| 0:59 | Separate client page with reviewed deliverable, $250 total and consent control |
| 1:19 | Approved revision with payment still due |
| 1:27 | Actual PayPal sandbox invoice for the same change |
| 1:37 | Actual sandbox buyer completes checkout |
| 1:53 | Authoritative invoice retrieval returns Paid on the client page |
| 2:03 | Released native Figma plugin refreshes the same Paid revision |
| 2:15 | Plugin closes/reopens and restores access and the paid order |
| 2:29 | Hosted judging, public source and bounded prototype scope |

The live assessment used the actual selected frame under the separate Figma test account. It produced a new proposal in the existing isolated judge run; the older paid orders were retained. The recording order is `0d53e64a-2236-4342-bf85-8ff3411c5c7f`, revision 1 / `scope-rev-1`, invoice `INV2-WXFF-4GMD-L86F-PPFX`. Explicit client approval was recorded at `18:50:20.166Z`. PayPal independently reports **PAID / $250 total / $0 due**.

Manual invoice retrieval produced the first visible Paid state at approximately `18:55:22Z`. Automatic event `WH-9W0280606C9968053-3FA58456V4830070N` was reconciled at `18:55:38.239Z`; an independent PayPal event read confirmed `INVOICING.INVOICE.PAID` for this invoice. The video does not attribute the earlier UI transition to that later callback. See [the full verification record](JUDGING-VERIFICATION-2026-10-23.md).

## Editing and review

The edit uses actual captures from that workflow. Navigation and waiting are condensed, as labeled. The client approval transition is condensed between actual before/after views; the final edit does not show the consent click continuously. The real assessment result is shown after inference, without repeating the model call for filming. Actual buyer checkout is moving footage. Authentication is omitted, private account details are covered with opaque redactions, and private URLs/access controls are excluded from the crop. No fixture, simulated callback or injected payment state substitutes for live evidence.

Narration was generated locally with the installed Microsoft Zira Desktop voice. No voice was cloned, no outside music was used and no paid speech API was called. The captions follow that narration. Public claims were checked against the transcript, live observations and saved provider evidence. The export fully decodes, contains both video and audio, and sampled frames cover every scene; layout and sensitive-information checks were performed on the rendered export. Automated decoding and visual checks are not a human listening test.

This is an operator demonstration using synthetic project content and sandbox test funds. It does not establish outside-designer validation, production readiness or measured time savings.

## Prepared YouTube upload copy

**Title:** Scope & Settle — Figma to Paid | PayPal AI Hackathon Demo

**Visibility:** Public, once the intended channel is authenticated.

**Description:**

Scope & Settle helps freelance designers and small studios turn an ambiguous Figma request into an evidence-backed scope decision, an explicitly approved change and a paid PayPal sandbox invoice.

This 2:49 demonstration shows the actual released plugin: a Figma comment and selected frame, a real Baseten/DeepSeek assessment against a desktop-only brief, a designer-reviewed $250 mobile checkout change, separate client approval, real PayPal sandbox checkout, and the same Paid revision returning to Figma after reopening.

Try the hosted judge entry: https://scope-and-settle.hperkins.com/judge
Public MIT source and local setup: https://github.com/henryperkins/scope-and-settle
Testing guide: https://github.com/henryperkins/scope-and-settle/blob/main/JUDGING.md
Project: https://devpost.com/software/scope-settle

0:00 Audience and workflow
0:09 Figma request and design context
0:21 Agreement evidence
0:35 Live AI assessment result
0:59 Separate client review
1:19 Approved, awaiting payment
1:27 PayPal sandbox invoice
1:37 Actual sandbox checkout
1:53 Authoritative Paid status
2:03 Paid in Figma
2:15 Close and reopen
2:29 Judge it yourself

Synthetic project content and sandbox test funds. Navigation, waiting and the client approval transition are condensed and labeled. Authentication is omitted; account details are redacted. The AI recommends scope treatment and quotes agreement evidence; people approve the commercial terms. Signed webhook delivery was verified separately from the first manual payment refresh. “Work begins after payment” is a commercial term and does not restrict Figma editing. English narration is synthetic. Designer walkthroughs are pending; no adoption or time-saving claims are made.
