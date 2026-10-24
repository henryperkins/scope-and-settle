import {db,getProjectForRun,currentRunId,assertRunActive,transaction} from './db.js';
import {ScopedAccessError,requireDesignerContext,sessionForContext,type ActorContext} from './context.js';
import {activeGrant,credentialHash} from './judgeAccess.js';
import {config} from './env.js';
import {CONNECTOR_OPERATIONS,DEFAULT_CONNECTOR_OPERATIONS,PREPARE_CONNECTOR_OPERATIONS,CONNECTOR_MAX_MINUTES,isConnectorOperation,newConnectorToken,connectorRow,connectorRecord,connectorEligible,connectorUsage,type ConnectorOperation,type DefaultConnectorOperation,type PrepareConnectorOperation} from './connectorStore.js';
import {assessmentReservationMicroUsd} from './assessment.js';
import {getProjectScope} from './scopeLedger.js';
import {assessChangeRequest,draftReviewedChangeOrder} from './requestItems.js';
import {getPaymentStatus} from './changeOrderService.js';
import {prepareConnectorSubmit,prepareConnectorInvoice} from './reviewedActions.js';
// T11c's transport calls the verifier and private minting from here; both verify the presented credential themselves.
export {authenticateConnector,mintConnectorContext,requireOperationContext} from './context.js';
export type {ConnectorContext,ConnectorIdentity,ServiceContext,OperationAuthority} from './context.js';
export {CONNECTOR_OPERATIONS,DEFAULT_CONNECTOR_OPERATIONS,PREPARE_CONNECTOR_OPERATIONS,type ConnectorOperation,type DefaultConnectorOperation,type PrepareConnectorOperation} from './connectorStore.js';
export type {ProjectScopeProjection,AssessmentProjection,AssessmentItemProjection,DraftProjection,PaymentStatusProjection,ActionPreparationProjection,ProjectedLineItem,ProjectedEvidence} from './connectorProjections.js';

/** The four default domain entrances. Each admits only an eligible designer session or a context minted for its own operation. */
export const connectorEntrances=Object.freeze({
 get_project_scope:getProjectScope,
 assess_change_request:assessChangeRequest,
 draft_change_order:draftReviewedChangeOrder,
 get_payment_status:getPaymentStatus,
} satisfies Record<DefaultConnectorOperation,unknown>);

/** Opt-in T12a action-preparation entrances: prepare immutable reviewed actions only, never execute. */
export const connectorPreparationEntrances=Object.freeze({
 submit_for_client_approval:prepareConnectorSubmit,
 issue_approved_invoice:prepareConnectorInvoice,
} satisfies Record<PrepareConnectorOperation,unknown>);

export interface ConnectorSummary {
 id:string;status:'active'|'expired'|'revoked'|'inactive';operations:readonly ConnectorOperation[];parentKind:'grant'|'session';
 issuedAt:string;expiresAt:string;revokedAt:string|null;maxAssessments:number;assessmentsUsed:number;
 maxCostMicroUsd:number;costHeldMicroUsd:number;costSettledMicroUsd:number;
}
const ISSUE_KEYS=['consent','operations','expiresInMinutes','maxAssessments','maxCostMicroUsd'];
const DEFAULTS=Object.freeze({expiresInMinutes:CONNECTOR_MAX_MINUTES,maxAssessments:2,maxCostMicroUsd:1_500_000});
const integer=(value:unknown,min:number,max:number)=>Number.isSafeInteger(value)&&(value as number)>=min&&(value as number)<=max;
function requireEnabled(){if(!config.mcpConnectorEnabled)throw new ScopedAccessError(403,'The Figma agent connector is disabled on this server');}
/** Metadata only: never the secret, the digest, the parent reference or the owner identity. */
function summary(row:any):ConnectorSummary{
 const record=connectorRecord(row),usage=connectorUsage(row.id);
 const status=row.revoked_at?'revoked':!(Date.parse(row.expires_at)>Date.now())?'expired':record&&connectorEligible(record)?'active':'inactive';
 return {id:row.id,status,operations:record?.operations??[],parentKind:row.parent_kind,issuedAt:row.issued_at,expiresAt:row.expires_at,revokedAt:row.revoked_at??null,
  maxAssessments:row.max_assessments,assessmentsUsed:usage.count,maxCostMicroUsd:row.max_cost_micro_usd,costHeldMicroUsd:usage.heldMicroUsd,costSettledMicroUsd:usage.settledMicroUsd};
}
/**
 * Designer-session issuance outside MCP. Returns the secret exactly once. The parent is derived here from the
 * authenticated application session, never from input: a renewable designer grant by its stable grant ID, or
 * this exact ordinary session by its digest identity. Expiry is at most 60 minutes and capped by the parent.
 */
export function issueConnectorCredential(ctx:ActorContext,input:unknown):{connector:ConnectorSummary;secret:string}{
 requireDesignerContext(ctx);requireEnabled();
 const body=input as any;
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!ISSUE_KEYS.includes(key)))throw new ScopedAccessError(400,'Only operations, expiry, assessment bounds and explicit consent are accepted');
 if(body.consent!==true)throw new ScopedAccessError(400,'Explicit consent is required to issue a connector credential');
 const operations=body.operations===undefined?[...DEFAULT_CONNECTOR_OPERATIONS]:body.operations;
 if(!Array.isArray(operations)||!operations.length||!operations.every(isConnectorOperation)||new Set(operations).size!==operations.length)throw new ScopedAccessError(400,'Choose one or more supported connector operations');
 const minutes=body.expiresInMinutes??DEFAULTS.expiresInMinutes,maxAssessments=body.maxAssessments??DEFAULTS.maxAssessments,maxCost=body.maxCostMicroUsd??DEFAULTS.maxCostMicroUsd;
 if(!integer(minutes,1,CONNECTOR_MAX_MINUTES))throw new ScopedAccessError(400,`Connector expiry must be 1 to ${CONNECTOR_MAX_MINUTES} whole minutes`);
 if(!integer(maxAssessments,0,20))throw new ScopedAccessError(400,'Maximum paid assessments must be 0 to 20');
 if(!integer(maxCost,0,25_000_000))throw new ScopedAccessError(400,'Maximum model spend must be 0 to 25 USD in micro-USD');
 return transaction(()=>{
  const session=sessionForContext(ctx),grant=session.grantId?activeGrant(session.grantId):null;
  if(session.grantId&&(!grant||grant.role!=='designer'||grant.run_id!==session.runId))throw new ScopedAccessError(401,'Designer access expired or was revoked');
  if(grant)assertRunActive(session.runId);
  else if(session.runId!==currentRunId())throw new ScopedAccessError(409,'This demo was reset; reconnect to your new run');
  const project=getProjectForRun(session.runId);
  if(project.id!==ctx.projectId)throw new ScopedAccessError(403,'Session does not grant access to this project');
  const expiresAt=Math.min(Date.now()+minutes*60_000,Date.parse(grant?grant.expires_at:session.expiresAt));
  if(!(expiresAt>Date.now()))throw new ScopedAccessError(401,'Designer access expired');
  const {id,token,digest}=newConnectorToken();
  db.prepare(`INSERT INTO connector_credentials(id,format_version,digest,project_id,run_id,file_key,operations_json,parent_kind,parent_ref,owner_actor_id,max_assessments,max_cost_micro_usd,issued_at,expires_at)
   VALUES(?,1,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,digest,project.id,session.runId,project.figmaFileKey,JSON.stringify(operations),grant?'grant':'session',
   grant?grant.id:credentialHash(session.token),ctx.actorId,maxAssessments,maxCost,new Date().toISOString(),new Date(expiresAt).toISOString());
  return {connector:summary(connectorRow(id)),secret:token};
 });
}
export function listConnectorCredentials(ctx:ActorContext){
 requireDesignerContext(ctx);
 const rows=db.prepare('SELECT * FROM connector_credentials WHERE project_id=? AND run_id=? ORDER BY issued_at DESC,rowid DESC').all(ctx.projectId,ctx.runId);
 return {enabled:config.mcpConnectorEnabled,maxExpiryMinutes:CONNECTOR_MAX_MINUTES,assessmentReservationMicroUsd:assessmentReservationMicroUsd(),operations:CONNECTOR_OPERATIONS,connectors:rows.map(summary)};
}
/** One-way revocation. Rotation is revoke followed by a new issue; it never mutates scope or refills any budget. */
export function revokeConnectorCredential(ctx:ActorContext,id:string):ConnectorSummary{
 requireDesignerContext(ctx);
 return transaction(()=>{
  const row=connectorRow(id);
  if(!row||row.project_id!==ctx.projectId||row.run_id!==ctx.runId)throw new ScopedAccessError(404,'Connector credential not found');
  if(!row.revoked_at)db.prepare("UPDATE connector_credentials SET revoked_at=?,revoked_reason='designer' WHERE id=? AND revoked_at IS NULL").run(new Date().toISOString(),id);
  return summary(connectorRow(id));
 });
}
