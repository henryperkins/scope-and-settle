import {revokeJudgeAccess} from '../dist/backend/judging.js';
const id=process.argv[2];
if(!/^[a-f0-9-]{36}$/.test(id||''))throw new Error('Provide the judging access ID, not its credential');
revokeJudgeAccess(id);console.log(JSON.stringify({id,revoked:true}));
