import { readFileSync, existsSync } from "node:fs";
import { isIP } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { basetenModel } from "./baseten.js";

// Backend runs from app/dist/backend/. Project root (paypal-hackathon/) is 3 levels up.
const here = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(here, "..", "..", "..");
export const APP_ROOT = resolve(here, "..", "..");
export const DATA_DIR = resolve(process.env.SCOPE_SETTLE_DATA_DIR || resolve(APP_ROOT, "data"));

function loadEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 1) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

const fileEnv = loadEnvFile(resolve(PROJECT_ROOT, ".env.local"));

function get(key: string): string {
  return process.env[key] ?? fileEnv[key] ?? "";
}
/** Comma-separated list; every entry must pass `valid` exactly or startup fails closed. */
function list(key: string, valid: (value: string) => boolean, message: string): string[] {
  const values = get(key).split(",").map(value => value.trim()).filter(Boolean);
  if (values.some(value => !valid(value))) throw new Error(message);
  return [...new Set(values)];
}
const exactOrigin = (value: string) => { try { return /^https?:$/.test(new URL(value).protocol) && new URL(value).origin === value; } catch { return false; } };

export const config = {
  port: Number(get("PORT") || 8787),
  host: get("HOST") || "127.0.0.1",
  publicUrl: (get("PUBLIC_BASE_URL") || get("RENDER_EXTERNAL_URL") || "http://localhost:8787").replace(/\/$/, ""),
  aiProvider: get("AI_PROVIDER") || basetenModel.provider,
  aiApiKey: get("BASETEN_API_KEY"),
  aiModel: get("AI_MODEL") || basetenModel.id,
  aiReasoningEffort: get("AI_REASONING_EFFORT") || basetenModel.reasoningEffort,
  aiBudgetUsd: Math.min(Number(get("AI_BUDGET_USD") || 25), 25),
  paypalWebhookId: get("PAYPAL_WEBHOOK_ID"),
  paypalEnv: get("PAYPAL_ENVIRONMENT") || "sandbox",
  paypalClientId: get("PAYPAL_CLIENT_ID"),
  paypalClientSecret: get("PAYPAL_CLIENT_SECRET"),
  paypalMerchantEmail: get("PAYPAL_SANDBOX_MERCHANT_EMAIL"),
  paypalBuyerEmail: get("PAYPAL_SANDBOX_BUYER_EMAIL"),
  figmaToken: get("FIGMA_PERSONAL_ACCESS_TOKEN"),
  figmaCommentPostingEnabled:get('FIGMA_COMMENT_POSTING_ENABLED')==='true',
  figmaFileKey: get("FIGMA_FILE_KEY"),
  figmaWebhookEnabled: get('FIGMA_WEBHOOK_ENABLED')==='true',
  figmaWebhookAccessVerified: get('FIGMA_WEBHOOK_ACCESS_VERIFIED')==='true',
  figmaWebhookId:get('FIGMA_WEBHOOK_ID'),
  figmaWebhookPasscode:get('FIGMA_WEBHOOK_PASSCODE'),
  figmaWebhookContextType:get('FIGMA_WEBHOOK_CONTEXT_TYPE')||'file',
  figmaWebhookContextId:get('FIGMA_WEBHOOK_CONTEXT_ID'),
  // Custom Figma agent connector. Disabled unless explicitly enabled: issuance refuses and credentials fail closed.
  mcpConnectorEnabled:get('MCP_CONNECTOR_ENABLED')==='true',
  // Exact browser origins (scheme://host[:port]) allowed to call /mcp. Empty by default: a supplied Origin is refused,
  // an absent Origin is accepted for an authenticated non-browser caller.
  mcpAllowedOrigins:list('MCP_ALLOWED_ORIGINS',exactOrigin,'MCP_ALLOWED_ORIGINS must list exact origins such as https://www.figma.com'),
  // Peer IP addresses whose X-Forwarded-Host/Proto are trusted for /mcp. Empty by default: forwarded headers are ignored.
  mcpTrustedProxies:list('MCP_TRUSTED_PROXIES',value=>isIP(value)!==0,'MCP_TRUSTED_PROXIES must list IP addresses'),
};

if (config.paypalEnv !== "sandbox") throw new Error("This hackathon build supports PayPal sandbox only");
if (config.aiProvider !== basetenModel.provider || config.aiModel !== basetenModel.id || config.aiReasoningEffort !== basetenModel.reasoningEffort) {
  throw new Error("This build requires Baseten DeepSeek-V4.1-Flash-1017-Fast with max reasoning; evaluate and price any replacement before enabling it");
}
if (!Number.isFinite(config.aiBudgetUsd) || config.aiBudgetUsd <= 0) throw new Error("Invalid AI budget");
export const paypalBase = "https://api-m.sandbox.paypal.com";

export function assertConfigured(): string[] {
  const missing: string[] = [];
  if (!config.paypalClientId) missing.push("PAYPAL_CLIENT_ID");
  if (!config.paypalClientSecret) missing.push("PAYPAL_CLIENT_SECRET");
  if (!config.figmaToken) missing.push("FIGMA_PERSONAL_ACCESS_TOKEN");
  if (!config.figmaFileKey) missing.push("FIGMA_FILE_KEY");
  return missing;
}
