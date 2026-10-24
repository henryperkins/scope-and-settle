import {createServer} from 'node:net';
import {createHash} from 'node:crypto';
import {realpath} from 'node:fs/promises';
import {resolve, dirname, basename, join} from 'node:path';

/** An OS-owned admission lock, shared by the HTTP server and offline evaluator; no stale PID file. */
export async function acquireRuntimeOwner(databasePath: string): Promise<{release: () => Promise<void>}> {
  const absolute = resolve(databasePath);
  const canonical = await realpath(absolute).catch(async error => {
    if (error.code !== 'ENOENT') throw error;
    return join(await realpath(dirname(absolute)), basename(absolute));
  });
  const key = createHash('sha256').update(process.platform === 'win32' ? canonical.toLowerCase() : canonical).digest('hex');
  const owner = createServer(socket => socket.destroy());
  const address = process.platform === 'win32' ? {path: '\\\\.\\pipe\\scope-settle-' + key, exclusive: true} :
    process.platform === 'linux' ? {path: '\0scope-settle-' + key, exclusive: true} :
    {host: '127.0.0.1', port: 49000 + parseInt(key.slice(0, 4), 16) % 16000, exclusive: true};
  await new Promise<void>((resolveOwner, reject) => {
    owner.once('error', error => reject(new Error((error as NodeJS.ErrnoException).code === 'EADDRINUSE' ? 'Another runtime already owns this database; stop it before starting the server or evaluator' : 'Database runtime ownership could not be acquired', {cause: error})));
    owner.listen(address, () => {owner.unref(); resolveOwner();});
  });
  let closing: Promise<void> | undefined;
  return {release: () => closing ??= new Promise<void>((done, reject) => owner.close(error => error ? reject(error) : done()))};
}
