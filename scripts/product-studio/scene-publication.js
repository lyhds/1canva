import {mediaSlots,mediaAlt} from './media.js';
import {COMPOSED_SCENE} from './composed-scene.js';

export const SCENE_FRAME_PROFILE='composed-frames-v1';
export function sceneLayouts(job){
 const layouts={};
 for(const slot of mediaSlots(job).filter(x=>x.startsWith('scene-'))){
  const a=job.assets[slot]?.at(-1),master=job.assets.master?.at(-1);
  if(!a?.accepted||a.sceneWorkflow!==COMPOSED_SCENE||a.masterHash!==master?.sha256)throw Error(slot+' 完整场景检查未通过');
  const mapping=a.frameMapping;
  if(!mapping?.verified||mapping.sourceHash!==a.sha256)throw Error(slot+' 画框边界尚未核准，保留原图');
  const b=mapping.bounds;
  if(!b||!['left','top','right','bottom'].every(k=>Number.isFinite(b[k]))||b.left<0||b.top<0||b.right>1||b.bottom>1||b.right<=b.left||b.bottom<=b.top)throw Error(slot+' 画框坐标无效');
  layouts[mediaAlt(slot,job)]={...b,sourceHash:a.sha256,profile:SCENE_FRAME_PROFILE};
 }
 return layouts;
}
export function sceneMetafields(job){
 return job.sceneWorkflow===COMPOSED_SCENE?[{namespace:'custom',key:'scene_layouts',type:'json',value:JSON.stringify(sceneLayouts(job))}]:[];
}
export function verifySceneMetafield(job,product){
 if(job.sceneWorkflow!==COMPOSED_SCENE)return;
 let actual;try{actual=JSON.parse(product.sceneLayouts?.value);}catch{throw Error('Shopify 场景画框坐标缺失');}
 const expected=sceneLayouts(job);
 for(const [key,value] of Object.entries(expected))for(const field of Object.keys(value))if(actual?.[key]?.[field]!==value[field])throw Error('Shopify 场景画框坐标回读不符');
}
