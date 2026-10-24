import {linkedOrders,recordPublishedOrder} from "./requestLinks.js";
import { randomUUID } from "node:crypto";
import { db, getProjectForRun, transaction } from "./db.js";
import { config } from "./env.js";
import { credentialHash, newCredential } from "./judgeAccess.js";
import { getSession, type Session } from "./sessions.js";
import { getAgentPolicy, policyAuthority, activeAgentPolicy } from "./agentPolicy.js";
import { createRequest, requestById, listRequests, messagesFor, appendMessage, exceptionFor, attentionFor, now, type AgentRequest } from "./agentStore.js";
import { getChangeOrder, approveChangeOrder, ensureInvoice, refreshPaymentStatus } from "./orders.js";
import {scopeContextForRun,createScopeParent,scopeAccessLink} from './scopeLedger.js';
import {activeGrant} from './judgeAccess.js';
import {ScopedAccessError} from './context.js';

export interface PortalSession { id:string; runId:string; expiresAt:string }
function portalById(id:string):PortalSession|null {
  const row=db.prepare("SELECT * FROM agent_portals WHERE id = ? AND revoked = 0 AND expires_at > ?").get(id,now()) as any;
  const policy=row ? getAgentPolicy(row.run_id) : null;
  return row && policy && policyAuthority(policy) ? {id:row.id,runId:row.run_id,expiresAt:row.expires_at} : null;
}
export function getPortalSession(credential:string):PortalSession|null {
  if (typeof credential!=="string" || credential.length!==43) return null;
  const row=db.prepare("SELECT id FROM agent_portals WHERE credential_hash = ?").get(credentialHash(credential)) as any;
  return row ? portalById(row.id) : null;
}
function requirePortal(session:PortalSession) {
  if (!session || typeof session.id!=="string" || !session.id || typeof session.runId!=="string") throw new ScopedAccessError(401,"Client portal access expired or revoked");
  const valid=portalById(session.id);
  if (!valid || valid.runId!==session.runId) throw new ScopedAccessError(401,"Client portal access expired or revoked");
  return valid;
}
export function requireDesigner(session:Session) {
  const valid=getSession(session.token);
  if (!valid || valid.runId!==session.runId) throw new ScopedAccessError(401,"Requires active designer role");
  if (valid.role!=="designer") throw new ScopedAccessError(403,"Requires active designer role");
}
export function createPortalAccess(session:Session) {
  requireDesigner(session);
  const policy=getAgentPolicy(session.runId);
  if (!policy || !policyAuthority(policy)) throw new Error("Approve an automation policy before sharing client access");
  const credential=newCredential(), id=randomUUID();
  transaction(()=>{
    db.prepare("UPDATE agent_portals SET revoked = 1 WHERE run_id = ?").run(session.runId);
    db.prepare("INSERT INTO agent_portals (id,run_id,credential_hash,expires_at,created_at) VALUES (?,?,?,?,?)")
      .run(id,session.runId,credentialHash(credential),policy.expiresAt,now());
  });
  return {credential,portalUrl:`${config.publicUrl}/client#access=${credential}`,expiresAt:policy.expiresAt};
}
function requestFor(session:PortalSession,id:string) {
  requirePortal(session);
  const request=requestById(id,session.runId);
  if (!request) throw new Error("Request not found");
  return request;
}
type PublishedOrder = Pick<import("../shared/types.js").ChangeOrderView,
  "id" | "revision" | "title" | "deliverables" | "lineItems" | "totalMinor" | "currency" | "status" |
  "invoiceUrl" | "paymentStatus" | "scopeRevisionId" | "amountDueMinor" | "lastCheckedAt" |
  "approvalStatus" | "financialState" | "paypalInvoiceId" | "scopeContext" | "milestoneSchedule" | "installmentSummary" | "installments" | "delivery">;

export function publishedOrder(request:AgentRequest,orderId?:string,revision?:number): PublishedOrder | null {
  const refs=linkedOrders(request);
  const selected=orderId?refs.find(r=>r.order_id===orderId&&r.revision===revision):refs.length===1?refs[0]:null;
  const order=selected?getChangeOrder(selected.order_id):null;
  if (!order || order.runId!==request.run_id || order.revision!==selected?.revision || order.stale || (order.approvalStatus!=="approved" && order.approvalStatus!=="awaiting_client_approval")) return null;
  // Internal assessment input and delegating credentials never enter the client view.
  return {id:order.id,revision:order.revision,title:order.title,deliverables:order.deliverables,lineItems:order.lineItems,
    totalMinor:order.totalMinor,currency:order.currency,status:order.status,invoiceUrl:order.invoiceUrl,paymentStatus:order.paymentStatus,
    scopeRevisionId:order.scopeRevisionId,amountDueMinor:order.amountDueMinor,lastCheckedAt:order.lastCheckedAt,
    delivery:order.delivery,milestoneSchedule:order.milestoneSchedule,installmentSummary:order.installmentSummary,installments:order.installments,approvalStatus:order.approvalStatus,financialState:order.financialState,paypalInvoiceId:order.paypalInvoiceId,scopeContext:order.scopeContext?{...order.scopeContext,commitments:[]}:null};
}
export function portalView(session:PortalSession) {
  const valid=requirePortal(session),project=getProjectForRun(session.runId);
  const scope=scopeContextForRun(session.runId);
  return {projectName:project.name,expiresAt:valid.expiresAt,acceptingRequests:!!activeAgentPolicy(session.runId),
    scope:{scopeSnapshot:scope.scopeSnapshot,rateSnapshot:scope.rateSnapshot,acknowledgement:scope.acknowledgement},
    requests:listRequests(session.runId).map(r=>({id:r.id,text:r.text,state:r.state,createdAt:r.created_at,
      messages:messagesFor(r.id,r.run_id).map(({source_id,...m})=>m),order:publishedOrder(r),orders:linkedOrders(r).map(ref=>publishedOrder(r,ref.order_id,ref.revision)).filter(Boolean)}))};
}
export function issuePortalScopeAccess(session:PortalSession){
 const valid=requirePortal(session),scope=scopeContextForRun(valid.runId),policy=getAgentPolicy(valid.runId)!;
 const parent=createScopeParent(scope.scopeSnapshot.projectId,valid.runId,'portal',valid.id,valid.expiresAt);
 const grant=policy.ownerGrantId?activeGrant(policy.ownerGrantId):null;
 return scopeAccessLink(valid.runId,scope.scopeSnapshot,parent,grant?.judge_access_id??null,valid.expiresAt);
}
function validateKey(key:unknown):asserts key is string {
  if (typeof key!=="string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(key)) throw new Error("Invalid request key");
}
export function addPortalRequest(session:PortalSession,text:string,key:string) {
  requirePortal(session);validateKey(key);
  if (!activeAgentPolicy(session.runId)) throw new Error("The agent is paused; contact your designer");
  const existing=db.prepare("SELECT text FROM agent_requests WHERE run_id = ? AND source = 'portal' AND source_id = ?").get(session.runId,key) as any;
  if (existing && existing.text!==text?.trim()) throw new Error("This request key already belongs to different content");
  return createRequest(session.runId,"portal",key,text);
}
export function replyToRequest(session:PortalSession,id:string,text:string,key:string) {
  const request=requestFor(session,id);validateKey(key);
  if (typeof text!=="string" || !text.trim() || text.length>4000) throw new Error("Reply text required (maximum 4000 characters)");
  if (messagesFor(id,session.runId).length>=30) throw new Error("This request has reached its reply limit; contact your designer");
  const sourceId=`portal:${id}:${key}`;
  const previous=db.prepare("SELECT body FROM agent_messages WHERE run_id = ? AND source_id = ?").get(session.runId,sourceId) as any;
  if (previous) {if (previous.body!==text.trim()) throw new Error("This reply key already belongs to different content");return request;}
  transaction(()=>{
    appendMessage(request,"client",text.trim(),sourceId);
    db.prepare("UPDATE agent_requests SET version = version + 1, assessment_id = NULL, updated_at = ? WHERE id = ?").run(now(),id);
    if (request.order_id || ["included","dismissed"].includes(request.state)) exceptionFor(request,"Client added a reply after a decision; review it without changing the existing quote.");
    else db.prepare("UPDATE agent_requests SET state = 'queued', exception = NULL WHERE id = ?").run(id);
  });
  return requestById(id,session.runId)!;
}
function portalSelection(session:PortalSession,id:string,orderId?:string,revision?:number){
 const request=requestFor(session,id),published=publishedOrder(request,orderId,revision);
 if(!published)throw new Error('Select an exact published current proposal and revision');
 return {request,published};
}
export async function approvePortalQuote(session:PortalSession,id:string,revision:number,consent:boolean,orderId?:string) {
 const {request,published}=portalSelection(session,id,orderId,revision);
 if(consent!==true)throw new Error('Explicit client consent is required');
 if(!Number.isSafeInteger(revision)||published.revision!==revision)throw new Error('This quote is not the published current revision');
 if((request.state==='exception'||request.state==='dismissed')&&published.status==='awaiting_client_approval')throw new Error('This quote needs designer review before approval');
 const revalidate=()=>{const live=portalSelection(session,id,published.id,revision);if(live.request.state==='dismissed')throw new Error('Request dismissed during provider operation');};
 const approved=approveChangeOrder(published.id,{changeOrderId:published.id,changeOrderRevision:revision});
 try {await ensureInvoice(approved.id,revalidate);revalidate();return {order:publishedOrder(request,published.id,revision)};}
 catch {revalidate();return {order:publishedOrder(request,published.id,revision),invoiceError:'Approval saved. Invoice delivery needs recovery; retry payment setup to reuse the same invoice.'};}
}
export async function refreshPortalPayment(session:PortalSession,id:string,orderId?:string,revision?:number) {
 const {request,published}=portalSelection(session,id,orderId,revision);
 const revalidate=()=>{portalSelection(session,id,published.id,published.revision);};
 await refreshPaymentStatus(published.id,revalidate);revalidate();return publishedOrder(request,published.id,published.revision);
}
export function handleAgentRequest(session:Session,id:string,action:"retry"|"dismiss"|"acknowledge") {
  requireDesigner(session);
  const request=requestById(id,session.runId);
  if (!request) throw new Error("Request not found");
  if(action==="acknowledge") {
    attentionFor(request,null);
    db.prepare("UPDATE agent_outbox SET state = 'handled' WHERE request_id = ? AND state='review' AND NOT EXISTS(SELECT 1 FROM outbound_operations o WHERE o.outbox_id=agent_outbox.id AND o.dispatch_started=1)").run(id);
  } else if (action==="dismiss") {
    db.prepare("UPDATE agent_requests SET state = 'dismissed', version = version + 1, exception = NULL, updated_at = ? WHERE id = ?").run(now(),id);
    db.prepare("UPDATE agent_outbox SET state = 'cancelled' WHERE request_id = ? AND state='pending' AND attempts=0 AND NOT EXISTS(SELECT 1 FROM outbound_operations o WHERE o.outbox_id=agent_outbox.id)").run(id);
    appendMessage(request,"designer","Your designer is handling this request directly.");
  } else {
    if (!activeAgentPolicy(session.runId)) throw new Error("Enable an approved policy before retrying");
    if (request.order_id) throw new Error("A quote already exists; review it manually instead of generating another quote");
    db.prepare("UPDATE agent_requests SET state = 'queued', version = version + 1, exception = NULL, updated_at = ? WHERE id = ?").run(now(),id);
  }
  return requestById(id,session.runId)!;
}

export function publishReviewedQuote(session:Session,id:string,orderId:string,revision:number,consent:boolean) {
  requireDesigner(session);
  const request=requestById(id,session.runId),order=getChangeOrder(orderId);
  if(!request || !order || order.runId!==session.runId)throw new Error("Request or quote not found");
  if(linkedOrders(request).some(r=>r.order_id!==orderId)){
    const binding=db.prepare(`SELECT r.id FROM proposal_item_reservations r JOIN request_item_results i ON i.item_id=r.item_id AND i.assessment_id=r.assessment_id JOIN request_sources s ON s.id=i.source_id WHERE r.order_id=? AND s.run_id=? AND s.source=? AND s.root_id=? AND r.state='reserved'`).get(orderId,request.run_id,request.source,request.source_id);
    if(!binding)throw new Error('An existing quote requires reserved partial items from this exact request; otherwise use a separate request');
  }
  if(consent!==true || order.revision!==revision || order.status!=="awaiting_client_approval" || order.stale)throw new Error("Explicit designer consent to the submitted current revision is required");
  if(db.prepare("SELECT id FROM agent_requests WHERE order_id = ? AND id != ?").get(orderId,id))throw new Error("This quote already belongs to another request");
  return transaction(()=>{
    recordPublishedOrder(request,orderId,revision);
    db.prepare("UPDATE agent_requests SET state='quoted',exception=NULL,version=version+1,updated_at=? WHERE id=?").run(now(),id);
    db.prepare("UPDATE agent_outbox SET state = 'cancelled' WHERE request_id = ? AND state='pending' AND attempts=0 AND NOT EXISTS(SELECT 1 FROM outbound_operations o WHERE o.outbox_id=agent_outbox.id)").run(id);
    appendMessage(request,"designer",`Your designer reviewed this exception and published quote revision ${revision} for USD $${(order.totalMinor/100).toFixed(2)}. Review the exact terms below; approval is required before invoicing.`);
    return requestById(id,session.runId)!;
  });
}
