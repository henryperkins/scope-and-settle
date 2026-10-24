// Scope & Settle — document access stays in Figma's main thread.
import {handleStatusCardMessage} from './status-card';
import {handleDeliveryMessage} from './delivery';
figma.showUI(__html__, { width: 440, height: 720, title: "Scope & Settle" });
let selectionGeneration=0;
function selectionSummary(nodes: readonly SceneNode[] = figma.currentPage.selection) {
  return nodes.slice(0,20).map(n=>({id:n.id,name:n.name.slice(0,256),type:n.type,
    width:'width' in n?Math.round(n.width):null,height:'height' in n?Math.round(n.height):null,
    ...('characters' in n?{selectedText:n.characters.slice(0,2000)}:{}),
    ...('mainComponent' in n?{componentId:n.mainComponent?.id??null}:{}),
    layout:{x:Math.round(n.x),y:Math.round(n.y),...('layoutMode' in n?{layoutMode:n.layoutMode}:{})},
  }));
}
figma.ui.onmessage=async(msg:{type?:string;session?:unknown;expectedFileKey?:string;exportId?:string;requestKey?:string;generation?:number;[key:string]:unknown})=>{
  if(msg.type==='delivery-context'||msg.type==='generate-delivery'){await handleDeliveryMessage(msg,()=>selectionGeneration);return;}
  if(msg.type==='status-card-context'||msg.type==='upsert-status-card'){await handleStatusCardMessage(msg,()=>selectionGeneration);return;}
  if(msg.type==='save-session')await figma.clientStorage.setAsync('designer-session',msg.session);
  if(msg.type==='get-session')figma.ui.postMessage({type:'session',session:await figma.clientStorage.getAsync('designer-session')});
  if(msg.type==='export-frame'||msg.type==='capture-selection'){
    const generation=selectionGeneration,fileKey=figma.fileKey,pageId=figma.currentPage.id;
    try{
      if(!fileKey||fileKey!==msg.expectedFileKey)throw new Error('Open the designated judging file before attaching evidence.');
      if(!msg.exportId||!msg.requestKey||msg.generation!==generation)throw new Error('Selection changed; capture it again.');
      const nodes=figma.currentPage.selection;
      if(!nodes.length||nodes.length>20)throw new Error('Select between one and 20 nodes.');
      if(msg.type==='export-frame'&&(nodes.length!==1||nodes[0].type!=='FRAME'))throw new Error('Select one frame in Figma before attaching it.');
      const ids=nodes.map(n=>n.id).join(','),context=selectionSummary(nodes),capturedAt=new Date().toISOString();
      const bytes=msg.type==='export-frame'?await nodes[0].exportAsync({format:'PNG',constraint:{type:'WIDTH',value:1000}}):null;
      if(bytes&&bytes.length>1_500_000)throw new Error('This frame is too large. Select a smaller frame.');
      if(selectionGeneration!==generation||figma.fileKey!==fileKey||figma.currentPage.id!==pageId||figma.currentPage.selection.map(n=>n.id).join(',')!==ids)throw new Error('Selection changed while exporting; capture it again.');
      figma.ui.postMessage({type:'frame',exportId:msg.exportId,requestKey:msg.requestKey,generation,fileKey,capturedAt,context,...(bytes?{dataUrl:'data:image/png;base64,'+figma.base64Encode(bytes)}:{})});
    }catch(error){figma.ui.postMessage({type:'error',exportId:msg.exportId,requestKey:msg.requestKey,message:error instanceof Error?error.message:String(error)});}
  }
  if(msg.type==='get-context')figma.ui.postMessage({type:'context',fileKey:figma.fileKey,pageName:figma.currentPage.name,generation:selectionGeneration,selection:selectionSummary()});
  if(msg.type==='resize')figma.ui.resize(420,640);
};
figma.on('selectionchange',()=>{selectionGeneration++;figma.ui.postMessage({type:'selection',fileKey:figma.fileKey,generation:selectionGeneration,selection:selectionSummary()});});
figma.on('currentpagechange',()=>{selectionGeneration++;figma.ui.postMessage({type:'selection',fileKey:figma.fileKey,generation:selectionGeneration,selection:selectionSummary()});});
