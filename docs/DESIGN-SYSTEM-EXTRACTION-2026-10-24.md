# Design system extraction — October 24, 2026

This records the visual system as shipped in 0.3.0, before it was evolved. It is extracted from `app/web/style.css` (4,487 bytes, the only stylesheet), the four pages and their scripts. The designer page is also inlined into the Figma plugin's `ui.html` at build. "Before" captures of every page, rendered from an isolated fixture with synthetic data, are in `.impeccable/review/before/`.

## What the system is

A calm, flat utility style: one teal accent on cool, faintly teal-tinted neutrals, white bordered cards on a pale ground, no shadows, no motion. One column of at most 840 px holds every page. It reads as careful and quiet, and its copy does most of the work.

## Tokens that exist

Only four custom properties are declared (`--ink`, `--muted`, `--brand`, `--line`). Every other value is hard-coded.

| Role | Value | Where |
| --- | --- | --- |
| Ink (text) | `#152d37` | body text, headings, client messages |
| Muted text | `#526871` | secondary copy, labels, footer |
| Brand teal | `#006b65` | primary buttons, links, eyebrows, wordmark ampersand |
| Line | `#d5e0df` | card borders, dividers |
| Page ground | `#f5f7f7` | body background |
| Surface | `#fff` | cards, inputs, secondary buttons |
| Control border | `#a9bfbd` | inputs, dashed empty state |
| Focus ring | `#57c8b0` | 3 px outline, 3 px offset |
| Teal tints | `#e9f4f0`, `#eaf4f0`, `#f0f8f5`, `#eef6f3`, `#f7fbfa`, `#f3f5f5` | badge, notice, selected comment and consent, message, quote, client message |
| Teal ink | `#165f51` | badge text |
| Quote rule | `#afd6cc`, text `#3a565e` | evidence blockquote |
| Amber | `#fff1cf` / `#765215`, rule `#b37c13` | warning badge, exception card |
| Brick | `#fff0ec` / `#873022`, `#ae3b2c`, `#bc7f74` | error notice, danger button |

That is 24 distinct colours, with six near-identical teal tints doing overlapping jobs.

**Type.** `Inter, ui-sans-serif, system-ui, -apple-system, sans-serif`, but Inter is never loaded, so pages render in each machine's system face (Segoe UI on Windows, San Francisco on macOS, whatever sans a Linux judge has). Ten sizes: 11, 12, 13, 14 (body), 17 (h2), 19, 21 (wordmark), 22, 26 (h1) and 28 px (total). Weights 400, 650, 700 and 750. Body line height 1.5; h1 1.15 with −0.6 px tracking.

**Shape.** Seven radii: 4, 5, 6, 7, 8, 10 and 12 px.

**Spacing.** No scale. Paddings and margins use 3, 5, 6, 7, 8, 9, 10, 12, 13, 14, 16, 18, 20, 24, 32 and 48 px. One breakpoint at 520 px tightens padding, collapses two-column grids and shrinks h1 to 22 px.

## Components that exist

- **Wordmark:** "Scope & Settle" at 21 px / 750 with the ampersand in brand teal. It changes face from machine to machine.
- **Environment badge:** uppercase "SANDBOX DEMO", "PAYPAL SANDBOX" or "CLIENT REVIEW · SANDBOX" in the header.
- **Eyebrow:** 11 px uppercase teal label above every h1 and above the agent panel heading.
- **Section / card:** white, 1 px line border, 12 px radius, 18 px padding (cards 14 px).
- **Buttons:** filled teal primary and white secondary with a teal border and text; a `danger` modifier recolours secondary. Disabled is 50 % opacity with a `wait` cursor. No hover or active treatment.
- **Fields:** full-width inputs, textareas and selects with a 1 px control border and 6 px radius; 12 px bold labels.
- **Badge:** 11 px bold pill-ish chip (5 px radius), teal tint or amber `warn`.
- **Notice:** tinted panel with a 3 px teal left border; an `error` variant; hidden when empty. Also used as the live status region.
- **Evidence blockquote:** 3 px pale-teal left rule with the clause ID beneath.
- **Line item and total:** description, quantity × unit price, price source; total at 28 px / 750.
- **Comment picker:** full-width buttons; selected gets a 2 px teal border.
- **Conversation:** stacked message bubbles, tinted differently for the client.
- **Quote box:** tinted, bordered, 10 px radius, inside a request card.
- **Exception card:** 4 px amber left border.
- **Consent box, check rows, fieldsets, details/summary disclosures, dashed empty state, frame preview, footer.**

## Findings carried into the evolution

1. **Accessibility.** Text contrast is good everywhere (muted text 5.9:1 on white, primary button 6.4:1). Non-text contrast fails: the focus ring is 2.0:1 against white and 1.9:1 against the page, and input borders are 1.9:1. Both need at least 3:1.
2. **Banned or default patterns.** Every page puts an uppercase eyebrow above its heading. Notices, evidence quotes and exception cards use thick coloured left borders. Order and quote cards sit inside section cards, so cards are nested.
3. **No state language.** Buttons have no hover, pressed or loading states beyond a "Working…" label swap. Request and order states share one badge style apart from a single amber variant, so "Quote ready", "Paid" and "Your designer is reviewing this" look alike.
4. **Duplication on the client portal.** Each request repeats its own text as the heading and again as the first message. Quotes are summarised in a message and then shown again in the quote box.
5. **Identity drift.** The wordmark and every heading change face per operating system because the named font is never loaded.
6. **Browser surfaces left at defaults.** There is no favicon (every page load logs a 401 for `/favicon.ico`), and text selection, caret, scrollbar and number figures are unstyled. Inline `style` attributes appear in `designer.html`, `judge.html` and `review.js`.
7. **Plugin context.** The same layout serves 440 px inside Figma and full browser width. It holds at 440 px, but it never adapts to Figma's dark theme.

## Kept as anchors

Confirmed on October 24, 2026 as the parts the evolved system keeps: the "Scope & Settle" wordmark with its teal ampersand, the brand teal `#006b65` and its deep ink `#152d37`, and calm, flat, bordered cards. The evolved system is documented in `DESIGN.md` once built.
