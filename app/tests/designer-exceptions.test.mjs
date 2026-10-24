import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {proposalDefaults} from '../web/proposal.js';
async function designer(){
 const source=(await readFile(new URL('../web/designer.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
 const elements=new Map(),calls=[];let agent;
 const edit={dataset:{edit:'ordinary'}},comment={dataset:{comment:'different-comment'},classList:{toggle(){}}};
 const el=id=>elements.get(id)||elements.set(id,{value:'',hidden:false,disabled:false,style:{},innerHTML:'',textContent:'',classList:{toggle(){}},scrollIntoView(){},querySelectorAll(selector){return id==='orders'&&selector==='[data-edit]'?[edit]:id==='comments'?[comment]:[];}}).get(id);
 const project={figmaFileKey:'fixture',scopeRevisionId:'s1',scopeClauses:[],rateCard:[{id:'mobile_checkout',description:'Mobile checkout',unitAmountMinor:25000}]};
 const ordinary={id:'ordinary',title:'An ordinary order',deliverables:['Mobile checkout'],lineItems:[{rateCardId:'mobile_checkout',description:'Mobile checkout',unitAmountMinor:25000,quantity:1}],status:'awaiting_client_approval',revision:1,totalMinor:25000,currency:'USD'};
 const request=async(path,method='GET',body)=>{calls.push({path,method,body});if(path==='/api/session')return {role:'designer'};if(path==='/api/project')return project;if(path==='/api/comments')return {comments:[{id:'different-comment',message:'Different request'}]};if(path==='/api/change-orders'&&method==='GET')return [ordinary];if(path==='/api/ai-budget')return {remainingMicroUsd:1,capMicroUsd:1};if(path==='/api/assessments/unclear')return {result:{classification:'needs_clarification',deliverables:[],lineItems:[]}};if(path.endsWith('/submit'))return {order:ordinary,approvalUrl:'https://example.test/review',approvalExpiresAt:new Date().toISOString()};if(path==='/api/change-orders/ordinary')return ordinary;return {};};
 const view={addEventListener(){}};view.parent=view;
 const ctx=vm.createContext({window:view,parent:view,document:{getElementById:el},sessionStorage:{getItem(){return null;},setItem(){}},localStorage:{setItem(){}},location:{hash:''},history:{},
   api:async()=>({role:'designer',token:'fixture'}),sessionApi:()=>request,mountAgent:options=>{agent=options;return {refresh:async()=>{},destroy(){}};},
   esc:String,money:x=>String(x),label:String,notice(){},busy:async(b,fn)=>fn(),safeInvoice:()=>null,itemRows:()=>'',proposalDefaults,JSON,Date});
 vm.runInContext(source,ctx);await vm.runInContext('connect("resume=fixture")',ctx);
 return {el,calls,edit,comment,review:r=>agent.onReview(r)};
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
