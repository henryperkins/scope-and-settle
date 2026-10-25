import {canonicalDraftFactory} from './helpers.mjs';
// Trusted setup only; copied into the smoke runner's disposable volume, never a public route.
export async function seedContainerSmoke(app) {
 const sessions=await app.load('sessions');
 const session=sessions.createSession({projectId:'demo',role:'designer',runId:'container-smoke-fixture'});
 const otherSession=sessions.createSession({projectId:'demo',role:'designer',runId:'container-smoke-other-run'});
 const {contextFromSessionToken}=await app.load('context');
 const make=await canonicalDraftFactory(app);
 const input=make(contextFromSessionToken(session.token),{requestedDeliverable:'Mobile checkout for the container persistence fixture'});
 return {session,otherSession,input};
}
