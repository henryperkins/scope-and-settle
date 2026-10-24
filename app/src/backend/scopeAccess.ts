import {db} from './db.js';
import {activeGrant,credentialHash} from './judgeAccess.js';
import {getAgentPolicy,policyAuthority} from './agentPolicy.js';

export function persistedGrant(row:any){return {kind:row.grant_kind??(row.role==='designer'?'project':'change_order'),resourceId:row.resource_id??(row.role==='designer'?(row.project_id??'demo'):row.change_order_id),revision:row.resource_revision??(row.role==='designer'?null:row.change_order_revision)};}
export function scopeParentActive(id:string|null,projectId:string,runId:string):boolean {
 if(!id)return false;const p=db.prepare('SELECT * FROM scope_access_parents WHERE id=? AND project_id=? AND run_id=? AND expires_at>?').get(id,projectId,runId,new Date().toISOString()) as any;
 if(!p)return false;
 if(p.parent_kind==='session')return (db.prepare("SELECT token FROM sessions WHERE project_id=? AND run_id=? AND role='designer' AND revoked=0 AND expires_at>?").all(projectId,runId,new Date().toISOString()) as any[]).some(s=>credentialHash(s.token)===p.parent_ref);
 if(p.parent_kind==='grant'){const g=activeGrant(p.parent_ref);return !!g&&g.role==='designer'&&g.run_id===runId;}
 if(p.parent_kind==='portal'){const portal=db.prepare('SELECT id FROM agent_portals WHERE id=? AND run_id=? AND revoked=0 AND expires_at>?').get(p.parent_ref,runId,new Date().toISOString());const policy=getAgentPolicy(runId);return !!portal&&!!policy&&policyAuthority(policy);}
 return false;
}
export function validScopeGrant(row:any):boolean {const g=persistedGrant(row);return row.role==='client'&&g.kind==='scope'&&Number.isSafeInteger(g.revision)&&!!db.prepare('SELECT id FROM scope_snapshots WHERE id=? AND project_id=? AND run_id=? AND version=?').get(g.resourceId,row.project_id??'demo',row.run_id,g.revision)&&scopeParentActive(row.scope_parent_id,row.project_id??'demo',row.run_id);}
export function validDeliveryGrant(row:any):boolean {
 const g=persistedGrant(row);return row.role==='client'&&g.kind==='delivery'&&Number.isSafeInteger(g.revision)&&!!db.prepare(`SELECT r.id FROM delivery_reviews r JOIN delivery_review_heads h ON h.review_id=r.id AND h.revision=r.review_revision JOIN change_orders o ON o.id=r.order_id AND o.revision=r.order_revision WHERE r.id=? AND r.project_id=? AND r.run_id=? AND r.review_revision=? AND r.state<>'superseded'`).get(g.resourceId,row.project_id??'demo',row.run_id,g.revision)&&scopeParentActive(row.scope_parent_id,row.project_id??'demo',row.run_id);
}
