import { config } from '../dist/backend/env.js';
import { basetenModel } from '../dist/backend/baseten.js';
if (!config.aiApiKey) throw new Error('BASETEN_API_KEY is not configured');
const response = await fetch(basetenModel.baseUrl + '/models', {
  headers: { Authorization: 'Bearer ' + config.aiApiKey }, redirect: 'error', signal: AbortSignal.timeout(15_000),
});
if (!response.ok) throw new Error('Baseten catalog returned HTTP ' + response.status);
const body = await response.json();
const model = (body.data ?? []).find(x => x.id === config.aiModel);
if (!model) throw new Error('Configured model is absent from the Baseten catalog');
const pricingMatches = Number(model.pricing?.prompt) * 1e12 === basetenModel.inputRatePerMTok
  && Number(model.pricing?.completion) * 1e12 === basetenModel.outputRatePerMTok;
console.log(JSON.stringify({ status: response.status, model: model.id, pricing: model.pricing,
  supportedFeatures: model.supported_features, inputModalities: model.input_modalities, pricingMatches, inferenceCalled: false }));
if (!pricingMatches) process.exitCode = 1;
