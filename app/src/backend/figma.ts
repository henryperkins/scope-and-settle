import { config } from "./env.js";
import type { FigmaComment } from "../shared/types.js";

interface FigmaApiComment {
  id: string;
  message?: string;
  user?: { id?: string; handle?: string };
  created_at?: string;
  resolved_at?: string | null;
  client_meta?: { node_id?: string } | null;
  parent_id?: string;
}
export class FigmaRequestError extends Error {
  readonly retryAfterSeconds:number;
  constructor(public status:number, retryAfterSeconds=60) {const safe=Number.isFinite(retryAfterSeconds)&&retryAfterSeconds>=0&&retryAfterSeconds<(8.64e15-Date.now())/1000?Math.max(60,retryAfterSeconds):60;super(`Figma comments unavailable (HTTP ${status}). Check file permissions or retry after ${safe} seconds.`);this.retryAfterSeconds=safe;}
}

export async function fetchComments(fileKey: string): Promise<FigmaComment[]> {
  if (fileKey !== config.figmaFileKey) {
    throw new Error(`File ${fileKey} is not the configured demo file`);
  }
  const res = await fetch(`https://api.figma.com/v1/files/${fileKey}/comments`, {
    redirect:"error", signal:AbortSignal.timeout(20_000),
    headers: { "X-Figma-Token": config.figmaToken },
  });
  if (!res.ok) {
    await res.body?.cancel();
    throw new FigmaRequestError(res.status, Math.max(60,Number(res.headers.get("retry-after"))||60));
  }
  let size=0;const chunks:Uint8Array[]=[];
  try{if(res.body)for await(const chunk of res.body){size+=chunk.byteLength;if(size>1_000_000)throw new Error('Figma comments response exceeds bounds');chunks.push(chunk);}}
  catch{if(size>1_000_000)throw new Error('Figma comments response exceeds bounds');throw new FigmaRequestError(503);}
  let data:{comments?:FigmaApiComment[]};try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('Invalid Figma comments response');}
  if(!data||!Array.isArray(data.comments)||data.comments.length>5000)throw new Error('Invalid Figma comments collection');
  const text=(value:unknown,max:number)=>value===undefined||value===null||typeof value==='string'&&value.length<=max;
  if(data.comments.some(c=>!c||typeof c.id!=='string'||!c.id||c.id.length>200||!text(c.message,16000)||!text(c.parent_id,200)||!text(c.user?.id,100)||!text(c.user?.handle,256)||!text(c.created_at,100)||!text(c.resolved_at,100)||!text(c.client_meta?.node_id,128)))throw new Error('Invalid Figma comment identifier or bounded fields');
  return data.comments.map((c) => ({
    id: c.id,
    message: c.message ?? "",
    userHandle: c.user?.handle ?? null,
    userId: c.user?.id ?? null,
    createdAt: c.created_at ?? null,
    resolvedAt: c.resolved_at ?? null,
    nodeId: c.client_meta?.node_id ?? null,
    parentId: c.parent_id && c.parent_id !== "" ? c.parent_id : null,
  }));
}

export async function postComment(fileKey:string,parentId:string,message:string,authorized?:()=>void,onDispatch?:()=>void):Promise<{id:string;userId?:string;parentId?:string}> {
  if (fileKey!==config.figmaFileKey || !parentId || message.length>5000) throw new Error("Invalid Figma reply target");
  authorized?.();onDispatch?.();
  const res=await fetch(`https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/comments`,{
    method:"POST",redirect:"error",signal:AbortSignal.timeout(20_000),headers:{"X-Figma-Token":config.figmaToken,"Content-Type":"application/json"},
    body:JSON.stringify({comment_id:parentId,message}),
  });
  if (!res.ok) {await res.body?.cancel();throw new FigmaRequestError(res.status,Math.max(60,Number(res.headers.get("retry-after"))||60));}
  const data=await res.json() as any;
  if(!data||typeof data.id!=="string"||!data.id||data.id.length>200||data.parent_id!==parentId||data.message!==message||typeof data.user?.id!=='string'||!data.user.id)throw new Error("Figma reply acknowledgement does not match the reviewed root and body");
  return {id:data.id,userId:data.user.id,parentId:data.parent_id};
}

/** Node identity/content verification only; this never verifies plugin-supplied pixels. */
export async function fetchDesignNodes(fileKey:string,nodeIds:string[]) {
  if(fileKey!==config.figmaFileKey||!nodeIds.length||nodeIds.length>20)throw new Error('Invalid configured Figma node request');
  const query=new URLSearchParams({ids:nodeIds.join(','),depth:'1'});
  const response=await fetch(`https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/nodes?${query}`,{
    redirect:'error',signal:AbortSignal.timeout(20_000),headers:{'X-Figma-Token':config.figmaToken},
  });
  if(!response.ok){await response.body?.cancel();throw new FigmaRequestError(response.status);}
  // Bound transport before JSON parsing, including a provider that ignores depth.
  let size=0;const chunks:Uint8Array[]=[];
  if(response.body){for await(const chunk of response.body){size+=chunk.byteLength;if(size>1_000_000){await response.body.cancel().catch(()=>{});throw new Error('Figma node response exceeds bounds');}chunks.push(chunk);}}
  const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const nodes=nodeIds.flatMap(id=>{const n=data.nodes?.[id]?.document;if(!n||n.id!==id||typeof n.name!=='string'||typeof n.type!=='string')return [];return [{id,name:n.name.slice(0,256),type:n.type.slice(0,64),width:Number.isFinite(n.absoluteBoundingBox?.width)?n.absoluteBoundingBox.width:null,height:Number.isFinite(n.absoluteBoundingBox?.height)?n.absoluteBoundingBox.height:null}];});
  return {nodes,version:typeof data.version==='string'?data.version.slice(0,256):null,lastModified:typeof data.lastModified==='string'?data.lastModified.slice(0,100):null};
}
