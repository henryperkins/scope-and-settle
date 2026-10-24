import {createHash} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {config} from './env.js';

export function legacyAssociationIssue(db:DatabaseSync,o:any,op:any):string|null {
 const ids=[o.paypal_invoice_id,op?.paypal_invoice_id].filter(Boolean) as string[];
 if(new Set(ids).size>1)return 'association_mismatch';
 for(const id of ids)if(db.prepare('SELECT id FROM change_orders WHERE id<>? AND paypal_invoice_id=? UNION ALL SELECT change_order_id FROM invoice_operations WHERE change_order_id<>? AND paypal_invoice_id=?').get(o.id,id,o.id,id))return 'ambiguous_provider_identity';
 return null;
}

/** Local adoption only: original snapshots, operations, invoice numbers and provider IDs are retained. */
export function adoptLegacyInvoices(db:DatabaseSync){
 const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
 const route=createHash('sha256').update(`${config.paypalEnv}:${config.paypalMerchantEmail.trim().toLowerCase()}:${config.paypalClientId}`).digest('hex');
 const at=new Date().toISOString();
 for(const o of db.prepare('SELECT * FROM change_orders').all() as any[]){
  if(!Number.isSafeInteger(o.total_minor)||o.total_minor<=0)continue; // Invalid historical terms remain on their original review path.
  const schedule={milestones:[{id:'upfront',title:'Approved work',amountMinor:o.total_minor,dueTrigger:'proposal_approval',acceptanceCriteria:['Deliver the approved change-order items']}],workStartPaymentMilestoneIds:['upfront']};
  const id='ms_'+hash([o.id,o.revision,'upfront']),record='ir_'+hash(id),op=db.prepare('SELECT * FROM invoice_operations WHERE operation_key=?').get(`invoice:${o.id}`) as any;
  const provider=o.paypal_invoice_id??op?.paypal_invoice_id??null;
  const issue=legacyAssociationIssue(db,o,op);
  const observation=provider?db.prepare('SELECT * FROM payment_observations WHERE change_order_id=? AND paypal_invoice_id=? ORDER BY id DESC LIMIT 1').get(o.id,provider) as any:null;
  db.prepare('INSERT INTO milestone_schedules VALUES(?,?,?,?,?,?)').run(o.id,o.revision,JSON.stringify(schedule),hash(schedule),'legacy_adoption',at);
  db.prepare("INSERT INTO milestones VALUES(?,?,?,'upfront','Approved work',?,'proposal_approval',?,1,?)").run(id,o.id,o.revision,o.total_minor,JSON.stringify(schedule.milestones[0].acceptanceCriteria),at);
  db.prepare('INSERT INTO invoice_records(id,milestone_id,order_id,project_id,run_id,revision,route,operation_key,terms_json,provider_id,payer_url,financial_json,observed_at,state,adoption_issue,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(record,id,o.id,o.project_id,o.run_id,o.revision,route,op?.operation_key??`legacy-record:${o.id}:${o.revision}`,op?.approved_terms_json??null,issue?null:provider,o.invoice_url,issue?null:observation?.financial_json??null,observation?.checked_at??null,issue?'review_required':op?.state??(provider?'created':'unissued'),issue,at);
  if(provider&&!issue)db.prepare('UPDATE payment_observations SET invoice_record_id=? WHERE change_order_id=? AND paypal_invoice_id=?').run(record,o.id,provider);
 }
}
