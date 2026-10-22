import { config } from '../dist/backend/env.js';
const response = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer ' + config.aiApiKey } });
const body = await response.json().catch(() => ({}));
const error = body.error;
console.log(JSON.stringify({ status: response.status, errorCode: error?.code ?? null, errorType: error?.type ?? null,
  errorMessage: error?.message ? String(error.message).replaceAll(config.aiApiKey, '[redacted]').replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]') : null,
  availableModels: (body.data ?? []).map(x => x.id).sort() }));
