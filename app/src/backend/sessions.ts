import { randomUUID } from "node:crypto";
import { db, currentRunId, transaction } from "./db.js";
import { activeGrant } from "./judgeAccess.js";
import {persistedGrant,validScopeGrant} from './scopeAccess.js';

export type Role = "designer" | "client";

export interface Session {
  token: string;
  projectId: string;
  runId: string;
  role: Role;
  changeOrderId: string | null;
  changeOrderRevision: number | null;
  expiresAt: string;
  canEditScope: boolean;
  grantId: string | null;
  grantKind: 'project'|'change_order'|'scope';
  resourceId: string;
  resourceRevision: number|null;
  scopeParentId: string|null;
}

/** Q09: expiring, revocable, revision-bound demo sessions. A link grants a role, not an identity. */
export function createSession(input: {
  projectId: string;
  role: Role;
  changeOrderId?: string | null;
  changeOrderRevision?: number | null;
  ttlMinutes?: number;
  runId?: string;
  grantId?: string;
  grantKind?: 'project'|'change_order'|'scope';
  resourceId?: string;
  resourceRevision?: number;
  scopeParentId?: string;
  expiresAt?: string;
}): Session {
  const token = randomUUID();
  if (input.ttlMinutes !== undefined && (!Number.isFinite(input.ttlMinutes) || input.ttlMinutes <= 0 || input.ttlMinutes > 1440)) throw new Error("Invalid session lifetime");
  const runId = input.runId ?? currentRunId();
  const grant = input.grantId ? activeGrant(input.grantId) : null;
  const kind=input.grantKind??(input.role==='designer'?'project':'change_order'),resourceId=input.resourceId??(input.role==='designer'?input.projectId:input.changeOrderId??''),resourceRevision=input.resourceRevision??input.changeOrderRevision??null;
  if(kind==='scope'&&!validScopeGrant({role:input.role,grant_kind:kind,resource_id:resourceId,resource_revision:resourceRevision,scope_parent_id:input.scopeParentId,project_id:input.projectId,run_id:runId}))throw new Error('Invalid scope grant or expired parent');
  if(grant&&(persistedGrant(grant).kind!==kind||persistedGrant(grant).resourceId!==resourceId||persistedGrant(grant).revision!==resourceRevision||grant.scope_parent_id!==(input.scopeParentId??null)))throw new Error('Invalid renewal grant scope');
  if (input.grantId && (!grant || grant.run_id !== runId || grant.role !== input.role ||
      grant.change_order_id !== (input.changeOrderId ?? null) || grant.change_order_revision !== (input.changeOrderRevision ?? null))) throw new Error("Invalid renewal grant scope");
  if (!grant && db.prepare("SELECT run_id FROM judge_runs WHERE run_id = ?").get(runId)) throw new Error("Judging runs require renewable access");
  const parent=input.scopeParentId?db.prepare('SELECT expires_at FROM scope_access_parents WHERE id=?').get(input.scopeParentId) as any:null;
  const expiresAt = new Date(Math.min(Date.now() + (input.ttlMinutes ?? 60) * 60_000, grant ? Date.parse(grant.expires_at) : Infinity,parent?Date.parse(parent.expires_at):Infinity,input.expiresAt?Date.parse(input.expiresAt):Infinity)).toISOString();
  db.prepare(
    `INSERT INTO sessions (token, project_id, role, change_order_id, change_order_revision, expires_at, created_at, run_id, grant_id)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(token, input.projectId, input.role, input.changeOrderId ?? null,
    input.changeOrderRevision ?? null, expiresAt, new Date().toISOString(), runId, input.grantId ?? null);
  db.prepare('UPDATE sessions SET grant_kind=?,resource_id=?,resource_revision=?,scope_parent_id=? WHERE token=?').run(kind,resourceId,resourceRevision,input.scopeParentId??null,token);
  return {
    token, projectId: input.projectId, role: input.role, runId,grantKind:kind,resourceId,resourceRevision,scopeParentId:input.scopeParentId??null,
    changeOrderId: input.changeOrderId ?? null,
    changeOrderRevision: input.changeOrderRevision ?? null, expiresAt, canEditScope: !grant && input.role === "designer", grantId: input.grantId ?? null,
  };
}

export function getSession(token: string | undefined | null): Session | null {
  if (!token) return null;
  const r = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token) as any;
  if (!r || r.revoked) return null;
  if (new Date(r.expires_at).getTime() <= Date.now()) return null;
  const resource=persistedGrant(r);
  if(resource.kind==='scope'&&!validScopeGrant(r))return null;
  if (r.grant_id) {
    const grant = activeGrant(r.grant_id);
    if (!grant || grant.role !== r.role || grant.run_id !== r.run_id ||
        grant.change_order_id !== r.change_order_id || grant.change_order_revision !== r.change_order_revision) return null;
    const g=persistedGrant(grant);if(g.kind!==resource.kind||g.resourceId!==resource.resourceId||g.revision!==resource.revision||grant.scope_parent_id!==r.scope_parent_id)return null;
  }
  return {
    token: r.token, projectId: r.project_id, role: r.role, runId: r.run_id,grantKind:resource.kind,resourceId:resource.resourceId,resourceRevision:resource.revision,scopeParentId:r.scope_parent_id,
    changeOrderId: r.change_order_id, changeOrderRevision: r.change_order_revision,
    expiresAt: r.expires_at, canEditScope: !r.grant_id && r.role === "designer", grantId: r.grant_id ?? null,
  };
}

export function createInvitation(input: Parameters<typeof createSession>[0]): { token: string; expiresAt: string } {
  const token = randomUUID();
  const expiresAt = new Date(Math.min(Date.now() + 60 * 60_000,input.expiresAt?Date.parse(input.expiresAt):Infinity)).toISOString();
  db.prepare(`INSERT INTO invitations (token, project_id, run_id, role, change_order_id, change_order_revision, expires_at) VALUES (?,?,?,?,?,?,?)`)
    .run(token, input.projectId, input.runId ?? currentRunId(), input.role, input.changeOrderId ?? null, input.changeOrderRevision ?? null, expiresAt);
  db.prepare('UPDATE invitations SET grant_kind=?,resource_id=?,resource_revision=?,scope_parent_id=? WHERE token=?').run(input.grantKind??null,input.resourceId??null,input.resourceRevision??null,input.scopeParentId??null,token);
  return { token, expiresAt };
}

export function redeemInvitation(token: string): Session | null {
  return transaction(() => {
    const invite = db.prepare("SELECT * FROM invitations WHERE token = ? AND revoked = 0 AND redeemed_at IS NULL AND expires_at > ?")
      .get(token, new Date().toISOString()) as any;
    if (!invite) return null;
    const resource=persistedGrant(invite);
    if(resource.kind==='scope'&&!validScopeGrant(invite))return null;
    if (invite.role === "client"&&resource.kind!=='scope') {
      const order = db.prepare("SELECT * FROM change_orders WHERE id = ? AND run_id = ? AND revision = ?")
        .get(invite.change_order_id, invite.run_id, invite.change_order_revision) as any;
      if (!order || order.status !== "awaiting_client_approval") return null;
    }
    db.prepare("UPDATE invitations SET redeemed_at = ? WHERE token = ?").run(new Date().toISOString(), token);
    return createSession({ projectId: invite.project_id, runId: invite.run_id, role: invite.role,
      grantKind:resource.kind,resourceId:resource.resourceId,resourceRevision:resource.revision??undefined,scopeParentId:invite.scope_parent_id??undefined,expiresAt:invite.expires_at,
      changeOrderId: invite.change_order_id, changeOrderRevision: invite.change_order_revision });
  });
}

export function revokeSession(token: string): void {
  db.prepare("UPDATE renewal_grants SET revoked = 1 WHERE id = (SELECT grant_id FROM sessions WHERE token = ?)").run(token);
  db.prepare("UPDATE sessions SET revoked = 1 WHERE token = ?").run(token);
}

export function requireRole(token: string | undefined, role: Role): Session {
  const s = getSession(token);
  if (!s) throw new Error("Missing, expired, or revoked session");
  if (s.role !== role) throw new Error(`Requires ${role} role`);
  return s;
}
