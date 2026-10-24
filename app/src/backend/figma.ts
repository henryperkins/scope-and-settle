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
  constructor(public status:number, public retryAfterSeconds=60) {super(`Figma comments unavailable (HTTP ${status}). Check file permissions or retry after ${retryAfterSeconds} seconds.`);}
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
  const data = (await res.json()) as { comments?: FigmaApiComment[] };
  return (data.comments ?? []).map((c) => ({
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

export async function postComment(fileKey:string,parentId:string,message:string):Promise<{id:string}> {
  if (fileKey!==config.figmaFileKey || !parentId || message.length>5000) throw new Error("Invalid Figma reply target");
  const res=await fetch(`https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/comments`,{
    method:"POST",redirect:"error",signal:AbortSignal.timeout(20_000),headers:{"X-Figma-Token":config.figmaToken,"Content-Type":"application/json"},
    body:JSON.stringify({comment_id:parentId,message}),
  });
  if (!res.ok) {await res.body?.cancel();throw new FigmaRequestError(res.status,Math.max(60,Number(res.headers.get("retry-after"))||60));}
  const data=await res.json() as any;
  if(typeof data.id!=="string")throw new Error("Figma reply acknowledgement missing");
  return {id:data.id};
}
