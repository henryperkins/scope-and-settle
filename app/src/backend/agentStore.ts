import { randomUUID } from "node:crypto";
import { db, assertRunActive } from "./db.js";

// Additive only: the existing payment, approval and budget tables are untouched.
db.exec(`
CREATE TABLE IF NOT EXISTS agent_policies (
  run_id TEXT PRIMARY KEY, policy_json TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_policy_history (
  run_id TEXT NOT NULL, version INTEGER NOT NULL, policy_json TEXT NOT NULL,
  PRIMARY KEY(run_id,version)
);
CREATE TABLE IF NOT EXISTS agent_requests (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, source TEXT NOT NULL, source_id TEXT NOT NULL,
  text TEXT NOT NULL, state TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  policy_version INTEGER, assessment_id TEXT, order_id TEXT, quote_revision INTEGER,
  quoted_minor INTEGER NOT NULL DEFAULT 0, clarification_count INTEGER NOT NULL DEFAULT 0,
  exception TEXT, delivery_exception TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(run_id, source, source_id)
);
CREATE TABLE IF NOT EXISTS agent_messages (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, request_id TEXT NOT NULL, actor TEXT NOT NULL,
  body TEXT NOT NULL, source_id TEXT, created_at TEXT NOT NULL,
  UNIQUE(run_id, source_id)
);
CREATE TABLE IF NOT EXISTS agent_portals (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, credential_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_outbox (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, request_id TEXT NOT NULL, kind TEXT NOT NULL,
  body TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', marker TEXT NOT NULL,
  provider_id TEXT, attempts INTEGER NOT NULL DEFAULT 0, error TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(request_id, marker)
);
CREATE TABLE IF NOT EXISTS agent_runtime (
  key TEXT PRIMARY KEY, value TEXT NOT NULL
);
`);
if (!(db.prepare("PRAGMA table_info(agent_requests)").all() as {name:string}[]).some(c=>c.name==="delivery_exception")) db.exec("ALTER TABLE agent_requests ADD COLUMN delivery_exception TEXT");

export const now = () => new Date().toISOString();
export interface AgentRequest {
  id: string; run_id: string; source: "portal" | "figma"; source_id: string; text: string;
  state: string; version: number; policy_version: number | null; assessment_id: string | null;
  order_id: string | null; quote_revision: number | null; quoted_minor: number;
  clarification_count: number; exception: string | null; delivery_exception:string|null; created_at: string; updated_at: string;
}
export function requestById(id: string, runId: string): AgentRequest | null {
  return db.prepare("SELECT * FROM agent_requests WHERE id = ? AND run_id = ?").get(id, runId) as unknown as AgentRequest ?? null;
}
export function listRequests(runId: string): AgentRequest[] {
  return db.prepare("SELECT * FROM agent_requests WHERE run_id = ? ORDER BY created_at DESC").all(runId) as unknown as AgentRequest[];
}
export function messagesFor(id: string, runId: string): any[] {
  return db.prepare("SELECT id,actor,body,created_at FROM agent_messages WHERE request_id = ? AND run_id = ? ORDER BY created_at,id").all(id,runId);
}
export function appendMessage(request: AgentRequest, actor: string, body: string, sourceId: string | null = null): void {
  db.prepare("INSERT OR IGNORE INTO agent_messages (id,run_id,request_id,actor,body,source_id,created_at) VALUES (?,?,?,?,?,?,?)")
    .run(randomUUID(), request.run_id, request.id, actor, body, sourceId, now());
}
export function createRequest(runId: string, source: AgentRequest["source"], sourceId: string, text: string): AgentRequest {
  assertRunActive(runId);
  if (typeof text !== "string" || !text.trim() || text.length > 4000) throw new Error("Request text required (maximum 4000 characters)");
  const existing = db.prepare("SELECT * FROM agent_requests WHERE run_id = ? AND source = ? AND source_id = ?").get(runId,source,sourceId) as unknown as AgentRequest;
  if (existing) return existing;
  if (Number((db.prepare("SELECT COUNT(*) n FROM agent_requests WHERE run_id = ?").get(runId) as any).n) >= 100) throw new Error("This demo has reached its 100 request limit");
  const id=randomUUID(), at=now();
  db.prepare("INSERT INTO agent_requests (id,run_id,source,source_id,text,state,created_at,updated_at) VALUES (?,?,?,?,?,'queued',?,?)")
    .run(id,runId,source,sourceId,text.trim(),at,at);
  const request=requestById(id,runId)!;
  appendMessage(request,"client",text.trim(),source === "figma" ? sourceId : null);
  return request;
}
export function exceptionFor(request: AgentRequest, message: string): void {
  db.prepare("UPDATE agent_requests SET state = 'exception', exception = ?, updated_at = ? WHERE id = ? AND run_id = ?")
    .run(message.slice(0,500),now(),request.id,request.run_id);
}
export function attentionFor(request:AgentRequest,message:string|null):void {
  db.prepare("UPDATE agent_requests SET delivery_exception = ?, updated_at = ? WHERE id = ? AND run_id = ?").run(message?.slice(0,500)??null,now(),request.id,request.run_id);
}
export function quotedTotal(runId: string): number {
  return Number((db.prepare("SELECT COALESCE(SUM(quoted_minor),0) n FROM agent_requests WHERE run_id = ?").get(runId) as any).n);
}
export function runtimeValue(key: string): string | null {
  return (db.prepare("SELECT value FROM agent_runtime WHERE key = ?").get(key) as any)?.value ?? null;
}
export function setRuntimeValue(key: string, value: string): void {
  db.prepare("INSERT INTO agent_runtime (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(key,value);
}

