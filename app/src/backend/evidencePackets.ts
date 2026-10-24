import {createHash,randomUUID} from 'node:crypto';
import {db,transaction} from './db.js';
import {requireDesignerContext,ScopedAccessError,type ActorContext} from './context.js';
import {getScopedOrder} from './changeOrderService.js';
import {contentHash} from './scopePersistence.js';
import {config} from './env.js';
import type {EvidencePacket,EvidencePacketManifest} from '../shared/types.js';

const sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function fail(message:string):never {throw new ScopedAccessError(409,message);}
function parse(value:string,label:string):any {try{return JSON.parse(value);}catch{fail(label+' is incomplete or changed; restore/review the evidence before exporting');}}
function scoped(ctx:ActorContext,orderId:string){requireDesignerContext(ctx);return getScopedOrder(ctx,orderId);}
type Gap={kind:string;resourceId:string;detail:string};
function redactor(ctx:ActorContext){
 const literals=new Set<string>([config.aiApiKey,config.paypalClientId,config.paypalClientSecret,config.figmaToken,config.figmaWebhookPasscode].filter(s=>s.length>=8));
 for(const table of ['sessions','invitations'])for(const r of db.prepare(`SELECT token FROM ${table} WHERE project_id=? AND run_id=?`).all(ctx.projectId,ctx.runId))literals.add(String(r.token));
 const digests=new Set<string>();for(const table of ['renewal_grants','agent_portals'])for(const r of db.prepare(`SELECT credential_hash FROM ${table} WHERE run_id=?`).all(ctx.runId))digests.add(String(r.credential_hash));
 for(const r of db.prepare('SELECT a.credential_hash FROM judge_access a JOIN judge_runs r ON r.judge_access_id=a.id WHERE r.run_id=?').all(ctx.runId))digests.add(String(r.credential_hash));
 let applied=false;
 const clean=(value:string)=>{
  let out=value;for(const secret of literals)if(out.includes(secret)){out=out.split(secret).join('[credential omitted]');}
  out=out.replace(/https?:\/\/[^\s<>"']+/gi,'[link omitted]')
   .replace(/\bBearer\s+[a-zA-Z0-9._~+\/-]+/gi,'[credential omitted]')
   .replace(/\bssc1\.[a-zA-Z0-9._-]+/g,'[credential omitted]')
   .replace(/\b(?:sk-(?:proj-|ant-)?[a-zA-Z0-9_-]{20,}|gh[pousr]_[a-zA-Z0-9_]{20,}|github_pat_[a-zA-Z0-9_]{20,})\b/g,'[credential omitted]')
   .replace(/\b(?:password|api[_ -]?key|client[_ -]?secret|access[_ -]?token|authorization|resume|access)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,'[credential omitted]')
   .replace(/\b[a-zA-Z0-9_-]{32,256}\b/g,v=>digests.has(sha(v))?'[credential omitted]':v)
   .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,'[email omitted]');
  if(out!==value)applied=true;return out;
 };
 const visit=(v:any):any=>typeof v==='string'?clean(v):Array.isArray(v)?v.map(visit):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,visit(x)])):v;
 return {visit,get applied(){return applied;}};
}
function terms(snapshot:any){
 return {title:snapshot.title??null,deliverables:snapshot.deliverables??[],lineItems:(snapshot.lineItems??[]).map((i:any)=>({description:i.description,quantity:i.quantity,unitAmountMinor:i.unitAmountMinor,priceSource:i.priceSource??'unknown',rateCardId:i.rateCardId??null})),totalMinor:snapshot.totalMinor??null,currency:snapshot.currency??null,milestoneSchedule:snapshot.milestoneSchedule??null};
}
function gather(ctx:ActorContext,orderId:string,gaps:Gap[]){
 const order=scoped(ctx,orderId);
 if(order.approvalStatus!=='approved')fail('Select an approved order for its factual evidence packet');
 const approvals=db.prepare("SELECT * FROM approvals WHERE change_order_id=? AND actor_role='client' ORDER BY change_order_revision,id").all(orderId) as any[];
 const proposals:any[]=[],scopes:any[]=[],rates:any[]=[];const scopeIds=new Set<string>(),rateIds=new Set<string>();
 for(const revision of [...new Set<number>(approvals.map(a=>Number(a.change_order_revision)))]){
  const saved=db.prepare('SELECT * FROM proposal_revisions WHERE change_order_id=? AND revision=?').get(orderId,revision) as any;
  const context=db.prepare("SELECT c.* FROM scope_context_links l JOIN scope_contexts c ON c.id=l.context_id WHERE l.kind='proposal' AND l.resource_id=? AND l.revision=? AND c.project_id=? AND c.run_id=?").get(orderId,revision,ctx.projectId,ctx.runId) as any;
  if(!saved)gaps.push({kind:'proposal_snapshot_missing',resourceId:orderId+':'+revision,detail:'Approved terms cannot be reconstructed from current editable/application fields'});
  const snapshot=saved?parse(saved.snapshot_json,'Proposal snapshot'):null;
  proposals.push({revision,available:!!saved,snapshotSha256:saved?sha(saved.snapshot_json):null,capturedAt:saved?.created_at??null,terms:snapshot?terms(snapshot):null,
   approvals:approvals.filter(a=>a.change_order_revision===revision).map(a=>({id:a.id,revision:a.change_order_revision,scopeRevisionId:a.scope_revision_id,recordedAt:a.created_at,authority:'demo_client_role',verifiedPersonalIdentity:false,clientViewingRecorded:false})),scopeContextId:context?.id??null});
  if(!context?.scope_snapshot_id)gaps.push({kind:'scope_reference_missing',resourceId:orderId+':'+revision,detail:'No immutable original-scope reference; the current baseline was not substituted'});
  if(context?.scope_snapshot_id)scopeIds.add(context.scope_snapshot_id);if(context?.rate_snapshot_id)rateIds.add(context.rate_snapshot_id);
 }
 for(const id of scopeIds){
  const row=db.prepare('SELECT * FROM scope_snapshots WHERE id=? AND project_id=? AND run_id=?').get(id,ctx.projectId,ctx.runId) as any;
  if(!row){gaps.push({kind:'scope_snapshot_missing',resourceId:id,detail:'Original supplied agreement unavailable'});continue;}
  const clauses=parse(row.clauses_json,'Scope clauses');if(contentHash(clauses)!==row.content_hash)fail('Original scope hash integrity check failed');
  scopes.push({id,version:row.version,sourceHash:row.content_hash,clauses:clauses.map((c:any)=>({id:c.id,text:c.text})),provenance:{kind:row.provenance_kind,label:'Provided agreement; acknowledgement is a separate recorded decision',capturedAt:row.captured_at,sourceTime:row.source_time??null},
   acknowledgements:(db.prepare('SELECT id,created_at FROM scope_acknowledgements WHERE snapshot_id=?').all(id) as any[]).map(a=>({id:a.id,recordedAt:a.created_at,authority:'demo_client_role',verifiedPersonalIdentity:false}))});
 }
 for(const id of rateIds){const row=db.prepare('SELECT * FROM rate_card_snapshots WHERE id=? AND project_id=? AND run_id=?').get(id,ctx.projectId,ctx.runId) as any;if(!row){gaps.push({kind:'rate_snapshot_missing',resourceId:id,detail:'Agreed rate snapshot unavailable'});continue;}const entries=parse(row.entries_json,'Rate entries');if(contentHash({currency:row.currency,entries})!==row.content_hash)fail('Rate snapshot hash integrity check failed');rates.push({id,version:row.version,currency:row.currency,entries,sourceHash:row.content_hash,provenance:row.provenance_kind,capturedAt:row.captured_at});}
 const items=db.prepare(`SELECT r.item_id,r.assessment_id,r.state,r.created_at,i.source_id,i.source_version,i.result_json FROM proposal_item_reservations r JOIN request_items it ON it.id=r.item_id AND it.project_id=? AND it.run_id=? LEFT JOIN request_item_results i ON i.item_id=r.item_id AND i.assessment_id=r.assessment_id WHERE r.order_id=? AND r.state='committed' ORDER BY r.rowid`).all(ctx.projectId,ctx.runId,orderId) as any[];
 const selectedSources=new Map<string,Set<number>>();const suggestions:any[]=[];
 for(const i of items){
  if(i.source_id){if(!selectedSources.has(i.source_id))selectedSources.set(i.source_id,new Set());selectedSources.get(i.source_id)!.add(i.source_version);}
  if(!i.result_json){gaps.push({kind:'item_result_missing',resourceId:i.item_id,detail:'Original model suggestion unavailable'});continue;}
  const result=parse(i.result_json,'Request item result');suggestions.push({itemId:i.item_id,assessmentId:i.assessment_id,sourceId:i.source_id,sourceVersion:i.source_version,classification:result.classification??null,requestedDeliverable:result.requestedDeliverable??null,requestQuote:result.requestQuote??null,provenance:'model_suggestion; approval remains the separate human decision',recordedAt:i.created_at});
 }
 const sources:any[]=[];
 for(const [id,versions] of selectedSources){
  const identity=db.prepare('SELECT project_id,run_id FROM request_sources WHERE id=?').get(id) as any;if(identity&&(identity.project_id!==ctx.projectId||identity.run_id!==ctx.runId))fail('Request source scope association integrity check failed');
  const row=db.prepare('SELECT s.*,f.state availability,f.reason unavailable_reason FROM request_sources s LEFT JOIN request_source_freshness f ON f.source_id=s.id WHERE s.id=? AND s.project_id=? AND s.run_id=?').get(id,ctx.projectId,ctx.runId) as any;
  if(!row){gaps.push({kind:'request_source_missing',resourceId:id,detail:'Retained source identity unavailable'});sources.push({id,available:false,versions:[]});continue;}
  sources.push({id,available:true,source:row.source,fileKey:row.file_key||null,rootId:row.root_id,currentVersion:row.version,currentAvailability:row.availability??'not_marked_unavailable',provenance:row.source==='figma'?'stored_authoritative_thread_projection':'provided_portal_request',versions:[...versions].sort((a,b)=>a-b).map(version=>{
   const saved=db.prepare('SELECT * FROM request_source_versions WHERE source_id=? AND version=?').get(id,version) as any;
   if(!saved){gaps.push({kind:'request_source_version_missing',resourceId:id+':'+version,detail:'Historical requested content unavailable; no current-source substitution'});return {version,available:false,messages:[],sourceHash:null};}
   const messages=parse(saved.messages_json,'Request source version');if(contentHash(messages)!==saved.content_hash)fail('Request source hash integrity check failed');
   return {version,available:true,sourceHash:saved.content_hash,recordedAt:saved.created_at,messages:messages.map((m:any)=>({id:m.id,message:m.message??m.text??'',recordedAt:m.createdAt??null,verifiedPersonalIdentity:false}))};
  })});
 }
 const requests=(db.prepare(`SELECT DISTINCT a.*,CASE WHEN l.request_id IS NULL THEN 'legacy_primary_pointer_inferred' ELSE 'recorded_proposal_link' END link_provenance FROM agent_requests a LEFT JOIN request_order_links l ON l.request_id=a.id AND l.run_id=a.run_id AND l.order_id=? WHERE a.run_id=? AND (l.order_id IS NOT NULL OR (a.order_id=? AND NOT EXISTS(SELECT 1 FROM request_order_links other WHERE other.request_id=a.id AND other.run_id=a.run_id))) ORDER BY a.created_at,a.id`).all(orderId,ctx.runId,orderId) as any[]).map(r=>({id:r.id,source:r.source,rootId:r.source_id,providedText:r.text,linkProvenance:r.link_provenance,provenance:'provided_request; messages do not authorize scope or payment',messages:(db.prepare('SELECT id,actor,body,created_at FROM agent_messages WHERE request_id=? AND run_id=? ORDER BY created_at,id').all(r.id,ctx.runId) as any[]).map(m=>({id:m.id,role:['client','designer','agent'].includes(m.actor)?m.actor:'unknown',text:m.body,recordedAt:m.created_at,provenance:m.actor==='agent'?'historical_application_message; not independent payment proof':'provided_statement'}))}));
 const evidenceIds=new Set<string>();for(const i of items)for(const row of db.prepare('SELECT snapshot_id FROM assessment_evidence WHERE assessment_id=? AND run_id=?').all(i.assessment_id,ctx.runId))evidenceIds.add(String(row.snapshot_id));
 const designEvidence:any[]=[];
 for(const id of evidenceIds){const row=db.prepare('SELECT * FROM design_evidence_snapshots WHERE id=? AND project_id=? AND run_id=?').get(id,ctx.projectId,ctx.runId) as any;if(!row){gaps.push({kind:'design_evidence_missing',resourceId:id,detail:'Selected design evidence metadata unavailable'});continue;}const value=parse(row.snapshot_json,'Design evidence'),{hash,...body}=value;if(hash!==row.hash||contentHash(body)!==row.hash)fail('Design evidence hash integrity check failed');designEvidence.push({id,sourceId:value.sourceId,sourceVersion:value.sourceVersion,sourceHash:value.sourceHash,fileKey:value.fileKey,nodeIds:value.nodeIds,capturedAt:value.capturedAt,receivedAt:value.receivedAt,verification:value.verification,pixelProvenance:value.pixelProvenance,imageHash:value.imageHash,sourceHashOfSnapshot:row.hash,pixelsIncluded:false});}
 const deliveries=(db.prepare('SELECT * FROM delivery_runs WHERE order_id=? AND project_id=? AND run_id=? ORDER BY rowid').all(orderId,ctx.projectId,ctx.runId) as any[]).map(run=>{
  const brief=parse(run.brief_json,'Delivery brief');if(contentHash(brief)!==run.brief_hash||brief.orderId!==orderId||brief.projectId!==ctx.projectId||brief.runId!==ctx.runId)fail('Delivery brief hash or association integrity check failed');
  const snapshots=(db.prepare('SELECT * FROM delivery_snapshots WHERE delivery_run_id=? AND project_id=? AND run_id=? ORDER BY rowid').all(run.id,ctx.projectId,ctx.runId) as any[]).map(row=>{
   const s=parse(row.snapshot_json,'Delivery snapshot');if(s.hash!==row.hash||s.deliveryRunId!==run.id||contentHash({operationId:run.operation_id,fileKey:s.fileKey,pageId:s.pageId,areaId:s.areaId,nodes:s.nodes,imageHash:s.imageHash})!==row.hash||contentHash(s.nodeIds)!==contentHash(s.nodes?.map((n:any)=>n.id)))fail('Delivery snapshot hash integrity check failed');
   if(s.pixelProvenance!=='client_supplied'||s.nodeProvenance!=='client_plugin_claim'||s.fileKey!==brief.allowedArea?.fileKey)fail('Delivery snapshot provenance or allowed-file integrity check failed');
   if(row.png?.length&&sha(row.png)!==s.imageHash)fail('Delivery image hash integrity check failed');if(!row.png?.length)gaps.push({kind:'delivery_image_unavailable',resourceId:s.id,detail:'Image bytes unavailable after interrupted restore; metadata/hash retained'});
   return {id:s.id,hash:s.hash,imageHash:s.imageHash,fileKey:s.fileKey,pageId:s.pageId,areaId:s.areaId,nodeIds:s.nodeIds,capturedAt:s.capturedAt,receivedAt:s.receivedAt,nodeProvenance:s.nodeProvenance,pixelProvenance:s.pixelProvenance,pixelsIncluded:false,imageBytesAvailable:!!row.png?.length};
  });
  const reviews=db.prepare('SELECT * FROM delivery_reviews WHERE milestone_id=? AND order_id=? ORDER BY review_revision').all(run.milestone_id,orderId) as any[];
  for(const review of reviews){const s=snapshots.find(s=>s.id===review.snapshot_id);if(s&&s.hash!==review.snapshot_hash)fail('Reviewed snapshot hash integrity check failed');if(!s)gaps.push({kind:'review_snapshot_missing',resourceId:review.snapshot_id,detail:'Referenced delivery snapshot unavailable; review decision retained'});}
  const acceptances=(db.prepare('SELECT * FROM delivery_acceptances WHERE milestone_id=? AND order_id=? ORDER BY created_at,id').all(run.milestone_id,orderId) as any[]).map(a=>{
   const review=reviews.find(r=>r.id===a.review_id);if(review&&(a.snapshot_id!==review.snapshot_id||a.snapshot_hash!==review.snapshot_hash||a.review_revision!==review.review_revision||a.order_revision!==review.order_revision))fail('Acceptance snapshot/revision integrity check failed');if(!review)gaps.push({kind:'accepted_review_missing',resourceId:a.review_id,detail:'Acceptance retained; exact review metadata unavailable'});
   return {id:a.id,reviewId:a.review_id,orderRevision:a.order_revision,reviewRevision:a.review_revision,snapshotId:a.snapshot_id,snapshotHash:a.snapshot_hash,acceptedAt:a.created_at,authority:'demo_client_delivery_grant',verifiedPersonalIdentity:false};
  });
  const events=(db.prepare('SELECT e.* FROM delivery_events e JOIN delivery_reviews r ON r.id=e.review_id WHERE r.milestone_id=? AND r.order_id=? ORDER BY e.rowid').all(run.milestone_id,orderId) as any[]).map(e=>{
   const b=parse(e.body_json,'Delivery event');return {id:e.id,reviewId:e.review_id,kind:e.kind,recordedAt:e.created_at,decision:{comment:b.comment??null,snapshotId:b.snapshotId??null,snapshotHash:b.snapshotHash??null,reviewRevision:b.reviewRevision??null,acceptanceCriteria:b.acceptanceCriteria??null,replacementReviewId:b.replacementReviewId??null}};
  });
  return {id:run.id,milestoneId:run.milestone_id,orderRevision:run.revision,briefHash:run.brief_hash,brief:{title:brief.title,deliverables:brief.deliverables,acceptanceCriteria:brief.acceptanceCriteria,requestReferences:brief.requestReferences,evidenceReferences:brief.evidenceReferences,relevantNodeIds:brief.relevantNodeIds,paymentCondition:brief.paymentCondition,allowedArea:brief.allowedArea},snapshots,reviews:reviews.map(r=>({id:r.id,revision:r.review_revision,orderRevision:r.order_revision,snapshotId:r.snapshot_id,snapshotHash:r.snapshot_hash,acceptanceCriteria:parse(r.criteria_json,'Review criteria'),state:r.state,submittedAt:r.submitted_at})),acceptances,events};
 });
 const invoices=(db.prepare(`SELECT r.*,m.title,m.local_id,m.amount_minor,m.due_trigger,m.legacy FROM invoice_records r JOIN milestones m ON m.id=r.milestone_id WHERE r.order_id=? AND r.project_id=? AND r.run_id=? AND r.revision IN (SELECT change_order_revision FROM approvals WHERE change_order_id=r.order_id AND actor_role='client') ORDER BY r.rowid`).all(orderId,ctx.projectId,ctx.runId) as any[]).map(r=>{
  const terms=r.terms_json?parse(r.terms_json,'Invoice terms'):null;
  const observations=(db.prepare('SELECT * FROM payment_observations WHERE change_order_id=? AND (invoice_record_id=? OR (invoice_record_id IS NULL AND paypal_invoice_id=?)) ORDER BY id').all(orderId,r.id,r.provider_id) as any[]).map(o=>{
   if(r.provider_id&&o.paypal_invoice_id!==r.provider_id)fail('Payment observation invoice association integrity check failed');
   const f=o.financial_json?parse(o.financial_json,'Payment observation'):null,external=/EXTERNAL|MARKED_AS/.test(o.raw_status)||f?.paymentState==='review_required';
   return {id:o.id,invoiceRecordId:r.id,providerInvoiceId:o.paypal_invoice_id,rawStatus:o.raw_status,paymentState:f?.paymentState??'unknown',invoiceState:f?.invoiceState??'unknown',amountDueMinor:o.amount_due_minor??null,paidMinor:f?.paidMinor??null,refundedMinor:f?.refundedMinor??null,observedAt:o.checked_at,settlementProvenance:external?'external_or_unverified':f?.paymentState==='paid'?'provider_reported_paypal':'recorded_provider_observation',applicationProcessedPayment:false,issues:f?.issues??[]};
  });
  return {invoiceRecordId:r.id,milestoneId:r.milestone_id,localId:r.local_id,orderRevision:r.revision,title:r.title,amountMinor:r.amount_minor,dueTrigger:r.due_trigger,legacy:!!r.legacy,providerInvoiceId:r.provider_id??null,invoiceNumber:terms?.invoiceNumber??null,representation:terms?.representation??'unknown',adoptionIssue:r.adoption_issue??null,operationState:r.state,observations,latestObservationId:observations.at(-1)?.id??null};
 });
 return {order:{id:order.id,revision:order.revision,approvalState:order.approvalStatus,applicationStatus:order.status,currency:order.currency},proposals,scopes,rates,sources,requests,modelSuggestions:suggestions,designEvidence,deliveries,invoices,paymentSummary:order.installmentSummary??null};
}
function render(packet:any){
 const pretty=(v:any)=>esc(JSON.stringify(v,null,2));
 const section=(title:string,value:any)=>`<section><h2>${esc(title)}</h2><pre>${pretty(value)}</pre></section>`;
 const money=(n:unknown,currency='USD')=>Number.isSafeInteger(n)&&/^[A-Z]{3}$/.test(currency)?esc(new Intl.NumberFormat('en-US',{style:'currency',currency}).format(Number(n)/100)):'Unknown / requires review';
 const proposal=packet.facts.proposals.find((p:any)=>p.revision===packet.revision),summary=packet.facts.paymentSummary;
 const overview=`<section><h2>${esc(proposal?.terms?.title??'Approved order')}</h2><p>Proposal revision ${packet.revision}. Approved total: <strong>${money(proposal?.terms?.totalMinor,proposal?.terms?.currency)}</strong>.</p><p>Net paid: ${money(summary?.netPaidMinor)} · Payable now: ${money(summary?.payableDueMinor)} · Future unbilled: ${money(summary?.futureUnbilledMinor)} · Refunded: ${money(summary?.refundedMinor)}</p><p>Amounts use one latest observation per invoice. An unknown amount remains qualified.</p><h3>Agreed deliverables</h3><ul>${(proposal?.terms?.deliverables??[]).map((d:string)=>`<li>${esc(d)}</li>`).join('')}</ul><h3>Installment obligations and latest observations</h3>${packet.facts.invoices.map((i:any)=>{const o=i.observations.at(-1);return `<article><h4>${esc(i.title)} · ${money(i.amountMinor)}</h4><p>Due trigger: ${esc(i.dueTrigger)}. Invoice: ${esc(i.providerInvoiceId??'Not issued')}. Latest recorded status: ${esc(o?.rawStatus??'Unavailable')} at ${esc(o?.observedAt??'unknown time')}.</p><p>${esc(o?.settlementProvenance??'No payment observation')}. Application-processed payment: no.</p></article>`;}).join('')}</section>`;
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Evidence packet ${esc(packet.id)}</title><style>body{font:16px/1.5 system-ui,sans-serif;color:#152d37;max-width:1000px;margin:auto;padding:24px}section{border:1px solid #ccd8d6;border-radius:8px;padding:16px;margin:16px 0}h1{font-size:26px}h2{font-size:20px}pre{font:13px/1.5 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere}p,li,h2,h4{overflow-wrap:anywhere}article{border-top:1px solid #ccd8d6;margin-top:12px}</style></head><body><h1>Factual scope and delivery evidence</h1><p>Packet ${esc(packet.id)} · Version 1 · Created ${esc(packet.createdAt)}</p><p>Supplied statements, stored observations, model suggestions and recorded human decisions have distinct provenance. Demo access does not verify personal identity. An approval or acceptance does not establish payment, settlement or proof that a client viewed an artifact.</p>${overview}${section('Approved revisions and recorded consent',packet.facts.proposals)}${section('Provided original scope and separate acknowledgements',packet.facts.scopes)}${section('Referenced rates',packet.facts.rates)}${section('Exact request source versions',packet.facts.sources)}${section('Provided request history',packet.facts.requests)}${section('Model suggestions — not human decisions',packet.facts.modelSuggestions)}${section('Design metadata — client-supplied image provenance',packet.facts.designEvidence)}${section('Delivery versions and append-only human decisions',packet.facts.deliveries)}${section('Per-invoice provider observations — no app-processed settlement claim',packet.facts.invoices)}${section('Latest-observation payment summary (historical rows are not summed)',packet.facts.paymentSummary)}${section('Missing evidence and limits',packet.gaps)}<section><h2>Limitations</h2><ul>${packet.limitations.map((v:string)=>`<li>${esc(v)}</li>`).join('')}</ul></section></body></html>`;
}
/** Synchronous snapshot of selected stored facts. No provider, model, job or outbound work. */
export function buildEvidencePacket(ctx:ActorContext,orderId:string):EvidencePacket {
 scoped(ctx,orderId);
 return transaction(()=>{
  const gaps:Gap[]=[],facts=gather(ctx,orderId,gaps),redaction=redactor(ctx),clean=redaction.visit(facts),id=randomUUID(),createdAt=new Date().toISOString();
  const packet={schemaVersion:1 as const,id,projectId:ctx.projectId,runId:ctx.runId,orderId,revision:facts.order.revision,createdAt,facts:clean,gaps:redaction.visit(gaps),redaction:{applied:redaction.applied,policy:'Whitelisted stored facts; credentials, private/public URLs, emails, provider internals, hidden reasoning and unrelated records omitted'},disputeDraft:{available:false,reason:'No verified matched dispute/payment record is present; provider submission and refunds require separately reviewed actions'},limitations:[
   'This is a point-in-time export of stored evidence, not a fresh provider retrieval or independent verification.',
   'Provided agreements and statements, model suggestions, recorded role-based decisions and provider observations are distinct facts.',
   'Demo client/designer access is not verified personal identity. No client-viewing telemetry is asserted.',
   'Plugin node metadata and image hashes retain client-supplied provenance. Pixel bytes are omitted; inspect the exact image in the authenticated application.',
   'The application records payment observations; it does not process or settle funds. External/marked-as-paid/refunded states remain unverified.',
   'Cancellation, refunds, replaced delivery and missing records remain visible. Historical observations are never added together.',
   'Secrets/links may be redacted from supplied text; original source hashes identify retained originals, not the redacted quotation.',
  ]};
  const json=JSON.stringify(packet,null,2),html=render(packet);if(Buffer.byteLength(json)+Buffer.byteLength(html)>4_000_000)fail('Evidence packet exceeds the bounded export size; review the selected order history');
  const manifest:EvidencePacketManifest={schemaVersion:1,packetId:id,projectId:ctx.projectId,runId:ctx.runId,orderId,revision:packet.revision,createdAt,algorithm:'sha256',files:[{name:'packet.json',mediaType:'application/json',sha256:sha(json),bytes:Buffer.byteLength(json)},{name:'packet.html',mediaType:'text/html',sha256:sha(html),bytes:Buffer.byteLength(html)}]};
  scoped(ctx,orderId);db.prepare('INSERT INTO evidence_packets VALUES(?,?,?,?,?,?,?,?,?)').run(id,ctx.projectId,ctx.runId,orderId,packet.revision,JSON.stringify(manifest),json,html,createdAt);
  return {...packet,manifest,previewHtml:html};
 });
}
function stored(ctx:ActorContext,id:string){
 requireDesignerContext(ctx);const row=db.prepare('SELECT * FROM evidence_packets WHERE id=? AND project_id=? AND run_id=?').get(id,ctx.projectId,ctx.runId) as any;
 if(!row)throw new ScopedAccessError(404,'Evidence packet not found');scoped(ctx,row.order_id);
 const manifest=parse(row.manifest_json,'Packet manifest') as EvidencePacketManifest;
 if(manifest.packetId!==row.id||manifest.projectId!==ctx.projectId||manifest.runId!==ctx.runId||manifest.orderId!==row.order_id||manifest.revision!==row.revision||manifest.files?.length!==2)fail('Evidence packet association integrity check failed');
 for(const name of ['packet.json','packet.html']){const text=name==='packet.json'?row.json_text:row.html_text,entry=manifest.files.find(f=>f.name===name);if(!entry||typeof text!=='string'||!text||sha(text)!==entry.sha256||Buffer.byteLength(text)!==entry.bytes)fail('Evidence packet is incomplete or changed; integrity check failed');}
 const packet=parse(row.json_text,'Packet JSON');if(packet.id!==row.id||packet.projectId!==ctx.projectId||packet.runId!==ctx.runId||packet.orderId!==row.order_id||packet.revision!==row.revision)fail('Evidence packet JSON association integrity check failed');return {row,manifest,packet};
}
export function getEvidencePacket(ctx:ActorContext,id:string):EvidencePacket {const {row,manifest,packet}=stored(ctx,id);return {...packet,manifest,previewHtml:row.html_text};}
export function evidencePacketFile(ctx:ActorContext,id:string,name:string){
 const {row,manifest}=stored(ctx,id);
 if(name==='manifest.json')return {text:JSON.stringify(manifest,null,2),mediaType:'application/json',filename:`scope-settle-${id}-manifest.json`};
 if(!['packet.json','packet.html'].includes(name))throw new ScopedAccessError(404,'Evidence file not found');
 return {text:name==='packet.json'?row.json_text:row.html_text,mediaType:name==='packet.json'?'application/json':'text/html',filename:`scope-settle-${id}.${name==='packet.json'?'json':'html'}`};
}
