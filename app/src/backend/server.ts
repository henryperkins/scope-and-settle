import {prepareReviewedAction,getReviewedAction,confirmReviewedAction} from './reviewedActions.js';
import {prepareMilestoneAction,confirmMilestoneAction,getMilestoneAction} from './installmentActions.js';
import {setMilestoneSchedule} from './milestones.js';
import {prepareDeliveryBrief,startApprovedWork,getDeliveryRun,orderDeliveries,recordDeliveryOutput,getDeliverySnapshot,submitDelivery,issueDeliveryAccess,getDeliveryReview,requestDeliveryChanges,acceptDelivery,refreshDeliveryPayment} from './delivery.js';
import {linkedOrders} from "./requestLinks.js";
import {assessRequest,assessStoredRequest,assessmentItems,setItemPrice,resolveDuplicate,abandonProposal} from "./requestItems.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { config, assertConfigured, APP_ROOT, DATA_DIR } from "./env.js";
import {acquireRuntimeOwner} from './runtimeOwner.js';
import { getProjectForRun, updateScopeBaseline } from "./db.js";
import { fetchComments } from "./figma.js";
import { resetDemoRun } from "./orders.js";
import { createSession, revokeSession, redeemInvitation } from "./sessions.js";
import { contextFromSessionToken, sessionForContext, requireActiveContext, requireDesignerContext, ScopedAccessError } from "./context.js";
import { getScopedOrder, listScopedOrders, draftChangeOrder, editScopedOrder, submitScopedOrder,
  approveScopedOrder, prepareScopedInvoice, getSettlement, issueScopedClientAccess } from "./changeOrderService.js";
import { aiBudget } from "./aiBudget.js";
import { assess, getAssessment } from "./assessment.js";
import {captureDesignEvidence,getDesignEvidence} from './designEvidence.js';
import { db } from "./db.js";
import { receiveWebhook } from "./webhooks.js";
import { startJudgeRun, renewJudgeSession, resetJudgeRun } from "./judging.js";
import {getAgentPolicy,saveAgentPolicy,policyAuthority} from "./agentPolicy.js";
import {listRequests,messagesFor,quotedTotal,runtimeValue} from "./agentStore.js";
import {getPortalSession,portalView,addPortalRequest,replyToRequest,approvePortalQuote,refreshPortalPayment,createPortalAccess,handleAgentRequest,publishReviewedQuote} from "./agentPortal.js";
import {startAgentWorker} from "./agentWorker.js";
import {startJobWorker,jobDiagnostics,retryFailedJob} from "./jobs.js";
import {getScopeContext,getScopeSnapshot,acknowledgeScope,issueScopeAccess,publishScope,publishRates} from './scopeLedger.js';
import {issuePortalScopeAccess} from './agentPortal.js';
import {receiveFigmaEvent} from './figmaWebhooks.js';
import {listRequestInbox,getInboxSettings,saveInboxSettings,refreshRequestThread,inboxRefreshDiagnostics,retryInboxJob} from './requestInbox.js';
import {issueConnectorCredential,listConnectorCredentials,revokeConnectorCredential} from './mcpAuth.js';
import {MCP_PATH,handleMcpRequest,drainMcp} from './mcp.js';
import {getStatusCard,getCardDisplaySettings,saveCardDisplaySettings} from './statusCards.js';
import {buildEvidencePacket,getEvidencePacket,evidencePacketFile} from './evidencePackets.js';

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

async function readBody(req: IncomingMessage,maxBytes=2_500_000): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > maxBytes) throw new Error("Request too large");
    chunks.push(c as Buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const runtimeOwner = await acquireRuntimeOwner(resolve(DATA_DIR, 'scope-and-settle.db'));
export const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${config.port}`);
  const path = url.pathname;
  // The connector owns its exact path: dispatched before the wildcard CORS, OPTIONS, body and error handling below.
  if (path === MCP_PATH) return handleMcpRequest(req, res);
  try {
    if (req.method === "OPTIONS") return json(res, 204, {});
    const publicFiles: Record<string, string> = {"/assets/evidence-packets.js":"evidence-packets.js","/delivery":"delivery-review.html","/assets/delivery-review.js":"delivery-review.js","/assets/delivery.js":"delivery.js","/assets/milestones.js":"milestones.js","/assets/status-cards.js":"status-cards.js","/assets/reviewed-actions.js":"reviewed-actions.js","/assets/connectors.js":"connectors.js","/assets/inbox.js":"inbox.js", "/scope":"scope.html","/assets/scope.js":"scope.js", "/": "judge.html", "/judge": "judge.html", "/designer": "designer.html", "/review": "review.html", "/client":"client.html", "/assets/client.js":"client.js", "/assets/agent.js":"agent.js",
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
    if(path==='/webhooks/figma'&&req.method==='POST'){
      try{return json(res,200,await receiveFigmaEvent(await readBody(req,64000)));}
      catch(error){return json(res,error instanceof ScopedAccessError?error.status:error instanceof SyntaxError||error instanceof Error&&/too large/.test(error.message)?400:503,{error:error instanceof ScopedAccessError?error.message:'Figma receipt could not be accepted'});}
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
      if(path==='/api/portal/scope-access'&&req.method==='POST')return json(res,201,issuePortalScopeAccess(portal));
      if(path==="/api/portal/requests" && req.method==="POST") {const b=await readBody(req);return json(res,201,addPortalRequest(portal,b.text,b.key));}
      const action=path.match(/^\/api\/portal\/requests\/([^/]+)\/(reply|approve|payment-status)$/);
      if(action && req.method==="POST") {
        const b=await readBody(req);
        if(action[2]==="reply")return json(res,200,replyToRequest(portal,action[1],b.text,b.key));
        if(action[2]==="approve")return json(res,200,await approvePortalQuote(portal,action[1],b.revision,b.consent,b.orderId));
        return json(res,200,await refreshPortalPayment(portal,action[1],b.orderId,b.revision));
      }
      return json(res,404,{error:"Portal route not found"});
    }
    const ctx = contextFromSessionToken(bearer);
    if(path==="/api/reconciliation" && req.method==="GET"){
      requireDesignerContext(ctx);return json(res,200,jobDiagnostics(ctx.projectId,ctx.runId));
    }
    const retryJob=path.match(/^\/api\/reconciliation\/([^/]+)\/retry$/);
    if(retryJob && req.method==="POST"){
      requireDesignerContext(ctx);return json(res,200,retryFailedJob(retryJob[1],ctx.projectId,ctx.runId));
    }
    let session = sessionForContext(ctx);
    // Body consumption is an await boundary: never authorize mutations from a stale session snapshot.
    const scopedBody = async () => {
      const body = await readBody(req);
      session = sessionForContext(ctx);
      return body;
    };
    const scopedOrder = path.match(/^\/api\/change-orders\/([^/]+)(?:\/(submit|approve|invoice|payment-status|client-access))?$/);
    const scopedSnapshot=path.match(/^\/api\/scope\/snapshots\/([^/]+)(?:\/(acknowledge|client-access))?$/);
    const deliveryReviewRoute=path.match(/^\/api\/delivery-reviews\/([^/]+)(?:\/(accept|changes|payment-status|client-access))?$/);
    if(scopedSnapshot)getScopeSnapshot(ctx,scopedSnapshot[1]);
    if (scopedOrder) getScopedOrder(ctx, scopedOrder[1]);
    const clientAction = (deliveryReviewRoute&&((req.method==='GET'&&(!deliveryReviewRoute[2]||deliveryReviewRoute[2]==='payment-status'))||(req.method==='POST'&&['accept','changes'].includes(deliveryReviewRoute[2])))) || (scopedSnapshot&&((!scopedSnapshot[2]&&req.method==='GET')||(scopedSnapshot[2]==='acknowledge'&&req.method==='POST'))) || (path === "/api/session" && req.method === "GET") || (scopedOrder && ((req.method === "GET" && (!scopedOrder[2] || scopedOrder[2] === "payment-status")) ||
      (req.method === "POST" && scopedOrder[2] === "approve")));
    if (session.role !== "designer" && !clientAction) return json(res, 403, { error: "Requires designer role" });
    if (path === "/api/session" && req.method === "GET") return json(res, 200, session);
    const packetBuild=path.match(/^\/api\/change-orders\/([^/]+)\/evidence-packets$/);
    if(packetBuild&&req.method==='POST'){
      const b=await scopedBody();if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).length)throw new ScopedAccessError(400,'Only the scoped order identity is accepted');
      return json(res,201,buildEvidencePacket(ctx,packetBuild[1]));
    }
    const packetRead=path.match(/^\/api\/evidence-packets\/([^/]+)(?:\/files\/(packet\.json|packet\.html|manifest\.json))?$/);
    if(packetRead&&req.method==='GET'){
      if(!packetRead[2])return json(res,200,getEvidencePacket(ctx,packetRead[1]));
      const file=evidencePacketFile(ctx,packetRead[1],packetRead[2]);
      res.writeHead(200,{'Content-Type':file.mediaType+'; charset=utf-8','Content-Disposition':`attachment; filename="${file.filename}"`,'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox; default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",'Access-Control-Allow-Origin':'*'});
      return res.end(file.text);
    }
    if(deliveryReviewRoute){
      const id=deliveryReviewRoute[1],action=deliveryReviewRoute[2];
      if(req.method==='GET'&&!action)return json(res,200,getDeliveryReview(ctx,id));
      if(req.method==='GET'&&action==='payment-status')return json(res,200,await refreshDeliveryPayment(ctx,id));
      if(req.method==='POST'&&action==='client-access'){await scopedBody();return json(res,201,issueDeliveryAccess(ctx,id));}
      if(req.method==='POST'&&['accept','changes'].includes(action)){
        if(req.headers.origin!==new URL(config.publicUrl).origin)throw new ScopedAccessError(403,'Review and confirm this delivery in the client application');
        const b=await scopedBody(),view=getDeliveryReview(ctx,id);
        if(action==='changes'){
          if(!b||Object.keys(b).some(k=>!['comment','expectedRevision','snapshotHash'].includes(k))||b.expectedRevision!==view.revision||b.snapshotHash!==view.snapshot.hash)throw new ScopedAccessError(409,'Select the exact displayed review revision and snapshot');
          return json(res,200,requestDeliveryChanges(ctx,id,b.comment));
        }
        if(!b||Object.keys(b).some(k=>!['consent','expectedRevision','snapshotHash'].includes(k))||b.consent!==true)throw new ScopedAccessError(400,'Explicit consent to the delivered snapshot, criteria and agreed balance is required');
        if(b.snapshotHash!==view.snapshot.hash)throw new ScopedAccessError(409,'Confirm the exact displayed delivery snapshot');
        return json(res,200,await acceptDelivery(ctx,id,b.expectedRevision));
      }
    }
    if(path==='/api/project/card-display'&&req.method==='GET')return json(res,200,getCardDisplaySettings(ctx));
    if(path==='/api/project/card-display'&&req.method==='POST'){
      if(req.headers.origin!==new URL(config.publicUrl).origin)throw new ScopedAccessError(403,'Manage canvas monetary display in the authenticated browser application');
      return json(res,200,saveCardDisplaySettings(ctx,await scopedBody()));
    }
    const cardRoute=path.match(/^\/api\/change-orders\/([^/]+)\/status-card$/);
    if(cardRoute&&req.method==='GET'){
      if([...url.searchParams.keys()].some(k=>k!=='revision')||url.searchParams.getAll('revision').length!==1||!/^\d+$/.test(url.searchParams.get('revision')??''))throw new ScopedAccessError(400,'Only the exact proposal revision is accepted');
      return json(res,200,getStatusCard(ctx,cardRoute[1],Number(url.searchParams.get('revision'))));
    }
    // Connector credentials: designer sessions only, issued and revoked with the application Origin and explicit consent.
    const connectorRoute=path.match(/^\/api\/connectors(?:\/([^/]+)\/revoke)?$/);
    if(connectorRoute&&req.method==='GET'&&!connectorRoute[1])return json(res,200,listConnectorCredentials(ctx));
    if(connectorRoute&&req.method==='POST'){
      if(req.headers.origin!==new URL(config.publicUrl).origin)throw new ScopedAccessError(403,'Manage connector credentials in the authenticated application');
      const body=await scopedBody();
      if(!connectorRoute[1])return json(res,201,issueConnectorCredential(ctx,body));
      if(!body||typeof body!=='object'||Object.keys(body).some(k=>k!=='consent')||body.consent!==true)throw new ScopedAccessError(400,'Explicit consent is required to revoke this connector credential');
      return json(res,200,revokeConnectorCredential(ctx,decodeURIComponent(connectorRoute[1])));
    }
    const workRoute=path.match(/^\/api\/milestones\/([^/]+)\/(delivery-brief|start-work|submit-delivery)$/);
    if(workRoute&&req.method==='POST'&&workRoute[2]==='submit-delivery'){
      const b=await scopedBody();if(!b||Object.keys(b).some(k=>!['snapshotId','consent'].includes(k))||b.consent!==true||typeof b.snapshotId!=='string')throw new ScopedAccessError(400,'Review the exact draft snapshot and explicitly submit it');
      const review=submitDelivery(ctx,workRoute[1],b.snapshotId);return json(res,201,{review,...issueDeliveryAccess(ctx,review.id)});
    }
    if(workRoute&&req.method==='GET'&&workRoute[2]==='delivery-brief')return json(res,200,await prepareDeliveryBrief(ctx,workRoute[1]));
    if(workRoute&&req.method==='POST'&&workRoute[2]==='start-work'){
      const b=await scopedBody();if(!b||Object.keys(b).some(k=>k!=='consent')||b.consent!==true)throw new ScopedAccessError(400,'Explicit designer consent to start approved work is required');
      return json(res,201,await startApprovedWork(ctx,workRoute[1]));
    }
    const orderDeliveryRoute=path.match(/^\/api\/change-orders\/([^/]+)\/deliveries$/);
    if(orderDeliveryRoute&&req.method==='GET')return json(res,200,orderDeliveries(ctx,orderDeliveryRoute[1]));
    const runRoute=path.match(/^\/api\/delivery-runs\/([^/]+)(?:\/(output))?$/);
    if(runRoute&&req.method==='GET'&&!runRoute[2])return json(res,200,getDeliveryRun(ctx,runRoute[1]));
    if(runRoute&&req.method==='POST'&&runRoute[2]==='output')return json(res,201,recordDeliveryOutput(ctx,runRoute[1],await scopedBody()));
    const snapshotRoute=path.match(/^\/api\/delivery-snapshots\/([^/]+)$/);
    if(snapshotRoute&&req.method==='GET')return json(res,200,getDeliverySnapshot(ctx,snapshotRoute[1]));
    const scheduleRoute=path.match(/^\/api\/change-orders\/([^/]+)\/milestone-schedule$/);
    if(scheduleRoute&&req.method==='POST'){
      const b=await scopedBody();
      if(!b||Object.keys(b).some(k=>!['expectedRevision','schedule'].includes(k)))throw new ScopedAccessError(400,'Exact revision and schedule required');
      return json(res,200,setMilestoneSchedule(ctx,scheduleRoute[1],b.expectedRevision,b.schedule));
    }
    if(path==='/api/installment-actions'&&req.method==='POST')return json(res,201,await prepareMilestoneAction(ctx,await scopedBody()));
    const installmentAction=path.match(/^\/api\/installment-actions\/([^/]+)(?:\/(confirm))?$/);
    if(installmentAction&&req.method==='GET'&&!installmentAction[2])return json(res,200,getMilestoneAction(ctx,installmentAction[1]));
    if(installmentAction&&req.method==='POST'&&installmentAction[2]==='confirm'){
      if(req.headers.origin!==new URL(config.publicUrl).origin)throw new ScopedAccessError(403,'Confirm this installment in the authenticated application');
      return json(res,200,await confirmMilestoneAction(ctx,installmentAction[1],await scopedBody()));
    }
    if(path==='/api/reviewed-actions'&&req.method==='POST'){
      const body=await scopedBody();
      return json(res,201,await prepareReviewedAction(ctx,body));
    }
    const reviewed=path.match(/^\/api\/reviewed-actions\/([^/]+)(?:\/(confirm))?$/);
    if(reviewed&&req.method==='GET'&&!reviewed[2])return json(res,200,getReviewedAction(ctx,reviewed[1]));
    if(reviewed&&req.method==='POST'&&reviewed[2]==='confirm'){
      if(req.headers.origin!==new URL(config.publicUrl).origin)throw new ScopedAccessError(403,'Confirm this preview in the authenticated application');
      const body=await scopedBody();
      if(!body||Object.keys(body).some(k=>!['previewHash','consent'].includes(k))||body.consent!==true||typeof body.previewHash!=='string')throw new ScopedAccessError(400,'Explicit consent to the displayed preview is required');
      return json(res,200,await confirmReviewedAction(ctx,reviewed[1],body.previewHash));
    }
    if(path==='/api/inbox'&&req.method==='GET')return json(res,200,{settings:getInboxSettings(ctx),threads:listRequestInbox(ctx,url.searchParams.get('filter')??undefined),refresh:inboxRefreshDiagnostics(ctx)});
    if(path==='/api/inbox/settings'&&req.method==='POST'){const b=await scopedBody();return json(res,200,saveInboxSettings(ctx,b));}
    if(path==='/api/inbox/refresh'&&req.method==='POST'){const b=await scopedBody();if(!b||Object.keys(b).some(k=>k!=='commentId'))throw new ScopedAccessError(400,'Only an authoritative comment ID is allowed');return json(res,200,await refreshRequestThread(ctx,b.commentId));}
    const inboxRetry=path.match(/^\/api\/inbox\/jobs\/([^/]+)\/retry$/);
    if(inboxRetry&&req.method==='POST'){await scopedBody();return json(res,200,retryInboxJob(ctx,inboxRetry[1]));}
    if(path==='/api/scope'&&req.method==='GET')return json(res,200,getScopeContext(ctx));
    if(scopedSnapshot){
      if(!scopedSnapshot[2]&&req.method==='GET')return json(res,200,getScopeSnapshot(ctx,scopedSnapshot[1]));
      if(scopedSnapshot[2]==='client-access'&&req.method==='POST'){const b=await scopedBody();return json(res,201,issueScopeAccess(ctx,scopedSnapshot[1],b.expectedVersion));}
      if(scopedSnapshot[2]==='acknowledge'&&req.method==='POST'){const b=await scopedBody();if(b.consent!==true||!Number.isSafeInteger(b.expectedVersion))return json(res,400,{error:'Explicit consent and exact scope version are required'});return json(res,200,acknowledgeScope(ctx,scopedSnapshot[1],b.expectedVersion));}
    }
    if(path==="/api/agent" && req.method==="GET") {
      const policy=getAgentPolicy(session.runId);
      const {ownerGrantId,ownerSessionHash,...publicPolicy}=policy??{};
      return json(res,200,{policy:policy?publicPolicy:null,authorityValid:policy?policyAuthority(policy):false,quotedMinor:quotedTotal(session.runId),
        portalReady:!!db.prepare("SELECT id FROM agent_portals WHERE run_id = ? AND revoked = 0 AND expires_at > ?").get(session.runId,new Date().toISOString()),
        lastCycle:runtimeValue("worker-last-cycle"),figmaLastSuccess:runtimeValue("figma-last-success"),figmaNextCheckAt:runtimeValue("figma-next-check-at"),
        error:runtimeValue(`run-error:${session.runId}`)||runtimeValue("worker-error")||(policy?.figmaClientIds.length?runtimeValue("figma-error"):null),
        requests:listRequests(session.runId).map(r=>({...r,orders:linkedOrders(r),items:r.assessment_id?assessmentItems(r.assessment_id,r.run_id):[],messages:messagesFor(r.id,r.run_id)})),
        deliveries:db.prepare("SELECT request_id,kind,state,error,updated_at FROM agent_outbox WHERE run_id = ? ORDER BY created_at DESC LIMIT 50").all(session.runId)});
    }
    if(path==="/api/agent/policy" && req.method==="POST") {
      const b=await scopedBody();
      const {ownerGrantId,ownerSessionHash,...policy}=saveAgentPolicy(sessionForContext(ctx),b);return json(res,200,policy);
    }
    if(path==="/api/agent/portal-access" && req.method==="POST")return json(res,201,createPortalAccess(sessionForContext(ctx)));
    const agentAction=path.match(/^\/api\/agent\/requests\/([^/]+)\/(retry|dismiss|publish|acknowledge)$/);
    if(agentAction && req.method==="POST") {
      if(agentAction[2]==="publish") {const b=await scopedBody();return json(res,200,publishReviewedQuote(sessionForContext(ctx),agentAction[1],b.orderId,b.revision,b.consent));}
      return json(res,200,handleAgentRequest(sessionForContext(ctx),agentAction[1],agentAction[2] as "retry"|"dismiss"|"acknowledge"));
    }
    if (path === "/api/project" && req.method === "GET") {
      return json(res, 200, getProjectForRun(session.runId));
    }
    if (path === "/api/comments" && req.method === "GET") {
      const project = getProjectForRun(session.runId);
      const comments = await fetchComments(project.figmaFileKey);
      requireActiveContext(ctx);
      return json(res, 200, { fileKey: project.figmaFileKey, fetchedAt: new Date().toISOString(), comments });
    }
    if (path === "/api/assessments" && req.method === "POST") {
      const b = await scopedBody();
      return json(res,201,await assessRequest(ctx,b));
    }
    if(path==='/api/design-evidence'&&req.method==='POST'){const b=await scopedBody();return json(res,201,await captureDesignEvidence(ctx,b));}
    const evidenceMatch=path.match(/^\/api\/design-evidence\/([^/]+)$/);
    if(evidenceMatch&&req.method==='GET')return json(res,200,getDesignEvidence(ctx,evidenceMatch[1]));
    const reassessMatch=path.match(/^\/api\/agent\/requests\/([^/]+)\/assess$/);
    if(reassessMatch&&req.method==='POST'){await scopedBody();return json(res,201,await assessStoredRequest(ctx,reassessMatch[1]));}
    const itemPriceMatch=path.match(/^\/api\/request-items\/([^/]+)\/designer-price$/);
    if(itemPriceMatch&&req.method==='POST'){const b=await scopedBody();return json(res,200,setItemPrice(ctx,itemPriceMatch[1],b));}
    const duplicateMatch=path.match(/^\/api\/request-items\/([^/]+)\/duplicate-decision$/);
    if(duplicateMatch&&req.method==='POST'){const b=await scopedBody();return json(res,200,resolveDuplicate(ctx,duplicateMatch[1],b.decision,b.reason,b.commitmentId,b.commitmentRevision,b.expected));}
    const abandonMatch=path.match(/^\/api\/change-orders\/([^/]+)\/abandon$/);
    if(abandonMatch&&req.method==='POST'){const b=await scopedBody();return json(res,200,abandonProposal(ctx,abandonMatch[1],b.reason));}
    const assessmentMatch = path.match(/^\/api\/assessments\/([^/]+)$/);
    if (assessmentMatch && req.method === "GET") {
      const record = getAssessment(assessmentMatch[1], session.runId);
      return record ? json(res, 200, record) : json(res, 404, { error: "Assessment not found" });
    }
    if (path === "/api/change-orders" && req.method === "GET") {
      return json(res, 200, listScopedOrders(ctx));
    }
    if (path === "/api/change-orders" && req.method === "POST") {
      const b = await scopedBody();
      const order = draftChangeOrder(ctx, {
        title: String(b.title ?? "Change order"), commentId: b.commentId ?? null,
        deliverables: Array.isArray(b.deliverables) ? b.deliverables : [],
        lineItems: Array.isArray(b.lineItems) ? b.lineItems : [], currency: String(b.currency ?? "USD"),
        assessmentId: b.assessmentId ? String(b.assessmentId) : null,
        itemIds:b.itemIds,operationId:b.operationId,
      });
      return json(res, 201, order);
    }
    if (path === "/api/project/scope" && req.method === "POST") {
      if (!sessionForContext(ctx).canEditScope) return json(res, 403, { error: "The judging brief and rate card are fixed for this run" });
      const b = await scopedBody();
      if (!Array.isArray(b.clauses) || b.clauses.length === 0) return json(res, 400, { error: "clauses required" });
      return json(res, 200, publishScope(ctx,b.clauses,b.expectedContextVersion));
    }
    if(path==='/api/project/rates'&&req.method==='POST'){const b=await scopedBody();return json(res,200,publishRates(ctx,b.entries,b.expectedContextVersion));}
    if (path === "/api/sessions" && req.method === "POST") {
      const b = await scopedBody();
      requireDesignerContext(ctx);
      const order = getScopedOrder(ctx,String(b.changeOrderId ?? ""));
      if (b.role !== "client" || !order || order.runId !== session.runId || order.status !== "awaiting_client_approval") {
        return json(res, 400, { error: "Only client access to a submitted proposal can be issued here" });
      }
      if (session.grantId) return json(res, 201, issueScopedClientAccess(ctx, order.id));
      const issued = createSession({
        projectId: session.projectId, runId: session.runId, role: "client",
        changeOrderId: order.id, changeOrderRevision: order.revision,
      });
      return json(res, 201, issued);
    }
    if (path === "/api/sessions/revoke" && req.method === "POST") {
      const b = await scopedBody();
      const target = db.prepare("SELECT project_id, run_id FROM sessions WHERE token = ?").get(String(b.token ?? "")) as any;
      if (target && (target.project_id !== session.projectId || target.run_id !== session.runId)) return json(res, 403, { error: "Session belongs to another project/run" });
      revokeSession(String(b.token ?? ""));
      return json(res, 200, { revoked: true });
    }
    if (path === "/api/demo/reset" && req.method === "POST") {
      session = sessionForContext(ctx);
      requireDesignerContext(ctx);
      if (session.grantId) return json(res, 200, resetJudgeRun(session));
      const reset = resetDemoRun(session.runId);
      return json(res, 200, { ...reset, session: createSession({ projectId: session.projectId, role: "designer", runId: reset.runId }) });
    }
    if (path === "/api/ai-budget" && req.method === "GET") {
      return json(res, 200, aiBudget.status());
    }
    const submitMatch = path.match(/^\/api\/change-orders\/([^/]+)\/submit$/);
    if (submitMatch && req.method === "POST") {
      return json(res, 200, submitScopedOrder(ctx,submitMatch[1]));
    }
    if (scopedOrder?.[2] === "client-access" && req.method === "POST") {
      return json(res, 200, issueScopedClientAccess(ctx,scopedOrder[1]));
    }
    const approveMatch = path.match(/^\/api\/change-orders\/([^/]+)\/approve$/);
    if (approveMatch && req.method === "POST") {
      return json(res, 200, await approveScopedOrder(ctx,approveMatch[1]));
    }
    const editMatch = path.match(/^\/api\/change-orders\/([^/]+)$/);
    if (editMatch && req.method === "PATCH") {
      const b = await scopedBody();
      const order = editScopedOrder(ctx,editMatch[1], { title: b.title, deliverables: b.deliverables, lineItems: b.lineItems });
      return json(res, 200, order);
    }
    const invoiceMatch = path.match(/^\/api\/change-orders\/([^/]+)\/invoice$/);
    if (invoiceMatch && req.method === "POST") {
      const order = await prepareScopedInvoice(ctx,invoiceMatch[1]);
      return json(res, 200, order);
    }
    const statusMatch = path.match(/^\/api\/change-orders\/([^/]+)\/payment-status$/);
    if (statusMatch && req.method === "GET") {
      const order = await getSettlement(ctx,statusMatch[1]);
      return json(res, 200, order);
    }
    const orderMatch = path.match(/^\/api\/change-orders\/([^/]+)$/);
    if (orderMatch && req.method === "GET") {
      const order = getScopedOrder(ctx,orderMatch[1]);
      return order ? json(res, 200, order) : json(res, 404, { error: "not found" });
    }
    return json(res, 404, { error: `No route ${req.method} ${path}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = err instanceof ScopedAccessError ? err.status : /not found/i.test(message) ? 404 : /baseline|revision|immutable|requires.*approval|Cannot approve|wait for|already belongs|paused|already exists|needs designer/i.test(message) ? 409 :
      /Invalid|unexpected|too large|required|Provide|Unknown rate|supports USD|JSON/i.test(message) ? 400 : 502;
    return json(res, status, { error: message });
  }
});

// One server process owns this DB. Timers are independent of AI policy.
let stopAgent:()=>Promise<void>=async()=>{},stopJobs:()=>Promise<void>=async()=>{};
let stopping:Promise<void>|null=null;
// The connector drain (both protocol eras plus admitted domain work) runs together with the job and agent drains.
function stopWorkers(){return stopping??=Promise.all([stopJobs(),stopAgent(),drainMcp()]).then(()=>{});}
const closeHttp=server.close.bind(server);
server.close=((callback?: (error?:Error)=>void)=>{
  const drained=stopWorkers();
  // Keep-alive sockets that went idle during the drain would otherwise hold the close open.
  void drained.then(()=>server.closeIdleConnections());
  closeHttp(error=>{void drained.then(()=>runtimeOwner.release()).then(()=>callback?.(error));});
  return server;
}) as typeof server.close;
const shutdown=()=>{server.close(()=>{db.close();});};
process.once("SIGTERM",shutdown);process.once("SIGINT",shutdown);
server.on("close",()=>{void stopWorkers();process.removeListener("SIGTERM",shutdown);process.removeListener("SIGINT",shutdown);});

server.listen(config.port, config.host, () => {
  if(!stopping){
    if(process.env.JOB_WORKER_DISABLED!=="true")stopJobs=startJobWorker();
    if(process.env.AGENT_WORKER_DISABLED!=="true")stopAgent=startAgentWorker();
  }
  const missing = assertConfigured();
  console.log(`Scope & Settle backend listening on http://localhost:${config.port}`);
  if (missing.length) console.log(`Missing config: ${missing.join(", ")}`);
});
