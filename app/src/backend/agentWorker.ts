import {randomUUID} from "node:crypto";
import {db,getProjectForRun,transaction} from "./db.js";
import {config} from "./env.js";
import {assess,getAssessment,type AssessmentResult} from "./assessment.js";
import {fetchComments,postComment,FigmaRequestError} from "./figma.js";
import {remindInvoice} from "./paypal.js";
import {createChangeOrder,submitForApproval,getChangeOrder,refreshPaymentStatus} from "./orders.js";
import {activeAgentPolicy,evaluateAutoQuote,policyAuthority,type AgentPolicy} from "./agentPolicy.js";
import {createRequest,requestById,appendMessage,messagesFor,exceptionFor,quotedTotal,now,runtimeValue,setRuntimeValue,type AgentRequest} from "./agentStore.js";
import type {FigmaComment} from "../shared/types.js";

export interface AgentDependencies {
  fetchComments:typeof fetchComments;
  postComment:typeof postComment;
  assess:(input:Parameters<typeof assess>[0],runId:string)=>Promise<{id:string;result:AssessmentResult}>;
  refreshPaymentStatus:typeof refreshPaymentStatus;
  remindInvoice:typeof remindInvoice;
}
const defaults:AgentDependencies={fetchComments,postComment,assess,refreshPaymentStatus,remindInvoice};
const markerPrefix="[Scope & Settle ";
let running:Promise<void>|null=null;
function policies():AgentPolicy[] {
  return (db.prepare("SELECT policy_json FROM agent_policies").all() as {policy_json:string}[]).map(r=>JSON.parse(r.policy_json)).filter(p=>p.enabled && policyAuthority(p));
}
function current(request:AgentRequest,policy:AgentPolicy) {
  const fresh=requestById(request.id,request.run_id),active=activeAgentPolicy(request.run_id);
  return fresh && active && active.version===policy.version && fresh.version===request.version && fresh.state!=="dismissed" ? fresh : null;
}
function queueMessage(request:AgentRequest,policy:AgentPolicy,text:string,key:string) {
  appendMessage(request,"agent",text);
  if(request.source!=="figma" || !policy.figmaReplies)return;
  const marker=`${markerPrefix}${request.id}:${key}]`, at=now();
  const body=JSON.stringify({text:`${text}\n${marker}`,policyVersion:policy.version,requestVersion:request.version});
  db.prepare("INSERT OR IGNORE INTO agent_outbox (id,run_id,request_id,kind,body,marker,created_at,updated_at) VALUES (?,?,?,'figma',?,?,?,?)")
    .run(randomUUID(),request.run_id,request.id,body,marker,at,at);
}
function ingestComments(comments:FigmaComment[],enabled:AgentPolicy[]) {
  for(const comment of [...comments].sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)))) {
    if(!comment.userId || !comment.message?.trim() || comment.resolvedAt || comment.message.includes(markerPrefix) || !comment.createdAt || !Number.isFinite(Date.parse(comment.createdAt)))continue;
    const matches=enabled.filter(p=>p.figmaClientIds.includes(comment.userId!) && Date.parse(comment.createdAt!)>=Date.parse(p.startedAt));
    if(matches.length!==1)continue; // A corrupt/migrated routing collision fails closed too.
    const policy=matches[0];
    if(db.prepare("SELECT id FROM agent_messages WHERE run_id = ? AND source_id = ?").get(policy.runId,comment.id))continue;
    if(!comment.parentId) {
      try {createRequest(policy.runId,"figma",comment.id,comment.message);}catch {setRuntimeValue(`run-error:${policy.runId}`,"A client comment could not be accepted. Check the request length or demo request limit.");}
      continue;
    }
    const request=db.prepare("SELECT * FROM agent_requests WHERE run_id = ? AND source = 'figma' AND source_id = ?").get(policy.runId,comment.parentId) as unknown as AgentRequest;
    if(!request)continue; // Enabling does not retroactively quote old conversations.
    if(comment.message.length>4000 || messagesFor(request.id,request.run_id).length>=30) {exceptionFor(request,"This conversation exceeds the demo limits; review it directly in Figma.");continue;}
    transaction(()=>{
      appendMessage(request,"client",comment.message,comment.id);
      db.prepare("UPDATE agent_requests SET version = version + 1, assessment_id = NULL, updated_at = ? WHERE id = ?").run(now(),request.id);
      if(request.order_id || ["included","dismissed"].includes(request.state))exceptionFor(request,"Client replied after a decision; review the new request without changing the existing quote.");
      else db.prepare("UPDATE agent_requests SET state = 'queued', exception = NULL WHERE id = ?").run(request.id);
    });
  }
}
async function processRequest(request:AgentRequest,policy:AgentPolicy,deps:AgentDependencies) {
  db.prepare("UPDATE agent_requests SET state = 'processing', policy_version = ?, updated_at = ? WHERE id = ?").run(policy.version,now(),request.id);
  const project=getProjectForRun(request.run_id),messages=messagesFor(request.id,request.run_id).filter(m=>m.actor==="client");
  const requestText=messages.map(m=>m.body).join("\n");
  try {
    const cached=request.assessment_id ? getAssessment(request.assessment_id,request.run_id) : null;
    const record=cached ?? await deps.assess({project,comment:{id:request.source_id,message:request.text},
      replies:messages.slice(1).map(m=>({id:m.id,message:m.body})),automation:true},request.run_id);
    const fresh=current(request,policy);
    if(!fresh) {
      const remaining=requestById(request.id,request.run_id);
      if(remaining?.state==="processing")exceptionFor(remaining,"Policy or request changed during assessment. Review before retrying; nothing was sent.");
      return;
    }
    db.prepare("UPDATE agent_requests SET assessment_id = ? WHERE id = ?").run(record.id,request.id);
    const result=record.result;
    if(result.classification==="needs_clarification" || result.questions.length) {
      if(fresh.clarification_count>=2) {exceptionFor(fresh,"Two clarification rounds did not resolve this request; designer review is needed.");return;}
      transaction(()=>{
        db.prepare("UPDATE agent_requests SET state = 'needs_clarification', clarification_count = clarification_count + 1, updated_at = ? WHERE id = ?").run(now(),request.id);
        queueMessage(fresh,policy,`Before I can quote this request: ${result.questions.join(" ")}`,`clarify-${fresh.version}`);
      });return;
    }
    if(result.classification==="included") {
      transaction(()=>{
        db.prepare("UPDATE agent_requests SET state = 'included', updated_at = ? WHERE id = ?").run(now(),request.id);
        queueMessage(fresh,policy,"This request appears covered by the agreed brief and has been added to the included-work list. No extra invoice will be created. Delivery timing remains with your designer.",`included-${fresh.version}`);
      });return;
    }
    transaction(()=>{
      // The allowance check and published revision are one SQLite transaction.
      const decision=evaluateAutoQuote(project,result,policy,quotedTotal(request.run_id),requestText);
      if(!decision.allowed) {exceptionFor(fresh,decision.reason);return;}
      const draft=createChangeOrder({title:"Client change request",commentId:request.source==="figma" ? request.source_id : null,
        deliverables:decision.deliverables,lineItems:decision.lineItems,currency:"USD"},request.run_id);
      db.prepare("UPDATE change_orders SET assessment_id = ? WHERE id = ?").run(record.id,draft.id);
      const order=submitForApproval(draft.id);
      db.prepare("UPDATE agent_requests SET state = 'quoted', order_id = ?, quote_revision = ?, quoted_minor = ?, exception = NULL, updated_at = ? WHERE id = ?")
        .run(order.id,order.revision,order.totalMinor,now(),request.id);
      const terms=decision.lineItems.map(i=>`${i.quantity} × ${i.description}`).join("; ");
      queueMessage(fresh,policy,`Quote: ${terms}. Total USD $${(order.totalMinor/100).toFixed(2)}. Review and explicitly approve revision ${order.revision} in your private client portal. A PayPal sandbox invoice follows approval. Work begins after payment; delivery timing requires agreement.`, `quote-${order.revision}`);
    });
  } catch {
    const remaining=requestById(request.id,request.run_id);
    if(remaining?.state==="processing")exceptionFor(remaining,"Assessment could not complete. Check AI availability and budget, then retry. No quote was sent.");
  }
}
async function dispatch(deps:AgentDependencies,comments:FigmaComment[]|null) {
  const outbox=db.prepare("SELECT * FROM agent_outbox WHERE state IN ('pending','uncertain') ORDER BY created_at LIMIT 10").all() as any[];
  for(const item of outbox) {
    const request=requestById(item.request_id,item.run_id),policy=activeAgentPolicy(item.run_id),body=JSON.parse(item.body);
    if(!request || !policy || request.state==="dismissed" || policy.version!==body.policyVersion || request.version!==body.requestVersion) {
      db.prepare("UPDATE agent_outbox SET state = 'cancelled', updated_at = ? WHERE id = ?").run(now(),item.id);
      if(request && policy)exceptionFor(request,"A pending message was cancelled because the policy or request changed. Review delivery before sending again.");
      continue;
    }
    if(item.kind==="figma") {
      if(!policy.figmaReplies)continue;
      if(item.state==="uncertain") {
        if(!comments)continue;
        const delivered=comments.find(c=>c.parentId===request.source_id && c.message.includes(item.marker));
        if(delivered) {db.prepare("UPDATE agent_outbox SET state = 'sent', provider_id = ?, error = NULL, updated_at = ? WHERE id = ?").run(delivered.id,now(),item.id);continue;}
        // Absence in a single read is not proof of non-delivery. Do not resend.
        db.prepare("UPDATE agent_outbox SET state = 'review', error = 'Delivery uncertain; inspect Figma before sending manually', updated_at = ? WHERE id = ?").run(now(),item.id);
        exceptionFor(request,"Figma reply delivery is uncertain. The quote remains in the portal; inspect the thread before any manual reply.");continue;
      }
      db.prepare("UPDATE agent_outbox SET state = 'sending', attempts = attempts + 1, updated_at = ? WHERE id = ?").run(now(),item.id);
      try {
        const sent=await deps.postComment(getProjectForRun(item.run_id).figmaFileKey,request.source_id,body.text);
        db.prepare("UPDATE agent_outbox SET state = 'sent', provider_id = ?, updated_at = ? WHERE id = ?").run(sent.id,now(),item.id);
      } catch(error) {
        const denied=error instanceof FigmaRequestError && [400,401,403,404,429].includes(error.status);
        db.prepare("UPDATE agent_outbox SET state = ?, error = ?, updated_at = ? WHERE id = ?").run(denied?"review":"uncertain",denied?"Figma rejected the reply; check permission or rate limit":"Reply acknowledgement missing",now(),item.id);
        if(denied)exceptionFor(request,"Figma rejected the reply. Check comment-write permission and rate limits. The portal contains the quote.");
      }
    } else if(item.kind==="reminder") {
      if(!policy.paypalReminders)continue;
      if(item.state==="uncertain") {db.prepare("UPDATE agent_outbox SET state = 'review' WHERE id = ?").run(item.id);exceptionFor(request,"PayPal reminder delivery is uncertain. Check the invoice before sending any further reminder.");continue;}
      const order=request.order_id ? getChangeOrder(request.order_id) : null;
      if(!order?.paypalInvoiceId || order.paypalInvoiceId!==body.invoiceId || order.revision!==request.quote_revision)continue;
      try {
        const refreshed=await deps.refreshPaymentStatus(order.id);
        if(!current(request,policy))continue;
        if(refreshed.status!=="payment_due" || refreshed.paymentStatus!=="payment_due") {db.prepare("UPDATE agent_outbox SET state = 'cancelled' WHERE id = ?").run(item.id);continue;}
        db.prepare("UPDATE agent_outbox SET state = 'sending', attempts = attempts + 1, updated_at = ? WHERE id = ?").run(now(),item.id);
        await deps.remindInvoice(order.paypalInvoiceId);
        db.prepare("UPDATE agent_outbox SET state = 'sent', updated_at = ? WHERE id = ?").run(now(),item.id);
        appendMessage(request,"agent","A PayPal sandbox invoice reminder was sent.");
      } catch {db.prepare("UPDATE agent_outbox SET state = 'uncertain', error = 'Reminder acknowledgement missing', updated_at = ? WHERE id = ?").run(now(),item.id);}
    }
  }
}
async function trackPayments(enabled:AgentPolicy[],deps:AgentDependencies) {
  for(const policy of enabled) {
    const requests=db.prepare("SELECT * FROM agent_requests WHERE run_id = ? AND state = 'quoted' AND order_id IS NOT NULL").all(policy.runId) as unknown as AgentRequest[];
    for(const request of requests) {
      let order=getChangeOrder(request.order_id!);
      if(!order || order.revision!==request.quote_revision) {exceptionFor(request,"The published quote changed. Review its revision before further client actions.");continue;}
      if(order.paypalInvoiceId && order.status!=="paid" && Date.now()-Date.parse(order.lastCheckedAt??order.createdAt)>5*60_000) {
        const key=`payment-check:${order.id}`;
        if(Date.now()-Number(runtimeValue(key)||0)<5*60_000)continue;
        setRuntimeValue(key,String(Date.now()));
        try {order=await deps.refreshPaymentStatus(order.id);}catch {exceptionFor(request,"Payment reconciliation failed. Check the existing invoice; no replacement was created.");continue;}
        if(!current(request,policy))continue;
      }
      if(order.status==="paid") {
        transaction(()=>{
          db.prepare("UPDATE agent_requests SET state = 'paid', updated_at = ? WHERE id = ?").run(now(),request.id);
          queueMessage(request,policy,`PayPal confirms payment for approved revision ${order!.revision}. Your designer can now begin the agreed work.`,`paid-${order!.revision}`);
        });
      } else if(order.status==="approved" || order.status==="creating_invoice") {
        exceptionFor(request,"Client approval is saved, but invoice setup needs recovery. Use the existing order's invoice recovery action.");
      } else if(policy.paypalReminders && order.paypalInvoiceId && order.status==="payment_due" && order.paymentStatus==="payment_due") {
        const approval=db.prepare("SELECT created_at FROM approvals WHERE change_order_id = ? AND change_order_revision = ?").get(order.id,order.revision) as any;
        const age=Date.now()-Date.parse(approval?.created_at??now());
        const reminders=db.prepare("SELECT * FROM agent_outbox WHERE request_id = ? AND kind = 'reminder' ORDER BY created_at DESC").all(request.id) as any[];
        if(age<24*60*60_000 || reminders.length>=2 || reminders.some(r=>r.state!=="sent") || (reminders[0] && Date.now()-Date.parse(reminders[0].updated_at)<24*60*60_000))continue;
        const body=JSON.stringify({policyVersion:policy.version,requestVersion:request.version,invoiceId:order.paypalInvoiceId});
        db.prepare("INSERT INTO agent_outbox (id,run_id,request_id,kind,body,marker,created_at,updated_at) VALUES (?,?,?,'reminder',?,?,?,?)")
          .run(randomUUID(),request.run_id,request.id,body,`reminder-${order.id}-${reminders.length+1}`,now(),now());
      }
    }
  }
}
async function cycle(deps:AgentDependencies) {
  setRuntimeValue("worker-last-cycle",now());
  const enabled=policies();let comments:FigmaComment[]|null=null;
  if(enabled.some(p=>p.figmaClientIds.length) && Date.now()>=Number(runtimeValue("figma-next-check-at")||0)) {
    setRuntimeValue("figma-next-check-at",String(Date.now()+60_000));
    try {
      comments=await deps.fetchComments(config.figmaFileKey);setRuntimeValue("figma-last-success",now());setRuntimeValue("figma-error","");
      ingestComments(comments,policies());
    } catch(error) {
      const delay=error instanceof FigmaRequestError ? error.retryAfterSeconds*1000 : 60_000;
      setRuntimeValue("figma-next-check-at",String(Date.now()+Math.max(delay,60_000)));
      setRuntimeValue("figma-error","Figma comment checks are unavailable. Check token permissions and retry timing. Portal requests remain available.");
    }
  }
  const queued=db.prepare("SELECT * FROM agent_requests WHERE state = 'queued' ORDER BY created_at").all() as unknown as AgentRequest[];
  for(const request of queued) {const policy=activeAgentPolicy(request.run_id);if(policy){await processRequest(request,policy,deps);break;}}
  await trackPayments(policies(),deps);
  await dispatch(deps,comments);
}
export function runAgentCycle(overrides:Partial<AgentDependencies>={}) {
  if(running)return running;
  running=cycle({...defaults,...overrides}).finally(()=>{running=null;});return running;
}
export function recoverAgentJobs() {
  db.prepare("UPDATE agent_requests SET state = 'exception', exception = 'Assessment interrupted by a restart. Review and retry; no automatic second AI call was made.' WHERE state = 'processing'").run();
  db.prepare("UPDATE agent_outbox SET state = 'uncertain' WHERE state = 'sending'").run();
}
export function startAgentWorker() {
  recoverAgentJobs();
  const tick=()=>{void runAgentCycle().catch(()=>setRuntimeValue("worker-error","The agent cycle failed; inspect server health before retrying."));};
  const timer=setInterval(tick,5000);timer.unref();tick();
  return ()=>clearInterval(timer);
}
