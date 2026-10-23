import {writeFileSync,chmodSync} from 'node:fs';
import {resolve} from 'node:path';
import {DATA_DIR,config} from '../dist/backend/env.js';
import {createJudgeAccess} from '../dist/backend/judging.js';
const issued=createJudgeAccess(process.argv[2]?{expiresAt:process.argv[2]}:{});
const path=resolve(DATA_DIR,`judge-access-${issued.id}.json`);
writeFileSync(path,JSON.stringify({...issued,entryUrl:`${config.publicUrl}/judge#access=${issued.credential}`},null,2)+'\n',{mode:0o600,flag:'wx'});
chmodSync(path,0o600);
console.log(JSON.stringify({id:issued.id,expiresAt:issued.expiresAt,privateAccessFile:path}));
