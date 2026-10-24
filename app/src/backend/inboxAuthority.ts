import {createHash} from 'node:crypto';
import {db,assertRunActive,currentRunId,getProjectForRun} from './db.js';
import {config} from './env.js';
import {ScopedAccessError} from './context.js';
import {activeGrant,credentialHash} from './judgeAccess.js';

export interface InboxSettings {version:number;intake:boolean;autoAssess:boolean;clientIds:string[];maxAssessments:number;startedAt:string;expiresAt:string;associationId:string;ownerGrantId:string|null;ownerSessionHash:string|null}
export const figmaAssociationId=createHash('sha256').update(JSON.stringify([config.figmaWebhookId,config.figmaWebhookContextType,config.figmaWebhookContextId,config.figmaFileKey,createHash('sha256').update(config.figmaWebhookPasscode).digest('hex')])).digest('hex');
export function webhookConfigured(){return config.figmaWebhookEnabled&&config.figmaWebhookAccessVerified&&!!config.figmaWebhookId&&!!config.figmaWebhookPasscode&&config.figmaWebhookPasscode.length<=100&&['file','project','team'].includes(config.figmaWebhookContextType)&&!!config.figmaWebhookContextId&&!!config.figmaFileKey&&(config.figmaWebhookContextType!=='file'||config.figmaWebhookContextId===config.figmaFileKey);}
export function inboxSettings(runId:string):InboxSettings|null{const row=db.prepare('SELECT settings_json FROM inbox_settings WHERE run_id=?').get(runId);return row?JSON.parse(String(row.settings_json)):null;}
export function settingsAuthority(runId:string,s:InboxSettings){
 try{assertKnownRun(runId);if(!Number.isFinite(Date.parse(s.expiresAt))||Date.parse(s.expiresAt)<=Date.now()||s.associationId!==figmaAssociationId||getProjectForRun(runId).figmaFileKey!==config.figmaFileKey)return false;
  if(s.ownerGrantId){const g=activeGrant(s.ownerGrantId);return !!g&&g.run_id===runId&&g.role==='designer';}
  return runId===currentRunId()&&!!s.ownerSessionHash&&(db.prepare("SELECT token FROM sessions WHERE run_id=? AND role='designer' AND revoked=0").all(runId) as {token:string}[]).some(r=>credentialHash(r.token)===s.ownerSessionHash);
 }catch{return false;}
}
export function assertKnownRun(runId:string){assertRunActive(runId);if(runId!==currentRunId()&&!db.prepare('SELECT run_id FROM judge_runs WHERE run_id=? AND closed_at IS NULL').get(runId))throw new ScopedAccessError(403,'Unknown inbox run');}
export function activeInboxSettings(){return (db.prepare('SELECT run_id,settings_json FROM inbox_settings').all() as {run_id:string;settings_json:string}[]).map(r=>({runId:r.run_id,...JSON.parse(r.settings_json) as InboxSettings})).filter(s=>s.intake&&settingsAuthority(s.runId,s));}
