import {usesArtDirection,AESTHETIC_CHECKS,sceneDirection} from './art-direction.js';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import {ROOT,hash} from './store.js';

export function rendererFingerprint() {
  return hash(Buffer.concat(['snippets/artwork-scene.liquid','snippets/frame-preview.liquid','assets/theme.css','scripts/product-studio/render.js'].map(file=>fs.readFileSync(path.join(ROOT,file)))));
}

export const SCENE_CHECKS = ['perspective', 'lightDirection', 'contactShadow', 'castShadow', 'frameLighting', 'sharpness', 'clearance', 'artworkIntegrity'];
export const SCENE_RENDERER = 'Current live scene renderer: frontal artwork plane, uniform frame texture, one soft downward shadow (zero horizontal offset), no scene-specific relighting. Do not claim directional shadow or frame-lighting controls exist.';

export function planningPrompt(slot, ratio, job) {
  const region = slot === 'scene-desktop' ? (job?.bannerProfile==='clearance-v3'?'v3 mount x20–80%, y16–66%; furniture below72%':job?.bannerProfile === 'fullbleed-v2' ? 'v2 mount x20–80%, y8–86%; plan actual contain-fit artwork plus shadow using its ratio, furniture outside that footprint' : 'x28–72%, y20–70%') : slot === 'scene-3' ? (job?.mobileSceneProfile==='clearance-v2'?'x18–82%, y18–62%; header above18%, furniture below66%':'x10–90%, y0–78%') : 'x23–77%, y14–58%';
  return `Plan a room background from actual images. Image 1 is the room reference; image 2 is the accepted artwork, as the primary source of mood, subject, visual density, palette and proportions; do not redraw it. Return JSON {lightSource:string,shadowDirection:string,softness:string,wallPerspective:string,sharpness:string,adaptation:string,compatible:boolean}. All seven fields must be at the JSON root. compatible must be a JSON boolean true or false (not a description, number, or string). Do not wrap the result in answer or plan. Artwork-specific direction: ${JSON.stringify(sceneDirection(job||{},slot)||null)}. Each string must describe visible evidence or explicitly state uncertainty. ${SCENE_RENDERER} If the reference has strong lateral light, adaptation must soften/redistribute it into plausible broad frontal/overhead diffuse light while adapting furniture, palette and composition to the artwork; never preserve contradictory hard sun patches. compatible means such an adaptation is credible, not that the unedited reference already matches. The reference is not a template to copy. In adaptation, explicitly record the artwork reading, suitable materials and visual hierarchy, reference cues retained or discarded, and combinations to avoid. Reject unsuitable references. Target ${slot}, native ${ratio}; keep the complete mount ${region} and a soft-shadow margin clear of furniture. Preserve credible furniture scale and bright clean header space. No baked painting, frame, rectangular ghost or painted-in frame shadow. Do not infer real artwork dimensions.`;
}

export function validatePlan(plan) {
  // Unwrap only a single known envelope; never infer a missing safety decision.
  if(plan&&typeof plan==='object'&&plan.lightSource===undefined){const nested=plan.answer??plan.plan;if(nested&&typeof nested==='object'&&!Array.isArray(nested))plan=nested;}
  if(!plan||typeof plan!=='object'||Array.isArray(plan))throw Error('场景光线分析必须返回对象');
  plan={...plan};
  if(typeof plan.compatible==='string'&&/^(true|false)$/i.test(plan.compatible.trim()))plan.compatible=plan.compatible.trim().toLowerCase()==='true';
  for (const field of ['lightSource','shadowDirection','softness','wallPerspective','sharpness','adaptation']) {
    if (typeof plan?.[field] !== 'string' || !plan[field].trim()) throw Error(`场景光线分析缺少 ${field}`);
  }
  if (typeof plan.compatible !== 'boolean') throw Error('场景光线分析缺少兼容性判断');
  return plan;
}

export function validateSceneQA(qa,job={}) {
  const checks=usesArtDirection(job)?[...SCENE_CHECKS,...AESTHETIC_CHECKS]:SCENE_CHECKS;
  if (typeof qa?.pass !== 'boolean' || !Array.isArray(qa.issues) || !qa.issues.every(x=>typeof x==='string') || typeof qa.reason !== 'string') throw Error('场景验收结构不完整');
  if (!['none','background','renderer','uncertain'].includes(qa.failureSource)) throw Error('场景验收缺少问题归因');
  for (const key of checks) {
    const check = qa.checks?.[key];
    if (typeof check?.pass !== 'boolean' || typeof check.evidence !== 'string' || !check.evidence.trim()) throw Error(`场景验收缺少 ${key} 的实际观察依据`);
  }
  const failed = checks.filter(key => !qa.checks[key].pass);
  return {...qa, pass:qa.pass && failed.length === 0 && qa.issues.length === 0 && qa.failureSource === 'none', issues:[...qa.issues, ...failed.map(key => `${key}: ${qa.checks[key].evidence}`)]};
}

export function sceneQAPrompt(plan, frames, job={}) {
  const checks=usesArtDirection(job)?[...SCENE_CHECKS,...AESTHETIC_CHECKS]:SCENE_CHECKS;
  return `Review actual rendered scene evidence, not the prompt. Images: 1 full-size default-frame composite; 2 labeled contact sheet of ALL sale frames; 3 original master; 4 raw generated background (NOT assumed empty; explicitly inspect it for baked artwork). Room plan: ${JSON.stringify(plan)}. ${SCENE_RENDERER}
Return JSON {pass:boolean,issues:string[],reason:string,failureSource:"none"|"background"|"renderer"|"uncertain",checks:{${checks.map(k=>`${k}:{pass:boolean,evidence:string}`).join(',')}}}. Every check needs concrete visible evidence. Also independently assess artwork-room mood compatibility, visual hierarchy, furniture/frame weight and breathing room; describe these in reason and put any mismatch in issues with pass=false. Full-bleed coverage alone is not aesthetic success. A fixed overlay that is too large is a renderer/layout limitation; do not regenerate rooms endlessly. Frames reviewed: ${frames.join(', ')}. An unobservable check fails, never assume a small thumbnail proves fine detail. contactShadow: narrow attached edge, no floating halo; castShadow: plausible direction and soft falloff matching furniture/window light; frameLighting: credible depth and highlights, no flat sticker or photography paper mat added to canvas; sharpness: artwork/frame/wall coherence without blurring or repainting master; clearance: full artwork and soft shadow clear of furniture, curtain and header region; artworkIntegrity: unchanged composition, ratio, colors and no exaggerated physical paint thickness. Reject baked-in frame/painting/shadow ghosts in empty background. A theme shadow/highlight limitation is renderer, not a reason to regenerate endless rooms. Uncertain attribution must be reported as uncertain. Background faults include wall perspective, hard sunlight and furniture overlap. Evaluate all frames; any failing frame fails the asset.`;
}

export async function frameSheet(items) {
  const width=480, height=600, columns=2;
  const layers=[];
  for(let i=0;i<items.length;i++) {
    const text=items[i].frame.replace(/[&<>"']/g,'');
    const tile=await sharp(items[i].bytes).resize(width,height-32,{fit:'contain',background:'#eeece7'}).png().toBuffer();
    layers.push({input:tile,left:(i%columns)*width,top:Math.floor(i/columns)*height+32});
    layers.push({input:Buffer.from(`<svg width="480" height="32"><rect width="480" height="32" fill="white"/><text x="12" y="23" font-size="18">${text}</text></svg>`),left:(i%columns)*width,top:Math.floor(i/columns)*height});
  }
  return sharp({create:{width:columns*width,height:Math.ceil(items.length/columns)*height,channels:3,background:'white'}}).composite(layers).png().toBuffer();
}
