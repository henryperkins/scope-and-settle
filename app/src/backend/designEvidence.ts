import {randomUUID,createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';
import {db,getProjectForRun,transaction,assertRunActive} from './db.js';
import {requireDesignerContext,ScopedAccessError} from './context.js';
import {fetchDesignNodes} from './figma.js';
import {refreshFigmaSource,requireSourceCurrent,type RequestSourceReference} from './requestSources.js';
import {contentHash} from './scopePersistence.js';
import type {ActorContext,DesignEvidenceInput,DesignEvidenceSnapshot} from '../shared/types.js';

export const evidenceBounds=Object.freeze({nodes:20,metadataBytes:16_000,pngBytes:1_500_000,totalBytes:2_100_000,maxDimension:4096,maxPixels:4_000_000,maxAgeMs:15*60_000,futureSkewMs:60_000});
const hashBytes=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const object=(v:any,keys:string[])=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k));
const text=(v:unknown,max:number):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
function invalid(message:string):never {throw new ScopedAccessError(400,message);}
function crc(bytes:Uint8Array){let value=0xffffffff;for(const byte of bytes){value^=byte;for(let k=0;k<8;k++)value=(value>>>1)^((value&1)?0xedb88320:0);}return (value^0xffffffff)>>>0;}

/** Fully validate the supported noninterlaced 8-bit PNG, including CRCs and bounded inflate. */
export function validateEvidencePng(value:unknown) {
 if(typeof value!=='string'||value.length>2_000_022||!/^data:image\/png;base64,[A-Za-z0-9+/]*={0,2}$/.test(value))invalid('Attach one valid PNG under 1.5 MB');
 const encoded=value.slice(22);if(encoded.length%4)invalid('Invalid PNG base64 length');const bytes=Buffer.from(encoded,'base64');
 if(bytes.toString('base64')!==encoded||bytes.length>evidenceBounds.pngBytes||bytes.length<57||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))invalid('Invalid PNG signature or size');
 let offset=8,width=0,height=0,channels=0,ended=false,idatEnded=false;const compressed:Buffer[]=[];
 while(offset<bytes.length){
  if(offset+12>bytes.length)invalid('Truncated PNG');const length=bytes.readUInt32BE(offset),end=offset+12+length;
  if(end>bytes.length)invalid('Truncated PNG chunk');const kind=bytes.toString('ascii',offset+4,offset+8),data=bytes.subarray(offset+8,end-4);
  if(crc(bytes.subarray(offset+4,end-4))!==bytes.readUInt32BE(end-4))invalid('Invalid PNG checksum');
  if(offset===8&&kind!=='IHDR')invalid('PNG header must be first');
  if(kind==='IHDR'){
   if(offset!==8||length!==13)invalid('Invalid PNG header');width=data.readUInt32BE(0);height=data.readUInt32BE(4);channels=({0:1,2:3,4:2,6:4} as Record<number,number>)[data[9]]??0;
   if(!width||!height||width>evidenceBounds.maxDimension||height>evidenceBounds.maxDimension||width*height>evidenceBounds.maxPixels||data[8]!==8||!channels||data[10]!==0||data[11]!==0||data[12]!==0)invalid('PNG dimensions or encoding exceed supported bounds');
  }else if(kind==='IDAT'){if(idatEnded)invalid('Noncontiguous PNG image data');compressed.push(data);}
  else {if(compressed.length)idatEnded=true;if(kind==='IEND'){if(length||end!==bytes.length)invalid('Invalid PNG end');ended=true;}else if(!/^[a-z]/.test(kind)&&kind!=='PLTE')invalid('Unsupported PNG critical chunk');}
  offset=end;
 }
 if(!ended||!compressed.length)invalid('PNG image data missing');
 const expected=(width*channels+1)*height;let pixels:Buffer;
 try{pixels=inflateSync(Buffer.concat(compressed),{maxOutputLength:expected});}catch{invalid('Invalid or oversized compressed PNG');}
 if(pixels.length!==expected)invalid('Invalid PNG scanline size');for(let row=0;row<height;row++)if(pixels[row*(width*channels+1)]>4)invalid('Invalid PNG scanline filter');
 return {bytes,width,height,hash:hashBytes(bytes)};
}

function validateInput(raw:DesignEvidenceInput) {
 if(!object(raw,['commentId','fileKey','nodeIds','capturedAt','selection','imageDataUrl','relevance'])||Buffer.byteLength(JSON.stringify(raw))>evidenceBounds.totalBytes)invalid('Invalid or oversized design evidence input');
 if(!text(raw.commentId,4000)||!text(raw.fileKey,128)||!Array.isArray(raw.nodeIds)||!raw.nodeIds.length||raw.nodeIds.length>evidenceBounds.nodes||raw.nodeIds.some(id=>!text(id,128)||!/^[A-Za-z0-9:_;-]+$/.test(id))||new Set(raw.nodeIds).size!==raw.nodeIds.length)invalid('Invalid selected node IDs');
 if(!Array.isArray(raw.selection)||raw.selection.length!==raw.nodeIds.length||Buffer.byteLength(JSON.stringify(raw.selection))>evidenceBounds.metadataBytes)invalid('Selected metadata exceeds bounds');
 const ids=new Set<string>();
 for(const n of raw.selection){
  if(!object(n,['id','name','type','width','height','selectedText','componentId','layout'])||!raw.nodeIds.includes(n.id)||ids.has(n.id)||!text(n.name,256)||!text(n.type,64))invalid('Invalid selection metadata');ids.add(n.id);
  for(const field of ['width','height'] as const)if(n[field]!==undefined&&n[field]!==null&&(!Number.isFinite(n[field])||n[field]!<0||n[field]!>1_000_000))invalid('Invalid selection dimensions');
  if(n.selectedText!==undefined&&(typeof n.selectedText!=='string'||n.selectedText.length>2000))invalid('Selected text exceeds bounds');
  if(n.componentId!==undefined&&n.componentId!==null&&!text(n.componentId,128))invalid('Invalid component reference');
  if(n.layout!==undefined){if(!object(n.layout,['x','y','layoutMode']))invalid('Invalid layout metadata');for(const field of ['x','y'] as const)if(n.layout[field]!==undefined&&(!Number.isFinite(n.layout[field])||Math.abs(n.layout[field]!)>10_000_000))invalid('Invalid layout coordinate');if(n.layout.layoutMode!==undefined&&!text(n.layout.layoutMode,64))invalid('Invalid layout mode');}
 }
 if(typeof raw.capturedAt!=='string'||!Number.isFinite(Date.parse(raw.capturedAt))||Date.now()-Date.parse(raw.capturedAt)>evidenceBounds.maxAgeMs||Date.parse(raw.capturedAt)-Date.now()>evidenceBounds.futureSkewMs)invalid('Design capture is invalid, stale or in the future');
 if(raw.relevance!==undefined&&(!object(raw.relevance,['confirmed','reason'])||raw.relevance.confirmed!==true||!text(raw.relevance.reason,1000)))invalid('Explicit request relevance needs a reason');
 const input=structuredClone(raw),png=raw.imageDataUrl===undefined?null:validateEvidencePng(raw.imageDataUrl);
 if(png&&input.nodeIds.length!==1)invalid('A PNG must describe exactly one selected frame');
 return {input,png};
}

export async function captureDesignEvidence(ctx:ActorContext,raw:DesignEvidenceInput):Promise<DesignEvidenceSnapshot> {
 requireDesignerContext(ctx);const {input,png}=validateInput(raw),project=getProjectForRun(ctx.runId),receivedAt=new Date().toISOString();
 if(input.fileKey!==project.figmaFileKey)invalid('Selection belongs to a different configured file');
 const resolved=await refreshFigmaSource(ctx.runId,input.commentId,()=>requireDesignerContext(ctx));requireDesignerContext(ctx);
 const anchorNodeId=resolved.root.nodeId??null,relationship=anchorNodeId===null?'unknown_anchor':input.nodeIds.includes(anchorNodeId)?'same_node':'different_node';
 if(relationship!=='same_node'&&!input.relevance)invalid('Select explicit relevance for this request when its comment anchor differs or is unknown');
 let authoritative:{nodes:DesignEvidenceSnapshot['authoritativeNodes'];version:string|null;lastModified:string|null}={nodes:[],version:null,lastModified:null},unavailableReason:string|null=null;
 try{authoritative=await fetchDesignNodes(input.fileKey,input.nodeIds);}catch{unavailableReason='Figma node identity unavailable; check file access and file_content:read permission';}
 requireDesignerContext(ctx);requireSourceCurrent(ctx.runId,resolved.reference);
 const fresh=await refreshFigmaSource(ctx.runId,input.commentId,()=>requireDesignerContext(ctx));requireDesignerContext(ctx);
 if(fresh.reference.version!==resolved.reference.version||(fresh.root.nodeId??null)!==anchorNodeId)throw new ScopedAccessError(409,'Request or comment anchor changed during capture');
 if(authoritative.nodes.length!==input.nodeIds.length)unavailableReason??='One or more selected nodes are missing, deleted or inaccessible';
 const verifiedAt=new Date().toISOString();
 const data:Omit<DesignEvidenceSnapshot,'hash'>={id:randomUUID(),projectId:ctx.projectId,runId:ctx.runId,fileKey:input.fileKey,nodeIds:input.nodeIds,sourceId:resolved.reference.id,sourceVersion:resolved.reference.version,sourceHash:resolved.reference.contentHash,rootId:resolved.source.rootId,anchorNodeId,relationship,relevance:input.relevance?{actorId:ctx.actorId,reason:input.relevance.reason,assertedAt:receivedAt}:null,capturedAt:input.capturedAt,receivedAt,verifiedAt,expiresAt:new Date(Date.parse(input.capturedAt)+evidenceBounds.maxAgeMs).toISOString(),providerVersion:authoritative.version,providerLastModified:authoritative.lastModified,authoritativeNodes:authoritative.nodes,selection:input.selection,verification:unavailableReason?'unavailable':'verified',unavailableReason,collectionSource:'client_plugin_claim',pixelProvenance:png?'client_supplied':'none',imageHash:png?.hash??null,imageWidth:png?.width??null,imageHeight:png?.height??null};
 const snapshot:DesignEvidenceSnapshot={...data,hash:contentHash(data)};
 transaction(()=>{requireDesignerContext(ctx);requireSourceCurrent(ctx.runId,resolved.reference);db.prepare('INSERT INTO design_evidence_snapshots VALUES(?,?,?,?,?,?,?,?)').run(snapshot.id,ctx.projectId,ctx.runId,snapshot.sourceId,snapshot.sourceVersion,snapshot.hash,JSON.stringify(snapshot),receivedAt);if(png)db.prepare('INSERT INTO design_evidence_bytes VALUES(?,?,?)').run(snapshot.id,ctx.runId,png.bytes);});
 return evidenceProjection(snapshot);
}
function evidenceProjection(snapshot:DesignEvidenceSnapshot):DesignEvidenceSnapshot {return {...snapshot,freshness:Date.now()<=Date.parse(snapshot.expiresAt)?'fresh':'stale'};}
/** Read DTO contains provenance and immutable references, never raw image bytes. */
export function designEvidenceById(runId:string,id:string):DesignEvidenceSnapshot|null {const row=db.prepare('SELECT snapshot_json FROM design_evidence_snapshots WHERE id=? AND run_id=?').get(id,runId) as any;return row?evidenceProjection(JSON.parse(row.snapshot_json)):null;}
export function getDesignEvidence(ctx:ActorContext,id:string){requireDesignerContext(ctx);const snapshot=designEvidenceById(ctx.runId,id);if(!snapshot)throw new ScopedAccessError(404,'Design evidence not found');return snapshot;}
/** Internal inference-only access, called after authority and authoritative source refresh. */
export function evidenceForAssessment(runId:string,id:string,source:RequestSourceReference,anchorNodeId:string|null) {
 assertRunActive(runId);const snapshot=designEvidenceById(runId,id);
 if(!snapshot)invalid('Unknown design evidence snapshot');
 if(snapshot.sourceId!==source.id||snapshot.sourceVersion!==source.version||snapshot.sourceHash!==source.contentHash||snapshot.anchorNodeId!==anchorNodeId)throw new ScopedAccessError(409,'Evidence request revision or comment anchor changed; capture again');
 if(snapshot.verification!=='verified')invalid('Design evidence is unavailable and cannot be verified for assessment');
 if(snapshot.freshness!=='fresh')throw new ScopedAccessError(409,'Design evidence is stale; capture again');
 if(snapshot.relationship!=='same_node'&&!snapshot.relevance)invalid('Evidence requires explicit request relevance');
 const row=db.prepare('SELECT png FROM design_evidence_bytes WHERE snapshot_id=? AND run_id=?').get(id,runId) as any;
 if(snapshot.imageHash&&(!row||hashBytes(row.png)!==snapshot.imageHash))throw new ScopedAccessError(409,'Design pixels are unavailable; capture again');
 return {snapshot,imageDataUrl:row?'data:image/png;base64,'+Buffer.from(row.png).toString('base64'):undefined,designContext:JSON.stringify({evidence:snapshot,limits:'REST verifies identity at retrieval; plugin pixels are client-supplied, not an independently verified rendering or exact provider version.'})};
}
export function assessmentEvidence(assessmentId:string,runId:string){const row=db.prepare('SELECT snapshot_id FROM assessment_evidence WHERE assessment_id=? AND run_id=?').get(assessmentId,runId) as any;return row?designEvidenceById(runId,row.snapshot_id):null;}
