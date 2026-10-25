import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {proposalDefaults} from '../web/proposal.js';
async function designer(orderOverrides={},sessionOverrides={}){
 const source=(await readFile(new URL('../web/designer.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
 const elements=new Map(),calls=[];let agent,inbox,releaseAssessment;
 const edit={dataset:{edit:'ordinary'}},comment={dataset:{comment:'different-comment'},classList:{toggle(){}}};
 const el=id=>elements.get(id)||elements.set(id,{value:'',hidden:false,disabled:false,style:{},innerHTML:'',textContent:'',classList:{toggle(){}},scrollIntoView(){},querySelectorAll(selector){return id==='orders'&&selector==='[data-edit]'?[edit]:id==='comments'?[comment]:[];}}).get(id);
 const project={figmaFileKey:'fixture',scopeRevisionId:'s1',scopeClauses:[],rateCard:[{id:'mobile_checkout',description:'Mobile checkout',unitAmountMinor:25000}]};
 const ordinary={id:'ordinary',title:'An ordinary order',deliverables:['Mobile checkout'],lineItems:[{rateCardId:'mobile_checkout',description:'Mobile checkout',unitAmountMinor:25000,quantity:1}],status:'awaiting_client_approval',revision:1,totalMinor:25000,currency:'USD',...orderOverrides};
 const request=async(path,method='GET',body)=>{calls.push({path,method,body});if(path==='/api/session')return {role:'designer'};if(path==='/api/project')return project;if(path==='/api/scope')return {scopeSnapshot:{id:'scope',version:1,provenance:{kind:'legacy_import',capturedAt:'2026-01-01'}},rateSnapshot:{version:1},acknowledgement:{state:'supplied_unacknowledged'},commitments:[]};if(path==='/api/comments')return {comments:[{id:'different-comment',message:'Different request'}]};if(path==='/api/change-orders'&&method==='GET')return [ordinary];if(path==='/api/ai-budget')return {remainingMicroUsd:1,capMicroUsd:1};if(path==='/api/assessments/unclear')return {result:{classification:'needs_clarification',deliverables:[],lineItems:[]}};if(path.endsWith('/submit'))return {order:ordinary,approvalUrl:'https://example.test/review',approvalExpiresAt:new Date().toISOString()};if(path==='/api/change-orders/ordinary')return ordinary;return {};};
 const view={addEventListener(){}};view.parent=view;
 const ctx=vm.createContext({window:view,parent:view,document:{getElementById:el},sessionStorage:{getItem(){return null;},setItem(){}},localStorage:{setItem(){}},location:{hash:'',href:'https://fixture.test/designer'},history:{},URL,
   api:async()=>({role:'designer',token:'fixture',...sessionOverrides}),sessionApi:()=>async(...args)=>args[0]==='/api/assessments/held'?new Promise(resolve=>releaseAssessment=resolve):request(...args),mountStatusCards:()=>({refresh:async()=>{},destroy(){},invalidate(){},message(){}}),mountReviewedActions:()=>({destroy(){},openThread(){},openAction:async()=>{}}),mountInbox:options=>{inbox=options;return {refresh:async()=>{},destroy(){}};},mountConnectors:()=>({refresh:async()=>{},destroy(){}}),mountAgent:options=>{agent=options;return {refresh:async()=>{},destroy(){}};},
   evidencePacketControls:()=>'',bindEvidencePackets(){},deliveryControls:()=>'',mountDelivery:()=>({bind(){},invalidate(){},message(){},destroy(){}}),milestoneMarkup:()=>'',installmentControls:()=>'',bindInstallments(){},installmentReminderControls:()=>'',bindInstallmentReminders(){},balanceCaption:o=>o.amountDueMinor===null||o.amountDueMinor===undefined?'':' · $'+(o.amountDueMinor/100).toFixed(2)+' retained provider balance',scopeVersions:()=> 'Scope v1 · Rates v1',financialLabel:o=>o.status,financialNotice:()=>'',canPay:()=>false,esc:String,money:x=>String(x),label:String,notice(){},busy:async(b,fn)=>fn(),safeInvoice:()=>null,itemRows:()=>'',proposalDefaults,JSON,Date});
 vm.runInContext(source,ctx);await vm.runInContext('connect("resume=fixture")',ctx);
 return {el,calls,edit,comment,review:r=>agent.onReview(r),reviewInbox:r=>inbox.onReview(r),releaseAssessment:value=>releaseAssessment(value)};
}
test('an unpriced exception opens without an invented default mobile price',async()=>{
 const d=await designer();await d.review({id:'exception',source:'portal',text:'Create a logo',assessment_id:'unclear'});
 assert.equal(d.el('price-mode').value,'custom');assert.equal(d.el('amount').value,'');assert.equal(d.el('submit-proposal').disabled,true);
});
test('switching to another order clears the previous exception publication target',async()=>{
 const d=await designer();await d.review({id:'exception',source:'portal',text:'Create a logo'});d.edit.onclick();
 await d.el('submit-proposal').onclick({currentTarget:{}});
 assert.ok(!d.calls.some(c=>c.path.includes('/agent/requests/exception/publish')));
});
test('T09 switching requests discards a held inbox assessment read instead of rendering stale review controls',async()=>{const d=await designer();const held=d.reviewInbox({id:'old-inbox',sourceKind:'figma',rootId:'old-comment',assessmentId:'held'});d.comment.onclick();d.releaseAssessment({result:{items:[]}});await held;assert.equal(d.el('assessment').innerHTML,'');});
test('C1 unavailable or changed source suppresses client review link while current source keeps it',async()=>{
 for(const itemSourceState of ['unavailable','changed','current']){
  const d=await designer({scopeRevisionId:'s1',itemSourceState},{grantId:'fixture-owner'});
  assert.equal(d.el('orders').innerHTML.includes('Client review link'),itemSourceState==='current',itemSourceState);
  assert.match(d.el('orders').innerHTML,/Review terms/);
 }
});
