import {createHash,randomUUID} from 'node:crypto';
import {db,transaction} from './db.js';
import {requireDesignerContext,ScopedAccessError,type ActorContext} from './context.js';
import {getScopedOrder} from './changeOrderService.js';
import {contentHash} from './scopePersistence.js';
import {validateEvidencePng} from './designEvidence.js';
import {config} from './env.js';
import type {EvidenceImageChoice,EvidenceImageChoicesView,EvidencePacket,EvidencePacketAttachment,EvidencePacketManifest,PacketImageSelection} from '../shared/types.js';

const sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function fail(message:string):never {throw new ScopedAccessError(409,message);}
function invalid(message:string):never {throw new ScopedAccessError(400,message);}
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
   .replace(/(?<![a-zA-Z0-9_-])[a-zA-Z0-9_-]{32,256}(?![a-zA-Z0-9_-])/g,v=>digests.has(sha(v))?'[credential omitted]':v);
  if(out.includes('@'))out=out.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,'[email omitted]');
  if(out!==value)applied=true;return out;
 };
 const visit=(v:any):any=>typeof v==='string'?clean(v):Array.isArray(v)?v.map(visit):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,visit(x)])):v;
 return {visit,get applied(){return applied;}};
}
function terms(snapshot:any){
 return {title:snapshot.title??null,deliverables:snapshot.deliverables??[],lineItems:(snapshot.lineItems??[]).map((i:any)=>({description:i.description,quantity:i.quantity,unitAmountMinor:i.unitAmountMinor,priceSource:i.priceSource??'unknown',rateCardId:i.rateCardId??null})),totalMinor:snapshot.totalMinor??null,currency:snapshot.currency??null,milestoneSchedule:snapshot.milestoneSchedule??null};
}

export function listEvidenceImageChoices(ctx:ActorContext,orderId:string):EvidenceImageChoicesView {
 const order=scoped(ctx,orderId);
 if(order.approvalStatus!=='approved')fail('Select an approved order for its factual evidence packet');
 const rows=db.prepare(`SELECT r.*,m.title milestone_title,d.id run_id_ref,d.operation_id,d.brief_json,d.brief_hash FROM delivery_reviews r JOIN delivery_review_heads h ON h.milestone_id=r.milestone_id AND h.review_id=r.id AND h.revision=r.review_revision JOIN delivery_runs d ON d.milestone_id=r.milestone_id AND d.order_id=r.order_id AND d.revision=r.order_revision LEFT JOIN milestones m ON m.id=r.milestone_id WHERE r.order_id=? AND r.order_revision=? AND r.project_id=? AND r.run_id=? AND r.state<>'superseded' ORDER BY d.rowid,r.review_revision`).all(orderId,order.revision,ctx.projectId,ctx.runId) as any[];
 const choices:EvidenceImageChoice[]=rows.map(r=>{
  const brief=parse(r.brief_json,'Delivery brief');
  if(contentHash(brief)!==r.brief_hash||brief.orderId!==orderId||brief.projectId!==ctx.projectId||brief.runId!==ctx.runId)fail('Delivery brief hash or association integrity check failed');
  const snapRow=db.prepare('SELECT * FROM delivery_snapshots WHERE id=? AND delivery_run_id=? AND project_id=? AND run_id=?').get(r.snapshot_id,r.run_id_ref,ctx.projectId,ctx.runId) as any;
  if(!snapRow)fail('Reviewed delivery snapshot is unavailable');
  const s=parse(snapRow.snapshot_json,'Delivery snapshot');
  if(s.id!==snapRow.id||s.hash!==snapRow.hash||s.hash!==r.snapshot_hash||s.deliveryRunId!==r.run_id_ref||contentHash({operationId:r.operation_id,fileKey:s.fileKey,pageId:s.pageId,areaId:s.areaId,nodes:s.nodes,imageHash:s.imageHash})!==snapRow.hash||contentHash(s.nodeIds)!==contentHash(s.nodes?.map((n:any)=>n.id)))fail('Delivery snapshot hash integrity check failed');
  if(s.pixelProvenance!=='client_supplied'||s.nodeProvenance!=='client_plugin_claim'||s.fileKey!==brief.allowedArea?.fileKey)fail('Delivery snapshot provenance or allowed-file integrity check failed');
  const hasBytes=!!snapRow.png?.byteLength;
  if(hasBytes&&sha(snapRow.png)!==s.imageHash)fail('Delivery image hash integrity check failed');
  const acc=db.prepare('SELECT * FROM delivery_acceptances WHERE review_id=? AND milestone_id=? AND order_id=?').get(r.id,r.milestone_id,orderId) as any;
  if(acc&&(acc.snapshot_id!==r.snapshot_id||acc.snapshot_hash!==r.snapshot_hash||acc.review_revision!==r.review_revision||acc.order_revision!==r.order_revision))fail('Acceptance snapshot/revision integrity check failed');
  const accepted=r.state==='accepted'&&!!acc;
  return {
   milestoneId:r.milestone_id,
   milestoneTitle:String(r.milestone_title??brief.title??r.milestone_id),
   reviewId:r.id,
   reviewRevision:r.review_revision,
   revision:r.review_revision,
   orderRevision:r.order_revision,
   state:r.state,
   accepted,
   acceptedAt:accepted?acc.created_at:null,
   snapshotId:s.id,
   snapshotHash:s.hash,
   imageHash:s.imageHash,
   imageState:hasBytes?'available':'unavailable',
   imageBytesAvailable:hasBytes,
   imageBytes:hasBytes?snapRow.png.byteLength:0,
   width:s.width??null,
   height:s.height??null,
   pixelProvenance:'client_supplied',
   nodeProvenance:'client_plugin_claim',
   previewPath:'/api/delivery-snapshots/'+s.id,
  };
 });
 return {orderId:order.id,orderRevision:order.revision,revision:order.revision,choices};
}

function resolveSelections(ctx:ActorContext,orderId:string,orderRevision:number,options:{expectedRevision:number;images:PacketImageSelection[];imagesReviewed:true}){
 if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['expectedRevision','images','imagesReviewed'].includes(k)))invalid('Exact expectedRevision, images and imagesReviewed acknowledgment are required');
 if(options.imagesReviewed!==true)invalid('Explicit acknowledgement that selected delivery images were reviewed is required');
 if(!Number.isSafeInteger(options.expectedRevision)||options.expectedRevision<=0)invalid('Exact expected order revision is required');
 if(options.expectedRevision!==orderRevision)fail('Order revision changed; review current delivery images before exporting');
 if(!Array.isArray(options.images)||options.images.length===0)invalid('Select at least one reviewed delivery image or build a metadata-only packet');
 if(options.images.length>4)invalid('At most four reviewed delivery images may be attached to an evidence packet');
 const seenReviews=new Set<string>(),seenSnapshots=new Set<string>();
 const attachments:EvidencePacketAttachment[]=[],pngByHash=new Map<string,Uint8Array>();
 for(const sel of options.images){
  if(!sel||typeof sel!=='object'||Array.isArray(sel)||Object.keys(sel).some(k=>!['reviewId','reviewRevision','snapshotId','snapshotHash'].includes(k)))invalid('Each image selection requires reviewId, reviewRevision, snapshotId and snapshotHash');
  if(typeof sel.reviewId!=='string'||!sel.reviewId.trim()||!Number.isSafeInteger(sel.reviewRevision)||sel.reviewRevision<=0||typeof sel.snapshotId!=='string'||!sel.snapshotId.trim()||typeof sel.snapshotHash!=='string'||!/^[0-9a-f]{64}$/.test(sel.snapshotHash))invalid('Invalid image selection reference');
  if(seenReviews.has(sel.reviewId)||seenSnapshots.has(sel.snapshotId))invalid('Duplicate delivery review or snapshot selection is not permitted');
  seenReviews.add(sel.reviewId);seenSnapshots.add(sel.snapshotId);
  const review=db.prepare('SELECT * FROM delivery_reviews WHERE id=?').get(sel.reviewId) as any;
  if(!review||review.project_id!==ctx.projectId||review.run_id!==ctx.runId||review.order_id!==orderId)fail('Selected delivery review does not belong to this scoped order');
  const head=db.prepare('SELECT * FROM delivery_review_heads WHERE milestone_id=?').get(review.milestone_id) as any;
  if(review.order_revision!==orderRevision||review.review_revision!==sel.reviewRevision||head?.review_id!==review.id||head?.revision!==review.review_revision||review.state==='superseded')fail('Selected delivery review is stale or was replaced; preview the current review before exporting');
  if(review.snapshot_id!==sel.snapshotId||review.snapshot_hash!==sel.snapshotHash)fail('Selected delivery snapshot does not match the current delivery review');
  const run=db.prepare('SELECT * FROM delivery_runs WHERE milestone_id=? AND order_id=? AND revision=? AND project_id=? AND run_id=?').get(review.milestone_id,orderId,orderRevision,ctx.projectId,ctx.runId) as any;
  const snapRow=run?db.prepare('SELECT * FROM delivery_snapshots WHERE id=? AND delivery_run_id=? AND project_id=? AND run_id=?').get(sel.snapshotId,run.id,ctx.projectId,ctx.runId) as any:null;
  if(!run||!snapRow)fail('Selected delivery snapshot is unavailable');
  const brief=parse(run.brief_json,'Delivery brief'),s=parse(snapRow.snapshot_json,'Delivery snapshot');
  if(s.id!==snapRow.id||s.deliveryRunId!==run.id||contentHash(brief)!==run.brief_hash||s.hash!==snapRow.hash||s.hash!==sel.snapshotHash||contentHash({operationId:run.operation_id,fileKey:s.fileKey,pageId:s.pageId,areaId:s.areaId,nodes:s.nodes,imageHash:s.imageHash})!==snapRow.hash||contentHash(s.nodeIds)!==contentHash(s.nodes?.map((n:any)=>n.id)))fail('Delivery snapshot hash integrity check failed');
  if(s.pixelProvenance!=='client_supplied'||s.nodeProvenance!=='client_plugin_claim'||s.fileKey!==brief.allowedArea?.fileKey)fail('Delivery snapshot provenance or allowed-file integrity check failed');
  if(!snapRow.png?.byteLength)fail('Selected delivery image bytes are unavailable; use metadata-only export or restore the snapshot');
  if(snapRow.png.byteLength>1_500_000)fail('Selected delivery image exceeds the 1,500,000-byte PNG limit');
  if(sha(snapRow.png)!==s.imageHash||!/^[0-9a-f]{64}$/.test(s.imageHash))fail('Delivery image hash integrity check failed');
  const validated=validateEvidencePng('data:image/png;base64,'+Buffer.from(snapRow.png).toString('base64'));
  if(validated.hash!==s.imageHash||validated.bytes.byteLength!==snapRow.png.byteLength)fail('Delivery image validation integrity check failed');
  const acc=db.prepare('SELECT * FROM delivery_acceptances WHERE review_id=? AND milestone_id=? AND order_id=?').get(review.id,review.milestone_id,orderId) as any;
  if(acc&&(acc.snapshot_id!==review.snapshot_id||acc.snapshot_hash!==review.snapshot_hash||acc.review_revision!==review.review_revision||acc.order_revision!==review.order_revision))fail('Acceptance snapshot/revision integrity check failed');
  if(review.state==='accepted'&&!acc)fail('Accepted review record is incomplete');
  const accepted=review.state==='accepted'&&!!acc;
  const milestone=db.prepare('SELECT title FROM milestones WHERE id=? AND order_id=?').get(review.milestone_id,orderId) as any;
  const fileName=`image-${s.imageHash}.png`;
  if(!pngByHash.has(s.imageHash))pngByHash.set(s.imageHash,new Uint8Array(validated.bytes));
  attachments.push({
   milestoneId:review.milestone_id,
   milestoneTitle:String(milestone?.title??brief.title??review.milestone_id),
   reviewId:review.id,
   reviewRevision:review.review_revision,
   orderRevision:review.order_revision,
   reviewState:review.state,
   accepted,
   acceptedAt:accepted?acc.created_at:null,
   acceptanceId:accepted?acc.id:null,
   snapshotId:s.id,
   snapshotHash:s.hash,
   imageHash:s.imageHash,
   fileName,
   mediaType:'image/png',
   bytes:validated.bytes.byteLength,
   width:s.width??validated.width??null,
   height:s.height??validated.height??null,
   pixelProvenance:'client_supplied',
   nodeProvenance:'client_plugin_claim',
   independentVerification:false,
   automaticRedactionApplied:false,
   imagesReviewedByDesigner:true,
  });
 }
 return {attachments,pngByHash,selectedSnapshotIds:seenSnapshots};
}

function gather(ctx:ActorContext,orderId:string,gaps:Gap[],selectedSnapshotIds=new Set<string>()){
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
   const s=parse(row.snapshot_json,'Delivery snapshot');if(s.id!==row.id||s.hash!==row.hash||s.deliveryRunId!==run.id||contentHash({operationId:run.operation_id,fileKey:s.fileKey,pageId:s.pageId,areaId:s.areaId,nodes:s.nodes,imageHash:s.imageHash})!==row.hash||contentHash(s.nodeIds)!==contentHash(s.nodes?.map((n:any)=>n.id)))fail('Delivery snapshot hash integrity check failed');
   if(s.pixelProvenance!=='client_supplied'||s.nodeProvenance!=='client_plugin_claim'||s.fileKey!==brief.allowedArea?.fileKey)fail('Delivery snapshot provenance or allowed-file integrity check failed');
   if(row.png?.length&&sha(row.png)!==s.imageHash)fail('Delivery image hash integrity check failed');if(!row.png?.length)gaps.push({kind:'delivery_image_unavailable',resourceId:s.id,detail:'Image bytes unavailable after interrupted restore; metadata/hash retained'});
   return {id:s.id,hash:s.hash,imageHash:s.imageHash,fileKey:s.fileKey,pageId:s.pageId,areaId:s.areaId,nodeIds:s.nodeIds,capturedAt:s.capturedAt,receivedAt:s.receivedAt,nodeProvenance:s.nodeProvenance,pixelProvenance:s.pixelProvenance,pixelsIncluded:selectedSnapshotIds.has(s.id),imageBytesAvailable:!!row.png?.length};
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
function render(packet:any,pngByHash?:Map<string,Uint8Array>){
 const pretty=(v:any)=>esc(JSON.stringify(v,null,2));
 const section=(title:string,value:any)=>`<section><h2>${esc(title)}</h2><pre>${pretty(value)}</pre></section>`;
 const money=(n:unknown,currency='USD')=>Number.isSafeInteger(n)&&/^[A-Z]{3}$/.test(currency)?esc(new Intl.NumberFormat('en-US',{style:'currency',currency}).format(Number(n)/100)):'Unknown / requires review';
 const proposal=packet.facts.proposals.find((p:any)=>p.revision===packet.revision),summary=packet.facts.paymentSummary;
 const overview=`<section><h2>${esc(proposal?.terms?.title??'Approved order')}</h2><p>Proposal revision ${packet.revision}. Approved total: <strong>${money(proposal?.terms?.totalMinor,proposal?.terms?.currency)}</strong>.</p><p>Net paid: ${money(summary?.netPaidMinor)} · Payable now: ${money(summary?.payableDueMinor)} · Future unbilled: ${money(summary?.futureUnbilledMinor)} · Refunded: ${money(summary?.refundedMinor)}</p><p>Amounts use one latest observation per invoice. An unknown amount remains qualified.</p><h3>Agreed deliverables</h3><ul>${(proposal?.terms?.deliverables??[]).map((d:string)=>`<li>${esc(d)}</li>`).join('')}</ul><h3>Installment obligations and latest observations</h3>${packet.facts.invoices.map((i:any)=>{const o=i.observations.at(-1);return `<article><h4>${esc(i.title)} · ${money(i.amountMinor)}</h4><p>Due trigger: ${esc(i.dueTrigger)}. Invoice: ${esc(i.providerInvoiceId??'Not issued')}. Latest recorded status: ${esc(o?.rawStatus??'Unavailable')} at ${esc(o?.observedAt??'unknown time')}.</p><p>${esc(o?.settlementProvenance??'No payment observation')}. Application-processed payment: no.</p></article>`;}).join('')}</section>`;
 const isV2=packet.schemaVersion===2&&Array.isArray(packet.attachedImages)&&packet.attachedImages.length>0;
 const csp=isV2?"default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'":"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
 const imageSection=isV2?`<section><h2>Reviewed delivery image attachments</h2><p>Each PNG below was explicitly previewed and selected by the designer from immutable stored delivery snapshots. Provenance remains client_supplied / client_plugin_claim; pixel contents are not automatically redacted and are not independently verified rendering proof.</p>${packet.attachedImages.map((img:EvidencePacketAttachment)=>{
  const bytes=pngByHash?.get(img.imageHash);if(!bytes)fail('Selected delivery image bytes missing during HTML render');
  const dataUrl='data:image/png;base64,'+Buffer.from(bytes).toString('base64');
  const statusLabel=img.accepted?`Accepted delivery (review revision ${img.reviewRevision}, accepted ${esc(img.acceptedAt??'recorded')})`:`Unaccepted draft (review revision ${img.reviewRevision}, state: ${esc(img.reviewState)}) — not accepted by client`;
  return `<figure><h4>${esc(img.milestoneTitle)} · ${statusLabel}</h4><img src="${dataUrl}" alt="${esc(img.milestoneTitle)} snapshot ${esc(img.snapshotId)}"><figcaption>File: <code>${esc(img.fileName)}</code> · Snapshot: <code>${esc(img.snapshotId)}</code> (<code>${esc(img.snapshotHash)}</code>) · PNG SHA-256: <code>${esc(img.imageHash)}</code> (${img.bytes} bytes) · Provenance: ${esc(img.pixelProvenance)} / ${esc(img.nodeProvenance)}</figcaption></figure>`;
 }).join('')}</section>`:'';
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>Evidence packet ${esc(packet.id)}</title><style>*,*::before,*::after{box-sizing:border-box}body{font:16px/1.5 system-ui,sans-serif;color:#152d37;max-width:1000px;margin:auto;padding:24px;overflow-x:hidden}section{border:1px solid #ccd8d6;border-radius:8px;padding:16px;margin:16px 0}h1{font-size:26px}h2{font-size:20px}pre{font:13px/1.5 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere}p,li,h2,h4,figcaption,code{overflow-wrap:anywhere;word-break:break-word}article,figure{border-top:1px solid #ccd8d6;margin:12px 0 0;padding-top:12px}img{max-width:100%;height:auto;display:block;border:1px solid #ccd8d6;border-radius:6px;margin:8px 0}</style></head><body><h1>Factual scope and delivery evidence</h1><p>Packet ${esc(packet.id)} · Version ${packet.schemaVersion} · Created ${esc(packet.createdAt)}</p><p>Supplied statements, stored observations, model suggestions and recorded human decisions have distinct provenance. Demo access does not verify personal identity. An approval or acceptance does not establish payment, settlement or proof that a client viewed an artifact.</p>${overview}${imageSection}${section('Approved revisions and recorded consent',packet.facts.proposals)}${section('Provided original scope and separate acknowledgements',packet.facts.scopes)}${section('Referenced rates',packet.facts.rates)}${section('Exact request source versions',packet.facts.sources)}${section('Provided request history',packet.facts.requests)}${section('Model suggestions — not human decisions',packet.facts.modelSuggestions)}${section('Design metadata — client-supplied image provenance',packet.facts.designEvidence)}${section('Delivery versions and append-only human decisions',packet.facts.deliveries)}${section('Per-invoice provider observations — no app-processed settlement claim',packet.facts.invoices)}${section('Latest-observation payment summary (historical rows are not summed)',packet.facts.paymentSummary)}${section('Missing evidence and limits',{gaps:packet.gaps,redaction:packet.redaction,disputeDraft:packet.disputeDraft,limitations:packet.limitations})}</body></html>`;
}
/** Synchronous snapshot of selected stored facts. No provider, model, job or outbound work. */
export function buildEvidencePacket(ctx:ActorContext,orderId:string,options?:{expectedRevision:number;images:PacketImageSelection[];imagesReviewed:true}):EvidencePacket {
 scoped(ctx,orderId);
 return transaction(()=>{
  const order=scoped(ctx,orderId);
  if(order.approvalStatus!=='approved')fail('Select an approved order for its factual evidence packet');
  const resolved=options!==undefined?resolveSelections(ctx,orderId,order.revision,options):null;
  const gaps:Gap[]=[],facts=gather(ctx,orderId,gaps,resolved?.selectedSnapshotIds),redaction=redactor(ctx),clean=redaction.visit(facts),id=randomUUID(),createdAt=new Date().toISOString();
  const cleanAttachments=resolved?redaction.visit(resolved.attachments) as EvidencePacketAttachment[]:undefined;
  const schemaVersion=resolved?2 as const:1 as const;
  const packet:Omit<EvidencePacket,'manifest'|'previewHtml'>={
   schemaVersion,id,projectId:ctx.projectId,runId:ctx.runId,orderId,revision:facts.order.revision,createdAt,
   facts:cleanAttachments?{...clean,attachedImages:cleanAttachments}:clean,
   ...(cleanAttachments?{attachedImages:cleanAttachments}:{}),
   gaps:redaction.visit(gaps),
   redaction:{applied:redaction.applied,policy:'Whitelisted stored facts; credentials, private/public URLs, emails, provider internals, hidden reasoning and unrelated records omitted'},
   disputeDraft:{available:false,reason:'No verified matched dispute/payment record is present; provider submission and refunds require separately reviewed actions'},
   limitations:[
    'This is a point-in-time export of stored evidence, not a fresh provider retrieval or independent verification.',
    'Provided agreements and statements, model suggestions, recorded role-based decisions and provider observations are distinct facts.',
    'Demo client/designer access is not verified personal identity. No client-viewing telemetry is asserted.',
    resolved?'Plugin node metadata and attached PNG bytes retain client-supplied provenance (client_plugin_claim / client_supplied) without independent rendering verification or automatic image redaction; the designer explicitly reviewed and opted in to attach the selected delivery images.':'Plugin node metadata and image hashes retain client-supplied provenance. Pixel bytes are omitted; inspect the exact image in the authenticated application.',
    'The application records payment observations; it does not process or settle funds. External/marked-as-paid/refunded states remain unverified.',
    'Cancellation, refunds, replaced delivery and missing records remain visible. Historical observations are never added together.',
    'Secrets/links may be redacted from supplied text; original source hashes identify retained originals, not the redacted quotation.',
   ]
  };
  const json=JSON.stringify(packet,null,2),html=render(packet,resolved?.pngByHash);
  const imageFiles=resolved?[...resolved.pngByHash.entries()].map(([hash,bytes])=>({name:`image-${hash}.png`,mediaType:'image/png',sha256:hash,bytes:bytes.byteLength})):[];
  const manifest:EvidencePacketManifest={schemaVersion,packetId:id,projectId:ctx.projectId,runId:ctx.runId,orderId,revision:packet.revision,createdAt,algorithm:'sha256',files:[{name:'packet.json',mediaType:'application/json',sha256:sha(json),bytes:Buffer.byteLength(json)},{name:'packet.html',mediaType:'text/html',sha256:sha(html),bytes:Buffer.byteLength(html)},...imageFiles]};
  const manifestText=JSON.stringify(manifest);
  if(!resolved){
   if(Buffer.byteLength(json)+Buffer.byteLength(html)>4_000_000)fail('Evidence packet exceeds the bounded export size; review the selected order history');
  }else{
   const rawPngBytes=[...resolved.pngByHash.values()].reduce((sum,b)=>sum+b.byteLength,0);
   const totalBytes=Buffer.byteLength(json)+Buffer.byteLength(html)+Buffer.byteLength(JSON.stringify(manifest,null,2))+rawPngBytes;
   if(totalBytes>16_777_216)fail('Evidence packet with attached images exceeds the 16,777,216-byte (16 MiB) bounded export size; use metadata-only export or select fewer images');
  }
  scoped(ctx,orderId);
  db.prepare('INSERT INTO evidence_packets VALUES(?,?,?,?,?,?,?,?,?)').run(id,ctx.projectId,ctx.runId,orderId,packet.revision,manifestText,json,html,createdAt);
  if(resolved){
   const insertFile=db.prepare('INSERT INTO evidence_packet_files VALUES(?,?,?,?,?,?)');
   for(const [hash,bytes] of resolved.pngByHash.entries())insertFile.run(id,`image-${hash}.png`,'image/png',hash,bytes,createdAt);
  }
  return {...packet,manifest,previewHtml:html};
 });
}
function stored(ctx:ActorContext,id:string){
 requireDesignerContext(ctx);const row=db.prepare('SELECT * FROM evidence_packets WHERE id=? AND project_id=? AND run_id=?').get(id,ctx.projectId,ctx.runId) as any;
 if(!row)throw new ScopedAccessError(404,'Evidence packet not found');scoped(ctx,row.order_id);
 const manifest=parse(row.manifest_json,'Packet manifest') as EvidencePacketManifest;
 const packet=parse(row.json_text,'Packet JSON');
 if(![1,2].includes(manifest.schemaVersion)||packet.schemaVersion!==manifest.schemaVersion||manifest.packetId!==row.id||manifest.projectId!==ctx.projectId||manifest.runId!==ctx.runId||manifest.orderId!==row.order_id||manifest.revision!==row.revision||!Array.isArray(manifest.files))fail('Evidence packet association integrity check failed');
 if(packet.id!==row.id||packet.projectId!==ctx.projectId||packet.runId!==ctx.runId||packet.orderId!==row.order_id||packet.revision!==row.revision)fail('Evidence packet JSON association integrity check failed');
 for(const name of ['packet.json','packet.html']){const text=name==='packet.json'?row.json_text:row.html_text,entry=manifest.files.find(f=>f.name===name);if(!entry||typeof text!=='string'||!text||sha(text)!==entry.sha256||Buffer.byteLength(text)!==entry.bytes)fail('Evidence packet is incomplete or changed; integrity check failed');}
 const fileRows=db.prepare('SELECT * FROM evidence_packet_files WHERE packet_id=? ORDER BY name').all(row.id) as any[];
 if(manifest.schemaVersion===1){
  if(manifest.files.length!==2||fileRows.length!==0)fail('Evidence packet association integrity check failed');
 }else{
  const imageEntries=manifest.files.filter(f=>!['packet.json','packet.html'].includes(f.name));
  if(imageEntries.length<1||imageEntries.length>4||manifest.files.length!==2+imageEntries.length||fileRows.length!==imageEntries.length)fail('Evidence packet is incomplete or changed; integrity check failed');
  for(const entry of imageEntries){
   const m=entry.name.match(/^image-([0-9a-f]{64})\.png$/);
   const saved=fileRows.find(r=>r.name===entry.name);
   if(!m||entry.mediaType!=='image/png'||entry.sha256!==m[1]||!saved||saved.media_type!=='image/png'||saved.sha256!==entry.sha256||!saved.bytes?.byteLength||saved.bytes.byteLength!==entry.bytes||saved.bytes.byteLength>1_500_000||sha(saved.bytes)!==entry.sha256)fail('Evidence packet is incomplete or changed; integrity check failed');
  }
  if(!Array.isArray(packet.attachedImages)||packet.attachedImages.length<1||packet.attachedImages.length>4)fail('Evidence packet attachment bindings are incomplete');
  for(const binding of packet.attachedImages){
   const entry=imageEntries.find(e=>e.name===binding.fileName);
   if(!entry||binding.fileName!==`image-${binding.imageHash}.png`||entry.sha256!==binding.imageHash||entry.bytes!==binding.bytes)fail('Evidence packet attachment binding integrity check failed');
  }
 }
 return {row,manifest,packet,fileRows};
}
export function getEvidencePacket(ctx:ActorContext,id:string):EvidencePacket {const {row,manifest,packet}=stored(ctx,id);return {...packet,manifest,previewHtml:row.html_text};}
export function evidencePacketFile(ctx:ActorContext,id:string,name:string):{text?:string;body:string|Uint8Array;mediaType:string;filename:string}{
 const {row,manifest,fileRows}=stored(ctx,id);
 if(name==='manifest.json'){const text=JSON.stringify(manifest,null,2);return {text,body:text,mediaType:'application/json',filename:`scope-settle-${id}-manifest.json`};}
 if(name==='packet.json'||name==='packet.html'){const text=name==='packet.json'?row.json_text:row.html_text;return {text,body:text,mediaType:name==='packet.json'?'application/json':'text/html',filename:`scope-settle-${id}.${name==='packet.json'?'json':'html'}`};}
 if(/^image-[0-9a-f]{64}\.png$/.test(name)){
  const saved=fileRows.find(r=>r.name===name);if(!saved)throw new ScopedAccessError(404,'Evidence file not found');
  return {body:new Uint8Array(saved.bytes),mediaType:'image/png',filename:`scope-settle-${id}-${name}`};
 }
 throw new ScopedAccessError(404,'Evidence file not found');
}
