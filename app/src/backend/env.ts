import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

export const config = {
  port: Number(get("PORT") || 8787),
  host: get("HOST") || "127.0.0.1",
  publicUrl: (get("PUBLIC_BASE_URL") || get("RENDER_EXTERNAL_URL") || "http://localhost:8787").replace(/\/$/, ""),
  aiApiKey: get("AI_API_KEY") || get("OPENAI_API_KEY"),
  aiModel: get("AI_MODEL") || "gpt-6-luna",
  aiBudgetUsd: Math.min(Number(get("AI_BUDGET_USD") || 25), 25),
  paypalWebhookId: get("PAYPAL_WEBHOOK_ID"),
  paypalEnv: get("PAYPAL_ENVIRONMENT") || "sandbox",
  paypalClientId: get("PAYPAL_CLIENT_ID"),
  paypalClientSecret: get("PAYPAL_CLIENT_SECRET"),
  paypalMerchantEmail: get("PAYPAL_SANDBOX_MERCHANT_EMAIL"),
  paypalBuyerEmail: get("PAYPAL_SANDBOX_BUYER_EMAIL"),
  figmaToken: get("FIGMA_PERSONAL_ACCESS_TOKEN"),
  figmaFileKey: get("FIGMA_FILE_KEY"),
};

if (config.paypalEnv !== "sandbox") throw new Error("This hackathon build supports PayPal sandbox only");
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
