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

test('real nested Figma message shape restores the paid session and enables frame attachment',async()=>{
  const source=(await readFile(new URL('../web/designer.js',import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'');
  const elements=new Map(),listeners={},posted=[];
  const element=id=>elements.get(id)||elements.set(id,{hidden:true,disabled:true,value:'',textContent:'',innerHTML:'',
    querySelectorAll:()=>[],scrollIntoView(){}}).get(id);
  const parent={postMessage:value=>posted.push(value)},top={},view={parent,top,addEventListener:(name,fn)=>listeners[name]=fn};
  const responses={
    '/api/session':{role:'designer'},
    '/api/project':{figmaFileKey:'judging-file',scopeRevisionId:'scope-rev-1',scopeClauses:[],rateCard:[]},
    '/api/comments':{comments:[]},
    '/api/ai-budget':{remainingMicroUsd:1000000,capMicroUsd:2000000},
    '/api/change-orders':[{id:'paid-order',title:'Mobile checkout',paymentStatus:'paid',status:'paid',revision:1,
      scopeRevisionId:'scope-rev-1',totalMinor:25000,amountDueMinor:0,lineItems:[],currency:'USD'}],
  };
  vm.runInContext(source,vm.createContext({window:view,parent,document:{getElementById:element},
    isFigmaPluginMessage:event=>isFigmaPluginMessage(event,view),sessionApi:()=>async path=>responses[path],
    esc:String,label:value=>value==='paid'?'Paid':value,money:value=>`$${(value/100).toFixed(2)}`,
    mountAgent:()=>({refresh:async()=>{},destroy(){}}),itemRows:()=>'',safeInvoice:()=>null,notice(){},proposalDefaults(){},busy:async(button,fn)=>fn(),JSON,Date}));
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
  assert.match(element('orders').innerHTML,/\$0\.00 due/);
  await send({type:'frame',fileKey:'judging-file',dataUrl:'data:image/png;base64,fixture',context:[]});
  assert.equal(element('frame').hidden,false);
  await send({type:'selection',fileKey:'other-file',selection:[]});
  assert.equal(element('attach-frame').disabled,true);
  assert.equal(element('frame').hidden,true);
  assert.deepEqual(posted.map(value=>value.pluginMessage.type),['get-session','get-context']);
});
