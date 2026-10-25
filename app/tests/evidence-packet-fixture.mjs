import {milestoneFixture} from './milestone-fixture.mjs';
import {canonicalDraftFactory} from './helpers.mjs';
import {outputFor,deliveryPng} from './delivery-fixture.mjs';
import {deflateSync,crc32} from 'node:zlib';
import assert from 'node:assert/strict';
function chunk(name,data){const tag=Buffer.from(name),b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);tag.copy(b,4);data.copy(b,8);b.writeUInt32BE(crc32(b.subarray(4,b.length-4)),b.length-4);return b;}
export function paddedDeliveryPng(targetBytes,pixel=1){
 const h=Buffer.alloc(13);h.writeUInt32BE(1);h.writeUInt32BE(1,4);h[8]=8;h[9]=6;
 const base=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',h),chunk('IDAT',deflateSync(Buffer.from([0,pixel,0,0,255])))]);
 const iend=chunk('IEND',Buffer.alloc(0)),padLen=Math.max(0,targetBytes-base.length-iend.length-12);
 const text=Buffer.alloc(padLen,0x61);if(padLen>=2){text[0]=0x6b;text[1]=0;}
 const bytes=Buffer.concat([base,chunk('tEXt',text),iend]);
 return {bytes,dataUrl:'data:image/png;base64,'+bytes.toString('base64')};
}
export async function packetFixture({text='Mobile checkout for the bounded packet fixture',judging=false}={}){
 const f=await milestoneFixture();
 if(judging){
  const access=await f.app.load('judging'),entry=access.createJudgeAccess({expiresAt:new Date(Date.now()+86400000).toISOString()});
  f.rootCredential=entry.credential;f.session=access.startJudgeRun(entry.credential);f.ctx=f.m.context.contextFromSessionToken(f.session.token);
  const http=f.http;f.http=(path,method='GET',body,token=f.session.token,headers={})=>http(path,method,body,token,headers);
  f.submit=async id=>{const r=await f.http('/api/change-orders/'+id+'/submit','POST');assert.equal(r.status,200);return r.body;};
  f.redeem=async url=>{const r=await f.http('/api/session/renew','POST',{credential:new URL(url).hash.slice('#resume='.length)},null);assert.equal(r.status,200);return r.body.token;};
 }
 f.packets=await f.app.load('evidencePackets').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
 const make=await canonicalDraftFactory(f.app),input=make(f.ctx,{requestedDeliverable:text});f.order=f.service.draftChangeOrder(f.ctx,input);f.order=f.schedule();await f.approve();
 f.source=f.db.prepare('SELECT s.* FROM proposal_item_reservations r JOIN request_item_results i ON i.item_id=r.item_id AND i.assessment_id=r.assessment_id JOIN request_sources s ON s.id=i.source_id WHERE r.order_id=?').get(f.order.id);
 f.request=f.store.createRequest(f.ctx.runId,'portal',f.source.root_id,text);const links=await f.app.load('requestLinks');links.recordPublishedOrder(f.request,f.order.id,2);
 f.delivery=await f.app.load('delivery');f.markPaid(f.order.installments[0].paypalInvoiceId);f.run=await f.delivery.startApprovedWork(f.ctx,f.order.installments[1].id);
 f.first=f.delivery.recordDeliveryOutput(f.ctx,f.run.id,outputFor(f.run));f.firstReview=f.delivery.submitDelivery(f.ctx,f.run.milestoneId,f.first.id);const link=f.delivery.issueDeliveryAccess(f.ctx,f.firstReview.id),token=await f.redeem(link.deliveryUrl),client=f.m.context.contextFromSessionToken(token);
 f.delivery.requestDeliveryChanges(client,f.firstReview.id,'Please clarify the error state');
 f.second=f.delivery.recordDeliveryOutput(f.ctx,f.run.id,outputFor(f.run,{imageDataUrl:deliveryPng(100)}));f.review=f.delivery.submitDelivery(f.ctx,f.run.milestoneId,f.second.id);const access=f.delivery.issueDeliveryAccess(f.ctx,f.review.id),next=await f.redeem(access.deliveryUrl);f.deliveryClient=f.m.context.contextFromSessionToken(next);
 f.acceptance=await f.delivery.acceptDelivery(f.deliveryClient,f.review.id,f.review.revision);f.order=f.orders.getChangeOrder(f.order.id);
 f.build=(options)=>{if(typeof f.packets.buildEvidencePacket!=='function')throw new Error('T17 requires buildEvidencePacket');return options===undefined?f.packets.buildEvidencePacket(f.ctx,f.order.id):f.packets.buildEvidencePacket(f.ctx,f.order.id,options);};
 return f;
}
