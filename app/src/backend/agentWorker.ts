import {claimOutbound,beginOutbound,finishOutbound,recoverOutbound,requireUnpaidInvoice} from './outboundActions.js';
import {ScopedAccessError} from './context.js';
import type {ApprovedInvoiceTerms} from './paymentState.js';
import {runAssessmentWork} from './assessmentWork.js';
import {reservePolicyItems} from "./requestItems.js";
import {linkedOrders,recordPublishedOrder} from "./requestLinks.js";
import {randomUUID} from "node:crypto";
import {db,getProjectForRun,transaction} from "./db.js";
import {config} from "./env.js";
import {assess,getAssessment,type AssessmentResult} from "./assessment.js";
import {fetchComments,postComment,FigmaRequestError} from "./figma.js";
import {getInvoice,PayPalRequestError,remindInvoice} from "./paypal.js";
import {submitForApproval,getChangeOrder,refreshPaymentStatus,isInvoiceInFlight} from "./orders.js";
import {automaticReconciliationBlocked} from "./jobs.js";
import {activeAgentPolicy,evaluateAutoQuote,policyAuthority,type AgentPolicy} from "./agentPolicy.js";
import {createRequest,requestById,appendMessage,messagesFor,exceptionFor,attentionFor,quotedTotal,now,runtimeValue,setRuntimeValue,type AgentRequest} from "./agentStore.js";
import type {FigmaComment} from "../shared/types.js";

export interface AgentDependencies {
  fetchComments:typeof fetchComments;
  postComment:typeof postComment;
  assess:(input:Parameters<typeof assess>[0],runId:string)=>Promise<{id:string;result:AssessmentResult}>;
  refreshPaymentStatus:typeof refreshPaymentStatus;
  remindInvoice:typeof remindInvoice;
  getInvoice:typeof getInvoice;
}
const defaults:AgentDependencies={fetchComments,postComment,assess,refreshPaymentStatus,remindInvoice,getInvoice};
const markerPrefix="[Scope & Settle ";
let running:Promise<void>|null=null;
function policies():AgentPolicy[] {
  return (db.prepare("SELECT policy_json FROM agent_policies").all() as {policy_json:string}[]).map(r=>JSON.parse(r.policy_json)).filter(p=>p.enabled && policyAuthority(p));
}
function legacyOwned(request:AgentRequest){
  return !db.prepare("SELECT request_id FROM request_inbox WHERE request_id=? AND run_id=? AND execution_owner='inbox'").get(request.id,request.run_id);
}
function current(request:AgentRequest,policy:AgentPolicy) {
  const fresh=requestById(request.id,request.run_id),active=activeAgentPolicy(request.run_id);
  return fresh && legacyOwned(fresh) && active && active.version===policy.version && fresh.version===request.version && fresh.state!=="dismissed" ? fresh : null;
}
function queueMessage(request:AgentRequest,policy:AgentPolicy,text:string,key:string) {
  if(!current(request,policy))return;
  appendMessage(request,"agent",text,`agent:${request.id}:${key}`);
  if(request.source!=="figma" || !policy.figmaReplies)return;
  const marker=`${markerPrefix}${request.id}:${key}]`, at=now();
  const body=JSON.stringify({text:`${text}\n${marker}`,policyVersion:policy.version,requestVersion:request.version});
  db.prepare("INSERT OR IGNORE INTO agent_outbox (id,run_id,request_id,kind,body,marker,created_at,updated_at) VALUES (?,?,?,'figma',?,?,?,?)")
    .run(randomUUID(),request.run_id,request.id,body,marker,at,at);
}
function ingestComments(comments:FigmaComment[],enabled:AgentPolicy[]) {
  for(const comment of [...comments].sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)))) {
    if(db.prepare("SELECT request_id FROM request_inbox i JOIN agent_requests r ON r.id=i.request_id WHERE i.execution_owner='inbox' AND r.source='figma' AND (r.source_id=? OR r.source_id=?)").get(comment.id,comment.parentId??''))continue;
    if(db.prepare("SELECT id FROM agent_outbox WHERE kind='figma' AND provider_id=?").get(comment.id))continue;
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
  if(!current(request,policy))return;
  db.prepare("UPDATE agent_requests SET state = 'processing', policy_version = ?, updated_at = ? WHERE id = ?").run(policy.version,now(),request.id);
  const project=getProjectForRun(request.run_id),messages=messagesFor(request.id,request.run_id).filter(m=>m.actor==="client");
  const requestText=messages.map(m=>m.body).join("\n");
  try {
    const source={source:request.source,rootId:request.source_id,fileKey:request.source==='figma'?project.figmaFileKey:'',messages:messages.map(m=>({id:m.source_id??m.id,message:m.body}))};
    const authorize=()=>{if(!current(request,policy)||!policyAuthority(policy))throw new Error('Policy or request authority changed');};
    const record=await runAssessmentWork(request.run_id,source,{project,comment:source.messages[0],replies:source.messages.slice(1),automation:true,itemized:true},authorize,deps.assess);
    const fresh=current(request,policy);
    if(!fresh) {
      const remaining=requestById(request.id,request.run_id);
      if(remaining?.state==="processing")exceptionFor(remaining,"Policy or request changed during assessment. Review before retrying; nothing was sent.");
      return;
    }
    db.prepare("UPDATE agent_requests SET assessment_id = ? WHERE id = ?").run(record.id,request.id);
    const itemRecord=record;
    const result=itemRecord.result;
    if(itemRecord.items.some((i:import("../shared/types.js").AssessmentItem)=>i.existingCommitment||i.lineageItemIds.length)||new Set(itemRecord.items.map((i:import("../shared/types.js").AssessmentItem)=>i.classification)).size>1){exceptionFor(fresh,'Mixed or suspected duplicate work requires designer item review.');return;}
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
      const binding=reservePolicyItems(policy,itemRecord.items.map((i:import("../shared/types.js").AssessmentItem)=>i.id),`auto:${request.id}:${request.version}`);
      const order=submitForApproval(binding.orderId);
      recordPublishedOrder(fresh,order.id,order.revision);
      db.prepare("UPDATE agent_requests SET state = 'quoted', exception = NULL, updated_at = ? WHERE id = ?").run(now(),request.id);
      const terms=decision.lineItems.map(i=>`${i.quantity} × ${i.description}`).join("; ");
      queueMessage(fresh,policy,`Quote: ${terms}. Total USD $${(order.totalMinor/100).toFixed(2)}. Review and explicitly approve revision ${order.revision} in your private client portal. A PayPal sandbox invoice follows approval. Work begins after payment; delivery timing requires agreement.`, `quote-${order.revision}`);
    });
  } catch {
    const remaining=requestById(request.id,request.run_id);
    if(remaining?.state==="processing")exceptionFor(remaining,"Assessment could not complete. Check AI availability and budget, then retry. No quote was sent.");
  }
}
async function dispatch(
  deps: AgentDependencies,
  comments: FigmaComment[] | null,
) {
  // Only never-dispatched work can become cancelled. Possible sends remain visible for review.
  db.prepare(
    `UPDATE agent_outbox SET state=CASE WHEN state='pending' AND attempts=0 THEN 'cancelled' ELSE 'uncertain' END,
    error='Legacy channel authority does not cover this inbox request',updated_at=?
    WHERE state IN ('pending','uncertain') AND NOT EXISTS(SELECT 1 FROM outbound_operations o WHERE o.outbox_id=agent_outbox.id AND o.authority='human_review') AND EXISTS(SELECT 1 FROM request_inbox i WHERE i.request_id=agent_outbox.request_id AND i.run_id=agent_outbox.run_id AND i.execution_owner='inbox')`,
  ).run(now());
  const outbox = db
    .prepare(
      "SELECT o.* FROM agent_outbox o WHERE state IN ('pending','uncertain') AND NOT EXISTS(SELECT 1 FROM outbound_operations a WHERE a.outbox_id=o.id AND a.authority='human_review') AND NOT EXISTS(SELECT 1 FROM request_inbox i WHERE i.request_id=o.request_id AND i.run_id=o.run_id AND i.execution_owner='inbox') ORDER BY created_at LIMIT 10",
    )
    .all() as any[];
  for (const item of outbox) {
    const request = requestById(item.request_id, item.run_id),
      policy = activeAgentPolicy(item.run_id),
      body = JSON.parse(item.body);
    if (
      !request ||
      !policy ||
      !current(request, policy) ||
      policy.version !== body.policyVersion ||
      request.version !== body.requestVersion
    ) {
      db.prepare(
        "UPDATE agent_outbox SET state = ?, updated_at = ? WHERE id = ?",
      ).run(
        item.state === "uncertain" ? "uncertain" : "cancelled",
        now(),
        item.id,
      );
      if (request && policy)
        attentionFor(
          request,
          "A pending message was cancelled because the policy or request changed. Review delivery before sending again.",
        );
      continue;
    }
    if (item.kind === "figma") {
      if (!policy.figmaReplies) continue;
      if (item.state === "uncertain") {
        if (!comments) continue;
        // A marker may be copied by a client. Without a verified posting identity,
        // even a unique match cannot establish this attempt's receipt.
        attentionFor(
          request,
          "Figma reply delivery is uncertain. Inspect its recorded thread before another message.",
        );
        continue;
      }
      if (Date.now() < Number(runtimeValue("figma-next-send-at") || 0))
        continue;
      if (!current(request, policy)) continue;
      setRuntimeValue("figma-next-send-at", String(Date.now() + 30_000));
      try {
        claimOutbound({
          id: item.id,
          runId: item.run_id,
          authority: "policy",
          kind: "figma",
        });
        const authorize = () => {
          if (!current(request, policy))
            throw new Error("Channel authority changed");
        };
        authorize();
        beginOutbound(item.id);
        const sent = await deps.postComment(
          getProjectForRun(item.run_id).figmaFileKey,
          request.source_id,
          body.text,
          () => {
            if (!current(request, policy))
              throw new Error("Channel authority changed");
          },
        );
        finishOutbound(item.id, "acknowledged", {
          providerId: sent.id,
          message: "Figma acknowledged the reply; delivery unverified",
        });
        const authorized = !!current(request, policy);
        db.prepare(
          "UPDATE agent_outbox SET state = 'sent', provider_id = ?, error=?, updated_at = ? WHERE id = ?",
        ).run(
          sent.id,
          authorized
            ? null
            : "Reply acknowledged after channel authority changed; review delivery",
          now(),
          item.id,
        );
        if (!authorized)
          attentionFor(
            request,
            "A reply was acknowledged after channel authority changed. Inspect its recorded provider reference.",
          );
      } catch (error) {
        const denied =
          error instanceof ScopedAccessError ||
          (error instanceof FigmaRequestError &&
            [400, 401, 403, 404, 429].includes(error.status));
        if (error instanceof FigmaRequestError && error.status === 429)
          setRuntimeValue(
            "figma-next-send-at",
            String(Date.now() + error.retryAfterSeconds * 1000),
          );
        finishOutbound(item.id, denied ? "denied" : "uncertain", {
          message: denied
            ? "Figma rejected the reply"
            : "Reply acknowledgement missing",
        });
        db.prepare(
          "UPDATE agent_outbox SET state = ?, error = ?, updated_at = ? WHERE id = ?",
        ).run(
          denied ? "review" : "uncertain",
          denied
            ? "Figma rejected the reply; check permission or rate limit"
            : "Reply acknowledgement missing",
          now(),
          item.id,
        );
        if (denied)
          attentionFor(
            request,
            "Figma rejected the reply. Check comment-write permission and rate limits. The portal contains the quote.",
          );
      }
    } else if (item.kind === "reminder") {
      if (!policy.paypalReminders) continue;
      if (item.state === "uncertain") {
        attentionFor(
          request,
          "PayPal reminder delivery is uncertain. Check the invoice before any further reminder.",
        );
        continue;
      }
      const ref = linkedOrders(request).find((r) =>
        body.orderId
          ? r.order_id === body.orderId && r.revision === body.revision
          : r.order_id === request.order_id &&
            r.revision === request.quote_revision,
      );
      const order = ref ? getChangeOrder(ref.order_id) : null;
      if (
        !order?.paypalInvoiceId ||
        order.paypalInvoiceId !== body.invoiceId ||
        order.revision !== ref?.revision
      )
        continue;
      if (automaticReconciliationBlocked(order.paypalInvoiceId)) continue;
      const authorize = () => {
        if (!current(request, policy))
          throw new Error("Channel authority changed");
        const live = getChangeOrder(order.id);
        if (
          !live ||
          live.revision !== ref!.revision ||
          live.paypalInvoiceId !== body.invoiceId ||
          !linkedOrders(request).some(
            (r) => r.order_id === live.id && r.revision === live.revision,
          )
        )
          throw new Error("Exact invoice revision changed");
      };
      try {
        const refreshed = await deps.refreshPaymentStatus(order.id, authorize);
        authorize();
        if (
          refreshed.status !== "payment_due" ||
          refreshed.paymentStatus !== "payment_due"
        )
          throw new Error("Invoice is no longer unpaid");
        const operation = db
          .prepare(
            "SELECT approved_terms_json FROM invoice_operations WHERE change_order_id=?",
          )
          .get(order.id) as any;
        const approval = db
          .prepare(
            "SELECT created_at FROM approvals WHERE change_order_id=? AND change_order_revision=? AND actor_role='client'",
          )
          .get(order.id, order.revision) as any;
        if (!operation?.approved_terms_json || !approval)
          throw new Error("Immutable approved invoice terms required");
        const terms: ApprovedInvoiceTerms = {
          ...JSON.parse(operation.approved_terms_json),
          invoiceId: order.paypalInvoiceId,
        };
        const detail = await deps.getInvoice(order.paypalInvoiceId, () => {
          authorize();
          return true;
        });
        authorize();
        requireUnpaidInvoice(detail, terms);
        // Existing policy authorizes the buyer only, never merchant or existing CCs.
        if ((detail.raw.additional_recipients ?? []).length)
          throw new Error("Existing invoice CCs need explicit human review");
        const buyers = detail.raw.primary_recipients;
        if (
          !Array.isArray(buyers) ||
          buyers.length !== 1 ||
          buyers[0]?.billing_info?.email_address?.toLowerCase() !==
            config.paypalBuyerEmail.toLowerCase()
        )
          throw new Error("Buyer recipient changed; human review required");
        claimOutbound({
          id: item.id,
          runId: item.run_id,
          authority: "policy",
          kind: "reminder",
          invoiceId: order.paypalInvoiceId,
          approvalAt: approval.created_at,
        });
        authorize();
        await deps.remindInvoice(
          order.paypalInvoiceId,
          () => {
            authorize();
            return true;
          },
          () => beginOutbound(item.id),
        );
        finishOutbound(item.id, "acknowledged", {
          message: "PayPal acknowledged the reminder; delivery unverified",
        });
        if (current(request, policy))
          appendMessage(
            request,
            "agent",
            "PayPal acknowledged an invoice reminder; recipient delivery is unverified.",
          );
        else
          attentionFor(
            request,
            "A reminder was acknowledged after channel authority changed. Review delivery.",
          );
      } catch (error) {
        const operation = db
          .prepare(
            "SELECT dispatch_started FROM outbound_operations WHERE outbox_id=?",
          )
          .get(item.id) as any;
        const rejected =
          error instanceof PayPalRequestError &&
          error.status !== null &&
          error.status >= 400 &&
          error.status < 500;
        const state =
          operation?.dispatch_started && !rejected ? "uncertain" : "denied";
        finishOutbound(
          item.id,
          state,
          {
            message:
              state === "uncertain"
                ? "Reminder outcome is uncertain; do not resend"
                : "Reminder was blocked before acknowledgement",
          },
          error instanceof PayPalRequestError ? error.retryAfterAt : null,
        );
      }
    }
  }
}
async function trackPayments(enabled:AgentPolicy[],deps:AgentDependencies) {
  for(const policy of enabled) {
    const requests=db.prepare("SELECT r.* FROM agent_requests r WHERE run_id = ? AND state IN ('quoted','exception','paid') AND order_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM request_inbox i WHERE i.request_id=r.id AND i.run_id=r.run_id AND i.execution_owner='inbox')").all(policy.runId) as unknown as AgentRequest[];
    for(const request of requests) {for(const ref of linkedOrders(request)){
      if(!current(request,policy))continue;
      let order=getChangeOrder(ref.order_id);
      if(!order || order.revision!==ref.revision) {exceptionFor(request,"The published quote changed. Review its revision before further client actions.");continue;}
      // The independent durable worker owns periodic PayPal reads and backoff.
      // This policy worker consumes the persisted projection; reminders still
      // perform their immediate pre-send authoritative check above.
      if(order.status==="paid") {
        transaction(()=>{
          if(!current(request,policy))return;
          if(request.state==="quoted"&&linkedOrders(request).every(r=>getChangeOrder(r.order_id)?.status==='paid')&&!(request.assessment_id?getAssessment(request.assessment_id,request.run_id)?.items??[]:[]).some((i:import('../shared/types.js').AssessmentItem)=>!i.reservationState&&i.classification!=='included'&&i.duplicateDecision!=='same_commitment'))db.prepare("UPDATE agent_requests SET state = 'paid', updated_at = ? WHERE id = ?").run(now(),request.id);
          queueMessage(request,policy,`PayPal confirms payment for approved revision ${order!.revision}. Your designer can now begin the agreed work.`,`paid-${order!.id}-${order!.revision}`);
        });
      } else if(order.status==="approved" || order.status==="creating_invoice") {
        if(!isInvoiceInFlight(order.id))attentionFor(request,"Client approval is saved, but invoice setup needs recovery. Use the existing order's invoice recovery action.");
      } else if(request.state==="quoted" && policy.paypalReminders && order.paypalInvoiceId && order.status==="payment_due" && order.paymentStatus==="payment_due") {
        if(!current(request,policy))continue;
        const approval=db.prepare("SELECT created_at FROM approvals WHERE change_order_id = ? AND change_order_revision = ?").get(order.id,order.revision) as any;
        const age=Date.now()-Date.parse(approval?.created_at??now());
        const reminders=db.prepare("SELECT * FROM agent_outbox WHERE kind = 'reminder' AND json_extract(body,'$.invoiceId')=? ORDER BY created_at DESC").all(order.paypalInvoiceId) as any[];
        if(age<24*60*60_000 || reminders.length>=2 || reminders.some(r=>r.state!=="sent") || (reminders[0] && Date.now()-Date.parse(reminders[0].updated_at)<24*60*60_000))continue;
        const body=JSON.stringify({policyVersion:policy.version,requestVersion:request.version,invoiceId:order.paypalInvoiceId,orderId:order.id,revision:order.revision});
        db.prepare("INSERT INTO agent_outbox (id,run_id,request_id,kind,body,marker,created_at,updated_at) VALUES (?,?,?,'reminder',?,?,?,?)")
          .run(randomUUID(),request.run_id,request.id,body,`reminder-${order.id}-${reminders.length+1}`,now(),now());
      }
    }}
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
  const queued=db.prepare("SELECT * FROM agent_requests r WHERE state='queued' AND NOT EXISTS(SELECT 1 FROM request_inbox i WHERE i.request_id=r.id AND i.execution_owner='inbox') ORDER BY created_at").all() as unknown as AgentRequest[];
  for(const request of queued) {const policy=activeAgentPolicy(request.run_id);if(policy){await processRequest(request,policy,deps);break;}}
  await trackPayments(policies(),deps);
  await dispatch(deps,comments);
  setRuntimeValue("worker-error","");
}
export function runAgentCycle(overrides:Partial<AgentDependencies>={}) {
  if(running)return running;
  running=cycle({...defaults,...overrides}).finally(()=>{running=null;});return running;
}
export function recoverAgentJobs() {
  recoverOutbound();
  db.prepare("UPDATE agent_requests SET state = 'exception', exception = 'Assessment interrupted by a restart. Review and retry; no automatic second AI call was made.' WHERE state = 'processing'").run();
  db.prepare("UPDATE agent_outbox SET state = 'uncertain' WHERE state = 'sending'").run();
}
export function startAgentWorker() {
  recoverAgentJobs();
  const tick=()=>{void runAgentCycle().catch(()=>setRuntimeValue("worker-error","The agent cycle failed; inspect server health before retrying."));};
  const timer=setInterval(tick,5000);timer.unref();tick();
  return async()=>{clearInterval(timer);await running?.catch(()=>{});};
}
