# Approved installment payments

Local T14 implementation adds exact revision-bound USD schedules. A designer can edit an unapproved proposal's schedule; the amounts must sum to its unchanged total. Saving creates a new draft revision. Client approval includes the full deliverables, original line items, payment triggers, acceptance criteria and work-start prerequisites.

The default remains one upfront invoice. Explicit schedules use a separate invoice record and recoverable operation for every installment. Proposal approval permits only the proposal-approval installments. Delivery-acceptance installments require the exact recorded acceptance (T16). This is installment billing, not escrow or PayPal partial payments.

Payment status is recorded per invoice. A paid deposit can satisfy the approved work prerequisites while the balance remains outstanding. The aggregate separately shows paid, refunded, payable and not-yet-invoiced amounts; uncertain evidence qualifies totals. Cancelled invoices retain raw observations and approved work remains committed. Legacy adoption preserves original invoice IDs, operation keys and consent history; conflicting associations require review.

Designer reminder/cancel/issue previews bind the exact installment, terms, revision and recipients. Confirmation requires the authenticated owner, explicit consent and same-origin browser request. Reminders retain the shared 24-hour cadence and outbound lock. Uncertain notifications are read-only; no blind replay. Invoice publication saves its dispatch and acknowledgement separately. A still-DRAFT invoice after an uncertain send requires provider review.

Automatic policy reminders remain limited to legacy single-invoice schedules. Explicit installment reminders use the designer review controls. Generic connector invoice preparation refuses custom schedules and directs the designer to exact installment selection. Connector payment reads return bounded installment facts and an aggregate without private links, merchant identity or operation terms.

Qualification is local: synthetic provider tests and desktop/390px browser flows. Real sandbox installment payment, native client/plugin behavior, hosted callbacks and external Release B/C gates remain separate. No provider account, deployment or live AI action was performed for T14.

References: [PayPal Invoicing v2](https://developer.paypal.com/api/invoicing/v2), [Release C execution supplement](superpowers/plans/2026-10-23-release-c-execution.md).
