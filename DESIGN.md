---
name: Scope & Settle
description: Client change requests settled on good terms, from comment to PayPal-confirmed payment.
colors:
  settle-teal: "#006b65"
  settle-teal-strong: "#00544f"
  paid-deep-teal: "#0b3f3b"
  teal-mist: "#dff0ec"
  teal-wash: "#eef7f5"
  teal-hairline: "#b4d9d1"
  harbour-ink: "#152d37"
  slate-ink: "#3a565e"
  weathered-slate: "#526871"
  placeholder-slate: "#5d7279"
  control-slate: "#778d92"
  control-slate-deep: "#566e74"
  working-slate: "#7b9096"
  working-mist: "#e9eff0"
  cool-hairline: "#d5e0df"
  soft-hairline: "#e4ebeb"
  tide-ground: "#f5f7f7"
  paper-white: "#ffffff"
  sunken-mist: "#eef3f3"
  ochre-ink: "#6f4c0c"
  ochre: "#a86f0a"
  ochre-tint: "#fbefd2"
  ochre-line: "#e5c787"
  brick-ink: "#8a2f20"
  brick: "#a8392a"
  brick-tint: "#fdeeea"
  brick-line: "#e9b3a8"
typography:
  amount:
    fontFamily: "Hanken Grotesk, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 720
    lineHeight: 1
    letterSpacing: "-0.02em"
    fontFeature: "\"tnum\" 1, \"lnum\" 1"
  display:
    fontFamily: "Hanken Grotesk, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 720
    lineHeight: 1.12
    letterSpacing: "-0.022em"
  headline:
    fontFamily: "Hanken Grotesk, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "1.3125rem"
    fontWeight: 680
    lineHeight: 1.25
    letterSpacing: "-0.012em"
  title:
    fontFamily: "Hanken Grotesk, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "-0.005em"
  body:
    fontFamily: "Hanken Grotesk, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.55
  meta:
    fontFamily: "Hanken Grotesk, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "Hanken Grotesk, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 620
    lineHeight: 1.2
    letterSpacing: "0.01em"
  wordmark:
    fontFamily: "Hanken Grotesk, system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 760
    letterSpacing: "-0.025em"
  code:
    fontFamily: "ui-monospace, Cascadia Mono, Consolas, monospace"
    fontSize: "0.9em"
rounded:
  control: "8px"
  inner: "10px"
  card: "12px"
  pill: "999px"
spacing:
  s1: "4px"
  s2: "8px"
  s3: "12px"
  s4: "16px"
  s5: "20px"
  s6: "24px"
  s8: "32px"
  s10: "40px"
  s12: "48px"
components:
  button-primary:
    backgroundColor: "{colors.settle-teal}"
    textColor: "{colors.paper-white}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "9px 16px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.settle-teal-strong}"
  button-primary-compact:
    padding: "7px 13px"
    height: "36px"
  button-secondary:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.settle-teal}"
    rounded: "{rounded.control}"
    padding: "9px 16px"
    height: "40px"
  button-secondary-hover:
    backgroundColor: "{colors.teal-wash}"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.settle-teal}"
    rounded: "{rounded.control}"
    padding: "9px 10px"
    height: "40px"
  button-quiet-hover:
    backgroundColor: "{colors.teal-wash}"
  button-danger:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.brick}"
    rounded: "{rounded.control}"
    padding: "9px 16px"
    height: "40px"
  button-danger-hover:
    backgroundColor: "{colors.brick-tint}"
  button-disabled:
    backgroundColor: "{colors.sunken-mist}"
    textColor: "{colors.weathered-slate}"
  input:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.harbour-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  input-readonly:
    backgroundColor: "{colors.sunken-mist}"
    textColor: "{colors.slate-ink}"
  status-action:
    backgroundColor: "{colors.teal-mist}"
    textColor: "{colors.settle-teal-strong}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "4px 10px 4px 8px"
  status-working:
    backgroundColor: "{colors.working-mist}"
    textColor: "{colors.slate-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "4px 10px 4px 8px"
  status-attention:
    backgroundColor: "{colors.ochre-tint}"
    textColor: "{colors.ochre-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "4px 10px 4px 8px"
  status-danger:
    backgroundColor: "{colors.brick-tint}"
    textColor: "{colors.brick-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "4px 10px 4px 8px"
  status-quiet:
    backgroundColor: "{colors.sunken-mist}"
    textColor: "{colors.weathered-slate}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "4px 10px 4px 8px"
  status-settled:
    backgroundColor: "{colors.paid-deep-teal}"
    textColor: "{colors.paper-white}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "4px 10px 4px 8px"
  card:
    backgroundColor: "{colors.paper-white}"
    rounded: "{rounded.card}"
    padding: "{spacing.s6}"
  card-compact:
    padding: "{spacing.s4}"
  statement:
    backgroundColor: "{colors.paper-white}"
    rounded: "{rounded.card}"
  decision-panel:
    backgroundColor: "{colors.paper-white}"
    rounded: "{rounded.card}"
    padding: "{spacing.s5}"
  evidence-quote:
    backgroundColor: "{colors.sunken-mist}"
    textColor: "{colors.harbour-ink}"
    rounded: "{rounded.inner}"
    padding: "12px 16px 12px 44px"
  notice:
    backgroundColor: "{colors.teal-wash}"
    textColor: "{colors.harbour-ink}"
    rounded: "{rounded.inner}"
    padding: "12px 16px"
  notice-attention:
    backgroundColor: "{colors.ochre-tint}"
    textColor: "{colors.ochre-ink}"
  notice-error:
    backgroundColor: "{colors.brick-tint}"
    textColor: "{colors.brick-ink}"
  consent:
    backgroundColor: "{colors.teal-wash}"
    rounded: "{rounded.inner}"
    padding: "12px 16px"
  consent-checked:
    backgroundColor: "{colors.teal-mist}"
  job-card:
    backgroundColor: "{colors.paper-white}"
    rounded: "{rounded.inner}"
    padding: "12px 16px"
  job-card-settled:
    backgroundColor: "{colors.sunken-mist}"
---

# Design System: Scope & Settle

## Overview

**Creative North Star: "Good Terms"**

Good Terms is the feeling of two people who already agree on what is being asked, what it costs and what has been paid. The system is calm, flat and exact: a cool, faintly teal-tinted ground, white hairline-bordered surfaces, one deep harbour ink for text and one brand teal that means "this move is yours". Every state the product can be in has a colour with a single meaning, so a client reads where the money stands before reading a word. The client's experience wins when designer and client needs conflict; the client surfaces carry the money moment and the full reading density, the designer surfaces compress the same system into operator density.

The world evolves the 0.3.0 system rather than replacing it. Its anchors stay: the "Scope & Settle" wordmark with its teal ampersand, brand teal and harbour ink, calm flat bordered cards. What it adds is one self-hosted face (Hanken Grotesk), a fixed type scale in two densities, a status language, a single lifted decision panel and the settlement track (Request, Quote, Approval, Payment), which is the signature that runs through every surface. It must never feel like legal-document stiffness, and never too playful. The Figma plugin follows Figma's light or dark theme; browser pages stay light.

**Key Characteristics:**
- Flat, hairline-bordered white surfaces on a cool tinted ground; one lifted panel where a decision is made.
- One face, one fixed rem scale, two densities (reading and operator).
- Colour is status: teal for the viewer's move, slate for someone else working, amber for care, brick for failure, deep teal with a check for Paid.
- The settlement track (Request, Quote, Approval, Payment) is the recurring signature, from a 10 px mini track in a row to the full board.
- Tabular figures on every amount, time and count.
- Quiet motion: short eased state changes, a breathing dot for live work, nothing decorative.

## Colors

A cool, teal-tinted neutral field with one brand teal family and three meaning-only status tones; nothing in the palette is decorative.

### Primary
- **Settle Teal** (settle-teal): the viewer's move. Primary button fills, action status chips, link text, the focus ring, the input caret, the wordmark ampersand, the evidence quote mark and the completed or current stops of the settlement track.
- **Settle Teal Strong** (settle-teal-strong): primary button hover and the text of action chips and "updated" markers, where teal must read as text on a tint.
- **Paid Deep Teal** (paid-deep-teal): settled and Paid only. Fills the settled chip (with a check), colours the settled stage label.
- **Teal Mist** (teal-mist): action chip ground, checked consent ground, the expanded tool button, the one-off "arrived" flash on a statement row.
- **Teal Wash** (teal-wash): the quietest teal. Open and updated statement rows, secondary and quiet button hover, notices, the client's own messages, unchecked consent.
- **Teal Hairline** (teal-hairline): borders on teal-washed surfaces (notice, consent, decision panel, the viewer's messages) and the text-selection colour.

### Status
- **Working Slate** (working-slate) on **Working Mist** (working-mist), text in **Slate Ink**: someone else is working or the item waits on the other party. The dot breathes while work is live and holds still while waiting.
- **Ochre** (ochre), **Ochre Ink** (ochre-ink), **Ochre Tint** (ochre-tint), **Ochre Line** (ochre-line): needs care. Exceptions, re-review, approved-but-unpaid recovery, payment needing review. The sandbox environment chip carries an ochre dot as a standing caution.
- **Brick** (brick), **Brick Ink** (brick-ink), **Brick Tint** (brick-tint), **Brick Line** (brick-line): failed, or a destructive control. Error notices, error toasts, invalid number fields, the danger button.

### Neutral
- **Harbour Ink** (harbour-ink): all body text and headings; the anchor ink carried from 0.3.0.
- **Slate Ink** (slate-ink): secondary reading text such as ledes, summaries, reasons and read-only inputs; also the working-status text.
- **Weathered Slate** (weathered-slate): metadata, labels, captions, footers, column heads.
- **Placeholder Slate** (placeholder-slate): placeholder text only.
- **Control Slate** (control-slate) and **Control Slate Deep** (control-slate-deep): input and secondary-button borders at rest and on hover, empty-track rings, the dashed empty-state border. Both hold at least 3:1 against white.
- **Cool Hairline** (cool-hairline): card, statement and panel borders, dividers, the settlement line between stations.
- **Soft Hairline** (soft-hairline): row separators inside a list or statement.
- **Tide Ground** (tide-ground): the page ground under every surface.
- **Paper White** (paper-white): cards, statements, inputs, secondary buttons, and text on teal.
- **Sunken Mist** (sunken-mist): recessed areas such as evidence quotes, column-head bars, read-only and disabled fields, other people's messages, settled and closed job cards, code.

### Named Rules
**The Viewer's Move Rule.** A solid teal fill, a teal action chip or a teal stage label means the person looking has something to do. On the settlement track, teal marks the stops already reached. Anything waiting on someone else is slate.

**The Meaning-Only Rule.** Ochre means needs care and brick means failed. Neither appears for emphasis, decoration or brand colour; a surface with nothing wrong carries neither (the sandbox chip's caution dot is the standing exception).

**The Paid Is Earned Rule.** Paid Deep Teal with a check appears only when payment is settled. No other state borrows it, and no state is shown as settled before it is.

## Typography

**Display Font:** Hanken Grotesk (self-hosted variable woff2, weights 100 to 900; falls back to system-ui, -apple-system, Segoe UI, Roboto, sans-serif)
**Body Font:** Hanken Grotesk
**Label/Mono Font:** Hanken Grotesk for labels; ui-monospace, Cascadia Mono, Consolas only inside inline code

**Character:** A single warm, open grotesk that is friendly without being casual. The hierarchy comes from finely stepped variable weights (400 to 760) and slight negative tracking on headings rather than from a second family.

### Hierarchy
- **Amount** (720, 2.25rem, line-height 1, tabular lining figures): the total in the decision panel. Money is the largest type on a client page.
- **Display** (720, 1.875rem, 1.12): the page H1, one per page. Shrinks to 86 percent below 560 px.
- **Headline** (680, 1.3125rem, 1.25): section headings such as the board title, agent heading and card headings.
- **Title** (650, 1.0625rem, 1.3): sub-section headings, legends, statement bar titles; also the size of ledes and money summaries, set at 400 with 1.5 leading and a 60 to 62ch measure.
- **Body** (400, 0.9375rem, 1.55): reading text and controls. Statement and job headings use body size at 640.
- **Meta** (400, 0.8125rem, 1.4): metadata, hints, captions, field labels (at 620), station names (at 680).
- **Label** (620, 0.75rem, 0.01em, sentence case): status chips (at 640), column heads, total labels, the environment chip.
- **Wordmark** (760, 1.25rem, -0.025em): "Scope & Settle" with the ampersand in Settle Teal.

Operator density (the designer workspace and the Figma plugin) swaps the scale: body 0.875rem, title 0.9375rem, headline 1.125rem, display 1.5rem, amount 1.75rem, leading 1.5. Label and meta stay the same in both densities.

### Named Rules
**The One Face Rule.** Every word is Hanken Grotesk, loaded from the same origin or inlined; no second display or body family, and no page falls back to the machine's system face by design.

**The Two Densities Rule.** Sizes come only from the seven type tokens; density changes by swapping the token set for the whole surface, never by setting a one-off size.

**The Tabular Money Rule.** Amounts, times, counts and step numbers use tabular lining figures so columns of money line up.

## Layout

A centred single shell with three widths: standard (1120 px) for the client portal and change review, narrow (880 px) for judge entry, wide (1320 px) for the designer workspace. Shell padding is 20 px top, 32 px sides and 48 px bottom, tightening to 16 px sides below 560 px. Spacing follows a 4 px base scale (4, 8, 12, 16, 20, 24, 32, 40, 48 px); stacks use 16 px gaps, tight stacks 8 px, and the header and page head sit 32 px above content.

Every page opens with the same header row: wordmark, a hairline divider and the page's context, and the environment chip pushed to the right. The client statement is a four-column grid (change, stage, amount, action) that compresses below 1080 px and stacks into main, stage-and-amount, and full-width action below 860 px. Two-column splits (terms beside the decision panel, review body beside its aside, the manual assessment grid) collapse to one column below 860 px. The designer board lays four stations side by side on a horizontal settlement line and turns the line vertical below 900 px, which is also the 440 px Figma plugin layout.

**The Line Never Wraps Rule.** The settlement line runs in one direction: across when four readable columns fit, straight down the left edge when they do not. It never wraps into two rows.

## Elevation & Depth

The system is flat. Depth comes from tone (white surfaces on the tinted ground, sunken mist for recessed content) and from 1 px hairline borders. Exactly one shadow exists, the lift, and it marks the surface that holds a decision. The toast uses the same lift because it floats over content at the bottom of the viewport. In Figma's dark theme the lift deepens to pure black at higher opacity.

### Shadow Vocabulary
- **Lift** (`box-shadow: 0 1px 2px rgb(21 45 55 / .06), 0 16px 36px -20px rgb(21 45 55 / .30)`): the decision panel (total, consent, approve or pay) and the floating toast. Nothing else.

### Named Rules
**The One Lift Rule.** On any page, the only raised surface in the flow is the decision panel. Cards, rows, job cards and buttons stay flat at rest and on hover; hover changes tone, never height.

## Shapes

Gently rounded, nested corners: 12 px on outer containers (cards, statements, the decision panel, the tool row), 10 px on surfaces that sit inside them (notices, evidence quotes, consent, messages, job cards, empty states, skeletons), 8 px on controls (buttons, inputs, frame previews) and full pills on status and environment chips. Borders are always 1 px solid hairlines, with three exceptions that carry meaning: the dashed control-slate border of an empty state, the dashed ring of a final (closed without quote) track stop, and the 2 px rings of track stops and station nodes. Round dots (6 to 16 px) recur as the system's mark: chip dots, track stops, station nodes and the "updated since your last visit" marker.

## Components

### Buttons
Confident and plain: sentence-case verbs at 640 weight, one teal fill per decision.
- **Shape:** gently rounded (8 px), 40 px minimum height (36 px in operator density, 32 px inside job cards).
- **Primary:** Settle Teal fill and border, Paper White text, 9 px by 16 px padding. Hover deepens to Settle Teal Strong; press nudges down 1 px. Optional 16 px stroke icon after or before the label.
- **Secondary:** Paper White with Control Slate border and teal text; hover washes to Teal Wash with a teal border.
- **Quiet:** transparent, teal text, 10 px side padding; hover washes to Teal Wash. Used for Refresh, tool toggles and low-stakes exits.
- **Danger:** Paper White with Brick Line border and brick text; hover fills Brick Tint with a brick border. Reserved for destructive resets.
- **Disabled / Busy:** disabled goes sunken mist with muted text and a not-allowed cursor. Busy swaps the label for "Working…" with a 14 px spinning ring and a progress cursor.
- **Focus:** a 2 px Settle Teal outline offset 2 px on every focusable element.

### Status chips
- **Style:** pill, label type at 640, 7 px leading dot, tinted ground with matching ink. Tones: action (teal mist, teal dot), working (slate, breathing dot), waiting (slate, still dot), attention (ochre), danger (brick), quiet (sunken mist with a hollow ring dot, for closed items), settled (Paid Deep Teal fill, white text, a drawn check in place of the dot).
- **Stage label:** the same tones as plain meta-size text, used beside the mini track in statement rows where a chip would be too heavy. Only settled rows promote to the chip.

### Cards / Containers
- **Corner Style:** 12 px.
- **Background:** Paper White on Tide Ground.
- **Shadow Strategy:** flat (see Elevation & Depth).
- **Border:** 1 px Cool Hairline.
- **Internal Padding:** 24 px, or 16 px in operator density and below 560 px.
- **Statement:** a card with no padding of its own and clipped corners: a title bar, a sunken column-head bar, then rows divided by soft hairlines. Open and updated rows wash to Teal Wash; a newly arrived row flashes Teal Mist once.

### Inputs / Fields
- **Style:** full-width, Paper White, 1 px Control Slate border, 8 px radius, 10 px by 12 px padding, teal caret. Labels sit above at meta size and 620 weight; hints below in meta muted.
- **Focus:** border turns teal plus a 2 px teal outline offset 1 px. Hover deepens the border to Control Slate Deep.
- **Error / Disabled:** invalid number fields take a brick border. Read-only and disabled fields recess to Sunken Mist.
- **Consent:** a checkbox row in a Teal Wash panel with a Teal Hairline border; when checked it deepens to Teal Mist with a teal border. It always states the exact revision, total and term.

### Navigation
There is no navigation bar. The header row (wordmark, hairline divider, context label, environment chip) orients every page. The designer's tools sit in a flat bordered row of quiet icon buttons; the expanded tool reads as pressed in Teal Mist with strong teal text, and its panel opens below as one disclosure. Disclosures throughout use a 16 px chevron that rotates 90 degrees when open.

### The Settlement Track (signature)
The four stops of every change: Request, Quote, Approval, Payment. Stops are 14 px rings on a 2 px line. Reached stops fill teal with a white check (dark ink in Figma's dark theme, where the teal lightens) and teal line; the current stop fills teal inside a white inner ring, turning ochre when the step needs care and breathing when work is live; a final stop for a request closed without a quote uses a dashed ring. Unreached stops are hollow Control Slate rings on a Cool Hairline line. Labels are label size, current in ink at 680. The mini track (10 px stops, no labels) sits in each statement row; the same line becomes the designer's board and the judge's numbered setup steps.

### The Decision Panel (signature)
The one lifted surface: Paper White, Teal Hairline border, 12 px radius, 20 px padding (16 px on phones), the lift shadow. It holds the total in amount type with its revision, the consent row and the single primary action, and later the PayPal pay or receipt button and its confirmation notice. It sits beside the terms on wide screens and below them on narrow ones.

### Evidence Quote
A recessed Sunken Mist block, 10 px radius, with a filled teal quote mark at the left and the clause reference beneath in meta muted. It carries agreed-brief text exactly as written; no border stripe.

### Toast Notice
The page's live status, fixed at the bottom centre (up to 560 px wide), built from the notice: Teal Wash with Teal Hairline and a teal info icon, or Brick Tint with Brick Line and an error icon. It slides up 8 px on entry, carries the lift, and has a quiet dismiss button. Confirmations fade after at least 6 seconds; errors stay until dismissed. Inline notices use the same anatomy with an attention variant in ochre.

### Stage-Board Station (designer)
A column headed by a 16 px node, the station name at meta size and 680 weight, and a tabular count. A 2 px Cool Hairline segment links each station to the next. The node fills teal when the station holds the designer's move and ochre when it holds an exception, and the station name turns ochre with it. Job cards stack beneath at 10 px radius: white and hairline-bordered by default, ochre-tinted with an Ochre Line border for exceptions, recessed to Sunken Mist once settled or closed. Each card leads with its status chip, then the request in body type, line items with their price source, a tabular total and compact actions.

### Line Items
Description in body strong, quantity times unit price and the price source beneath in meta: rate-card prices in Settle Teal Strong, designer-set prices in Ochre Ink. Line totals align right in tabular figures. Price provenance appears on every line.

## Do's and Don'ts

### Do:
- **Do** take every colour, size, space, radius and duration from the custom properties in `app/web/style.css`; values in this file mirror them.
- **Do** keep the wordmark as "Scope & Settle" at 760 weight with only the ampersand in Settle Teal.
- **Do** draw the favicon from the wordmark's own ampersand: the Hanken Grotesk glyph at 760, outlined as a path, white on a Settle Teal 32 px tile with 8 px corners, never live text in a system face.
- **Do** give every state one tone from the status set and keep its meaning: teal for the viewer's move, slate for someone else working, ochre for care, brick for failure, Paid Deep Teal with a check for Paid.
- **Do** show progress with the settlement track, at full size where there is room and as the 10 px mini track inside rows.
- **Do** use the operator density (`.compact`) for designer surfaces and the reading density for client surfaces.
- **Do** honour Figma's light and dark theme in the plugin by swapping the token set; keep browser pages light.
- **Do** set amounts, times and counts in tabular lining figures, and show the price source on every line item.
- **Do** use stroke icons from the shared set (24 px grid, 1.75 stroke, round caps), decorative and hidden from assistive technology.
- **Do** respect reduced motion: every animation and transition collapses to 1 ms.

### Don't:
- **Don't** let it stiffen into a legal document: agreement text appears only as short evidence quotes, and terms read as plain sentences beside the decision.
- **Don't** make it too playful: motion stays short and eased (120 to 180 ms state changes, a breathing dot for live work), and no hue is added beyond the teal family and the status tones.
- **Don't** lift anything except the decision panel and the floating toast.
- **Don't** put an uppercase eyebrow or kicker above headings; the 0.3.0 eyebrows were removed.
- **Don't** use thick coloured side stripes on notices, quotes or cards; tone and hairlines carry meaning.
- **Don't** nest bordered cards inside cards; the decision panel inside an open statement row is the one sanctioned exception.
- **Don't** use ochre or brick for emphasis, or Paid Deep Teal for anything not settled.
- **Don't** load another font family or rely on the system face for display text.
