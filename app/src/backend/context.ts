import { getProjectForRun } from "./db.js";
import { getSession, type Session } from "./sessions.js";
import { credentialHash } from "./judgeAccess.js";
import { config } from "./env.js";
import { connectorDigest, isConnectorOperation, liveConnector, parseConnectorBearer, type ConnectorOperation, type ConnectorRecord } from "./connectorStore.js";
import type { ActorContext, ResourceGrant } from "../shared/types.js";
export type { ActorContext, ResourceGrant } from "../shared/types.js";
export type { ConnectorOperation } from "./connectorStore.js";

export class ScopedAccessError extends Error {
  constructor(public readonly status: 400 | 401 | 403 | 404 | 409, message: string) { super(message); }
}
// Copies, prototypes and JSON objects cannot acquire this module's authority.
const authority = new WeakMap<ActorContext, Readonly<Session>>();
function activeSession(token: string | undefined): Session {
  const session = getSession(token);
  if (!session) throw new ScopedAccessError(401, "Missing, expired, or revoked session");
  if (session.role !== "designer" && session.role !== "client") throw new ScopedAccessError(403, "Invalid session role");
  let project;
  try { project = getProjectForRun(session.runId); }
  catch { throw new ScopedAccessError(401, "This demo was reset; reconnect to your new run"); }
  if (project.id !== session.projectId) throw new ScopedAccessError(403, "Session does not grant access to this project");
  if (session.role === "client" && (!['scope','change_order','delivery'].includes(session.grantKind) || !session.resourceId || !Number.isSafeInteger(session.resourceRevision) || session.resourceRevision! < 1)) {
    throw new ScopedAccessError(403, "Session requires an exact proposal revision");
  }
  return session;
}
export function contextFromSessionToken(token: string | undefined): ActorContext {
  const session = activeSession(token);
  const grant: ResourceGrant = session.role === "designer" ? {kind:"project",resourceId:session.projectId,revision:null} :
    {kind:session.grantKind==='delivery'?'delivery':session.grantKind==='scope'?'scope':'change_order',resourceId:session.resourceId,revision:session.resourceRevision!};
  const ctx: ActorContext = Object.freeze({ projectId:session.projectId, runId:session.runId, role:session.role,
    actorId:session.grantId ? `demo:grant:${session.grantId}` : `demo:session:${credentialHash(session.token)}`, grant:Object.freeze(grant) });
  authority.set(ctx, Object.freeze({...session}));
  return ctx;
}
/** Application-session guard only. A connector context has no session provenance and is rejected by construction. */
export function sessionForContext(ctx: ActorContext): Session {
  const original = authority.get(ctx);
  if (!original) throw new ScopedAccessError(401, "Untrusted actor context");
  const current = activeSession(original.token);
  for (const key of ["projectId", "runId", "role", "changeOrderId", "changeOrderRevision", "grantId","grantKind","resourceId","resourceRevision","scopeParentId"] as const) {
    if (current[key] !== original[key]) throw new ScopedAccessError(401, "Session authority changed");
  }
  return current;
}
export function requireActiveContext(ctx: ActorContext): void { sessionForContext(ctx); }
export function requireDesignerContext(ctx: ActorContext): void {
  if (sessionForContext(ctx).role !== "designer") throw new ScopedAccessError(403, "Requires designer role");
}

/** Operation-bound connector authority: role `connector`, never `designer`, and never the owner's actor identity. */
export interface ConnectorContext {
  readonly projectId: string;
  readonly runId: string;
  readonly role: "connector";
  readonly actorId: string;
  readonly operation: ConnectorOperation;
  readonly grant: Readonly<{ kind: "connector"; resourceId: string; revision: null }>;
}
/** Accepted only by the four operation entrances, through requireOperationContext. */
export type ServiceContext = ActorContext | ConnectorContext;
export interface ConnectorIdentity {
  readonly connectorId: string; readonly projectId: string; readonly runId: string;
  readonly operations: readonly ConnectorOperation[]; readonly expiresAt: string;
}
type ConnectorProvenance = Readonly<{ connectorId: string; digest: string; operation: ConnectorOperation; projectId: string; runId: string; fileKey: string; parentKind: string; parentRef: string }>;
// A separate private map: session guards never consult it, so they reject every connector context.
const connectorAuthority = new WeakMap<object, ConnectorProvenance>();
const CONNECTOR_DENIED = "Missing, malformed, expired or revoked connector credential";
function requireConnectorEnabled(): void {
  if (!config.mcpConnectorEnabled) throw new ScopedAccessError(403, "The Figma agent connector is disabled on this server");
}
function verifyConnector(authorizationHeaderValues: unknown): { record: ConnectorRecord; digest: string } {
  requireConnectorEnabled();
  const parsed = parseConnectorBearer(authorizationHeaderValues);
  const digest = parsed ? connectorDigest(parsed.token) : null;
  const record = parsed && digest ? liveConnector(parsed.id, digest) : null;
  if (!record || !digest) throw new ScopedAccessError(401, CONNECTOR_DENIED);
  return { record, digest };
}
/** The single verifier for raw Authorization header values (a string or a one-element array). Metadata only; no authority. */
export function authenticateConnector(authorizationHeaderValues: unknown): ConnectorIdentity {
  const { record } = verifyConnector(authorizationHeaderValues);
  return Object.freeze({ connectorId: record.id, projectId: record.projectId, runId: record.runId, operations: record.operations, expiresAt: record.expiresAt });
}
/**
 * Verifies the presented credential itself, then mints one frozen context for one operation invocation.
 * There is no constructor from rows, JSON, spreads, identities or SDK authInfo objects.
 */
export function mintConnectorContext(authorizationHeaderValues: unknown, operation: unknown): ConnectorContext {
  const { record, digest } = verifyConnector(authorizationHeaderValues);
  if (!isConnectorOperation(operation) || !record.operations.includes(operation)) throw new ScopedAccessError(403, "This connector credential does not permit that operation");
  const ctx: ConnectorContext = Object.freeze({ projectId: record.projectId, runId: record.runId, role: "connector", actorId: `connector:${record.id}`, operation,
    grant: Object.freeze({ kind: "connector", resourceId: record.id, revision: null }) });
  connectorAuthority.set(ctx, Object.freeze({ connectorId: record.id, digest, operation, projectId: record.projectId, runId: record.runId,
    fileKey: record.fileKey, parentKind: record.parentKind, parentRef: record.parentRef }));
  return ctx;
}
export type OperationAuthority = { kind: "designer"; session: Session } | { kind: "connector"; connector: ConnectorRecord };
/**
 * The guard of the four operation entrances, called again at every await, limiter and dispatch boundary.
 * Admits an eligible designer session, or a connector context minted for exactly this operation whose
 * credential, parent, run, file and allowlist are re-read and rechecked on every call.
 */
export function requireOperationContext(ctx: ServiceContext, operation: ConnectorOperation): OperationAuthority {
  const minted = connectorAuthority.get(ctx as object);
  if (minted) {
    if (minted.operation !== operation) throw new ScopedAccessError(403, "This connector context was minted for a different operation");
    requireConnectorEnabled();
    const record = liveConnector(minted.connectorId, minted.digest);
    if (!record || record.projectId !== minted.projectId || record.runId !== minted.runId || record.fileKey !== minted.fileKey ||
      record.parentKind !== minted.parentKind || record.parentRef !== minted.parentRef || !record.operations.includes(operation)) {
      throw new ScopedAccessError(401, "Connector authority expired, was revoked or changed");
    }
    return { kind: "connector", connector: record };
  }
  const session = sessionForContext(ctx as ActorContext);
  if (session.role !== "designer") throw new ScopedAccessError(403, "Requires designer role");
  return { kind: "designer", session };
}
