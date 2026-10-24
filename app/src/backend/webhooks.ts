import { db, transaction } from "./db.js";
import { isTombstonedInvoice } from "./orders.js";
import { verifyWebhook } from "./paypal.js";
import { enqueueJob, paypalRoute, UNMATCHED_PROJECT, UNMATCHED_RUN } from "./jobs.js";

export async function receiveWebhook(headers:Record<string,string|string[]|undefined>,event:any):Promise<{state:string}|null> {
  if(typeof event?.id!=="string" || !event.id || event.id.length>200 || typeof event.event_type!=="string" || event.event_type.length>200)throw new Error("Invalid webhook event");
  if(!(await verifyWebhook(headers,event)))return null;
  const nested=event.resource?.invoice?.id,direct=event.resource?.id;
  if(nested && direct && nested!==direct)throw new Error("Invalid conflicting invoice IDs");
  const candidate=nested??direct;
  const invoiceId=event.event_type.startsWith("INVOICING.INVOICE.") && typeof candidate==="string" && candidate.length>0 && candidate.length<=200?candidate:null;
  return transaction(()=>{
    const previous=db.prepare("SELECT * FROM webhook_receipts WHERE id=?").get(event.id);
    const upgrade=previous?.state==="ignored" && previous.invoice_id==null && invoiceId;
    if(previous && !upgrade){
      if((previous.invoice_id && previous.invoice_id!==invoiceId) || (previous.event_type && previous.event_type!==event.event_type) || (previous.route_key && previous.route_key!==paypalRoute))throw new Error("Conflicting webhook replay");
      return {state:"duplicate"};
    }
    const now=new Date().toISOString(),state=!invoiceId?"ignored":isTombstonedInvoice(invoiceId)?"tombstoned":"queued";
    const jobId=state==="queued"?enqueueJob({key:`paypal:event:${paypalRoute}:${event.id}`,kind:"paypal_reconcile",projectId:UNMATCHED_PROJECT,runId:UNMATCHED_RUN,payload:{invoiceId:invoiceId!,route:paypalRoute,receiptId:event.id},dueAt:now}):null;
    db.prepare(`INSERT INTO webhook_receipts (id,invoice_id,state,event_type,route_key,job_id,received_at,verified_at,processed_at) VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET invoice_id=excluded.invoice_id,state=excluded.state,event_type=excluded.event_type,route_key=excluded.route_key,job_id=excluded.job_id,verified_at=excluded.verified_at,processed_at=excluded.processed_at`)
      .run(event.id,invoiceId,state,event.event_type,paypalRoute,jobId,now,now,state==="queued"?null:now);
    return {state};
  });
}
