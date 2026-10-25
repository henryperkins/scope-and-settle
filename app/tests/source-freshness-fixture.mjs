import assert from 'node:assert/strict';
import {once} from 'node:events';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {isolatedApp,providerFixture} from './helpers.mjs';

/**
 * T11a fixture: one isolated application, database and HTTP server with synthetic Figma,
 * model and PayPal adapters. Nothing leaves the process; every provider call is counted.
 */
export async function fixture({listen=true,observeAssessmentJoins=false}={}){
 const nativeFetch=globalThis.fetch,app=await isolatedApp();
 if(observeAssessmentJoins){
  // Only the disposable compiled test copy emits this signal at the actual promise join.
  // No mutable test control or observer is added to the production application.
  const file=join(app.app,'dist/backend/assessmentWork.js'),bytes=await readFile(file,'utf8');
  assert.equal(bytes.split('if (existing) {').length,2,'One actual shared-work join boundary');
  await writeFile(file,bytes.replace('if (existing) {',"if (existing) { process.emit('scope-settle:test:assessment-join');"));
 }
 Object.assign(process.env,{FIGMA_WEBHOOK_ENABLED:'true',FIGMA_WEBHOOK_ACCESS_VERIFIED:'true',FIGMA_WEBHOOK_ID:'t11a-subscription',
  FIGMA_WEBHOOK_PASSCODE:'t11a-secret-only',FIGMA_WEBHOOK_CONTEXT_TYPE:'file',FIGMA_WEBHOOK_CONTEXT_ID:'test-file',FIGMA_COMMENT_POSTING_ENABLED:'true'});
 const m={};
 for(const name of ['db','env','sessions','context','requestInbox','requestItems','requestSources','assessmentWork','orders','changeOrderService','agentPortal','agentPolicy','figmaWebhooks','jobs','agentStore','reviewedActions'])m[name]=await app.load(name);
 const {db}=m.db,provider=providerFixture();
 const session=m.sessions.createSession({projectId:'demo',role:'designer',runId:m.db.currentRunId()}),ctx=m.context.contextFromSessionToken(session.token);
 let comments=[],readHook=null,calls=0,writes=0,cancelApplies=true,notifications=[];
 globalThis.fetch=async(url,init={})=>{
  const u=new URL(url);
  if(u.hostname==='127.0.0.1')return nativeFetch(url,init);
  if(u.hostname==='api.figma.com'){
   if(init.method==='POST'){
    writes++;const body=JSON.parse(init.body),reply={id:'posted-'+writes,parent_id:body.comment_id,message:body.message,user:{id:'designer-fixture'},created_at:new Date().toISOString()};
    comments.push(reply);return Response.json(reply);
   }
   // The authoritative snapshot is taken before any held read is released.
   const copy=structuredClone(comments);if(readHook)await readHook();return Response.json({comments:copy});
  }
  if(u.pathname.endsWith('/chat/completions')){
   calls++;const wire=JSON.parse(init.body),c=JSON.parse(wire.messages[1].content[0].text),automatic=!!wire.response_format.json_schema.schema.properties.automation;
   const evidence=[{kind:'scope_clause',snapshotId:c.scopeContext.scopeSnapshotId,clauseId:c.project.scopeClauses[0].id,quote:c.project.scopeClauses[0].text}];
   const items=[c.comment,...c.replies].map(x=>({requestedDeliverable:automatic?c.project.rateCard.find(r=>r.id==='mobile_checkout').description:x.message,requestQuote:x.message,classification:'new_work',evidence,rates:[{rateCardId:'mobile_checkout',quantity:1}],questions:[],existingCommitment:null}));
   const automation=automatic?{allRequestsCovered:true,unpricedComponents:[],coverage:items.map((item,n)=>({requestQuote:item.requestQuote,deliverableIndex:n,rateCardId:'mobile_checkout',quantity:1}))}:undefined;
   return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({items,explanation:'Synthetic supported additions',designObservations:[],...(automatic?{automation}:{})})}}],usage:{prompt_tokens:100,completion_tokens:100}});
  }
  if(/\/(remind|cancel)$/.test(u.pathname)){
   notifications.push({kind:u.pathname.split('/').at(-1),invoiceId:u.pathname.split('/').at(-2)});
   writes++;const invoice=provider.invoices.get(u.pathname.split('/').at(-2));
   if(u.pathname.endsWith('/cancel')&&cancelApplies)invoice.status='CANCELLED';
   return new Response(null,{status:204});
  }
  return provider.fetch(url,init);
 };
 let server=null,base=null;
 if(listen){({server}=await app.load('server'));if(!server.listening)await once(server,'listening');base='http://127.0.0.1:'+server.address().port;m.env.config.publicUrl=base;}
 async function http(path,method='GET',body,token=session.token,headers={}){
  const response=await nativeFetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {status:response.status,body:await response.json().catch(()=>null)};
 }
 const count=(sql,...args)=>Number(db.prepare(sql).get(...args).n);
 const f={
  app,db,m,ctx,session,provider,base,http,count,
  inbox:m.requestInbox,items:m.requestItems,sources:m.requestSources,work:m.assessmentWork,orders:m.orders,service:m.changeOrderService,portal:m.agentPortal,jobs:m.jobs,store:m.agentStore,actions:m.reviewedActions,
  get comments(){return comments;},set comments(v){comments=v;},
  set readHook(v){readHook=v;},get readHook(){return readHook;},
  set cancelApplies(v){cancelApplies=v;},
  get calls(){return calls;},get writes(){return writes;},
  get notifications(){return structuredClone(notifications);},
  root(id,message,user='client'){const c={id,message,user:{id:user},created_at:new Date().toISOString()};comments.push(c);return c;},
  reply(id,parent,message,user='client'){const c={id,parent_id:parent,message,user:{id:user},created_at:new Date().toISOString()};comments.push(c);return c;},
  comment(id){return comments.find(c=>c.id===id);},
  remove(...ids){comments=comments.filter(c=>!ids.includes(c.id));},
  enable(autoAssess=false){return m.requestInbox.saveInboxSettings(ctx,{expectedVersion:m.requestInbox.getInboxSettings(ctx).version,intake:true,autoAssess,clientIds:['client'],consent:true});},
  event(commentId){return m.figmaWebhooks.receiveFigmaEvent({event_type:'FILE_COMMENT',webhook_id:'t11a-subscription',passcode:'t11a-secret-only',timestamp:new Date().toISOString(),file_key:'test-file',comment_id:commentId});},
  async fileRefresh(...ids){for(const id of ids)await f.event(id);return m.jobs.runInboxJobs(new Date(),'figma_refresh');},
  async assessThread(rootId){
   const thread=await http('/api/inbox/refresh','POST',{commentId:rootId});assert.equal(thread.status,200,JSON.stringify(thread.body));
   const assessment=await http('/api/agent/requests/'+thread.body.id+'/assess','POST',{});assert.equal(assessment.status,201,JSON.stringify(assessment.body));
   return {thread:thread.body,assessment:assessment.body};
  },
  draft(itemIds,operationId,assessmentId){return http('/api/change-orders','POST',{itemIds,operationId,...(assessmentId?{assessmentId}:{})});},
  async submit(orderId){const r=await http('/api/change-orders/'+orderId+'/submit','POST');assert.equal(r.status,200,JSON.stringify(r.body));return r.body;},
  async redeem(approvalUrl){const r=await http('/api/session/redeem','POST',{invitation:approvalUrl.split('#').pop()},null);assert.equal(r.status,200,JSON.stringify(r.body));return r.body.token;},
  portalAccess(){m.agentPolicy.saveAgentPolicy(session,{enabled:true,consent:true,allowedRateIds:['mobile_checkout'],maxQuoteMinor:25000,maxTotalMinor:100000,maxQuantity:1});return m.agentPortal.createPortalAccess(session).credential;},
  portalSession(credential){return m.agentPortal.getPortalSession(credential);},
  displayed(requestId){return {requestVersion:m.agentStore.requestById(requestId,ctx.runId).version,source:m.requestInbox.listRequestInbox(ctx).find(t=>t.id===requestId).source};},
  head(rootId){
   const s=db.prepare('SELECT * FROM request_sources WHERE run_id=? AND root_id=?').get(ctx.runId,rootId);
   return s?{id:s.id,version:s.version,contentHash:s.content_hash,versions:count('SELECT COUNT(*) n FROM request_source_versions WHERE source_id=?',s.id)}:null;
  },
  /** Durable source-keyed freshness record, or null when no trusted observation exists. */
  fence(sourceId){return db.prepare('SELECT * FROM request_source_freshness WHERE source_id=?').get(sourceId)??null;},
  cachedSource(rootId){const h=f.head(rootId);return {source:'figma',fileKey:'test-file',rootId,messages:JSON.parse(db.prepare('SELECT messages_json FROM request_source_versions WHERE source_id=? AND version=?').get(h.id,h.version).messages_json)};},
  project(){return m.db.getProjectForRun(ctx.runId);},
  reservations(orderId){return db.prepare('SELECT state FROM proposal_item_reservations WHERE order_id=? ORDER BY id').all(orderId).map(r=>r.state);},
  counts(){
   return {orders:count('SELECT COUNT(*) n FROM change_orders'),operations:count('SELECT COUNT(*) n FROM proposal_item_operations'),
    reservations:db.prepare('SELECT id,order_id,state FROM proposal_item_reservations ORDER BY id').all(),approvals:count('SELECT COUNT(*) n FROM approvals'),
    revisions:count('SELECT COUNT(*) n FROM proposal_revisions'),invoiceOperations:count('SELECT COUNT(*) n FROM invoice_operations'),
    outbox:count('SELECT COUNT(*) n FROM agent_outbox'),outbound:count('SELECT COUNT(*) n FROM outbound_operations'),
    provider:provider.counts(),writes,calls};
  },
  async close(){if(server)await new Promise(r=>server.close(r));globalThis.fetch=nativeFetch;db.close();},
 };
 return f;
}
