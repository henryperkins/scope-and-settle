import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { config, assertConfigured, APP_ROOT } from "./env.js";
import { getProjectForRun, updateScopeBaseline } from "./db.js";
import { fetchComments } from "./figma.js";
import {
  createChangeOrder, listChangeOrders, getChangeOrder, ensureInvoice, refreshPaymentStatus,
  editChangeOrder, submitForApproval, approveChangeOrder, resetDemoRun,
} from "./orders.js";
import { createSession, getSession, revokeSession, createInvitation, redeemInvitation } from "./sessions.js";
import { aiBudget } from "./aiBudget.js";
import { assess, getAssessment } from "./assessment.js";
import { db } from "./db.js";
import { receiveWebhook } from "./webhooks.js";
import { startJudgeRun, renewJudgeSession, createClientAccess, resetJudgeRun } from "./judging.js";
import {getAgentPolicy,saveAgentPolicy,policyAuthority} from "./agentPolicy.js";
import {listRequests,messagesFor,quotedTotal,runtimeValue} from "./agentStore.js";
import {getPortalSession,portalView,addPortalRequest,replyToRequest,approvePortalQuote,refreshPortalPayment,createPortalAccess,handleAgentRequest,publishReviewedQuote} from "./agentPortal.js";
import {startAgentWorker} from "./agentWorker.js";

function json(res: ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(text);
}

async function readBody(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 2_500_000) throw new Error("Request too large");
    chunks.push(c as Buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${config.port}`);
  const path = url.pathname;
  try {
    if (req.method === "OPTIONS") return json(res, 204, {});
    const publicFiles: Record<string, string> = { "/": "judge.html", "/judge": "judge.html", "/designer": "designer.html", "/review": "review.html", "/client":"client.html", "/assets/client.js":"client.js", "/assets/agent.js":"agent.js",
      "/assets/style.css": "style.css", "/assets/common.js": "common.js", "/assets/proposal.js": "proposal.js", "/assets/figma-bridge.js": "figma-bridge.js", "/assets/designer.js": "designer.js", "/assets/judge.js": "judge.js", "/assets/review.js": "review.js" };
    if (req.method === "GET" && publicFiles[path]) {
      const file = publicFiles[path];
      res.writeHead(200, { "Content-Type": file.endsWith(".html") ? "text/html; charset=utf-8" : file.endsWith(".css") ? "text/css" : "text/javascript",
        "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'" });
      return res.end(readFileSync(resolve(APP_ROOT, "web", file)));
    }
    if (path === "/health") {
      const missing = assertConfigured();
      return json(res, 200, { ok: missing.length === 0, missing, paypalEnv: config.paypalEnv });
    }
    const metadataPath = resolve(APP_ROOT, "downloads/plugin.json");
    const plugin = existsSync(metadataPath) ? JSON.parse(readFileSync(metadataPath, "utf8")) : null;
    if (path === "/api/demo-info" && req.method === "GET") return json(res, 200, {
      figmaUrl: `https://www.figma.com/design/${encodeURIComponent(config.figmaFileKey)}/Scope-and-Settle`, plugin,
    });
    if (req.method === "GET" && (path === "/JUDGING.md" || path === "/downloads/plugin.zip" || path === "/downloads/plugin.json" || path === "/downloads/SHA256SUMS" ||
        (plugin && path === `/downloads/${plugin.filename}` && /^scope-and-settle-[a-zA-Z0-9.-]+\.zip$/.test(plugin.filename)))) {
      const file = path === "/JUDGING.md" ? resolve(APP_ROOT, "JUDGING.md") : resolve(APP_ROOT, "downloads", path.split("/").pop()!);
      if (!existsSync(file)) return json(res, 404, { error: "This release has no plugin package yet" });
      res.writeHead(200, { "Content-Type": path.endsWith(".zip") ? "application/zip" : path.endsWith(".json") ? "application/json" : "text/plain; charset=utf-8",
        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
        ...(path.endsWith(".zip") ? { "Content-Disposition": `attachment; filename="${plugin.filename}"` } : {}) });
      return res.end(readFileSync(file));
    }
    if (path === "/webhooks/paypal" && req.method === "POST") {
      const event = await readBody(req);
      const eventId = typeof event?.id === "string" ? event.id.slice(0, 100) : null;
      try {
        const result = await receiveWebhook(req.headers, event);
        console.info(JSON.stringify({ component: "paypal_webhook", eventId, state: result?.state ?? "rejected" }));
        return result ? json(res, 200, result) : json(res, 401, { error: "Webhook verification failed" });
      } catch (error) {
        // No payload, authorization header, certificate URL, or signature in logs.
        console.warn(JSON.stringify({ component: "paypal_webhook", eventId, state: "error" }));
        throw error;
      }
    }
    if (path === "/api/session/redeem" && req.method === "POST") {
      const b = await readBody(req);
      const redeemed = redeemInvitation(String(b.invitation ?? ""));
      return redeemed ? json(res, 200, redeemed) : json(res, 401, { error: "Invitation is expired, used, revoked or superseded. Ask the designer for a fresh link." });
    }
    if ((path === "/api/judge/start" || path === "/api/session/renew") && req.method === "POST") {
      const b = await readBody(req);
      const issued = path === "/api/judge/start" ? startJudgeRun(b.credential) : renewJudgeSession(b.credential);
      return issued ? json(res, path === "/api/judge/start" ? 201 : 200, issued) :
        json(res, 401, { error: "Access is expired, revoked, reset or superseded. Return to judge entry for a fresh run." });
    }
    const bearer=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if(path==="/api/portal" || path.startsWith("/api/portal/")) {
      const portal=getPortalSession(bearer??"");
      if(!portal)return json(res,401,{error:"Client portal access expired, revoked or reset. Ask the designer for a new private link."});
      if(path==="/api/portal" && req.method==="GET")return json(res,200,portalView(portal));
      if(path==="/api/portal/requests" && req.method==="POST") {const b=await readBody(req);return json(res,201,addPortalRequest(portal,b.text,b.key));}
      const action=path.match(/^\/api\/portal\/requests\/([^/]+)\/(reply|approve|payment-status)$/);
      if(action && req.method==="POST") {
        const b=await readBody(req);
        if(action[2]==="reply")return json(res,200,replyToRequest(portal,action[1],b.text,b.key));
        if(action[2]==="approve")return json(res,200,await approvePortalQuote(portal,action[1],b.revision,b.consent));
        return json(res,200,await refreshPortalPayment(portal,action[1]));
      }
      return json(res,404,{error:"Portal route not found"});
    }
    const session = getSession(bearer);
    if (!session) return json(res, 401, { error: "Missing, expired, or revoked session" });
    if (session.projectId !== "demo") return json(res, 403, { error: "Session does not grant access to this project" });
    const scopedOrder = path.match(/^\/api\/change-orders\/([^/]+)(?:\/(submit|approve|invoice|payment-status|client-access))?$/);
    if (scopedOrder) {
      const order = getChangeOrder(scopedOrder[1]);
      if (!order) return json(res, 404, { error: "Change order not found" });
      if (order.projectId !== session.projectId || order.runId !== session.runId || (session.role === "client" &&
          (session.changeOrderId !== order.id || session.changeOrderRevision !== order.revision))) {
        return json(res, 403, { error: "Session does not grant access to this proposal revision" });
      }
    }
    const clientAction = (path === "/api/session" && req.method === "GET") || (scopedOrder && ((req.method === "GET" && (!scopedOrder[2] || scopedOrder[2] === "payment-status")) ||
      (req.method === "POST" && scopedOrder[2] === "approve")));
    if (session.role !== "designer" && !clientAction) return json(res, 403, { error: "Requires designer role" });
    if (path === "/api/session" && req.method === "GET") return json(res, 200, session);
    if(path==="/api/agent" && req.method==="GET") {
      const policy=getAgentPolicy(session.runId);
      const {ownerGrantId,ownerSessionHash,...publicPolicy}=policy??{};
      return json(res,200,{policy:policy?publicPolicy:null,authorityValid:policy?policyAuthority(policy):false,quotedMinor:quotedTotal(session.runId),
        portalReady:!!db.prepare("SELECT id FROM agent_portals WHERE run_id = ? AND revoked = 0 AND expires_at > ?").get(session.runId,new Date().toISOString()),
        lastCycle:runtimeValue("worker-last-cycle"),figmaLastSuccess:runtimeValue("figma-last-success"),figmaNextCheckAt:runtimeValue("figma-next-check-at"),
        error:runtimeValue(`run-error:${session.runId}`)||runtimeValue("worker-error")||(policy?.figmaClientIds.length?runtimeValue("figma-error"):null),
        requests:listRequests(session.runId).map(r=>({...r,messages:messagesFor(r.id,r.run_id)})),
        deliveries:db.prepare("SELECT request_id,kind,state,error,updated_at FROM agent_outbox WHERE run_id = ? ORDER BY created_at DESC LIMIT 50").all(session.runId)});
    }
    if(path==="/api/agent/policy" && req.method==="POST") {
      const {ownerGrantId,ownerSessionHash,...policy}=saveAgentPolicy(session,await readBody(req));return json(res,200,policy);
    }
    if(path==="/api/agent/portal-access" && req.method==="POST")return json(res,201,createPortalAccess(session));
    const agentAction=path.match(/^\/api\/agent\/requests\/([^/]+)\/(retry|dismiss|publish|acknowledge)$/);
    if(agentAction && req.method==="POST") {
      if(agentAction[2]==="publish") {const b=await readBody(req);return json(res,200,publishReviewedQuote(session,agentAction[1],b.orderId,b.revision,b.consent));}
      return json(res,200,handleAgentRequest(session,agentAction[1],agentAction[2] as "retry"|"dismiss"|"acknowledge"));
    }
    if (path === "/api/project" && req.method === "GET") {
      return json(res, 200, getProjectForRun(session.runId));
    }
    if (path === "/api/comments" && req.method === "GET") {
      const project = getProjectForRun(session.runId);
      const comments = await fetchComments(project.figmaFileKey);
      return json(res, 200, { fileKey: project.figmaFileKey, fetchedAt: new Date().toISOString(), comments });
    }
    if (path === "/api/assessments" && req.method === "POST") {
      const b = await readBody(req);
      const project = getProjectForRun(session.runId);
      if (b.imageDataUrl && b.figmaFileKey !== project.figmaFileKey) return json(res, 400, { error: "Attach a frame from the designated Figma file" });
      const comments = await fetchComments(project.figmaFileKey);
      const comment = comments.find(c => c.id === b.commentId);
      if (!comment) return json(res, 400, { error: "Select an actual comment in the configured file" });
      const replies = comments.filter(c => c.parentId === comment.id);
      if (b.clarification) replies.push({ ...comment, id: "designer-provided-reply", message: String(b.clarification).slice(0, 4000) });
      return json(res, 201, await assess({ project, comment, replies,
        designContext: String(b.designContext ?? ""), imageDataUrl: b.imageDataUrl }, session.runId));
    }
    const assessmentMatch = path.match(/^\/api\/assessments\/([^/]+)$/);
    if (assessmentMatch && req.method === "GET") {
      const record = getAssessment(assessmentMatch[1], session.runId);
      return record ? json(res, 200, record) : json(res, 404, { error: "Assessment not found" });
    }
    if (path === "/api/change-orders" && req.method === "GET") {
      return json(res, 200, listChangeOrders(session.runId));
    }
    if (path === "/api/change-orders" && req.method === "POST") {
      const b = await readBody(req);
      if (b.assessmentId) {
        const a = getAssessment(String(b.assessmentId), session.runId);
        if (!a || a.result.classification !== "new_work" || a.scopeRevisionId !== getProjectForRun(session.runId).scopeRevisionId) {
          return json(res, 409, { error: "A current new-work assessment is required; reassess the request" });
        }
      }
      const order = createChangeOrder({
        title: String(b.title ?? "Change order"),
        commentId: b.commentId ?? null,
        deliverables: Array.isArray(b.deliverables) ? b.deliverables : [],
        lineItems: Array.isArray(b.lineItems) ? b.lineItems : [],
        currency: String(b.currency ?? "USD"),
      }, session.runId);
      if (b.assessmentId) db.prepare("UPDATE change_orders SET assessment_id = ? WHERE id = ?").run(String(b.assessmentId), order.id);
      return json(res, 201, getChangeOrder(order.id));
    }
    if (path === "/api/project/scope" && req.method === "POST") {
      if (!session.canEditScope) return json(res, 403, { error: "The judging brief and rate card are fixed for this run" });
      const b = await readBody(req);
      if (!Array.isArray(b.clauses) || b.clauses.length === 0) return json(res, 400, { error: "clauses required" });
      return json(res, 200, updateScopeBaseline(b.clauses));
    }
    if (path === "/api/sessions" && req.method === "POST") {
      const b = await readBody(req);
      const order = getChangeOrder(String(b.changeOrderId ?? ""));
      if (b.role !== "client" || !order || order.runId !== session.runId || order.status !== "awaiting_client_approval") {
        return json(res, 400, { error: "Only client access to a submitted proposal can be issued here" });
      }
      if (session.grantId) return json(res, 201, createClientAccess(session, order));
      const issued = createSession({
        projectId: session.projectId, runId: session.runId, role: "client",
        changeOrderId: order.id, changeOrderRevision: order.revision,
      });
      return json(res, 201, issued);
    }
    if (path === "/api/sessions/revoke" && req.method === "POST") {
      const b = await readBody(req);
      const target = db.prepare("SELECT project_id, run_id FROM sessions WHERE token = ?").get(String(b.token ?? "")) as any;
      if (target && (target.project_id !== session.projectId || target.run_id !== session.runId)) return json(res, 403, { error: "Session belongs to another project/run" });
      revokeSession(String(b.token ?? ""));
      return json(res, 200, { revoked: true });
    }
    if (path === "/api/demo/reset" && req.method === "POST") {
      if (session.grantId) return json(res, 200, resetJudgeRun(session));
      const reset = resetDemoRun(session.runId);
      return json(res, 200, { ...reset, session: createSession({ projectId: session.projectId, role: "designer", runId: reset.runId }) });
    }
    if (path === "/api/ai-budget" && req.method === "GET") {
      return json(res, 200, aiBudget.status());
    }
    const submitMatch = path.match(/^\/api\/change-orders\/([^/]+)\/submit$/);
    if (submitMatch && req.method === "POST") {
      const order = submitForApproval(submitMatch[1]);
      if (session.grantId) return json(res, 200, { order, ...createClientAccess(session, order) });
      const link = createInvitation({ projectId: "demo", role: "client", runId: session.runId, changeOrderId: order.id, changeOrderRevision: order.revision });
      return json(res, 200, { order, approvalUrl: `${config.publicUrl}/review#${link.token}`, approvalExpiresAt: link.expiresAt });
    }
    if (scopedOrder?.[2] === "client-access" && req.method === "POST") {
      const order = getChangeOrder(scopedOrder[1])!;
      if (!session.grantId) return json(res, 400, { error: "Use submit to issue a development invitation" });
      return json(res, 200, createClientAccess(session, order));
    }
    const approveMatch = path.match(/^\/api\/change-orders\/([^/]+)\/approve$/);
    if (approveMatch && req.method === "POST") {
      if (session.role !== "client") return json(res, 403, { error: "Requires client role" });
      const order = approveChangeOrder(approveMatch[1], session);
      try { return json(res, 200, await ensureInvoice(order.id)); }
      catch (error) { return json(res, 200, { ...getChangeOrder(order.id), invoiceError: error instanceof Error ? error.message : "Invoice preparation failed; approval is saved" }); }
    }
    const editMatch = path.match(/^\/api\/change-orders\/([^/]+)$/);
    if (editMatch && req.method === "PATCH") {
      const b = await readBody(req);
      const order = editChangeOrder(editMatch[1], { title: b.title, deliverables: b.deliverables, lineItems: b.lineItems });
      return json(res, 200, order);
    }
    const invoiceMatch = path.match(/^\/api\/change-orders\/([^/]+)\/invoice$/);
    if (invoiceMatch && req.method === "POST") {
      const order = await ensureInvoice(invoiceMatch[1]);
      return json(res, 200, order);
    }
    const statusMatch = path.match(/^\/api\/change-orders\/([^/]+)\/payment-status$/);
    if (statusMatch && req.method === "GET") {
      const order = await refreshPaymentStatus(statusMatch[1]);
      return json(res, 200, order);
    }
    const orderMatch = path.match(/^\/api\/change-orders\/([^/]+)$/);
    if (orderMatch && req.method === "GET") {
      const order = getChangeOrder(orderMatch[1]);
      return order ? json(res, 200, order) : json(res, 404, { error: "not found" });
    }
    return json(res, 404, { error: `No route ${req.method} ${path}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /not found/i.test(message) ? 404 : /baseline|revision|immutable|requires.*approval|Cannot approve|wait for|already belongs|paused|already exists|needs designer/i.test(message) ? 409 :
      /Invalid|unexpected|too large|required|Provide|Unknown rate|supports USD|JSON/i.test(message) ? 400 : 502;
    return json(res, status, { error: message });
  }
});

// Test fixtures opt out; production work is driven by durable approved policies.
const stopAgent=process.env.AGENT_WORKER_DISABLED==="true" ? ()=>{} : startAgentWorker();
server.on("close",stopAgent);

server.listen(config.port, config.host, () => {
  const missing = assertConfigured();
  console.log(`Scope & Settle backend listening on http://localhost:${config.port}`);
  if (missing.length) console.log(`Missing config: ${missing.join(", ")}`);
});
