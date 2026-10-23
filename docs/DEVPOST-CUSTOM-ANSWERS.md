# Devpost technical answers and remaining entrant inputs

Prepared against the live PayPal AI Hackathon form on October 23, 2026. These are reviewable draft answers, not a submission confirmation. No credentials or personal attestations are included.

## 28784 — PayPal and AI technology requirement

Scope & Settle meaningfully integrates PayPal sandbox Invoicing and Baseten's DeepSeek model. An actual Figma comment, supplied agreement clauses and optional selected-frame image are sent to `deepseek-ai/DeepSeek-V4.1-Flash-1017-Fast` through Baseten Model APIs with maximum reasoning and structured output. AI classifies included work, new work or clarification, quoting agreement evidence. The server validates clause quotations and rate identifiers and calculates integer money amounts. A designer reviews terms; a client explicitly approves the exact proposal revision.

Only then does the backend create/publish a PayPal sandbox invoice. Retry/recovery reconciles and reuses the same invoice. Clients complete actual sandbox checkout. A Cloudflare Worker forwards original webhook bodies/signature headers; the backend uses PayPal's signature verification and authoritative invoice retrieval before showing Paid. It validates invoice identity, merchant, currency, total, status and amount due against the approved terms. Three actual $250 payments and real signed PAID receipts are documented, including automatic delivery for an independent judge run and the final native demonstration. Manual refresh is separately identified. AI cannot grant approval or mark an invoice paid.

## 28786 — Additional sponsor tools

**None, used other AI tools.** Baseten supplies the runtime AI model and Google Cloud hosts the application. They are not options in the official sponsor-category list. The implemented runtime does not establish use of AG Grid, APIMatic, Astropods, Bryntum, Channel3, Elastic, KERNEL, Postman, Render or Zapier. Historical Render setup notes do not establish actual Render usage.

## 28788 — Public repository

https://github.com/henryperkins/scope-and-settle

## 28787 — Working demo/test build

https://scope-and-settle.hperkins.com/judge

## 28798 — Testing instructions (public-safe draft)

Use https://scope-and-settle.hperkins.com/judge and the separately supplied judging code. Start a new demo; save the private designer access. Download/extract plugin 0.2.1 and import its manifest in Figma desktop via Plugins → Development → Import plugin from manifest. Open the designated Figma file linked on entry using your own Figma account; select Desktop checkout — synthetic demo. Paste designer access into the plugin and Connect. Select “Can you add the mobile checkout?”, Attach selected frame, and Assess against the brief. Review the quoted desktop-only agreement, deliverables and $250 rate-card price. Confirm terms and open the separate client review. Check consent and Approve change & prepare invoice. Pay the $250 invoice using the dedicated personal PayPal sandbox buyer. Refresh payment, verify Paid / $0 due, then close/reopen the plugin. Demo controls → Reset my demo replaces only your run. Renewal works through the same saved access. Full steps/recovery: https://github.com/henryperkins/scope-and-settle/blob/main/JUDGING.md. The browser workspace also exercises assessment, approval and payment; frame export requires Figma. Hosted testing requires no provider API secrets.

**Private delivery gate:** the connector field metadata does not expose a visibility flag. The event rules require credentials for private testing, but do not by themselves establish this field's privacy. Confirm the event-specific submission UI or obtain an organizer answer before adding the judging code and sandbox-buyer password. Do not put them in this file, the public description, repository or video. General guidance: https://help.devpost.com/article/190-testing-guide. No organizer message has been sent.

## 29053 — AI tools used during development

OpenAI Codex assisted with implementation, regression tests, debugging, release checks and documentation. Baseten Model APIs provided live runtime inference using DeepSeek-V4.1-Flash-1017-Fast at maximum reasoning. The bounded AI evaluation used six synthetic cases and three fresh paraphrases, retained earlier failures, and kept actual provider evidence separate from automated fixtures. Runtime inference, human design decisions and automated development assistance are distinguished in the project description.

ElevenLabs was used by the entrant to replace the demonstration narration; the supplied MP3 was synchronized with the unchanged product footage. This is presentation work, separate from the application's runtime AI. Voice/model details and entrant-side generation cost were not supplied. The [audio revision record](DEMO-VIDEO.md#narration-revision--october-23-2026) distinguishes the prepared release asset from its pending YouTube publication.

## Entrant answers deferred by the user

| Field ID | Required human answer |
| --- | --- |
| 28778 | Individual, Team or Organization; actual team attribution if applicable |
| 28779 | Country of residence |
| 28780 | Canadian province for any Canadian team member, otherwise N/A |
| 28781 | Organization represented, otherwise N/A |
| 28782 / 28783 | New or Existing before October 1, 2026 at 9:15 a.m. Pacific; prior work and hackathon changes if Existing |
| 28790 / 28791 | Personal PayPal experience rating 1–10 and explanation |
| 28792 | Permission to contact for feedback: Yes or No |
| 29054 | Learning level: None, Moderate or Significant |
| 29055 | Career AI value: Yes or No |
| 28794 | Age-of-majority attestation for entrant and all teammates |
| 28795 | Eligible-jurisdiction attestation for entrant and all teammates |
| 28796 | Promotion-entity employee/representative/agent eligibility attestation |

Optional APIMatic and AG Grid experience questions should remain unanswered unless actual use is established. Confirm the full official rules and entrant eligibility before the final submit action. Do not infer personal answers from a profile, location setting, code history or tool usage.
