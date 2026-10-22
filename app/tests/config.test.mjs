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
