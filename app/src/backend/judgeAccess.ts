import { createHash, randomBytes, randomUUID } from "node:crypto";
import { db } from "./db.js";
import type { Role } from "./sessions.js";

export const newCredential = () => randomBytes(32).toString("base64url");
export const credentialHash = (value: string) => createHash("sha256").update(value).digest("hex");

export function activeAccess(id: string): any | null {
  return db.prepare("SELECT * FROM judge_access WHERE id = ? AND revoked = 0 AND expires_at > ?")
    .get(id, new Date().toISOString()) ?? null;
}

export function accessByCredential(credential: string): any | null {
  if (typeof credential !== "string" || credential.length !== 43) return null;
  const access = db.prepare("SELECT id FROM judge_access WHERE credential_hash = ?").get(credentialHash(credential)) as any;
  return access ? activeAccess(access.id) : null;
}

export function activeGrant(id: string): any | null {
  const grant = db.prepare("SELECT * FROM renewal_grants WHERE id = ? AND revoked = 0 AND expires_at > ?")
    .get(id, new Date().toISOString()) as any;
  if (!grant || !activeAccess(grant.judge_access_id)) return null;
  const run = db.prepare("SELECT * FROM judge_runs WHERE run_id = ? AND judge_access_id = ? AND closed_at IS NULL")
    .get(grant.run_id, grant.judge_access_id);
  if (!run) return null;
  if (grant.role === "client") {
    const order = db.prepare("SELECT * FROM change_orders WHERE id = ? AND run_id = ? AND revision = ?")
      .get(grant.change_order_id, grant.run_id, grant.change_order_revision) as any;
    if (!order || !["awaiting_client_approval", "approved", "creating_invoice", "payment_due", "paid"].includes(order.status)) return null;
  }
  return grant;
}

export function grantByCredential(credential: string): any | null {
  if (typeof credential !== "string" || credential.length !== 43) return null;
  const grant = db.prepare("SELECT id FROM renewal_grants WHERE credential_hash = ?").get(credentialHash(credential)) as any;
  return grant ? activeGrant(grant.id) : null;
}

export function createGrant(accessId: string, runId: string, role: Role, orderId: string | null = null, revision: number | null = null) {
  const access = activeAccess(accessId);
  if (!access) throw new Error("Judging access expired or revoked");
  const credential = newCredential(), id = randomUUID();
  db.prepare(`INSERT INTO renewal_grants (id,credential_hash,judge_access_id,run_id,role,change_order_id,change_order_revision,expires_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(id, credentialHash(credential), accessId, runId, role, orderId, revision, access.expires_at, new Date().toISOString());
  return { id, credential, expiresAt: access.expires_at as string };
}
