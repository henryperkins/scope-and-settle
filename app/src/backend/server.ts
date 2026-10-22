import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config, assertConfigured, APP_ROOT } from "./env.js";
import { getProject, updateScopeBaseline } from "./db.js";
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
    const publicFiles: Record<string, string> = { "/": "designer.html", "/designer": "designer.html", "/review": "review.html",
      "/assets/style.css": "style.css", "/assets/common.js": "common.js", "/assets/designer.js": "designer.js", "/assets/review.js": "review.js" };
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
    if (path === "/webhooks/paypal" && req.method === "POST") {
      const result = await receiveWebhook(req.headers, await readBody(req));
      return result ? json(res, 200, result) : json(res, 401, { error: "Webhook verification failed" });
    }
    if (path === "/api/session/redeem" && req.method === "POST") {
      const b = await readBody(req);
      const redeemed = redeemInvitation(String(b.invitation ?? ""));
      return redeemed ? json(res, 200, redeemed) : json(res, 401, { error: "Invitation is expired, used, revoked or superseded. Ask the designer for a fresh link." });
    }
    const session = getSession(req.headers.authorization?.match(/^Bearer (.+)$/)?.[1]);
    if (!session) return json(res, 401, { error: "Missing, expired, or revoked session" });
    if (session.projectId !== "demo") return json(res, 403, { error: "Session does not grant access to this project" });
    const scopedOrder = path.match(/^\/api\/change-orders\/([^/]+)(?:\/(submit|approve|invoice|payment-status))?$/);
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
    if (path === "/api/project" && req.method === "GET") {
      return json(res, 200, getProject());
    }
    if (path === "/api/comments" && req.method === "GET") {
      const project = getProject();
      const comments = await fetchComments(project.figmaFileKey);
      return json(res, 200, { fileKey: project.figmaFileKey, fetchedAt: new Date().toISOString(), comments });
    }
    if (path === "/api/assessments" && req.method === "POST") {
      const b = await readBody(req);
      const project = getProject();
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
        if (!a || a.result.classification !== "new_work" || a.scopeRevisionId !== getProject().scopeRevisionId) {
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
      const issued = createSession({
        projectId: session.projectId, runId: session.runId, role: "client",
        changeOrderId: order.id, changeOrderRevision: order.revision,
      });
      return json(res, 201, issued);
    }
    if (path === "/api/sessions/revoke" && req.method === "POST") {
      const b = await readBody(req);
      const target = getSession(String(b.token ?? ""));
      if (target && (target.projectId !== session.projectId || target.runId !== session.runId)) return json(res, 403, { error: "Session belongs to another project/run" });
      revokeSession(String(b.token ?? ""));
      return json(res, 200, { revoked: true });
    }
    if (path === "/api/demo/reset" && req.method === "POST") {
      const reset = resetDemoRun(session.runId);
      return json(res, 200, { ...reset, session: createSession({ projectId: session.projectId, role: "designer", runId: reset.runId }) });
    }
    if (path === "/api/ai-budget" && req.method === "GET") {
      return json(res, 200, aiBudget.status());
    }
    const submitMatch = path.match(/^\/api\/change-orders\/([^/]+)\/submit$/);
    if (submitMatch && req.method === "POST") {
      const order = submitForApproval(submitMatch[1]);
      const link = createInvitation({ projectId: "demo", role: "client", runId: session.runId, changeOrderId: order.id, changeOrderRevision: order.revision });
      return json(res, 200, { order, approvalUrl: `${config.publicUrl}/review#${link.token}`, approvalExpiresAt: link.expiresAt });
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
    const status = /not found/i.test(message) ? 404 : /baseline|revision|immutable|requires.*approval|Cannot approve|wait for/i.test(message) ? 409 :
      /Invalid|unexpected|too large|required|Provide|Unknown rate|supports USD|JSON/i.test(message) ? 400 : 502;
    return json(res, status, { error: message });
  }
});

server.listen(config.port, config.host, () => {
  const missing = assertConfigured();
  console.log(`Scope & Settle backend listening on http://localhost:${config.port}`);
  if (missing.length) console.log(`Missing config: ${missing.join(", ")}`);
});
