# Approved installment payments

Local T14 implementation adds exact revision-bound USD schedules. A designer can edit an unapproved proposal's schedule; the amounts must sum to its unchanged total. Saving creates a new draft revision. Client approval includes the full deliverables, original line items, payment triggers, acceptance criteria and work-start prerequisites.

The default remains one upfront invoice. Explicit schedules use a separate invoice record and recoverable operation for every installment. Proposal approval permits only the proposal-approval installments. Delivery-acceptance installments require the exact recorded acceptance (T16). This is installment billing, not escrow or PayPal partial payments.

Payment status is recorded per invoice. A paid deposit can satisfy the approved work prerequisites while the balance remains outstanding. The aggregate separately shows paid, refunded, payable and not-yet-invoiced amounts; uncertain evidence qualifies totals. Cancelled invoices retain raw observations and approved work remains committed. Legacy adoption preserves original invoice IDs, operation keys and consent history; conflicting associations require review.

Designer reminder/cancel/issue previews bind the exact installment, terms, revision and recipients. Confirmation requires the authenticated owner, explicit consent and same-origin browser request. Reminders retain the shared 24-hour cadence and outbound lock. Uncertain notifications are read-only; no blind replay. Invoice publication saves its dispatch and acknowledgement separately. A still-DRAFT invoice after an uncertain send requires provider review.

Existing agent-policy reminders remain limited to legacy single-invoice schedules; separately consented automatic installment policies are described below. Manual installment reminders continue to use the designer review controls. Generic connector invoice preparation refuses custom schedules and directs the designer to exact installment selection. Connector payment reads return bounded installment facts and an aggregate without private links, merchant identity or operation terms.

Qualification is local: synthetic provider tests and desktop/390px browser flows. Real sandbox installment payment, native client/plugin behavior, hosted callbacks and external Release B/C gates remain separate. No provider account, deployment or live AI action was performed for T14.

References: [PayPal Invoicing v2](https://developer.paypal.com/api/invoicing/v2), [Release C execution supplement](superpowers/plans/2026-10-23-release-c-execution.md).

## Optional automatic installment reminders

Reminders remain manual by default. An existing agent policy with `paypalReminders:true` grants no installment-reminder permission. In the designer order card, review the exact issued, fully unpaid invoices, recipients, merchant, expiry and limits, then explicitly allow automatic reminders. Preparation never sends a notification. The policy also supports canonical manually created orders without an agent request.

Only invoices included in that review are covered. Paid and future unissued installments are shown as excluded. New invoice associations or due events require fresh review; the balance is never reminded before delivery acceptance and issuance. Each send rechecks the live parent, current policy/version, exact approved schedule, record, invoice terms and recipients. Automatic reminders require the configured buyer as the sole primary recipient and no existing CCs. Changed configuration, recipients or merchant, payment/refund activity, unknown state, pause, revocation, revision change or reset prevents sending.

The earliest automatic reminder is 24 hours after the later approved due trigger and durable known-send eligibility, and 24 hours after any reminder attempt. The most recent known-send timestamp is a conservative eligibility anchor; invoice-send recovery may move it later. Two automatic dispatch attempts per invoice is the lifetime limit across legacy policy sends, new policies and renewals. Human attempts share the invoice lock and cadence but do not consume the automatic count. Renewing consent does not refill history.

Consent lasts at most 24 hours and never outlives a parent designer grant. As with existing explicit delegation, natural expiry of an ordinary session does not revoke the bounded policy; explicit revocation and reset do. Any active designer with access to that order/run may pause it. Pause and reconfirmation retain immutable version history. A preview is single use and cannot silently extend expiry.

The worker uses its own persisted `installment_reminder` lane. It records dispatch before notifying PayPal and shares durable outbound reservations and provider backoff with manual and legacy sends. A lost response keeps one uncertain operation through restart or policy renewal and cannot be automatically replayed. A known provider refusal retains its backoff. An acknowledgement is saved independently of later caller authority and does not prove recipient delivery. Refresh reminder status to see attempted records, timing and recorded acknowledgement.

Local clocks, providers and browser evidence are synthetic. Real reminder qualification remains separately authorized and needs a fully unpaid invoice eligible for at least 24 actual hours, followed by fresh consent under a parent valid at dispatch. No production cadence is shortened or backdated for that proof.
