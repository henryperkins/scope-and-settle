import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {isFigmaPluginMessage} from '../web/figma-bridge.js';

test('Figma messages require the editor origin and a host ancestor',()=>{
  const parent={},top={},view={parent,top};
  assert.equal(isFigmaPluginMessage({origin:'https://www.figma.com',source:top},view),true);
  assert.equal(isFigmaPluginMessage({origin:'https://www.figma.com',source:parent},view),true);
  for(const event of [
    {origin:'https://www.figma.com',source:{}},
    {origin:'https://example.test',source:top},
    {origin:'null',source:parent},
    {origin:'https://www.figma.com.attacker.test',source:parent},
  ]) assert.equal(isFigmaPluginMessage(event,view),false);
  const standalone={};standalone.parent=standalone;standalone.top=standalone;
  assert.equal(isFigmaPluginMessage({origin:'https://www.figma.com',source:standalone},standalone),false);
});

test('plugin main captures file/node/time before export and rejects selection changes during the held export',async()=>{
 const source=await readFile(new URL('../plugin/dist/code.js',import.meta.url),'utf8'),messages=[],events={};let release;
 const frame={id:'1:2',name:'Checkout',type:'FRAME',width:100,height:200,x:0,y:0,layoutMode:'VERTICAL',exportAsync:()=>new Promise(r=>release=r)};
 const figma={fileKey:'test-file',currentPage:{id:'page',name:'Page',selection:[frame]},ui:{postMessage:m=>messages.push(m),resize(){}},showUI(){},clientStorage:{getAsync:async()=>null,setAsync:async()=>{}},base64Encode:b=>Buffer.from(b).toString('base64'),on:(name,fn)=>events[name]=fn};
 vm.runInContext(source,vm.createContext({figma,__html__:'fixture',Date,Error}));
 const held=figma.ui.onmessage({type:'export-frame',expectedFileKey:'test-file',exportId:'one',requestKey:'request-v1',generation:0});
 figma.currentPage.selection=[];events.selectionchange();release(Buffer.from('fixture'));await held;
 assert.equal(messages.some(m=>m.type==='frame'),false);assert.match(messages.at(-1).message,/changed/i);assert.equal(messages.at(-1).exportId,'one');
 figma.currentPage.selection=[frame];events.selectionchange();await figma.ui.onmessage({type:'capture-selection',expectedFileKey:'test-file',exportId:'two',requestKey:'request-v2',generation:2});
 const captured=messages.at(-1);assert.equal(captured.type,'frame');assert.equal(captured.generation,2);assert.equal(captured.context[0].id,'1:2');assert.equal(captured.context[0].layout.layoutMode,'VERTICAL');assert.ok(captured.capturedAt);assert.equal(captured.dataUrl,undefined);
});

test('real nested Figma message shape restores the paid session and enables frame attachment',async()=>{
  const source=(await readFile(new URL('../web/designer.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'')+'\nglobalThis.chooseRequest=id=>{selected=id;};';
  const elements=new Map(),listeners={},posted=[];
  const element=id=>elements.get(id)||elements.set(id,{hidden:true,disabled:true,value:'',textContent:'',innerHTML:'',
    querySelectorAll:()=>[],scrollIntoView(){}}).get(id);
  const parent={postMessage:value=>posted.push(value)},top={},view={parent,top,addEventListener:(name,fn)=>listeners[name]=fn};
  const responses={
    '/api/scope':{scopeSnapshot:{id:'scope',version:1,provenance:{kind:'legacy_import',capturedAt:'2026-01-01'}},rateSnapshot:{version:1},acknowledgement:{state:'supplied_unacknowledged'},commitments:[]},
    '/api/session':{role:'designer'},
    '/api/project':{figmaFileKey:'judging-file',scopeRevisionId:'scope-rev-1',scopeClauses:[],rateCard:[]},
    '/api/comments':{comments:[]},
    '/api/ai-budget':{remainingMicroUsd:1000000,capMicroUsd:2000000},
    '/api/change-orders':[{id:'paid-order',title:'Mobile checkout',paymentStatus:'paid',status:'paid',revision:1,
      scopeRevisionId:'scope-rev-1',totalMinor:25000,amountDueMinor:0,lineItems:[],currency:'USD'}],
  };
  const sandbox=vm.createContext({window:view,parent,document:{getElementById:element},
    isFigmaPluginMessage:event=>isFigmaPluginMessage(event,view),sessionApi:()=>async path=>responses[path],
    deliveryControls:()=>'',mountDelivery:()=>({bind(){},invalidate(){},message(){},destroy(){}}),milestoneMarkup:()=>'',installmentControls:()=>'',bindInstallments(){},balanceCaption:o=>o.amountDueMinor===null||o.amountDueMinor===undefined?'':' · $'+(o.amountDueMinor/100).toFixed(2)+' retained provider balance',scopeVersions:()=> 'Scope v1 · Rates v1',financialLabel:o=>o.status==='paid'?'Paid':o.status,financialNotice:()=>'',canPay:()=>false,esc:String,label:value=>value==='paid'?'Paid':value,money:value=>`$${(value/100).toFixed(2)}`,
    URL,location:{href:'https://fixture.test/designer'},mountStatusCards:()=>({refresh:async()=>{},destroy(){},invalidate(){},message(){}}),mountReviewedActions:()=>({destroy(){},openThread(){},openAction:async()=>{}}),mountInbox:()=>({refresh:async()=>{},destroy(){}}),mountConnectors:()=>({refresh:async()=>{},destroy(){}}),mountAgent:()=>({refresh:async()=>{},destroy(){}}),itemRows:()=>'',safeInvoice:()=>null,notice(){},proposalDefaults(){},busy:async(button,fn)=>fn(),JSON,Date});
  vm.runInContext(source,sandbox);
  const send=(message,source=top,origin='https://www.figma.com')=>listeners.message({source,origin,data:{pluginMessage:message}});
  await send({type:'session',session:{role:'designer',token:'untrusted'}},{});
  assert.equal(element('workspace').hidden,true);
  await send({type:'context',fileKey:'judging-file',selection:[{id:'5:2',type:'FRAME'}]});
  await send({type:'session',session:{role:'designer',token:'stored-session',renewalCredential:'stored-grant'}});
  assert.equal(element('workspace').hidden,false);
  assert.equal(element('connect').hidden,true);
  assert.equal(element('attach-frame').disabled,false);
  assert.match(element('orders').innerHTML,/Paid/);
  assert.match(element('orders').innerHTML,/Revision 1 · scope-rev-1/);
  assert.match(element('orders').innerHTML,/\$0\.00 retained provider balance/);
  await send({type:'frame',fileKey:'judging-file',dataUrl:'data:image/png;base64,fixture',context:[]});
  assert.equal(element('frame').hidden,true,'unsolicited/late native frames must be ignored');
  sandbox.chooseRequest('request-one');
  element('attach-frame').onclick();
  const exportMessage=posted.at(-1).pluginMessage;
  await send({type:'frame',fileKey:'judging-file',exportId:exportMessage.exportId,requestKey:exportMessage.requestKey,generation:0,capturedAt:new Date().toISOString(),dataUrl:'data:image/png;base64,fixture',context:[{id:'5:2',name:'Checkout',type:'FRAME'}]});
  assert.equal(element('frame').hidden,false);
  element('attach-frame').onclick();const late=posted.at(-1).pluginMessage;
  await send({type:'selection',fileKey:'judging-file',generation:1,selection:[{id:'9:9',type:'FRAME'}]});
  await send({type:'frame',fileKey:'judging-file',exportId:late.exportId,requestKey:late.requestKey,generation:0,dataUrl:'data:image/png;base64,fixture',context:[]});
  assert.equal(element('frame').hidden,true,'a selection change invalidates a held export');
  await send({type:'selection',fileKey:'other-file',selection:[]});
  assert.equal(element('attach-frame').disabled,true);
  assert.equal(element('frame').hidden,true);
  assert.deepEqual(posted.map(value=>value.pluginMessage.type),['get-session','get-context','export-frame','export-frame']);
});
