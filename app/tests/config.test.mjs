import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { isolatedApp } from './helpers.mjs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

test('a live PayPal environment is rejected before the application starts', async () => {
  const app = await isolatedApp();
  const envModule = pathToFileURL(join(app.app, 'dist/backend/env.js')).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(envModule)})`],
    { env: { ...process.env, PAYPAL_ENVIRONMENT: 'live' }, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /sandbox/i);
});

test('OpenAI and generic keys never substitute for a missing Baseten key', async () => {
  const app = await isolatedApp();
  const envModule = pathToFileURL(join(app.app, 'dist/backend/env.js')).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    `const {config} = await import(${JSON.stringify(envModule)}); if (config.aiApiKey !== '') process.exit(1);`],
    { env: { ...process.env, BASETEN_API_KEY: '', OPENAI_API_KEY: 'wrong-provider', AI_API_KEY: 'wrong-provider' }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('an unpriced model or reduced reasoning setting fails at startup', async () => {
  const app = await isolatedApp();
  const envModule = pathToFileURL(join(app.app, 'dist/backend/env.js')).href;
  for (const override of [{ AI_MODEL: 'another-model' }, { AI_REASONING_EFFORT: 'high' }, { AI_PROVIDER: 'openai' }]) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(envModule)})`],
      { env: { ...process.env, ...override }, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /requires Baseten/);
  }
});
