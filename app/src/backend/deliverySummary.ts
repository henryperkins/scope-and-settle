import {db} from './db.js';
import type {ChangeOrderView} from '../shared/types.js';
export function deliveryFinancialReview(order:ChangeOrderView){return !order.installmentSummary?.workStartSatisfied||!!order.installmentSummary.unknownRecordIds.length||!!order.installments?.some(m=>m.financialState&&(['refunded','partially_refunded','review_required','unknown'].includes(m.financialState.paymentState)||m.financialState.invoiceState==='cancelled'));}
/** Delivery history is independent of provider payment observations. */
export function deliverySummary(orderId:string,revision:number){
 const rows=db.prepare(`SELECT r.id review_id,r.milestone_id,r.review_revision,r.snapshot_hash,r.state,a.created_at accepted_at FROM delivery_review_heads h JOIN delivery_reviews r ON r.id=h.review_id LEFT JOIN delivery_acceptances a ON a.review_id=r.id WHERE r.order_id=? AND r.order_revision=? ORDER BY r.rowid`).all(orderId,revision) as any[];
 let expected=db.prepare("SELECT id FROM milestones WHERE order_id=? AND revision=? AND due_trigger='delivery_acceptance'").all(orderId,revision).map(r=>String(r.id));
 const runs=db.prepare('SELECT milestone_id FROM delivery_runs WHERE order_id=? AND revision=?').all(orderId,revision).map(r=>String(r.milestone_id));if(!expected.length)expected=runs;
 const state=expected.length&&expected.every(id=>rows.some(r=>r.milestone_id===id&&r.state==='accepted'))?'accepted':rows.some(r=>r.state==='changes_requested')?'changes_requested':rows.some(r=>r.state==='in_review')?'in_review':runs.length?'draft':'not_recorded';
 return {state,reviews:rows.map(r=>({reviewId:r.review_id,revision:r.review_revision,milestoneId:r.milestone_id,snapshotHash:r.snapshot_hash,state:r.state,acceptedAt:r.accepted_at??null}))};
}
