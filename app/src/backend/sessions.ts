import { randomUUID } from "node:crypto";
import { db, currentRunId, transaction } from "./db.js";
import { activeGrant } from "./judgeAccess.js";

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
}): Session {
  const token = randomUUID();
  if (input.ttlMinutes !== undefined && (!Number.isFinite(input.ttlMinutes) || input.ttlMinutes <= 0 || input.ttlMinutes > 1440)) throw new Error("Invalid session lifetime");
  const runId = input.runId ?? currentRunId();
  const grant = input.grantId ? activeGrant(input.grantId) : null;
  if (input.grantId && (!grant || grant.run_id !== runId || grant.role !== input.role ||
      grant.change_order_id !== (input.changeOrderId ?? null) || grant.change_order_revision !== (input.changeOrderRevision ?? null))) throw new Error("Invalid renewal grant scope");
  if (!grant && db.prepare("SELECT run_id FROM judge_runs WHERE run_id = ?").get(runId)) throw new Error("Judging runs require renewable access");
  const expiresAt = new Date(Math.min(Date.now() + (input.ttlMinutes ?? 60) * 60_000, grant ? Date.parse(grant.expires_at) : Infinity)).toISOString();
  db.prepare(
    `INSERT INTO sessions (token, project_id, role, change_order_id, change_order_revision, expires_at, created_at, run_id, grant_id)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run(token, input.projectId, input.role, input.changeOrderId ?? null,
    input.changeOrderRevision ?? null, expiresAt, new Date().toISOString(), runId, input.grantId ?? null);
  return {
    token, projectId: input.projectId, role: input.role, runId,
    changeOrderId: input.changeOrderId ?? null,
    changeOrderRevision: input.changeOrderRevision ?? null, expiresAt, canEditScope: !grant && input.role === "designer", grantId: input.grantId ?? null,
  };
}

export function getSession(token: string | undefined | null): Session | null {
  if (!token) return null;
  const r = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token) as any;
  if (!r || r.revoked) return null;
  if (new Date(r.expires_at).getTime() <= Date.now()) return null;
  if (r.grant_id && !activeGrant(r.grant_id)) return null;
  return {
    token: r.token, projectId: r.project_id, role: r.role, runId: r.run_id,
    changeOrderId: r.change_order_id, changeOrderRevision: r.change_order_revision,
    expiresAt: r.expires_at, canEditScope: !r.grant_id && r.role === "designer", grantId: r.grant_id ?? null,
  };
}

export function createInvitation(input: Parameters<typeof createSession>[0]): { token: string; expiresAt: string } {
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
  db.prepare(`INSERT INTO invitations (token, project_id, run_id, role, change_order_id, change_order_revision, expires_at) VALUES (?,?,?,?,?,?,?)`)
    .run(token, input.projectId, input.runId ?? currentRunId(), input.role, input.changeOrderId ?? null, input.changeOrderRevision ?? null, expiresAt);
  return { token, expiresAt };
}

export function redeemInvitation(token: string): Session | null {
  return transaction(() => {
    const invite = db.prepare("SELECT * FROM invitations WHERE token = ? AND revoked = 0 AND redeemed_at IS NULL AND expires_at > ?")
      .get(token, new Date().toISOString()) as any;
    if (!invite) return null;
    if (invite.role === "client") {
      const order = db.prepare("SELECT * FROM change_orders WHERE id = ? AND run_id = ? AND revision = ?")
        .get(invite.change_order_id, invite.run_id, invite.change_order_revision) as any;
      if (!order || order.status !== "awaiting_client_approval") return null;
    }
    db.prepare("UPDATE invitations SET redeemed_at = ? WHERE token = ?").run(new Date().toISOString(), token);
    return createSession({ projectId: invite.project_id, runId: invite.run_id, role: invite.role,
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
