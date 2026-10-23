import { randomUUID } from "node:crypto";
import { db, getProject, transaction } from "./db.js";
import { config } from "./env.js";
import { activeAccess, activeGrant, accessByCredential, grantByCredential, createGrant, credentialHash, newCredential } from "./judgeAccess.js";
import { createSession, type Session } from "./sessions.js";
import { resetDemoRun } from "./orders.js";
import type { ChangeOrderView } from "../shared/types.js";

export function createJudgeAccess({ expiresAt = "2026-12-16T16:00:00Z" } = {}) {
  if (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()) throw new Error("Invalid judging access expiry");
  const id = randomUUID(), credential = newCredential();
  const normalizedExpiry = new Date(expiresAt).toISOString();
  db.prepare("INSERT INTO judge_access (id,credential_hash,expires_at,project_json,created_at) VALUES (?,?,?,?,?)")
    .run(id, credentialHash(credential), normalizedExpiry, JSON.stringify(getProject()), new Date().toISOString());
  return { id, credential, expiresAt: normalizedExpiry };
}

function sessionForGrant(grant: any, renewalCredential: string) {
  const session = createSession({ projectId: "demo", runId: grant.run_id, role: grant.role, grantId: grant.id,
    changeOrderId: grant.change_order_id, changeOrderRevision: grant.change_order_revision });
  return { ...session, renewalCredential, accessExpiresAt: grant.expires_at };
}

function newRun(access: any) {
  const runId = `judge-${randomUUID()}`;
  db.prepare("INSERT INTO judge_runs (run_id,judge_access_id,project_json,created_at) VALUES (?,?,?,?)")
    .run(runId, access.id, access.project_json, new Date().toISOString());
  const issued = createGrant(access.id, runId, "designer");
  return sessionForGrant(activeGrant(issued.id), issued.credential);
}

export function startJudgeRun(credential: string) {
  const access = accessByCredential(credential);
  return access ? transaction(() => newRun(access)) : null;
}

export function renewJudgeSession(credential: string) {
  const grant = grantByCredential(credential);
  return grant ? sessionForGrant(grant, credential) : null;
}

export function createClientAccess(session: Session, order: ChangeOrderView) {
  const parent = session.grantId ? activeGrant(session.grantId) : null;
  if (!parent || parent.role !== "designer" || parent.run_id !== order.runId ||
      !["awaiting_client_approval", "approved", "creating_invoice", "payment_due", "paid"].includes(order.status)) throw new Error("Requires a submitted proposal and active designer access");
  const grant = createGrant(parent.judge_access_id, parent.run_id, "client", order.id, order.revision);
  return { approvalUrl: `${config.publicUrl}/review#resume=${grant.credential}`, approvalExpiresAt: grant.expiresAt };
}

export function resetJudgeRun(session: Session) {
  const grant = session.grantId ? activeGrant(session.grantId) : null;
  if (!grant || grant.role !== "designer") throw new Error("Requires active designer access");
  const access = activeAccess(grant.judge_access_id)!;
  const reset = resetDemoRun(session.runId);
  // Synchronous on this process: the old run closes before any new request can enter.
  const next = transaction(() => newRun(access));
  return { ...reset, runId: next.runId, session: next };
}

export function revokeJudgeAccess(id: string): void {
  db.prepare("UPDATE judge_access SET revoked = 1 WHERE id = ?").run(id);
}
