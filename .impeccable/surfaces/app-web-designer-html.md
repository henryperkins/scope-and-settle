---
version: 1
slug: "app-web-designer-html"
primary_target: "app/web/designer.html"
related_targets: ["app/web/judge.html"]
---

# Designer workspace, Figma plugin and judge entry

Mode: Operate. Primary target `app/web/designer.html` (`designer.js`, `agent.js`), also inlined as the Figma plugin's `ui.html` (`app/plugin/code.ts`). Related: `app/web/judge.html` (`judge.js`), the judges' way in.

## Brief

- **Audience:** the freelance designer (and judges playing that role), at a desk with Figma open; inside a 440 × 720 plugin panel or a full browser tab.
- **Job:** approve rates and limits once, share the client link, handle only exceptions, follow every change to Paid, and occasionally assess a request by hand with a selected frame.
- **Content:** agent view (policy, state, requests, deliveries) and change orders from the existing APIs; the manual assessment, terms and demo tools stay as they are.
- **Constraints:** element IDs and behaviors the scripts and tests rely on stay; order cards keep "Paid", "Revision N · scope-rev-N" and "$0.00 due"; the plugin follows Figma's light or dark theme, browser pages stay light.
- **Judge entry:** a browser-first sequence (start/resume, designer authorization, client request/consent, PayPal payment/persistence) on the same settlement line. Each step labels the role and expected result. Native Figma installation and frame evidence are optional disclosures after the main journey; package provenance sits beneath them. No instruction step is marked complete from a link click.
- **Memorable moment:** the board's settlement line with an amber exception sitting at the station it blocks.
- **Unresolved:** none.

## Direction contract

THESIS: The board is the settlement line. Every request and order sits under the station it has reached, so an exception shows exactly where it blocks the flow. It refuses the settings-first column of stacked disclosures.

OWN-WORLD: Good Terms in operator density. 14 px Hanken Grotesk, white bordered cards on `#f5f7f7`, teal for the designer's move, slate for waiting, amber only for exceptions and re-review, deep teal with a check for Paid. Figma-dark tokens when the plugin runs dark.

STORY: In one look the designer sees what the agent handled, what waits on the client and the one exception that needs them; they act on that card and return to Figma.

FIRST VIEWPORT: Header, then the agent strip: state chip, quoted versus authorized, access end and Pause, with a tool row (Rates, limits and client access · Assess a request · Agreed brief · Demo controls). Below it the settlement line runs across four stations (Request, Quote, Approval, Payment) with counts, and the cards sit in four columns under them. In the 440 px plugin the line runs vertically down the left and the stations stack as groups.

FORM: Stage board, my resonance rank 4 of 7, dealt as the lead and chosen. seed:fcac7e307ae9d637

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
