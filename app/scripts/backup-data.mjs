import { DatabaseSync, backup } from 'node:sqlite';
import { mkdir, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DATA_DIR } from '../dist/backend/env.js';
const source = resolve(DATA_DIR, 'scope-and-settle.db');
try { await access(source); } catch { console.log('No existing database to back up.'); process.exit(0); }
const dir = resolve(DATA_DIR, 'backups');
await mkdir(dir, { recursive: true });
const destination = resolve(dir, 'scope-and-settle-' + new Date().toISOString().replaceAll(':', '-') + '.db');
const db = new DatabaseSync(source, { readOnly: true });
await backup(db, destination);
db.close();
console.log('Database backup saved: ' + destination);
