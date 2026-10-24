import assert from 'node:assert/strict';
import {fixture} from './source-freshness-fixture.mjs';
import {draftInput} from './helpers.mjs';

export const splitSchedule=()=>({milestones:[{id:'deposit',title:'Deposit',amountMinor:10000,dueTrigger:'proposal_approval',acceptanceCriteria:['Deposit confirmed']},{id:'balance',title:'Delivery balance',amountMinor:15000,dueTrigger:'delivery_acceptance',acceptanceCriteria:['One mobile checkout draft reviewed']}],workStartPaymentMilestoneIds:['deposit']});
export async function milestoneFixture(){
 const f=await fixture();
 f.milestones=await f.app.load('milestones').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
 f.order=f.orders.createChangeOrder(draftInput(),f.ctx.runId);
 f.schedule=()=>{assert.equal(typeof f.milestones.setMilestoneSchedule,'function','T14 requires approved installment schedules');return f.milestones.setMilestoneSchedule(f.ctx,f.order.id,f.order.revision,splitSchedule());};
 f.approve=async()=>{const submitted=await f.submit(f.order.id);f.clientToken=await f.redeem(submitted.approvalUrl);f.client=f.m.context.contextFromSessionToken(f.clientToken);const approved=await f.http('/api/change-orders/'+f.order.id+'/approve','POST',{},f.clientToken);assert.equal(approved.status,200,JSON.stringify(approved.body));f.order=f.orders.getChangeOrder(f.order.id);return f.order;};
 f.markPaid=id=>{const invoice=f.provider.invoices.get(id);invoice.status='PAID';invoice.due_amount.value='0.00';invoice.payments={paid_amount:{...invoice.amount},transactions:[{type:'PAYPAL',payment_id:'payment-'+id,amount:{...invoice.amount}}]};};
 return f;
}
