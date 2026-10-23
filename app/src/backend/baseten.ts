// Verified against Baseten's authenticated /v1/models catalog on 2026-10-23.
// Rates are micro-USD per million tokens. Cache discounts are deliberately ignored.
export const basetenModel = {
  provider: "baseten",
  id: "deepseek-ai/DeepSeek-V4.1-Flash-1017-Fast",
  reasoningEffort: "max",
  baseUrl: "https://inference.baseten.co/v1",
  contextTokens: 1_048_576,
  maxOutputTokens: 16_384, // Includes reasoning and the final JSON answer.
  inputRatePerMTok: 600_000,
  outputRatePerMTok: 2_400_000,
  timeoutMs: 90_000,
} as const;
