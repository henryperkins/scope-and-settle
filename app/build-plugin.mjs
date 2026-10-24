// Bundles the Figma plugin main code and copies manifest + UI into plugin/dist/.
import * as esbuild from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = dirname(fileURLToPath(import.meta.url));
const pluginDir = resolve(appRoot, "plugin");
const distDir = resolve(pluginDir, "dist");
mkdirSync(distDir, { recursive: true });
writeFileSync(resolve(appRoot, 'JUDGING.md'), readFileSync(resolve(appRoot, '../JUDGING.md')));

await esbuild.build({
  entryPoints: [resolve(pluginDir, "code.ts")],
  bundle: true,
  platform: "browser",
  target: "es2017",
  outfile: resolve(distDir, "code.js"),
});

const backend = process.env.PUBLIC_BASE_URL || 'http://localhost:8787';
const bundled = await esbuild.build({ entryPoints: [resolve(appRoot, 'web/designer.js')], bundle: true, format: 'iife', write: false, target: 'es2020' });
// The plugin UI has no same-origin asset route, so the self-hosted font travels inside the stylesheet.
const font = 'data:font/woff2;base64,' + readFileSync(resolve(appRoot, 'web/fonts/hanken-grotesk-latin.woff2')).toString('base64');
const css = readFileSync(resolve(appRoot, 'web/style.css'), 'utf8').replaceAll('/assets/fonts/hanken-grotesk-latin.woff2', font);
const ui = readFileSync(resolve(appRoot, 'web/designer.html'), 'utf8')
  .replace('<link rel="stylesheet" href="/assets/style.css">', '<style>' + css + '</style>')
  .replace('<script type="module" src="/assets/designer.js"></script>', '<script>window.SCOPE_SETTLE_API=' + JSON.stringify(backend) + ';' + bundled.outputFiles[0].text.replaceAll('</script', '<\\/script') + '</script>');
writeFileSync(resolve(distDir, 'ui.html'), ui);
const manifest = JSON.parse(readFileSync(resolve(pluginDir, 'manifest.json'), 'utf8'));
manifest.main = 'code.js'; manifest.ui = 'ui.html'; manifest.documentAccess = 'dynamic-page';
manifest.networkAccess.allowedDomains = [new URL(backend).origin];
writeFileSync(resolve(distDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log("Plugin built → plugin/dist/ (import manifest.json from there in Figma)");
