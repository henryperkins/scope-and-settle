import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
globalThis.window={};globalThis.location={origin:'https://fixture.test'};
const ui=await import('data:text/javascript;base64,'+Buffer.from(await readFile(new URL('../web/common.js',import.meta.url),'utf8')).toString('base64'));
test('T14 split UI renders exact consent, future balance and individual pay links without a whole-order Paid claim',()=>{
 const order={status:'payment_due',approvalStatus:'approved',currency:'USD',milestoneSchedule:{milestones:[{id:'deposit',title:'Deposit',amountMinor:10000,dueTrigger:'proposal_approval',acceptanceCriteria:['Deposit confirmed']},{id:'balance',title:'Balance',amountMinor:15000,dueTrigger:'delivery_acceptance',acceptanceCriteria:['Review checkout']}],workStartPaymentMilestoneIds:['deposit']},installmentSummary:{allObligationsPaid:false,workStartSatisfied:true,netPaidMinor:10000,grossPaidMinor:10000,refundedMinor:0,payableDueMinor:0,futureUnbilledMinor:15000,unknownRecordIds:[]},installments:[{id:'deposit',title:'Deposit',amountMinor:10000,invoiceUrl:'https://www.sandbox.paypal.com/invoice/p/#one',financialState:{invoiceState:'closed',paymentState:'paid'}},{id:'balance',title:'Balance',amountMinor:15000,financialState:null}]};
 assert.equal(ui.financialLabel(order),'Deposit paid · Balance outstanding');assert.equal(ui.canPay(order),false);
 assert.equal(typeof ui.milestoneMarkup,'function');const html=ui.milestoneMarkup(order);assert.match(html,/\$100\.00/);assert.match(html,/\$150\.00/);assert.match(html,/Review checkout/);assert.match(html,/delivery acceptance/i);assert.match(html,/work.start/i);
});
for(const [invoiceState,paymentState,allowed,want] of [['payable','due',true,'Payment due'],['payable','partial',true,'Partially paid'],['closed','paid',false,'Paid'],['closed','pending',false,'Payment pending'],['cancelled','unknown',false,'Invoice cancelled'],['closed','refunded',false,'Refunded'],['closed','partially_refunded',false,'Partially refunded'],['unknown','unknown',false,'Payment needs review'],['payable','review_required',false,'Payment needs review'],['scheduled','not_started',false,'Invoice scheduled']])test(`UI ${invoiceState}/${paymentState} labels and payment permission`,()=>{
 assert.equal(typeof ui.canPay,'function','all UIs need explicit payment permission');assert.equal(typeof ui.financialLabel,'function');
 const order={invoiceUrl:'https://www.sandbox.paypal.com/invoice/p/#opaque',financialState:{invoiceState,paymentState,amountDueMinor:5000}};
 assert.equal(ui.canPay(order),allowed);assert.equal(ui.financialLabel(order),want);
});
