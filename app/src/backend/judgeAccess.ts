import { createHash, randomBytes, randomUUID } from "node:crypto";
import { db } from "./db.js";
import type { Role } from "./sessions.js";
import {persistedGrant,validScopeGrant,validDeliveryGrant} from './scopeAccess.js';

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
  if(persistedGrant(grant).kind==='scope'&&!validScopeGrant(grant)||persistedGrant(grant).kind==='delivery'&&!validDeliveryGrant(grant))return null;
  if (grant.role === "client"&&!['scope','delivery'].includes(persistedGrant(grant).kind)) {
    const order = db.prepare("SELECT * FROM change_orders WHERE id = ? AND run_id = ? AND revision = ?")
      .get(grant.change_order_id, grant.run_id, grant.change_order_revision) as any;
    if (!order || (order.status!=="awaiting_client_approval" && !db.prepare("SELECT id FROM approvals WHERE change_order_id=? AND change_order_revision=? AND actor_role='client'").get(order.id,order.revision))) return null;
  }
  return grant;
}

export function grantByCredential(credential: string): any | null {
  if (typeof credential !== "string" || credential.length !== 43) return null;
  const grant = db.prepare("SELECT id FROM renewal_grants WHERE credential_hash = ?").get(credentialHash(credential)) as any;
  return grant ? activeGrant(grant.id) : null;
}

export function createGrant(accessId: string, runId: string, role: Role, orderId: string | null = null, revision: number | null = null,resource?:{kind:'scope'|'delivery';resourceId:string;revision:number;parentId:string}) {
  const access = activeAccess(accessId);
  if (!access) throw new Error("Judging access expired or revoked");
  const credential = newCredential(), id = randomUUID();
  if(resource&&!(resource.kind==='scope'?validScopeGrant:validDeliveryGrant)({role,grant_kind:resource.kind,resource_id:resource.resourceId,resource_revision:resource.revision,scope_parent_id:resource.parentId,run_id:runId}))throw new Error('Invalid resource grant');
  const scopeParent=resource?db.prepare('SELECT expires_at FROM scope_access_parents WHERE id=?').get(resource.parentId) as any:null;
  const expiresAt=new Date(Math.min(Date.parse(access.expires_at),scopeParent?Date.parse(scopeParent.expires_at):Infinity)).toISOString();
  db.prepare(`INSERT INTO renewal_grants (id,credential_hash,judge_access_id,run_id,role,change_order_id,change_order_revision,expires_at,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(id, credentialHash(credential), accessId, runId, role, orderId, revision, expiresAt, new Date().toISOString());
  if(resource)db.prepare('UPDATE renewal_grants SET grant_kind=?,resource_id=?,resource_revision=?,scope_parent_id=? WHERE id=?').run(resource.kind,resource.resourceId,resource.revision,resource.parentId,id);
  return { id, credential, expiresAt };
}
