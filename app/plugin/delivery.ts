// Standard Plugin API draft scaffolds. Optional beta/MCP generation is deliberately unavailable.
type Context={epoch:string;fileKey:string;projectId:string;runId:string};
let context:Context|null=null;
const active=new Map<string,Promise<any>>();
const marker='scope-settle-delivery',complete='scope-settle-delivery-complete';
const text=(v:any,max=4000)=>typeof v==='string'&&v.trim()&&v.length<=max;
function validate(run:any,c:Context){
 if(!run||!text(run.id,200)||!text(run.operationId,200)||!run.brief||run.brief.projectId!==c.projectId||run.brief.runId!==c.runId||run.brief.operationId!==run.operationId||run.brief.milestoneId!==run.milestoneId||run.brief.allowedArea?.fileKey!==c.fileKey||run.brief.allowedArea.operationId!==run.operationId||run.brief.allowedArea.mode!=='dedicated_draft_page'||!text(run.brief.allowedArea.pageName,200)||!text(run.brief.title,200)||!Array.isArray(run.brief.deliverables)||!run.brief.deliverables.length||run.brief.deliverables.length>20||run.brief.deliverables.some((s:any)=>!text(s))||!Array.isArray(run.brief.acceptanceCriteria)||run.brief.acceptanceCriteria.some((s:any)=>!text(s))||JSON.stringify([run.brief.title,run.brief.deliverables,run.brief.acceptanceCriteria]).length>6000||run.financialReviewRequired||run.state!=='draft')throw new Error('Use the current paid approved work brief in its allowed file and draft area.');
}
export async function handleDeliveryMessage(msg:any,generation:()=>number){
 if(msg.type==='delivery-context'){
  const c=msg.context;context=c&&text(c.epoch,200)&&text(c.fileKey,128)&&text(c.projectId,200)&&text(c.runId,200)?{epoch:c.epoch,fileKey:c.fileKey,projectId:c.projectId,runId:c.runId}:null;return;
 }
 if(msg.type!=='generate-delivery')return;
 const c=context,invocationId=msg.invocationId;
 try{
  if(!c||msg.epoch!==c.epoch||!text(invocationId,200))throw new Error('Delivery context changed; explicitly start from the current approved work.');
  validate(msg.run,c);const capturedGeneration=generation();
  const guard=()=>{if(context!==c||figma.fileKey!==c.fileKey||generation()!==capturedGeneration)throw new Error('File, selection or delivery authority changed; refresh before generating.');};
  guard();const key=JSON.stringify([c.projectId,c.runId,msg.run.operationId]);let work=active.get(key);
  if(!work){work=generate(msg.run,key,guard).finally(()=>active.delete(key));active.set(key,work);}
  const output=await work;guard();figma.ui.postMessage({type:'delivery-result',invocationId,epoch:c.epoch,runId:msg.run.id,ok:true,output});
 }catch(error){figma.ui.postMessage({type:'delivery-result',invocationId,epoch:msg.epoch,runId:msg.run?.id,ok:false,message:error instanceof Error?error.message:String(error)});}
}
async function generate(run:any,key:string,guard:()=>void){
 await figma.loadFontAsync({family:'Inter',style:'Regular'});guard();
 const pages=figma.root.children.filter(p=>p.getPluginData(marker)===key);if(pages.length>1)throw new Error('Multiple matching draft pages require designer review.');
 if(run.latestSnapshot&&(!pages.length||pages[0].id!==run.latestSnapshot.pageId))throw new Error('The saved draft page is missing or changed; designer review is required before new generation.');
 let page=pages[0],area:FrameNode|undefined;
 if(page){await page.loadAsync();guard();const frames=page.children.filter(n=>n.getPluginData(marker)===key);if(frames.length!==1||frames[0].type!=='FRAME'||frames[0].getPluginData(complete)!=='true'||run.latestSnapshot&&frames[0].id!==run.latestSnapshot.areaId)throw new Error('Interrupted or moved draft area requires designer review; original content is preserved.');area=frames[0];}
 else {
  guard();page=figma.createPage();page.name=run.brief.allowedArea.pageName;page.setPluginData(marker,key);
  area=figma.createFrame();page.appendChild(area);area.name='DRAFT · '+run.brief.title;area.setPluginData(marker,key);area.resize(1000,800);area.x=0;area.y=0;area.fills=[{type:'SOLID',color:{r:.96,g:.98,b:.98}}];
  let y=32;
  const label=(parent:FrameNode,body:string,size:number,x:number,top:number,width:number)=>{const node=figma.createText();parent.appendChild(node);node.fontName={family:'Inter',style:'Regular'};node.fontSize=size;node.characters=body;node.resize(width,30);node.textAutoResize='HEIGHT';node.x=x;node.y=top;return node;};
  label(area,'DRAFT · '+run.brief.title,28,32,y,936);y+=64;
  label(area,'Approved revision '+run.revision+' · Designer review required · Client acceptance not recorded',16,32,y,936);y+=52;
  for(const deliverable of run.brief.deliverables){const draft=figma.createFrame();area.appendChild(draft);draft.name='Draft: '+deliverable;draft.resize(936,160);draft.x=32;draft.y=y;draft.fills=[{type:'SOLID',color:{r:1,g:1,b:1}}];label(draft,deliverable,20,24,20,888);label(draft,'Draft workspace for this approved deliverable. Refine the design and review it against the checklist before submission.',15,24,74,888);y+=184;}
  label(area,'Acceptance checklist\n'+run.brief.acceptanceCriteria.map((s:string)=>'□ '+s).join('\n'),16,32,y,936);y+=Math.max(120,run.brief.acceptanceCriteria.join('').length/65*24+70);
  if(y>3900)throw new Error('This draft exceeds the bounded review export; use a smaller agreed milestone.');area.resize(1000,y+32);area.setPluginData(complete,'true');
 }
 guard();if(area.parent!==page||area.getPluginData(marker)!==key)throw new Error('Draft area was moved; review it before exporting.');
 const collect=(node:SceneNode):SceneNode[]=>[node,...('children' in node?node.children.flatMap(collect):[])];
 const nodes=collect(area);if(nodes.length>120)throw new Error('Draft output exceeds the supported review size.');
 const png=await area.exportAsync({format:'PNG',constraint:{type:'WIDTH',value:1000}});guard();if(png.length>1_500_000)throw new Error('Draft review image exceeds 1.5 MB.');
 for(const node of nodes){const fresh=await figma.getNodeByIdAsync(node.id);guard();if(fresh!==node||node.removed)throw new Error('Draft changed during readback; export it again.');let parent:BaseNode|null=node;while(parent&&parent!==area)parent=parent.parent;if(parent!==area)throw new Error('Draft output moved outside its allowed area.');}
 if(area.parent!==page)throw new Error('Draft page changed during export.');
 return {operationId:run.operationId,fileKey:figma.fileKey,pageId:page.id,areaId:area.id,nodeIds:nodes.map(n=>n.id),nodes:nodes.map(n=>({id:n.id,parentId:n.parent!.id,type:n.type})),capturedAt:new Date().toISOString(),imageDataUrl:'data:image/png;base64,'+figma.base64Encode(png)};
}
