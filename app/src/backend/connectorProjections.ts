import type {AssessmentItem,ChangeOrderView,FinancialState,ItemReviewReference,LineItem,ScopeContext,InstallmentSummary} from '../shared/types.js';

/**
 * Operation-specific narrow projections for the four connector entrances. Whitelisted fields only:
 * no invoice or payer bearer URLs, client-access links, actor/grant identities, raw provider payloads,
 * raw images, prompts or provider internals. T11c's versioned DTOs serialize these.
 */
export interface ProjectedLineItem {description:string;quantity:number;unitAmountMinor:number;priceSource:'rate_card'|'designer';rateCardId:string|null}
export interface ProjectScopeProjection {
 projectId:string;contextVersion:number;contextFingerprint:string;
 scope:{snapshotId:string;version:number;contentHash:string;provenanceKind:string;capturedAt:string;clauses:{id:string;text:string}[]};
 rates:{snapshotId:string;version:number;currency:string;entries:{id:string;description:string;unitAmountMinor:number}[]};
 acknowledgement:'acknowledged'|'supplied_unacknowledged';
 commitments:{orderId:string;revision:number;approvedAt:string;title:string|null;deliverables:string[];lineItems:ProjectedLineItem[];totalMinor:number|null;currency:string|null}[];
}
export type ProjectedEvidence={kind:'scope_clause';clauseId:string;quote:string}|{kind:'approved_change';orderId:string;revision:number;quote:string};
export interface AssessmentItemProjection {
 itemId:string;requestedDeliverable:string;requestQuote:string;classification:string;evidence:ProjectedEvidence[];questions:string[];
 lineItems:ProjectedLineItem[];proposedTotalMinor:number;review:ItemReviewReference;reservationState:string|null;duplicateDecision:string|null;
 existingCommitment:{orderId:string;revision:number}|null;draftEligible:boolean;
}
export interface AssessmentProjection {
 assessmentId:string;source:{id:string;version:number;contentHash:string};contextFingerprint:string;classification:string;explanation:string;
 items:AssessmentItemProjection[];designEvidence:{snapshotId:string;verification:string;freshness:string}|null;
}
export interface DraftProjection {
 orderId:string;revision:number;status:string;approvalState:string;operationId:string;assessmentId:string;itemIds:string[];
 title:string;deliverables:string[];lineItems:ProjectedLineItem[];totalMinor:number;currency:string;
 scope:{scopeVersion:number|null;rateVersion:number|null}|null;landingPath:'/designer';
}
export interface PaymentStatusProjection {
 summary?:InstallmentSummary;
 installments?:{id:string;invoiceRecordId:string;title:string;amountMinor:number;dueTrigger:string;invoiceState:string;paymentState:string;observedAt:string|null}[];
 orderId:string;revision:number;approvalState:string;invoiceState:FinancialState['invoiceState']|'none';paymentState:FinancialState['paymentState']|'not_invoiced';
 currency:string;totalMinor:number;amountDueMinor:number|null;paidMinor:number|null;refundedMinor:number|null;observedAt:string|null;
 cached:boolean;source:'stored_observation'|'provider_retrieval'|'none';hasInvoice:boolean;
}
export interface ActionPreparationProjection {
 actionId:string;kind:'submit_for_client_approval'|'issue_approved_invoice';orderId:string;revision:number;
 previewHash:string;reviewUrl:string;expiresAt:string;state:'prepared';
}

const lineItem=(line:LineItem):ProjectedLineItem=>({description:line.description,quantity:line.quantity,unitAmountMinor:line.unitAmountMinor,priceSource:line.priceSource==='designer'?'designer':'rate_card',rateCardId:line.rateCardId??null});
const strings=(value:unknown)=>Array.isArray(value)?value.filter((x):x is string=>typeof x==='string'):[];
// Abandoned proposals persist status 'cancelled' outside the declared status union.
const approvalState=(order:ChangeOrderView)=>(order.status as string)==='cancelled'?'cancelled':order.approvalStatus;
const review=(r:ItemReviewReference):ItemReviewReference=>({assessmentId:r.assessmentId,sourceId:r.sourceId,sourceVersion:r.sourceVersion,contextFingerprint:r.contextFingerprint,termsFingerprint:r.termsFingerprint});

export function projectScope(c:ScopeContext):ProjectScopeProjection {
 return {projectId:c.scopeSnapshot.projectId,contextVersion:c.contextVersion,contextFingerprint:c.contextFingerprint,
  scope:{snapshotId:c.scopeSnapshot.id,version:c.scopeSnapshot.version,contentHash:c.scopeSnapshot.contentHash,provenanceKind:c.scopeSnapshot.provenance.kind,capturedAt:c.scopeSnapshot.provenance.capturedAt,clauses:c.scopeSnapshot.clauses.map(({id,text})=>({id,text}))},
  rates:{snapshotId:c.rateSnapshot.id,version:c.rateSnapshot.version,currency:c.rateSnapshot.currency,entries:c.rateSnapshot.entries.map(({id,description,unitAmountMinor})=>({id,description,unitAmountMinor}))},
  acknowledgement:c.acknowledgement.state,
  commitments:c.commitments.map(x=>{const t=(x.terms??{}) as any;return {orderId:x.resourceId,revision:x.revision,approvedAt:x.approvalEvidence.createdAt,title:typeof t.title==='string'?t.title:null,
   deliverables:strings(t.deliverables),lineItems:Array.isArray(t.lineItems)?t.lineItems.map(lineItem):[],totalMinor:Number.isSafeInteger(t.totalMinor)?t.totalMinor:null,currency:typeof t.currency==='string'?t.currency:null};})};
}
/** Draft eligibility is a display hint only; the reservation transaction remains the authority. */
const draftEligible=(i:AssessmentItem)=>i.classification==='new_work'&&i.lineItems.length>0&&!i.questions.length&&!i.reservationState&&!i.exactSourceDuplicate&&!i.exactCommitment&&!i.lineageItemIds.length&&(i.reviewReferences??[]).every(r=>r.decision==='distinct_work');
export function projectAssessment(record:any,source:{id:string;version:number;contentHash:string},contextFingerprint:string):AssessmentProjection {
 const items=(record.items??[]) as AssessmentItem[],evidence=record.designEvidence;
 return {assessmentId:record.id,source:{id:source.id,version:source.version,contentHash:source.contentHash},contextFingerprint,classification:String(record.result?.classification??''),explanation:String(record.result?.explanation??''),
  items:items.map(i=>({itemId:i.id,requestedDeliverable:i.requestedDeliverable,requestQuote:i.requestQuote,classification:i.classification,
   evidence:i.evidence.map((e):ProjectedEvidence=>e.kind==='scope_clause'?{kind:'scope_clause',clauseId:e.clauseId,quote:e.quote}:{kind:'approved_change',orderId:e.resourceId,revision:e.revision,quote:e.quote}),
   questions:strings(i.questions),lineItems:i.lineItems.map(lineItem),proposedTotalMinor:i.proposedTotalMinor,review:review(i.review!),reservationState:i.reservationState??null,duplicateDecision:i.duplicateDecision??null,
   existingCommitment:i.existingCommitment?{orderId:i.existingCommitment.resourceId,revision:i.existingCommitment.revision}:null,draftEligible:draftEligible(i)})),
  designEvidence:evidence?{snapshotId:evidence.id,verification:evidence.verification,freshness:evidence.freshness}:null};
}
export function projectDraft(order:ChangeOrderView,binding:{operationId:string;assessmentId:string;itemIds:string[]}):DraftProjection {
 return {orderId:order.id,revision:order.revision,status:order.status,approvalState:approvalState(order),operationId:binding.operationId,assessmentId:binding.assessmentId,itemIds:[...binding.itemIds],
  title:order.title,deliverables:strings(order.deliverables),lineItems:order.lineItems.map(lineItem),totalMinor:order.totalMinor,currency:order.currency,
  scope:order.scopeContext?{scopeVersion:order.scopeContext.scopeVersion,rateVersion:order.scopeContext.rateVersion}:null,landingPath:'/designer'};
}
export function projectPayment(order:ChangeOrderView,source:PaymentStatusProjection['source']):PaymentStatusProjection {
 if(order.installments?.some(m=>!m.legacy)&&order.installmentSummary){
  const s=order.installmentSummary,hasInvoice=order.installments.some(m=>!!m.paypalInvoiceId);
  return {orderId:order.id,revision:order.revision,approvalState:approvalState(order),invoiceState:hasInvoice?'unknown':'none',paymentState:s.unknownRecordIds.length?'review_required':s.refundedMinor&&s.refundedMinor>0?(s.netPaidMinor===0?'refunded':'partially_refunded'):s.allObligationsPaid?'paid':s.netPaidMinor&&s.netPaidMinor>0?'partial':hasInvoice?'due':'not_invoiced',currency:order.currency,totalMinor:order.totalMinor,amountDueMinor:s.payableDueMinor,paidMinor:s.grossPaidMinor,refundedMinor:s.refundedMinor,observedAt:order.lastCheckedAt,cached:source!=='provider_retrieval',source,hasInvoice,summary:s,
   installments:order.installments.map(m=>({id:m.id,invoiceRecordId:m.invoiceRecordId,title:m.title,amountMinor:m.amountMinor,dueTrigger:m.dueTrigger,invoiceState:m.financialState?.invoiceState??'none',paymentState:m.financialState?.paymentState??'not_invoiced',observedAt:m.financialState?.observedAt??null}))};
 }
 const f=order.financialState,invoiced=!!order.paypalInvoiceId;
 return {orderId:order.id,revision:order.revision,approvalState:approvalState(order),invoiceState:f?.invoiceState??(invoiced?'unknown':'none'),paymentState:order.installments?.some(m=>m.state==='review_required')?'review_required':f?.paymentState??(invoiced?'unknown':'not_invoiced'),
  currency:order.currency,totalMinor:order.totalMinor,amountDueMinor:f?.amountDueMinor??null,paidMinor:f?.paidMinor??null,refundedMinor:f?.refundedMinor??null,
  observedAt:f?.observedAt??order.lastCheckedAt??null,cached:source!=='provider_retrieval',source,hasInvoice:invoiced};
}
export function projectPreparedAction(preview:{id:string;kind:'submit_for_client_approval'|'issue_approved_invoice';orderId?:string;revision?:number;previewHash:string;reviewUrl:string;expiresAt:string}):ActionPreparationProjection {
 return {actionId:preview.id,kind:preview.kind,orderId:String(preview.orderId),revision:Number(preview.revision),previewHash:preview.previewHash,reviewUrl:preview.reviewUrl,expiresAt:preview.expiresAt,state:'prepared'};
}
