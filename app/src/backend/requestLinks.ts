import {db} from './db.js';
import {getChangeOrder} from './orders.js';
import type {AgentRequest} from './agentStore.js';
export function linkedOrders(request:AgentRequest){
 const rows=db.prepare('SELECT order_id,MAX(revision) revision FROM request_order_links WHERE request_id=? AND run_id=? GROUP BY order_id ORDER BY rowid').all(request.id,request.run_id) as {order_id:string;revision:number}[];
 if(!rows.length&&request.order_id&&request.quote_revision)rows.push({order_id:request.order_id,revision:request.quote_revision});
 return rows;
}
export function recordPublishedOrder(request:AgentRequest,orderId:string,revision:number){
 const order=getChangeOrder(orderId);if(!order||order.runId!==request.run_id||order.revision!==revision||!['awaiting_client_approval','approved'].includes(order.approvalStatus)||order.stale)throw new Error('Exact submitted proposal required');
 const other=db.prepare('SELECT request_id FROM request_order_links WHERE order_id=? AND request_id<>?').get(orderId,request.id);if(other)throw new Error('Quote belongs to another request');
 const previous=db.prepare('SELECT MAX(published_minor) amount FROM request_order_links WHERE request_id=? AND order_id=?').get(request.id,orderId) as any;
 const delta=Math.max(0,order.totalMinor-Number(previous?.amount??0));
 const inserted=db.prepare('INSERT OR IGNORE INTO request_order_links VALUES(?,?,?,?,?,?)').run(request.id,request.run_id,orderId,revision,order.totalMinor,new Date().toISOString());
 if(inserted.changes)db.prepare('UPDATE agent_requests SET order_id=?,quote_revision=?,quoted_minor=quoted_minor+? WHERE id=? AND run_id=?').run(orderId,revision,delta,request.id,request.run_id);
}
