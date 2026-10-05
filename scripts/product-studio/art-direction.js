import {ModelFormatError,nonEmptyText} from './model-format.js';
import {bannerRatio} from './banner.js';
import {sceneRatio} from './media.js';
import {artworkShape} from './artwork-geometry.js';
import {BAKED_FRAMES,sceneFrameGuidance} from './frame-finish.js';
import {styleDirectionClause} from './scene-styles.js';
export const ART_DIRECTION_VERSION = 'artwork-led-v1';
export const DIRECTION_FIELDS = ['direction','paletteAndMaterials','composition','referenceUse','lightingAndRenderer','frameAndScale','avoid'];
export const AESTHETIC_CHECKS = ['artworkRoomFit','visualHierarchy','visualWeight','breathingRoom'];
export const usesArtDirection = job => job.artDirectionProfile === ART_DIRECTION_VERSION;

export function directionPrompt(job) {
  const styleClause=styleDirectionClause(job);
  const userStyling=styleClause?`${styleClause} Additional free-text notes from the user: ${job.sceneBrief||'none'}.`:`User styling preferences: ${job.sceneBrief || 'Choose from the artwork itself'}.`;
  const renderer = job.sceneWorkflow === 'composed-unframed-v1'
    ? 'Generate a finished room containing the exact artwork as an unframed stretched canvas. Solve coherent room, canvas and wall lighting with narrow contact shadows in the generated image. The theme adds only the external frame later using detected artwork edges. Keep all four edges and shadow clear, with room for frame rails; no baked decorative frame. Room views are not physically to scale.'
    : 'Generate a finished room containing the exact artwork already mounted in a slim float frame. Solve coherent room, frame, canvas and wall lighting with narrow contact shadows in the generated image; that frame belongs to this image and no second frame is drawn later. Keep the rail slim and even on all four sides, the four outer edges visible, and the wall band around the frame clear of furniture, plants and tabletop objects. Room views are not physically to scale.';
  return `Design three distinct room directions around the accepted artwork in image 1, not around a competitor room.
${artworkShape(job)} Plan the wall and furniture around this fixed rectangle. Small, medium and large mean uniform scaling of the same artwork; the mobile and desktop aspect ratios describe the surrounding room photograph only. In composition and frameAndScale, describe how the room accommodates the unchanged canvas.
${job.sceneWorkflow===BAKED_FRAMES?sceneFrameGuidance(job,{planning:true}):''}
${userStyling} Return JSON {artworkReading:string,scenes:[{slot:"scene-1"|"scene-2"|"scene-3",${DIRECTION_FIELDS.map(k=>k+':string').join(',')}}]}. Describe visible subject, mood, palette, marks and visual density with observations distinguished from inference. Each field needs a concrete artwork-specific reason. referenceUse describes photographic/material cues to seek and furnishings to reject; actual references will be chosen afterwards. Three distinct styling directions at three different artwork scales: the large-format statement setting in scene-3, a medium setting in scene-1 (canvas over a low console or sideboard) and a small, intimate setting in scene-2 (a nook, hallway or corner), each with a room and furniture scale that makes the canvas size legible, with an independently recomposed ${bannerRatio(job)} desktop companion and ${sceneRatio(job)} mobile view.${job.sceneWorkflow==='baked-frames-v1'?' Scene-2 may be shot from a gentle oblique camera angle while scene-1 and scene-3 stay nearly frontal.':''} Full-screen is the room, not maximum painting size. Avoid copying a fixed room template or assigning every blue work the same pale room. ${renderer} If scale or lighting needs unsupported rendering, describe the limitation explicitly.`;
}

export function validateDirection(value) {
  if(value&&typeof value==='object'&&value.artworkReading===undefined){const nested=value.answer;if(nested&&typeof nested==='object'&&!Array.isArray(nested))value=nested;}
  if (typeof value?.artworkReading !== 'string' || !value.artworkReading.trim() || !Array.isArray(value.scenes) || value.scenes.length !== 3) throw new ModelFormatError('场景设计缺少作品解读或三个搭配方向');
  for (const slot of ['scene-1','scene-2','scene-3']) {
    const scenes=value.scenes.filter(s=>s?.slot===slot);
    if(scenes.length!==1) throw new ModelFormatError(`场景设计缺少唯一的 ${slot}`);
    for(const key of DIRECTION_FIELDS) if(typeof scenes[0][key]!=='string'||!scenes[0][key].trim()) throw new ModelFormatError(`${slot} 缺少设计依据 ${key}`);
  }
  if(new Set(value.scenes.map(s=>s.direction.trim())).size!==3) throw new ModelFormatError('三个场景需要不同的搭配方向');
  return value;
}

export function sceneDirection(job,slot) {
  return job.artDirection?.scenes.find(s=>s.slot===(slot==='scene-desktop'?'scene-3':slot));
}

export function validateSelection(result,candidates) {
  if(result?.scenes===undefined&&result?.answer&&typeof result.answer==='object')result=result.answer;
  if(!Array.isArray(result?.scenes)||result.scenes.length!==3) throw new ModelFormatError('参考终选需要三个场景');
  const chosen=['scene-1','scene-2','scene-3'].map(slot=>{
    const rows=result.scenes.filter(s=>s?.slot===slot),row=rows[0];
    if(rows.length!==1)throw new ModelFormatError('参考终选缺少唯一的 '+slot+'（slot 缺失或重复）');
    const index=typeof row.index==='string'&&/^\d+$/.test(row.index.trim())?Number(row.index.trim()):row.index;
    const missing=[['index',Number.isInteger(index)&&index>=1&&index<=candidates.length],['reason',nonEmptyText(row.reason)],['keep',nonEmptyText(row.keep)],['discard',nonEmptyText(row.discard)]].filter(([,ok])=>!ok).map(([k])=>k);if(rows.length!==1||missing.length)throw new ModelFormatError('参考终选缺少有效索引或取舍依据（'+slot+'：'+(rows.length!==1?'slot 缺失或重复':'缺少 '+missing.join('、'))+'）');
    return {...candidates[index-1],reason:row.reason,keep:row.keep,discard:row.discard};
  });
  if(new Set(chosen.map(c=>c.id)).size!==3||!chosen[2].bigsize||chosen[0].bigsize||chosen[1].bigsize) throw new ModelFormatError('需要三个不同参考，第三个为适配的大尺寸参考');
  return chosen;
}
