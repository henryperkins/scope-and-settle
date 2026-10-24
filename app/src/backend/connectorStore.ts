import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {db,currentRunId,getProjectForRun} from './db.js';
import {activeGrant,credentialHash} from './judgeAccess.js';
import {config} from './env.js';

/**
 * Dependency-light connector store: credential format, digest, verified lookup, live parent/run checks and
 * connector budget rows. It never constructs authority; context.ts mints contexts after verification.
 */
export const DEFAULT_CONNECTOR_OPERATIONS=Object.freeze(['get_project_scope','assess_change_request','draft_change_order','get_payment_status'] as const);
export const PREPARE_CONNECTOR_OPERATIONS=Object.freeze(['submit_for_client_approval','issue_approved_invoice'] as const);
export const CONNECTOR_OPERATIONS=Object.freeze([...DEFAULT_CONNECTOR_OPERATIONS,...PREPARE_CONNECTOR_OPERATIONS] as const);
export type DefaultConnectorOperation=typeof DEFAULT_CONNECTOR_OPERATIONS[number];
export type PrepareConnectorOperation=typeof PREPARE_CONNECTOR_OPERATIONS[number];
export type ConnectorOperation=typeof CONNECTOR_OPERATIONS[number];
export const isConnectorOperation=(value:unknown):value is ConnectorOperation=>typeof value==='string'&&(CONNECTOR_OPERATIONS as readonly string[]).includes(value);
export const CONNECTOR_MAX_MINUTES=60;
const TOKEN=/^ssc1\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/;
const HEADER_LENGTH='Bearer '.length+'ssc1.'.length+36+1+43;
const DOMAIN='scope-and-settle/figma-connector-credential/v1\0';
const now=()=>new Date().toISOString();

export interface ConnectorRecord {
 readonly id:string;readonly projectId:string;readonly runId:string;readonly fileKey:string;readonly operations:readonly ConnectorOperation[];
 readonly parentKind:'grant'|'session';readonly parentRef:string;readonly ownerActorId:string;readonly maxAssessments:number;readonly maxCostMicroUsd:number;
 readonly issuedAt:string;readonly expiresAt:string;readonly revokedAt:string|null;
}
/** Domain-separated SHA-256 of the complete presented credential. Only this digest is stored. */
export const connectorDigest=(token:string)=>createHash('sha256').update(DOMAIN).update(token,'utf8').digest('hex');
/** A versioned public record ID plus 32 cryptographically random bytes in canonical base64url. */
export function newConnectorToken(){const id=randomUUID(),token=`ssc1.${id}.${randomBytes(32).toString('base64url')}`;return {id,token,digest:connectorDigest(token)};}
/**
 * Exactly one `Bearer <credential>` value. Missing, duplicate (repeated or comma-joined), oversized,
 * non-canonical and malformed values are rejected before any lookup.
 */
export function parseConnectorBearer(values:unknown):{id:string;token:string}|null{
 const list=Array.isArray(values)?values:[values];
 if(list.length!==1||typeof list[0]!=='string'||list[0].length!==HEADER_LENGTH||!list[0].startsWith('Bearer '))return null;
 const token=list[0].slice(7),match=TOKEN.exec(token);
 if(!match)return null;
 const bytes=Buffer.from(match[2],'base64url');
 return bytes.length===32&&bytes.toString('base64url')===match[2]?{id:match[1],token}:null;
}
export const connectorRow=(id:string)=>typeof id==='string'?(db.prepare('SELECT * FROM connector_credentials WHERE id=?').get(id) as any)??null:null;
export function connectorRecord(row:any):ConnectorRecord|null{
 let operations:unknown;try{operations=JSON.parse(row.operations_json);}catch{return null;}
 // Unknown operation names fail closed.
 if(!Array.isArray(operations)||!operations.length||!operations.every(isConnectorOperation)||new Set(operations).size!==operations.length)return null;
 return Object.freeze({id:row.id,projectId:row.project_id,runId:row.run_id,fileKey:row.file_key,operations:Object.freeze([...operations]),parentKind:row.parent_kind,parentRef:row.parent_ref,
  ownerActorId:row.owner_actor_id,maxAssessments:row.max_assessments,maxCostMicroUsd:row.max_cost_micro_usd,issuedAt:row.issued_at,expiresAt:row.expires_at,revokedAt:row.revoked_at??null});
}
/** The parent stored at issuance stays active with the same designer role, project and run. No bearer token is stored. */
export function connectorParentActive(kind:string,ref:string,projectId:string,runId:string):boolean{
 if(kind==='grant'){const grant=activeGrant(ref);return !!grant&&grant.role==='designer'&&grant.run_id===runId&&(grant.grant_kind??'project')==='project';}
 if(kind!=='session')return false;
 return (db.prepare("SELECT token FROM sessions WHERE project_id=? AND run_id=? AND role='designer' AND grant_id IS NULL AND revoked=0 AND expires_at>?").all(projectId,runId,now()) as any[])
  .some(session=>credentialHash(session.token)===ref);
}
/**
 * Liveness, independent of the deployment flag: not revoked or expired; a judging run is open with a grant
 * parent, or an ordinary run is exactly today's run with a session parent (getProjectForRun would otherwise
 * resolve an old ordinary run to today's template); same project and configured file; parent still active.
 */
export function connectorEligible(record:ConnectorRecord):boolean{
 if(record.revokedAt||!(Date.parse(record.expiresAt)>Date.now()))return false;
 const judging=db.prepare('SELECT closed_at FROM judge_runs WHERE run_id=?').get(record.runId) as any;
 if(judging?(judging.closed_at||record.parentKind!=='grant'):(record.runId!==currentRunId()||record.parentKind!=='session'))return false;
 let project;try{project=getProjectForRun(record.runId);}catch{return false;}
 if(project.id!==record.projectId||project.figmaFileKey!==record.fileKey)return false;
 return connectorParentActive(record.parentKind,record.parentRef,record.projectId,record.runId);
}
const ZERO_DIGEST='0'.repeat(64);
/** Verified lookup: public record ID, fixed-size constant-time digest comparison, then full liveness. */
export function liveConnector(id:string,digest:string):ConnectorRecord|null{
 if(!config.mcpConnectorEnabled)return null;
 const row=connectorRow(id),stored=Buffer.from(row?.digest??ZERO_DIGEST,'hex'),presented=Buffer.from(digest,'hex');
 if(stored.length!==32||presented.length!==32||!timingSafeEqual(stored,presented)||!row)return null;
 const record=connectorRecord(row);
 return record&&connectorEligible(record)?record:null;
}

export function connectorUsage(connectorId:string){
 const r=db.prepare(`SELECT COUNT(*) count,COALESCE(SUM(CASE WHEN state='settled' THEN actual_micro_usd ELSE 0 END),0) settled,
  COALESCE(SUM(CASE WHEN state='held' THEN reserved_micro_usd ELSE 0 END),0) held FROM connector_budget_reservations WHERE connector_id=?`).get(connectorId) as any;
 return {count:Number(r.count),settledMicroUsd:Number(r.settled),heldMicroUsd:Number(r.held)};
}
/**
 * Only inside the transaction that creates a new durable logical attempt: atomically reserve one assessment
 * and the shared conservative cost estimate, or return the refusal. Counts are never refilled.
 */
export function reserveConnectorAttempt(connectorId:string,attemptId:string,estimateMicroUsd:number):'count'|'cost'|null{
 const row=connectorRow(connectorId),usage=connectorUsage(connectorId);
 if(!row||usage.count+1>row.max_assessments)return 'count';
 if(usage.settledMicroUsd+usage.heldMicroUsd+estimateMicroUsd>row.max_cost_micro_usd)return 'cost';
 const at=now();
 db.prepare("INSERT INTO connector_budget_reservations(id,connector_id,attempt_id,call_id,reserved_micro_usd,actual_micro_usd,state,created_at,settled_at,updated_at) VALUES(?,?,?,NULL,?,NULL,'held',?,NULL,?)")
  .run(randomUUID(),connectorId,attemptId,estimateMicroUsd,at,at);
 return null;
}
export function linkConnectorCall(attemptId:string,callId:string){db.prepare('UPDATE connector_budget_reservations SET call_id=?,updated_at=? WHERE attempt_id=? AND call_id IS NULL').run(callId,now(),attemptId);}
/** Actual known usage only. Uncertain, failed or crashed dispatches are never settled and stay held. */
export function settleConnectorAttempt(attemptId:string,actualMicroUsd:number){
 if(!Number.isSafeInteger(actualMicroUsd)||actualMicroUsd<0)return;
 const at=now();db.prepare("UPDATE connector_budget_reservations SET actual_micro_usd=?,state='settled',settled_at=?,updated_at=? WHERE attempt_id=? AND state='held'").run(actualMicroUsd,at,at,attemptId);
}
