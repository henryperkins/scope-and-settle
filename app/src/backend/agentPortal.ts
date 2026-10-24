import { randomUUID } from "node:crypto";
import { db, getProjectForRun, transaction } from "./db.js";
import { config } from "./env.js";
import { credentialHash, newCredential } from "./judgeAccess.js";
import { getSession, type Session } from "./sessions.js";
import { getAgentPolicy, policyAuthority, activeAgentPolicy } from "./agentPolicy.js";
import { createRequest, requestById, listRequests, messagesFor, appendMessage, exceptionFor, now, type AgentRequest } from "./agentStore.js";
import { getChangeOrder, approveChangeOrder, ensureInvoice, refreshPaymentStatus } from "./orders.js";

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
  const valid=portalById(session.id);
  if (!valid || valid.runId!==session.runId) throw new Error("Client portal access expired or revoked");
  return valid;
}
export function requireDesigner(session:Session) {
  const valid=getSession(session.token);
  if (!valid || valid.role!=="designer" || valid.runId!==session.runId) throw new Error("Requires active designer role");
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
export function publishedOrder(request:AgentRequest) {
  const order=request.order_id ? getChangeOrder(request.order_id) : null;
  if (!order || order.runId!==request.run_id || order.revision!==request.quote_revision || order.stale || !["awaiting_client_approval","approved","creating_invoice","payment_due","paid"].includes(order.status)) return null;
  // Internal assessment input and delegating credentials never enter the client view.
  return {id:order.id,revision:order.revision,title:order.title,deliverables:order.deliverables,lineItems:order.lineItems,
    totalMinor:order.totalMinor,currency:order.currency,status:order.status,invoiceUrl:order.invoiceUrl,paymentStatus:order.paymentStatus,
    scopeRevisionId:order.scopeRevisionId,amountDueMinor:order.amountDueMinor,lastCheckedAt:order.lastCheckedAt};
}
export function portalView(session:PortalSession) {
  const valid=requirePortal(session),project=getProjectForRun(session.runId);
  return {projectName:project.name,expiresAt:valid.expiresAt,acceptingRequests:!!activeAgentPolicy(session.runId),
    requests:listRequests(session.runId).map(r=>({id:r.id,text:r.text,state:r.state,createdAt:r.created_at,
      messages:messagesFor(r.id,r.run_id),order:publishedOrder(r)}))};
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
export async function approvePortalQuote(session:PortalSession,id:string,revision:number,consent:boolean) {
  const request=requestFor(session,id),published=publishedOrder(request);
  if (consent!==true) throw new Error("Explicit client consent is required");
  if (!published || !Number.isSafeInteger(revision) || published.revision!==revision) throw new Error("This quote is not the published current revision");
  if (request.state==="exception" || request.state==="dismissed") throw new Error("This quote needs designer review before approval");
  const approved=approveChangeOrder(published.id,{changeOrderId:published.id,changeOrderRevision:revision});
  try { return {order:await ensureInvoice(approved.id)}; }
  catch { return {order:getChangeOrder(approved.id),invoiceError:"Approval saved. Invoice delivery needs recovery; retry payment setup to reuse the same invoice."}; }
}
export async function refreshPortalPayment(session:PortalSession,id:string) {
  const request=requestFor(session,id),order=publishedOrder(request);
  if (!order) throw new Error("Published quote not found");
  return refreshPaymentStatus(order.id);
}
export function handleAgentRequest(session:Session,id:string,action:"retry"|"dismiss") {
  requireDesigner(session);
  const request=requestById(id,session.runId);
  if (!request) throw new Error("Request not found");
  if (action==="dismiss") {
    db.prepare("UPDATE agent_requests SET state = 'dismissed', version = version + 1, exception = NULL, updated_at = ? WHERE id = ?").run(now(),id);
    db.prepare("UPDATE agent_outbox SET state = 'cancelled' WHERE request_id = ? AND state != 'sent'").run(id);
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
  if(consent!==true || order.revision!==revision || order.status!=="awaiting_client_approval" || order.stale)throw new Error("Explicit designer consent to the submitted current revision is required");
  if(db.prepare("SELECT id FROM agent_requests WHERE order_id = ? AND id != ?").get(orderId,id))throw new Error("This quote already belongs to another request");
  return transaction(()=>{
    const previous=db.prepare("SELECT snapshot_json FROM proposal_revisions WHERE change_order_id = ? AND revision = ?").get(request.order_id,request.quote_revision) as any;
    const previousAmount=previous ? Number(JSON.parse(previous.snapshot_json).totalMinor) : 0;
    const allowance=request.quoted_minor+(request.order_id===orderId ? Math.max(0,order.totalMinor-previousAmount) : order.totalMinor);
    db.prepare("UPDATE agent_requests SET state = 'quoted', order_id = ?, quote_revision = ?, quoted_minor = ?, exception = NULL, version = version + 1, updated_at = ? WHERE id = ?")
      .run(orderId,revision,allowance,now(),id);
    db.prepare("UPDATE agent_outbox SET state = 'cancelled' WHERE request_id = ? AND state != 'sent'").run(id);
    appendMessage(request,"designer",`Your designer reviewed this exception and published quote revision ${revision} for USD $${(order.totalMinor/100).toFixed(2)}. Review the exact terms below; approval is required before invoicing.`);
    return requestById(id,session.runId)!;
  });
}
