import { createHash } from "node:crypto";
import { db, getProjectForRun, currentRunId, transaction } from "./db.js";
import { activeGrant } from "./judgeAccess.js";
import { credentialHash } from "./judgeAccess.js";
import { getSession } from "./sessions.js";
import type { Session } from "./sessions.js";
import type { ProjectView, LineItem } from "../shared/types.js";
import type { AssessmentResult } from "./assessment.js";
import { now } from "./agentStore.js";

export interface AgentPolicy {
  runId: string; version: number; enabled: boolean; allowedRateIds: string[];
  maxQuoteMinor: number; maxTotalMinor: number; maxQuantity: number;
  figmaClientIds: string[]; figmaReplies: boolean; paypalReminders: boolean;
  scopeRevisionId: string; projectHash: string; ownerGrantId: string | null; ownerSessionHash: string | null;
  expiresAt: string; startedAt: string; approvedAt: string;
}
export const projectHash = (project: ProjectView) => createHash("sha256").update(JSON.stringify(project)).digest("hex");
export function getAgentPolicy(runId: string): AgentPolicy | null {
  const row=db.prepare("SELECT policy_json FROM agent_policies WHERE run_id = ?").get(runId) as any;
  return row ? JSON.parse(row.policy_json) : null;
}
export function policyAuthority(policy: AgentPolicy): boolean {
  if (!Number.isFinite(Date.parse(policy.expiresAt)) || Date.parse(policy.expiresAt) <= Date.now()) return false;
  if (policy.ownerGrantId) {
    const grant=activeGrant(policy.ownerGrantId);
    if (!grant || grant.run_id!==policy.runId || grant.role!=="designer") return false;
  } else {
    // Natural session expiry does not revoke delegation. Explicit revocation does.
    if (policy.runId !== currentRunId() || !policy.ownerSessionHash) return false;
    const owners=db.prepare("SELECT token FROM sessions WHERE run_id = ? AND role = 'designer' AND revoked = 0").all(policy.runId) as {token:string}[];
    if (!owners.some(owner=>credentialHash(owner.token)===policy.ownerSessionHash)) return false;
  }
  try { return projectHash(getProjectForRun(policy.runId)) === policy.projectHash; } catch { return false; }
}
export function activeAgentPolicy(runId: string): AgentPolicy | null {
  const p=getAgentPolicy(runId);
  return p?.enabled && policyAuthority(p) ? p : null;
}
export function saveAgentPolicy(session: Session, input: any): AgentPolicy {
  return transaction(()=>savePolicy(session,input));
}
function savePolicy(session: Session, input: any): AgentPolicy {
  if (session.role !== "designer") throw new Error("Requires designer role");
  if (!getSession(session.token) || !input || typeof input!=="object") throw new Error("Invalid policy or expired designer session");
  const previous=getAgentPolicy(session.runId), project=getProjectForRun(session.runId);
  if (input.enabled === false && previous) {
    const paused={...previous,enabled:false,version:previous.version+1};
    db.prepare("UPDATE agent_policies SET policy_json = ?, updated_at = ? WHERE run_id = ?").run(JSON.stringify(paused),now(),session.runId);
    db.prepare("INSERT INTO agent_policy_history VALUES (?,?,?)").run(session.runId,paused.version,JSON.stringify(paused));
    return paused;
  }
  if (input.enabled !== true || input.consent !== true) throw new Error("Explicit consent is required to enable automatic quotes");
  const ids=input.allowedRateIds;
  if (!Array.isArray(ids) || !ids.length || ids.length > 20 || new Set(ids).size !== ids.length || ids.some(id=>typeof id!=="string" || !project.rateCard.some(r=>r.id===id))) throw new Error("Invalid approved rate selection");
  for (const key of ["maxQuoteMinor","maxTotalMinor","maxQuantity"]) {
    if (!Number.isSafeInteger(input[key]) || input[key] < 1 || input[key] > (key === "maxQuantity" ? 100 : 10_000_000)) throw new Error("Invalid automation limit");
  }
  if (input.maxTotalMinor < input.maxQuoteMinor) throw new Error("Invalid cumulative quote limit");
  const clientIds=input.figmaClientIds ?? [];
  if (!Array.isArray(clientIds) || clientIds.length>20 || clientIds.some(id=>typeof id!=="string" || !/^[\w-]{1,100}$/.test(id))) throw new Error("Invalid Figma client IDs");
  // The configured file has one routing owner per client, across judging runs.
  for (const row of db.prepare("SELECT policy_json FROM agent_policies WHERE run_id != ?").all(session.runId) as {policy_json:string}[]) {
    const other=JSON.parse(row.policy_json) as AgentPolicy;
    if (other.enabled && policyAuthority(other) && clientIds.some(id=>other.figmaClientIds.includes(id))) throw new Error("This Figma client already belongs to another active agent run");
  }
  const grant=session.grantId ? activeGrant(session.grantId) : null;
  if (session.grantId && (!grant || grant.role!=="designer" || grant.run_id!==session.runId)) throw new Error("Designer access expired or revoked");
  const at=now();
  const policy: AgentPolicy={runId:session.runId,version:(previous?.version??0)+1,enabled:true,
    allowedRateIds:[...ids],maxQuoteMinor:input.maxQuoteMinor,maxTotalMinor:input.maxTotalMinor,maxQuantity:input.maxQuantity,
    figmaClientIds:[...new Set(clientIds)] as string[],figmaReplies:input.figmaReplies===true,paypalReminders:input.paypalReminders===true,
    scopeRevisionId:project.scopeRevisionId,projectHash:projectHash(project),ownerGrantId:session.grantId,ownerSessionHash:session.grantId ? null : credentialHash(session.token),
    expiresAt:grant?.expires_at ?? new Date(Date.now()+24*60*60_000).toISOString(),startedAt:previous?.enabled ? previous.startedAt : at,approvedAt:at};
  db.prepare("INSERT INTO agent_policies (run_id,policy_json,updated_at) VALUES (?,?,?) ON CONFLICT(run_id) DO UPDATE SET policy_json=excluded.policy_json,updated_at=excluded.updated_at")
    .run(session.runId,JSON.stringify(policy),at);
  db.prepare("INSERT INTO agent_policy_history VALUES (?,?,?)").run(session.runId,policy.version,JSON.stringify(policy));
  return policy;
}

export type QuoteDecision = { allowed:false; reason:string } | { allowed:true; totalMinor:number; lineItems:LineItem[]; deliverables:string[] };
export function evaluateAutoQuote(project: ProjectView, result: AssessmentResult, policy: AgentPolicy, alreadyQuotedMinor: number, requestText: string): QuoteDecision {
  const no=(reason:string):QuoteDecision=>({allowed:false,reason});
  if (!policy.enabled || Date.parse(policy.expiresAt)<=Date.now()) return no("Automatic quoting is paused or expired.");
  if (projectHash(project)!==policy.projectHash) return no("The brief or rates changed; approve a new automation policy.");
  if (result.classification!=="new_work" || !result.evidence?.length) return no("A supported new-work assessment is required.");
  if (result.evidence.some(e=>!e.quote?.trim() || !project.scopeClauses.some(c=>c.id===e.clauseId && c.text.includes(e.quote)))) return no("Agreement evidence needs review.");
  if (result.questions?.length || !result.rates?.length || result.deliverables?.length!==result.rates.length) return no("Some requested work or pricing still needs clarification.");
  if (new Set(result.rates.map(r=>r.rateCardId)).size!==result.rates.length) return no("Duplicate rate entries need review.");
  const coverage=result.automation;
  if (!coverage?.allRequestsCovered || coverage.unpricedComponents.length || coverage.coverage.length!==result.rates.length) return no("Full pricing coverage needs review.");
  if (new Set(coverage.coverage.map(c=>c.deliverableIndex)).size!==result.rates.length) return no("Deliverable coverage is ambiguous.");
  const items:LineItem[]=[];
  for (let i=0;i<result.rates.length;i++) {
    const requested=result.rates[i], rate=project.rateCard.find(r=>r.id===requested.rateCardId);
    if (!rate || !policy.allowedRateIds.includes(rate.id)) return no("The request uses a rate you have not authorized.");
    if (!Number.isSafeInteger(requested.quantity) || requested.quantity<1 || requested.quantity>policy.maxQuantity) return no("The requested quantity exceeds the approved limit.");
    // Autonomous commitments use the exact approved catalogue; free-form extra
    // deliverables must return to the designer even if AI attaches a known price.
    if (result.deliverables[i]!==rate.description) return no("The proposed deliverables differ from the approved rate description.");
    const component=coverage.coverage.find(c=>c.deliverableIndex===i);
    if (!component || component.rateCardId!==rate.id || component.quantity!==requested.quantity || !component.requestQuote?.trim() || !requestText.includes(component.requestQuote)) return no("Requested work does not match its pricing evidence.");
    items.push({rateCardId:rate.id,description:rate.description,quantity:requested.quantity,unitAmountMinor:rate.unitAmountMinor,priceSource:"rate_card"});
  }
  const total=items.reduce((sum,item)=>sum+item.quantity*item.unitAmountMinor,0);
  if (!Number.isSafeInteger(total) || total<1 || total>policy.maxQuoteMinor) return no("This quote exceeds the approved amount per request.");
  if (!Number.isSafeInteger(alreadyQuotedMinor) || alreadyQuotedMinor<0 || alreadyQuotedMinor+total>policy.maxTotalMinor) return no("This quote exceeds the remaining cumulative allowance.");
  return {allowed:true,totalMinor:total,lineItems:items,deliverables:items.map(item=>item.description)};
}
