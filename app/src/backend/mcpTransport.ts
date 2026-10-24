import {randomUUID} from 'node:crypto';
import {isIP} from 'node:net';
import {StringDecoder} from 'node:string_decoder';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {createMcpHandler,type McpServer,type McpHttpHandler} from '@modelcontextprotocol/server';
import {toNodeHandler} from '@modelcontextprotocol/node';
import {config} from './env.js';
import {ScopedAccessError} from './context.js';
import {authenticateConnector,type ConnectorIdentity} from './mcpAuth.js';
import {report} from './mcpErrors.js';
const MCP_PATH='/mcp';

export const PRODUCTION_MCP_LIMITS=Object.freeze({maxBodyBytes:64*1024,maxHeaderLines:64,maxConcurrent:8,bodyTimeoutMs:10_000,exchangeTimeoutMs:150_000,drainGraceMs:2_000,maxOutputBytes:60_000});
export type McpLimits=typeof PRODUCTION_MCP_LIMITS;
export interface McpLifecycle {readonly limits:McpLimits;status():{accepting:boolean;exchanges:number;domain:number};track(work:Promise<unknown>):void}
interface TransportOptions {limits?:Partial<McpLimits>;createServer:(identity:ConnectorIdentity,authorization:readonly string[]|undefined,lifecycle:McpLifecycle)=>McpServer}
/** Trusted constructor only; HTTP and job JSON never configure limits or the server factory. */
export function createMcpTransport(options:TransportOptions){
 if(options.limits&&Object.keys(options.limits).some(key=>!Object.hasOwn(PRODUCTION_MCP_LIMITS,key)))throw new Error('Unknown MCP limit');
 const limits=Object.freeze({...PRODUCTION_MCP_LIMITS,...options.limits});
 if(Object.values(limits).some(value=>!Number.isSafeInteger(value)||value<1))throw new Error('Invalid MCP limit');
// ---- Lifecycle: admitted exchanges, streams and domain promises. ----
// `maxConcurrent` bounds both open exchanges and running tool executions. A JSON-RPC batch runs several tools in
// one exchange, and a disconnect closes the exchange while its domain work keeps running: both still count.
interface Exchange {handler:McpHttpHandler;res:ServerResponse;done:Promise<void>}
let accepting=true,draining:Promise<void>|null=null;
const exchanges=new Set<Exchange>(),domainWork=new Set<Promise<void>>();
function status(){return {accepting,exchanges:exchanges.size,domain:domainWork.size};}
function track(work:Promise<unknown>){const settled=work.then(()=>{},()=>{});domainWork.add(settled);void settled.then(()=>{domainWork.delete(settled);});}
/**
 * Server shutdown: stop admissions, abort modern exchanges (their domain work keeps running), wait for every
 * admitted domain promise so paid results are durably recorded, let delivered responses flush, then end the
 * remaining streams so the HTTP server can close. Only after this resolves may SQLite close.
 */
function drain():Promise<void>{
 return draining??=(async()=>{
  accepting=false;
  await Promise.allSettled([...exchanges].map(exchange=>exchange.handler.close()));
  while(domainWork.size)await Promise.allSettled([...domainWork]);
  let grace:NodeJS.Timeout|undefined;
  await Promise.race([Promise.allSettled([...exchanges].map(exchange=>exchange.done)),new Promise<void>(resolve=>{grace=setTimeout(resolve,limits.drainGraceMs);})]);
  clearTimeout(grace);
  for(const exchange of exchanges)exchange.res.destroy();
 })();
}


const lifecycle:McpLifecycle=Object.freeze({limits,status,track});
// ---- Transport guards before the SDK. ----
const BASE_HEADERS={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const SINGLE_VALUED=['host','origin','content-type','content-length','mcp-protocol-version','mcp-method','mcp-name','mcp-session-id','last-event-id'];
const STRIPPED=new Set(['authorization','proxy-authorization','cookie','forwarded','x-real-ip']);
const AUTHORITY=/^(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*|\[[0-9a-f:.]+\])(?::\d{1,5})?$/i;
const ALLOWED_REQUEST_HEADERS='Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Method, Mcp-Name, Last-Event-ID';
const values=(req:IncomingMessage,name:string)=>req.headersDistinct[name]??[];
/** Pre-header sanitized refusal, logged with its code and correlation ID; never a second response once headers were sent. */
type RequestId=string|number;
function protocolError(id:RequestId|null,code:string,numeric=-32000,correlationId=randomUUID()) {
 return {jsonrpc:'2.0',id,error:{code:numeric,message:code,data:{code,correlationId}}};
}
function refuse(res:ServerResponse,status:number,code:string,headers:Record<string,string>={},afterEnd?:()=>void,ids:RequestId[]=[]){
 if(res.headersSent||res.writableEnded||res.destroyed){if(!res.writableEnded&&!res.destroyed)res.end(afterEnd);return;}
 const correlationId=randomUUID();
 report('refused',{status,code,correlationId});
 const messages=(ids.length?ids:[null]).map(id=>protocolError(id,code,-32000,correlationId));
 const body=JSON.stringify(messages.length===1?messages[0]:messages);
 res.writeHead(status,{...BASE_HEADERS,'Content-Type':'application/json','Content-Length':String(Buffer.byteLength(body)),Connection:'close',...headers});
 res.end(body,afterEnd);
}
const peer=(req:IncomingMessage)=>{const address=req.socket.remoteAddress??'';return address.startsWith('::ffff:')&&isIP(address.slice(7))===4?address.slice(7):address;};
/**
 * Exact authority: the single Host (or, only from a configured trusted proxy, exactly one X-Forwarded-Host and
 * X-Forwarded-Proto) must form the configured public origin. Forwarded headers from any other peer are ignored.
 */
function authority(req:IncomingMessage):'ok'|'malformed'|'denied'{
 const hosts=values(req,'host');
 if(hosts.length!==1)return 'malformed';
 let protocol=(req.socket as {encrypted?:boolean}).encrypted?'https':'http',host=hosts[0];
 if(config.mcpTrustedProxies.includes(peer(req))){
  const forwardedHost=values(req,'x-forwarded-host'),forwardedProto=values(req,'x-forwarded-proto');
  if(forwardedHost.length>1||forwardedProto.length>1)return 'malformed';
  if(forwardedHost.length!==1||forwardedProto.length!==1)return 'denied';
  host=forwardedHost[0];protocol=forwardedProto[0].toLowerCase();
 }
 if((protocol!=='http'&&protocol!=='https')||!AUTHORITY.test(host))return 'denied';
 try{return new URL(`${protocol}://${host}`).origin===new URL(config.publicUrl).origin?'ok':'denied';}catch{return 'denied';}
}
/** Absent Origin: an authenticated non-browser caller. Supplied: exactly one value on the explicit allowlist. */
function origin(req:IncomingMessage):{ok:boolean;value?:string}{
 const supplied=values(req,'origin');
 if(!supplied.length)return {ok:true};
 return supplied.length===1&&config.mcpAllowedOrigins.includes(supplied[0])?{ok:true,value:supplied[0]}:{ok:false};
}
/** The SDK's view of the response: one owner, no writes after a sanitized refusal or a completed response. */
function guard(res:ServerResponse,pending:Set<RequestId>){
 let owned=true,buffer='',sse=false;
 const decoder=new StringDecoder('utf8');
 const bufferLimit=limits.maxOutputBytes*limits.maxConcurrent+limits.maxBodyBytes*8;
 function sanitize(packet:any):any {
  if(Array.isArray(packet))return packet.map(sanitize);
  if(!packet||typeof packet!=='object')throw new Error('Invalid SDK response');
  if(typeof packet.id==='string'||typeof packet.id==='number')pending.delete(packet.id);
  if(!packet.error)return packet;
  const numeric=Number.isSafeInteger(packet.error.code)?packet.error.code:-32603;
  const code=numeric===-32601?'method_not_found':numeric===-32602?'invalid_arguments':numeric===-32700?'parse_error':numeric===-32600?'invalid_request':'protocol_error';
  const correlationId=randomUUID();report('protocol_error',{code,correlationId});
  return protocolError(typeof packet.id==='string'||typeof packet.id==='number'?packet.id:null,code,numeric,correlationId);
 }
 function packetText(value:string){return JSON.stringify(sanitize(JSON.parse(value)));}
 function write(chunk:string|Uint8Array){
  if(!owned||res.writableEnded||res.destroyed)return true;
  buffer+=typeof chunk==='string'?chunk:decoder.write(Buffer.from(chunk));
  if(Buffer.byteLength(buffer)>bufferLimit){fail(502,'result_too_large');return true;}
  if(sse){
   let end:number;
   while((end=buffer.indexOf('\n\n'))>=0){
    const event=buffer.slice(0,end),rest=buffer.slice(end+2);buffer=rest;
    const data=event.split(/\r?\n/).filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
    try {
     if(!data.trim())res.write(event+'\n\n'); // SDK priming/retry event, without a JSON-RPC message.
     else res.write(event.split(/\r?\n/).filter(line=>!line.startsWith('data:')).join('\n')+'\ndata: '+packetText(data)+'\n\n');
    } catch {fail(502,'internal_error');break;}
   }
  }
  return true;
 }
 function fail(status:number,code:string,afterEnd?:()=>void){
  if(!owned||res.writableEnded||res.destroyed)return;
  owned=false;buffer='';
  const ids=[...pending];
  if(!res.headersSent){refuse(res,status,code,{},afterEnd,ids);return;}
  const messages=(ids.length?ids:[null]).map(id=>protocolError(id,code));
  report('stream_ended',{code});
  res.end(sse?messages.map(message=>'event: message\ndata: '+JSON.stringify(message)+'\n\n').join(''):JSON.stringify(messages.length===1?messages[0]:messages),afterEnd);
 }
 const face={
  writeHead(status:number,headers?:Record<string,string>){
   if(owned&&!res.headersSent){
    const safe=Object.fromEntries(Object.entries(headers??{}).filter(([name])=>name.toLowerCase()!=='content-length'));
    sse=String(safe['content-type']??safe['Content-Type']??'').includes('text/event-stream');
    res.removeHeader('content-length');res.writeHead(status,{...safe,...(accepting?{}:{connection:'close'})});
   }
   return face;
  },
  write,
  end(chunk?:string|Uint8Array){
   if(!owned||res.writableEnded||res.destroyed)return face;
   if(chunk!==undefined)write(chunk);
   if(!owned)return face;
   buffer+=decoder.end();
   try {
    if(!sse&&buffer.trim())res.write(packetText(buffer));
    else if(sse&&buffer.trim()){fail(502,'internal_error');return face;}
   } catch {fail(502,'internal_error');return face;}
   owned=false;buffer='';res.end();return face;
  },
  on(event:string,listener:(...args:unknown[])=>void){res.on(event,listener);return face;},
  get destroyed(){return res.destroyed;},
 };
 return {face,fail};
}

/** Entry point for the exact `/mcp` path, dispatched before the application's CORS, OPTIONS, body and error handling. */
async function handle(req:IncomingMessage,res:ServerResponse):Promise<void>{
 try{
  if(!config.mcpConnectorEnabled)return refuse(res,404,'not_found');
  if(!accepting)return refuse(res,503,'shutting_down');
  if(req.rawHeaders.length/2>limits.maxHeaderLines)return refuse(res,431,'headers_too_large');
  if(SINGLE_VALUED.some(name=>values(req,name).length>1))return refuse(res,400,'bad_request');
  const checked=authority(req);
  if(checked!=='ok')return refuse(res,checked==='malformed'?400:403,checked==='malformed'?'bad_request':'host_not_allowed');
  const allowed=origin(req);
  if(!allowed.ok)return refuse(res,403,'origin_not_allowed');
  const cors:Record<string,string>=allowed.value?{'Access-Control-Allow-Origin':allowed.value,Vary:'Origin'}:{};
  if(req.method==='OPTIONS'){
   // Only an explicitly allowlisted browser origin gets a preflight answer.
   if(!allowed.value)return refuse(res,403,'origin_not_allowed');
   res.writeHead(204,{...BASE_HEADERS,...cors,'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':ALLOWED_REQUEST_HEADERS,'Access-Control-Max-Age':'600','Content-Length':'0'});
   return void res.end();
  }
  if(req.method!=='POST')return refuse(res,405,'method_not_allowed',{Allow:'POST',...cors});
  if(Number(values(req,'content-length')[0]??0)>limits.maxBodyBytes)return refuse(res,413,'body_too_large',cors);
  // Running tool executions count too, including those whose client already disconnected.
  if(exchanges.size>=limits.maxConcurrent||domainWork.size>=limits.maxConcurrent)return refuse(res,503,'busy',{'Retry-After':'1',...cors});
  let identity:ConnectorIdentity;
  const authorization=req.headersDistinct.authorization;
  try{identity=authenticateConnector(authorization);}
  catch(error){
   const forbidden=error instanceof ScopedAccessError&&error.status===403;
   return refuse(res,forbidden?403:401,forbidden?'forbidden':'unauthorized',{...(forbidden?{}:{'WWW-Authenticate':'Bearer'}),...cors});
  }
  await serve(req,res,identity,authorization,cors);
 }catch(error){
  report('transport_failure',{},error);
  refuse(res,500,'internal_error');
 }
}

async function serve(req:IncomingMessage,res:ServerResponse,identity:ConnectorIdentity,authorization:readonly string[]|undefined,cors:Record<string,string>){
 for(const [name,value] of Object.entries({...BASE_HEADERS,...cors}))res.setHeader(name,value);
 const handler=createMcpHandler(()=>options.createServer(identity,authorization,lifecycle),{legacy:'stateless',maxRequestBodySize:limits.maxBodyBytes,onerror:error=>report('sdk_error',{},error)});
 const exchange:Exchange={handler,res,done:new Promise<void>(resolve=>res.once('close',()=>resolve()))};
 exchanges.add(exchange);
 const pending=new Set<RequestId>(),response=guard(res,pending);
 // Body and exchange deadlines answer before headers when they can; admitted domain work is never cancelled.
 // The 408 is flushed first; the unfinished request is destroyed only once that response has ended.
 const bodyTimer=setTimeout(()=>{if(!req.complete)response.fail(408,'request_timeout',()=>req.destroy());},limits.bodyTimeoutMs);
 const deadline=setTimeout(()=>response.fail(504,'timeout'),limits.exchangeTimeoutMs);
 res.once('close',()=>{clearTimeout(bodyTimer);clearTimeout(deadline);exchanges.delete(exchange);void handler.close().catch(()=>{});});
 // The SDK sees the raw body stream (no pre-parsed body) and no credential, cookie or forwarding headers.
 const headers:Record<string,string|string[]|undefined>={};
 for(const [name,value] of Object.entries(req.headers))if(!STRIPPED.has(name)&&!name.startsWith('x-forwarded-'))headers[name]=value;
 const request={method:'POST',url:MCP_PATH,headers,async *[Symbol.asyncIterator](){
  const chunks:Buffer[]=[];let size=0;
  for await(const chunk of req){const bytes=Buffer.from(chunk);size+=bytes.length;if(size<=limits.maxBodyBytes)chunks.push(bytes);yield bytes;}
  if(size<=limits.maxBodyBytes)try {
   const parsed=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   for(const message of Array.isArray(parsed)?parsed:[parsed])if(message?.jsonrpc==='2.0'&&typeof message.method==='string'&&(typeof message.id==='string'||typeof message.id==='number'))pending.add(message.id);
  } catch {} // The pinned SDK validates syntax; raw parser diagnostics never leave this layer.
 }};
 await toNodeHandler(handler,{maxRequestBodySize:limits.maxBodyBytes,onerror:error=>report('bridge_error',{},error)})(request,response.face);
}

return Object.freeze({handle,drain,status,limits});
}
