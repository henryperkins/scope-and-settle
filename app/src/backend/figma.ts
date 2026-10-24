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

export async function fetchComments(fileKey: string): Promise<FigmaComment[]> {
  if (fileKey !== config.figmaFileKey) {
    throw new Error(`File ${fileKey} is not the configured demo file`);
  }
  const res = await fetch(`https://api.figma.com/v1/files/${fileKey}/comments`, {
    headers: { "X-Figma-Token": config.figmaToken },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Figma comments request failed: HTTP ${res.status} ${body.slice(0, 200)}`);
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
