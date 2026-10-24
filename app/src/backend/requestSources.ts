import {randomUUID} from 'node:crypto';
import {db,getProjectForRun,assertRunActive,transaction} from './db.js';
import {contentHash} from './scopePersistence.js';
import {fetchComments} from './figma.js';
import {ScopedAccessError} from './context.js';
import type {FigmaComment} from '../shared/types.js';

export interface RequestSource {source:'figma'|'portal';rootId:string;fileKey:string;messages:{id:string;message:string}[]}
export interface RequestSourceReference {id:string;version:number;contentHash:string}
export type SourceUnavailableReason='source_missing'|'source_bounds';
export const SOURCE_UNAVAILABLE='Request source is known unavailable. Abandon its unapproved proposals; after the thread is restored, refresh it and reassess';
/** The persistent known-unavailability fence. Never constructed from HTTP, job or connector input. */
export class SourceUnavailableError extends ScopedAccessError {constructor(message=SOURCE_UNAVAILABLE){super(409,message);}}
const now=()=>new Date().toISOString();

/** Canonical per-thread bounds, shared by capture and inbox projection. */
export function withinCanonicalBounds(messages:{id:string;message:string}[]){
 return Array.isArray(messages)&&messages.length>0&&messages.length<=31&&!messages.some(m=>typeof m?.id!=='string'||!m.id.trim()||m.id.length>4000||typeof m.message!=='string'||!m.message.trim()||m.message.length>4000)&&new Set(messages.map(m=>m.id)).size===messages.length;
}
/** Source-keyed freshness record. An absent row means no known unavailability. */
export function sourceFreshness(sourceId:string){return (db.prepare('SELECT * FROM request_source_freshness WHERE source_id=?').get(sourceId) as any)??null;}
export function sourceUnavailable(sourceId:string){return sourceFreshness(sourceId)?.state==='unavailable';}
/** Monotonic observation watermark. Trusted reads capture it before awaiting the provider. */
export function observationMark():number{return Number((db.prepare('SELECT COALESCE(MAX(generation),0) g FROM request_source_freshness').get() as any).g);}
function knownFigmaSource(runId:string,rootId:string){
 const project=getProjectForRun(runId);
 return db.prepare("SELECT * FROM request_sources WHERE project_id=? AND run_id=? AND source='figma' AND file_key=? AND root_id=?").get(project.id,runId,project.figmaFileKey,rootId) as any;
}
/**
 * Trusted observation only: a successful, complete authoritative read found this exact known
 * (project, run, source, file, root) missing or outside canonical bounds. Unknown IDs fence nothing.
 * The canonical head and immutable history are left untouched; each observation advances the generation.
 */
export function recordSourceUnavailable(runId:string,rootId:string,reason:SourceUnavailableReason):string|null{
 return transaction(()=>{
  const source=knownFigmaSource(runId,rootId);if(!source)return null;
  const at=now();
  db.prepare(`INSERT INTO request_source_freshness(source_id,project_id,run_id,state,reason,generation,observed_at,updated_at) VALUES(?,?,?,'unavailable',?,?,?,?)
   ON CONFLICT(source_id) DO UPDATE SET state='unavailable',reason=excluded.reason,generation=excluded.generation,observed_at=excluded.observed_at,updated_at=excluded.updated_at`)
   .run(source.id,source.project_id,runId,reason,observationMark()+1,at,at);
  return String(source.id);
 });
}
/** After a successful read could not resolve `requestedId`, fence only the exact known root it belongs to. */
export function recordMissingSource(runId:string,requestedId:string,comments:FigmaComment[]){
 const project=getProjectForRun(runId),chosen=comments.find(c=>c.id===requestedId);
 const roots=chosen?[chosen.parentId??chosen.id]:knownFigmaSource(runId,requestedId)?[requestedId]:
  (db.prepare(`SELECT DISTINCT s.root_id FROM request_sources s JOIN request_source_versions v ON v.source_id=s.id AND v.version=s.version
   WHERE s.project_id=? AND s.run_id=? AND s.source='figma' AND s.file_key=? AND EXISTS(SELECT 1 FROM json_each(v.messages_json) m WHERE json_extract(m.value,'$.id')=?)`)
   .all(project.id,runId,project.figmaFileKey,requestedId) as any[]).map(row=>String(row.root_id));
 for(const root of roots){const found=comments.find(c=>c.id===root);if(!found||found.parentId)recordSourceUnavailable(runId,root,'source_missing');}
}
function persistSource(runId:string,input:RequestSource,mark:number|null):RequestSourceReference {
 return transaction(()=>{
  assertRunActive(runId);const project=getProjectForRun(runId);
  if(!input.rootId||input.source==='figma'&&input.fileKey!==project.figmaFileKey||!withinCanonicalBounds(input.messages))throw new Error('Invalid request source');
  const file=input.source==='figma'?input.fileKey:'',hash=contentHash(input.messages);
  let row=db.prepare('SELECT * FROM request_sources WHERE project_id=? AND run_id=? AND source=? AND file_key=? AND root_id=?').get(project.id,runId,input.source,file,input.rootId) as any;
  const fence=row?sourceFreshness(row.id):null;
  if(fence?.state==='unavailable'){
   // Generic capture, cached bytes and stored JSON fail closed. Only a validated read that began
   // after the latest unavailable observation recovers, with a new version even for identical bytes.
   if(mark===null)throw new SourceUnavailableError();
   if(Number(fence.generation)>mark)throw new SourceUnavailableError('A newer authoritative observation marked this request source unavailable; refresh it again');
   const at=now();row.version++;
   db.prepare('UPDATE request_sources SET version=?,content_hash=? WHERE id=?').run(row.version,hash,row.id);
   db.prepare('INSERT INTO request_source_versions VALUES(?,?,?,?,?)').run(row.id,row.version,JSON.stringify(input.messages),hash,at);
   db.prepare("UPDATE request_source_freshness SET state='available',generation=?,recovered_version=?,recovered_at=?,updated_at=? WHERE source_id=?").run(observationMark()+1,row.version,at,at,row.id);
   return {id:row.id,version:row.version,contentHash:hash};
  }
  if(!row){row={id:randomUUID(),version:1};db.prepare('INSERT INTO request_sources VALUES(?,?,?,?,?,?,?,?)').run(row.id,project.id,runId,input.source,file,input.rootId,1,hash);}
  else if(row.content_hash!==hash){row.version++;db.prepare('UPDATE request_sources SET version=?,content_hash=? WHERE id=?').run(row.version,hash,row.id);}
  db.prepare('INSERT OR IGNORE INTO request_source_versions VALUES(?,?,?,?,?)').run(row.id,row.version,JSON.stringify(input.messages),hash,new Date().toISOString());
  return {id:row.id,version:row.version,contentHash:hash};
 });
}
/** Internal source persistence only. Callers own private authority and source acquisition. No paid work. A latched source fails closed. */
export function captureRequestSource(runId:string,input:RequestSource):RequestSourceReference {return persistSource(runId,input,null);}
/**
 * Trusted acquisition only: `input` is the canonical projection of an authoritative Figma read that
 * completed after `mark` (from observationMark()) was taken and after current run/file/authority checks.
 */
export function acquireRequestSource(runId:string,input:RequestSource,mark:number):RequestSourceReference {return persistSource(runId,input,mark);}
/** Pure projection, reusable after a trusted file-wide refresh. Missing roots are unavailable, never invented. */
export function canonicalFigmaSource(fileKey:string,commentId:string,comments:FigmaComment[]) {
 const chosen=comments.find(c=>c.id===commentId),root=chosen?.parentId?comments.find(c=>c.id===chosen.parentId):chosen;
 if(!root||root.parentId)throw new ScopedAccessError(400,'Select an actual root comment in the configured file');
 const replies=comments.filter(c=>c.parentId===root.id).sort((a,b)=>a.id.localeCompare(b.id));
 const source:RequestSource={source:'figma',fileKey,rootId:root.id,messages:[root,...replies].map(c=>({id:c.id,message:c.message}))};
 return {source,root,replies};
}
/** Strictly internal adapter: never exposed as an actor constructor or accepted from HTTP/job JSON. */
export async function refreshFigmaSource(runId:string,commentId:string,assertAuthorized:()=>void) {
 assertAuthorized();assertRunActive(runId);const project=getProjectForRun(runId),mark=observationMark();
 const comments=await fetchComments(project.figmaFileKey);assertAuthorized();assertRunActive(runId);
 let resolved;
 try{resolved=canonicalFigmaSource(project.figmaFileKey,commentId,comments);}
 catch(error){recordMissingSource(runId,commentId,comments);throw error;}
 if(!withinCanonicalBounds(resolved.source.messages)){recordSourceUnavailable(runId,resolved.root.id,'source_bounds');throw new ScopedAccessError(400,'Invalid request source: the authoritative thread exceeds canonical bounds');}
 const reference=acquireRequestSource(runId,resolved.source,mark);
 return {...resolved,reference,observedAt:new Date().toISOString()};
}
/** Shared consumer guard: the exact displayed reference is the current canonical head and not known unavailable. */
export function requireSourceCurrent(runId:string,ref:RequestSourceReference) {
 assertRunActive(runId);const row=db.prepare('SELECT version,content_hash FROM request_sources WHERE id=? AND run_id=?').get(ref.id,runId) as any;
 if(row&&sourceUnavailable(ref.id))throw new SourceUnavailableError();
 if(!row||row.version!==ref.version||row.content_hash!==ref.contentHash)throw new ScopedAccessError(409,'Request source changed; refresh and reassess');
}
/** The same predicate for an assessed item: its source version is the current, available canonical head. */
export function requireAssessedSourceCurrent(sourceId:string,version:number,changed='Item assessment source changed; reassess') {
 const row=db.prepare('SELECT version FROM request_sources WHERE id=?').get(sourceId) as any;
 if(!row||sourceUnavailable(sourceId))throw new SourceUnavailableError();
 if(row.version!==version)throw new ScopedAccessError(409,changed);
}
