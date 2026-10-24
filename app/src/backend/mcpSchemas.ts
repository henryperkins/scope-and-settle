import * as z from 'zod';
import type {StandardSchemaWithJSON} from '@modelcontextprotocol/server';
import type {ConnectorOperation} from './connectorStore.js';

// ---- Versioned strict schemas. Unknown fields are refused at every level, never stripped. ----
const SCHEMA_VERSION=z.literal(1);
const text=(max:number)=>z.string().min(1).max(max).regex(/\S/);
const id=text(200);
const hex64=z.string().regex(/^[0-9a-f]{64}$/);
const revision=z.int().min(1);
const ReviewReference=z.strictObject({assessmentId:id,sourceId:id,sourceVersion:revision,contextFingerprint:hex64,termsFingerprint:hex64});
const SourceReference=z.strictObject({id,version:revision,contentHash:hex64});
const bounded=(max:number)=>z.string().max(max);
const amount=z.int().min(0);
const LineItem=z.strictObject({description:bounded(4000),quantity:z.int().min(1).max(100),unitAmountMinor:amount,priceSource:z.enum(['rate_card','designer']),rateCardId:bounded(200).nullable()});
const Evidence=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('scope_clause'),clauseId:bounded(200),quote:bounded(4000)}),
 z.strictObject({kind:z.literal('approved_change'),orderId:bounded(200),revision,quote:bounded(4000)}),
]);

export const INPUTS={
 get_project_scope:z.strictObject({schemaVersion:SCHEMA_VERSION}),
 assess_change_request:z.strictObject({schemaVersion:SCHEMA_VERSION,commentId:text(4000),expectedSource:SourceReference.optional(),expectedContextFingerprint:hex64.optional(),evidenceSnapshotId:id.optional()}),
 draft_change_order:z.strictObject({schemaVersion:SCHEMA_VERSION,operationId:text(120),assessmentId:id,items:z.array(z.strictObject({itemId:id,expected:ReviewReference})).min(1).max(20)}),
 get_payment_status:z.strictObject({schemaVersion:SCHEMA_VERSION,orderId:id,expectedRevision:revision,refresh:z.boolean().optional()}),
 submit_for_client_approval:z.strictObject({schemaVersion:SCHEMA_VERSION,orderId:id,expectedRevision:revision}),
 issue_approved_invoice:z.strictObject({schemaVersion:SCHEMA_VERSION,orderId:id,expectedRevision:revision}),
} satisfies Record<ConnectorOperation,z.ZodType>;

export const OUTPUTS={
 get_project_scope:z.strictObject({schemaVersion:SCHEMA_VERSION,projectId:bounded(200),contextVersion:z.int().min(0),contextFingerprint:hex64,
  scope:z.strictObject({snapshotId:bounded(200),version:z.int().min(0),contentHash:hex64,provenanceKind:bounded(100),capturedAt:bounded(100),clauses:z.array(z.strictObject({id:bounded(100),text:bounded(4000)})).max(50)}),
  rates:z.strictObject({snapshotId:bounded(200),version:z.int().min(0),currency:bounded(8),entries:z.array(z.strictObject({id:bounded(200),description:bounded(4000),unitAmountMinor:amount})).max(100)}),
  acknowledgement:z.enum(['acknowledged','supplied_unacknowledged']),
  commitments:z.array(z.strictObject({orderId:bounded(200),revision,approvedAt:bounded(100),title:bounded(200).nullable(),deliverables:z.array(bounded(4000)).max(20),lineItems:z.array(LineItem).max(20),totalMinor:amount.nullable(),currency:bounded(8).nullable()})).max(100)}),
 assess_change_request:z.strictObject({schemaVersion:SCHEMA_VERSION,assessmentId:bounded(200),source:z.strictObject({id:bounded(200),version:revision,contentHash:hex64}),contextFingerprint:hex64,classification:bounded(64),explanation:bounded(4000),
  items:z.array(z.strictObject({itemId:bounded(200),requestedDeliverable:bounded(4000),requestQuote:bounded(4000),classification:z.enum(['included','new_work','needs_clarification']),evidence:z.array(Evidence).max(20),
   questions:z.array(bounded(4000)).max(20),lineItems:z.array(LineItem).max(20),proposedTotalMinor:amount,review:ReviewReference,reservationState:bounded(64).nullable(),duplicateDecision:bounded(64).nullable(),
   existingCommitment:z.strictObject({orderId:bounded(200),revision}).nullable(),draftEligible:z.boolean()})).max(20),
  designEvidence:z.strictObject({snapshotId:bounded(200),verification:bounded(64),freshness:bounded(64)}).nullable()}),
 draft_change_order:z.strictObject({schemaVersion:SCHEMA_VERSION,orderId:bounded(200),revision,status:bounded(64),approvalState:bounded(64),operationId:bounded(120),assessmentId:bounded(200),itemIds:z.array(bounded(200)).max(20),
  title:bounded(200),deliverables:z.array(bounded(4000)).max(20),lineItems:z.array(LineItem).max(20),totalMinor:amount,currency:bounded(8),
  scope:z.strictObject({scopeVersion:z.int().nullable(),rateVersion:z.int().nullable()}).nullable(),landingPath:z.literal('/designer')}),
 get_payment_status:z.strictObject({schemaVersion:SCHEMA_VERSION,orderId:bounded(200),revision,approvalState:bounded(64),invoiceState:bounded(64),paymentState:bounded(64),currency:bounded(8),totalMinor:amount,
  amountDueMinor:amount.nullable(),paidMinor:amount.nullable(),refundedMinor:amount.nullable(),observedAt:bounded(100).nullable(),cached:z.boolean(),source:z.enum(['stored_observation','provider_retrieval','none']),hasInvoice:z.boolean(),summary:z.strictObject({approvedTotalMinor:amount,invoicedMinor:amount,payableDueMinor:amount.nullable(),futureUnbilledMinor:amount,grossPaidMinor:amount.nullable(),refundedMinor:amount.nullable(),netPaidMinor:z.int().nullable(),unknownRecordIds:z.array(bounded(200)).max(12),allObligationsPaid:z.boolean(),workStartSatisfied:z.boolean()}).optional(),installments:z.array(z.strictObject({id:bounded(200),invoiceRecordId:bounded(200),title:bounded(200),amountMinor:amount,dueTrigger:z.enum(['proposal_approval','delivery_acceptance']),invoiceState:bounded(64),paymentState:bounded(64),observedAt:bounded(100).nullable()})).max(12).optional()}),
 submit_for_client_approval:z.strictObject({schemaVersion:SCHEMA_VERSION,actionId:bounded(200),kind:z.literal('submit_for_client_approval'),orderId:bounded(200),revision,previewHash:hex64,reviewUrl:bounded(500),expiresAt:bounded(100),state:z.literal('prepared')}),
 issue_approved_invoice:z.strictObject({schemaVersion:SCHEMA_VERSION,actionId:bounded(200),kind:z.literal('issue_approved_invoice'),orderId:bounded(200),revision,previewHash:hex64,reviewUrl:bounded(500),expiresAt:bounded(100),state:z.literal('prepared')}),
} satisfies Record<ConnectorOperation,z.ZodType>;
export type Output<O extends ConnectorOperation>=z.infer<typeof OUTPUTS[O]>;

/**
 * Advertises the strict JSON Schema in discovery while the tool layer validates with the same Zod schema.
 * The SDK's own validation would answer with issue text; this keeps every refusal a sanitized code.
 */
export function advertised(schema:z.ZodType):StandardSchemaWithJSON{
 const standard=schema['~standard'] as unknown as {jsonSchema:{input:(options:unknown)=>Record<string,unknown>}};
 return {'~standard':{version:1,vendor:'scope-and-settle',validate:(value:unknown)=>({value}),
  jsonSchema:{input:(options:unknown)=>standard.jsonSchema.input(options),output:(options:unknown)=>standard.jsonSchema.input(options)}}} as unknown as StandardSchemaWithJSON;
}

