import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { zipSync, strToU8 } from 'fflate';

export async function packagePlugin({appRoot, sourceCommit, publicUrl}) {
  if (!/^[a-f0-9]{40}$/.test(sourceCommit || '')) throw new Error('A full reviewed source commit is required');
  const {version} = JSON.parse(await readFile(resolve(appRoot,'package.json'),'utf8'));
  const manifest = JSON.parse(await readFile(resolve(appRoot,'plugin/dist/manifest.json'),'utf8'));
  if (manifest.main !== 'code.js' || manifest.ui !== 'ui.html' || manifest.networkAccess?.allowedDomains?.length !== 1 ||
      manifest.networkAccess.allowedDomains[0] !== new URL(publicUrl).origin) throw new Error('Built plugin origin does not match this release');
  const entries = {};
  for (const name of ['manifest.json','code.js','ui.html']) entries[name]=new Uint8Array(await readFile(resolve(appRoot,'plugin/dist',name)));
  entries['JUDGING.md'] = new Uint8Array(await readFile(resolve(appRoot,'JUDGING.md')));
  const checksums = Object.fromEntries(Object.entries(entries).map(([name,data])=>[name,createHash('sha256').update(data).digest('hex')]));
  entries['SOURCE.json'] = strToU8(JSON.stringify({version,sourceCommit,publicUrl,checksums},null,2)+'\n');
  // Stable timestamps make packaging the same built files reproducible.
  const zip = zipSync(Object.fromEntries(Object.entries(entries).map(([name,data])=>[name,[data,{mtime:new Date('2026-01-01T00:00:00Z')}]])),{level:9});
  const sha256 = createHash('sha256').update(zip).digest('hex');
  const filename = `scope-and-settle-${version}-${sourceCommit.slice(0,12)}.zip`;
  const metadata = {version,sourceCommit,publicUrl,filename,sha256,checksums};
  await mkdir(resolve(appRoot,'downloads'),{recursive:true});
  await writeFile(resolve(appRoot,'downloads',filename),zip);
  await writeFile(resolve(appRoot,'downloads/plugin.zip'),zip);
  await writeFile(resolve(appRoot,'downloads/plugin.json'),JSON.stringify(metadata,null,2)+'\n');
  await writeFile(resolve(appRoot,'downloads/SHA256SUMS'),`${sha256}  ${filename}\n`);
  return metadata;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const appRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  let sourceCommit=process.env.SOURCE_COMMIT;
  if (!sourceCommit) {
    execFileSync('git',['diff','--exit-code','HEAD','--','app','deploy','Dockerfile','JUDGING.md'],{cwd:resolve(appRoot,'..'),stdio:'pipe'});
    if (execFileSync('git',['ls-files','--others','--exclude-standard','--','app','deploy','JUDGING.md'],{cwd:resolve(appRoot,'..'),encoding:'utf8'}).trim()) throw new Error('Commit the reviewed release inputs before packaging');
    sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:appRoot,encoding:'utf8'}).trim();
  }
  console.log(JSON.stringify(await packagePlugin({appRoot,sourceCommit,publicUrl:process.env.PUBLIC_BASE_URL || 'http://localhost:8787'})));
}
