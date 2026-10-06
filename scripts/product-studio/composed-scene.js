import {validateBackground} from './background.js';
import {referenceDirection} from './reference-direction.js';
import {OBLIQUE_VIEW_SLOTS,sceneSelection} from './media.js';
import {usesArtDirection} from './art-direction.js';
import {artworkGeometry,artworkShape} from './artwork-geometry.js';
import {FRAME_SELECTION_POLICY,sceneFrameGuidance} from './frame-finish.js';
import {styleFidelityClause,styleOnlyClause} from './scene-styles.js';
export const COMPOSED_SCENE='composed-unframed-v1';
export const composedScenes=j=>j.sceneWorkflow===COMPOSED_SCENE;
// The overlay workflow maps frame coordinates onto the scene, so every composed scene
// keeps a nearly frontal camera. Baked scenes paint the frame in: slots listed in
// OBLIQUE_VIEW_SLOTS may instead use the gentle oblique rule below (see bakedFramePrompt).
const CAMERA_FRONTAL_CANVAS='Keep the camera nearly frontal and all four canvas edges clearly visible.';
const CAMERA_FRONTAL_FRAME='Keep the camera nearly frontal and all four frame edges clearly visible.';
const CAMERA_OBLIQUE_FRAME='The camera may stay nearly frontal or move to a gentle oblique angle that suits this intimate setting (up to about 30 degrees off the wall normal); all four frame edges must remain completely visible and the artwork content clearly legible, with natural single-point perspective — no fisheye or extreme wide-angle distortion, and the viewing angle must never crop or hide the frame.';
// Wide artworks on portrait walls are the main source of proportion drift: the generator
// enlarges a landscape canvas to fill the vertical space. Capping its width keeps the
// true ratio easy to honor (2026-09-12 merchant decision). Portrait scenes only — on the
// wide desktop hero a landscape canvas already fits naturally.
const landscapeCue=(job,ratio)=>{
 const [sw,sh]=String(ratio).split(':').map(Number);
 if(!(Number.isFinite(sw)&&Number.isFinite(sh)&&sh>sw))return '';
 const geometry=artworkGeometry(job),r=geometry?.ratio??1;
 if(!(r>=1.25))return '';
 const width=r>=1.8?'about 36%':r>=1.4?'about 45%':'about 52%';
 return ` This artwork is a wide landscape (${geometry.label}): on a portrait wall it must read as a distinctly landscape band — keep its width within ${width} of the image width, with generous empty wall on both sides. Derive its height from that width using the original artwork ratio; never assign its height independently to fill empty wall. Never stretch, elongate or vertically enlarge it to fill the wall, and never crop it. A small wide painting is correct here.`;
};
// Each scene slot carries a different artwork scale so the set shows what the work
// looks like small, medium and large. The generator made every scene a wall-filling
// statement piece, which left the dedicated large-format scene with nothing to say.
const SCENE_SCALE = {
  'scene-1': 'the MEDIUM setting: the canvas hangs above a low console, sideboard or bench and reads as an ordinary mid-size print — clearly smaller than the scene-3 statement piece, with calm wall carrying the composition',
  'scene-2': 'the SMALL, intimate setting: the canvas reads as a modest piece in a tighter part of the room — a nook, hallway or corner beside a chair — with human-scale objects close to it so its size is legible',
  'scene-3': 'the LARGE-FORMAT statement setting: the canvas is the wall\u2019s main event and reads as a big piece, unmistakably larger than in the other two scenes',
  'scene-desktop': 'the ROOM-LED wide composition: the room, its light and the furniture carry the frame, while the canvas sits complete at its own ratio with breathing room on every side — it is NOT the largest setting, so never enlarge, stretch or re-proportion it to fill the wide frame',
};
export function composedPrompt(job,slot,ratio){
  const portrait=(artworkGeometry(job)?.ratio??1)<1;
  // Style-only fallback: when the reference library was empty, the selection carries
  // styleOnly entries. The artwork is then the only image sent to the generator (image 1)
  // and the room is designed from the selected style instead of a photo. Exception: with
  // art direction on, the desktop hero borrows the generated scene-3 room as image 1, so
  // it keeps the normal two-image wording.
  const styleOnly=sceneSelection(job,slot)?.styleOnly&&!(slot==='scene-desktop'&&usesArtDirection(job));
  const opening=styleOnly
    ?`Create ONE finished interior scene, native ${ratio}. This ratio applies ONLY to the whole output photograph. No room reference photo is provided: design the room yourself from the styling direction below. Image 1 is the exact original artwork to display and the sole source for the painting's shape, orientation and content.`
    :`Create ONE finished interior scene, native ${ratio}. This ratio applies ONLY to the whole output photograph. Image 1 is the room reference; image 2 is the exact original artwork to display. Image 2 is the sole source for the painting's shape, orientation and content. Any artwork or frame visible in image 1 is only part of the room reference: ignore its proportions and replace it with image 2. ${slot==='scene-desktop'?'For this desktop companion, borrow the scene-3 room materials, lighting and atmosphere from image 1; rebuild the painting from image 2 so a proportion error in the earlier scene is not carried forward.':''}`;
  const desktopPlacement=slot==='scene-desktop'?`The room carries the wide composition: keep the complete canvas at its true ratio inside the middle 60% of the image height, with the upper and lower bands left for interface clearance — never widen the canvas to fill the frame.${portrait?' For a portrait canvas in this wide room, hang it on open wall and place the low seating and consoles to the left and right sides of the artwork instead of directly beneath it, so the furniture never forces the canvas to shrink, squash or lose its true proportions.':''}`:null;
  return `${opening}
${artworkShape(job)} Render its canvas at exactly that width-to-height ratio and no other — the scene ratio is not the artwork ratio; never stretch, squash, crop or re-proportion the artwork to suit the wall, camera, sofa or furniture.
Place the artwork ONCE on the wall as an unframed stretched canvas, with NO external decorative frame, wood/metal rails, mat or border. Preserve the full artwork content, subject and colour relationships; no duplicate painting or extra wall art.${landscapeCue(job,ratio)}
This scene is ${SCENE_SCALE[slot]??SCENE_SCALE['scene-1']}. The painting is the visual focus; arrange camera and furniture so the canvas size stays legible against real objects at human scale, and no furniture may overlap the painting or its contact/cast shadow. ${slot==='scene-3'?'Do not shrink the artwork to accommodate a sofa; move or lower furniture instead.':desktopPlacement??'Keep the canvas at the size described above — do not enlarge it to fill the wall.'} ${CAMERA_FRONTAL_CANVAS} Leave clean wall around every edge for a future thin external frame and its shadow; do not draw that frame or a placeholder. Keep a clear band around the canvas on every side for the future frame rail and its shadow: at least 4% of the image height clear below the canvas, and clear wall to the sides and above it. Judge occlusion from the camera's viewpoint, not from the floor plan: anything standing in front of the wall can visually cross into the canvas or that band, so no plant, vase, lamp, chair back, tabletop object or their shadows may rise in front of a canvas edge, clip it, or read as passing behind it. Each edge must also separate in lightness from the wall: the room's own wall colour must read clearly lighter or darker than the artwork along every edge, so a dark passage of the painting is never set against an equally dark wall. Reach that contrast with the wall colour, materials and lighting themselves — never by painting a separate panel, rectangle, border, mat or outline on the wall behind the canvas. Edge contrast and frame clearance outrank palette matching.
Solve lighting IN THIS IMAGE: one coherent soft room light source, matching illumination on the artwork, canvas sides, wall and furniture. Keep image details and colours recognizable; no glare obscuring the artwork. Canvas sits close to the wall. Paint a narrow attached contact shadow and a subtle short soft cast shadow consistent with the room light. Do NOT enlarge/darken the shadow to simulate a future thick frame, add a halo, or make the canvas float. Future frame shadows will be handled separately. No invented heavy impasto, labels, text, logos or exaggerated depth.
${referenceDirection(job,slot)}
${slot==='scene-desktop'?'Independently compose a wide PC hero. Keep artwork and shadow in the central crop-safe region; top space for a header and bottom space for a product label. For 16:9 output, keep the complete canvas and future frame within the middle 60% of image height, leaving the upper and lower 20% for ultrawide cover cropping and interface clearance. Preserve side breathing room for 16:10 and 3:2 windows. Compose natively at the requested ratio; never stretch or crop an existing scene to manufacture that ratio.':'Portrait scene with clear top space; complete artwork and furniture remain visible.'}
Artwork context: ${JSON.stringify({title:job.analysis?.title,palette:job.analysis?.palette})}. Room styling direction: ${JSON.stringify(job.artDirection?.scenes?.find(s=>s.slot===(slot==='scene-desktop'?'scene-3':slot))||null)}. User scene brief: ${job.sceneBrief||''}.
Priority when arranging this scene: preserve ${styleOnly?"the artwork's complete rectangle and content first":"image 2's complete rectangle and content first"}; adapt room styling, apparent size and furniture around it. Medium, small and large describe proportional scale, never a new width-to-height ratio. The ${ratio} output format changes the room composition only. ${styleOnly?styleOnlyClause(job)+' The artwork must not be redesigned.':(styleFidelityClause(job)||'Room reference cues may be adapted;')+' image 2 artwork must not be redesigned.'}`;
}
/** Prompt for the baked-frame workflow.
 *  Derived from the proven overlay prompt on purpose: only the sentences that talk about
 *  the frame change, so the instructions that make the generator actually place the
 *  artwork (exact ratio, visual focus, no duplicate) are inherited rather than retyped.
 *  A rewritten prompt silently lost them once and every scene came back an empty room. */
const BAKED_SWAPS=[[
 'as an unframed stretched canvas, with NO external decorative frame, wood/metal rails, mat or border',
 'as a stretched canvas inside a slim, realistic FLOAT FRAME whose rail sits proud of the canvas with a narrow shadow gap, using the finish selected by the FRAME FINISH SELECTION instructions below, and with NO other frame, mat or border'],
['Keep the camera nearly frontal and all four canvas edges clearly visible.', 'Keep the camera nearly frontal and all four frame edges clearly visible.'],
 ['Leave clean wall around every edge for a future thin external frame and its shadow; do not draw that frame or a placeholder.',
  'Leave clean wall around the frame and its shadow; do not add a second frame or a placeholder.'],
 ['Keep a clear band around the canvas on every side for the future frame rail and its shadow: at least 4% of the image height clear below the canvas, and clear wall to the sides and above it.',
  'Keep a clear band of wall around the frame on every side: at least 4% of the image height clear below the frame, and clear wall to the sides and above it.'],
 ["anything standing in front of the wall can visually cross into the canvas or that band, so no plant, vase, lamp, chair back, tabletop object or their shadows may rise in front of a canvas edge, clip it, or read as passing behind it.",
  "anything standing in front of the wall can visually cross into the frame or that band, so no plant, vase, lamp, chair back, tabletop object or their shadows may rise in front of a frame edge, clip it, or read as passing behind it."],
 ["Each edge must also separate in lightness from the wall: the room's own wall colour must read clearly lighter or darker than the artwork along every edge, so a dark passage of the painting is never set against an equally dark wall. Reach that contrast with the wall colour, materials and lighting themselves — never by painting a separate panel, rectangle, border, mat or outline on the wall behind the canvas. Edge contrast and frame clearance outrank palette matching.",
  'The rail must also separate in lightness from both the wall and the canvas so it stays readable along every edge; reach that with the rail material, the wall colour and the room lighting — never by painting a separate panel, rectangle, mat or outline on the wall.'],
 ['Canvas sits close to the wall. Paint a narrow attached contact shadow and a subtle short soft cast shadow consistent with the room light. Do NOT enlarge/darken the shadow to simulate a future thick frame, add a halo, or make the canvas float. Future frame shadows will be handled separately.',
  'The frame sits close to the wall. Paint a narrow attached contact shadow and a subtle short soft cast shadow consistent with the room light. Do NOT add a halo to the frame or make the piece float.'],
 ['no furniture may overlap the painting or its contact/cast shadow', 'no furniture may overlap the frame or its contact/cast shadow']];
export function bakedFramePrompt(job,slot,ratio){
 // Keep existing room plans, but do not carry their retired fixed-oak choice into
 // newly generated scenes. The saved historical plan itself remains untouched.
 const promptJob=job.artDirection&&job.artDirection.frameSelectionPolicy!==FRAME_SELECTION_POLICY
  ?{...job,artDirection:{...job.artDirection,scenes:job.artDirection.scenes?.map(({frameAndScale,...scene})=>scene)}}:job;
 let prompt=composedPrompt(promptJob,slot,ratio);
 for(const [from,to] of BAKED_SWAPS){
  if(!prompt.includes(from))throw Error('带框提示词缺少可替换语句：'+from.slice(0,48));
  prompt=prompt.replace(from,to);
 }
 if(OBLIQUE_VIEW_SLOTS.has(slot)){
  if(!prompt.includes(CAMERA_FRONTAL_FRAME))throw Error('带框提示词缺少正面镜头语句');
  prompt=prompt.replace(CAMERA_FRONTAL_FRAME,CAMERA_OBLIQUE_FRAME+' Keep the original canvas rectangle in the wall plane and project canvas and frame together through the same camera perspective; never pre-squash or pre-stretch the artwork to simulate the viewing angle.');
 }
 return prompt+'\n'+sceneFrameGuidance(job,{slot})+' The float frame is part of this image: never draw a second frame, mat, border or duplicate rail.';
}
export const COMPOSED_CHECKS=['singleArtwork','frontalEdges','unframed','sourceFaithful','lightCoherent','naturalShadow','frameSpace','largeEnough'];export const composedReviewPrompt=`Review this FINISHED scene (image 1) against the original artwork (image 2). The artwork SHOULD be present in the room; it is not an empty background. Return JSON {checks:{singleArtwork:boolean,frontalEdges:boolean,unframed:boolean,sourceFaithful:boolean,lightCoherent:boolean,naturalShadow:boolean,frameSpace:boolean,largeEnough:boolean},artworkBounds:{left:number,top:number,right:number,bottom:number},objects:[{name:string,left:number,top:number,right:number,bottom:number}],lighting:{direction:string,softness:string,contactShadow:string,castShadow:string},issues:string[],reason:string}. Coordinates are normalized 0..1. Report visible furniture/decor boxes, excluding wall/floor. Require exactly one complete matching artwork, no external decorative frame/mat, no duplicate ghost, no furniture occluding it. It must have substantial visual prominence. Judge realistic soft scene illumination and narrow attached contact/short cast shadow, not a large floating halo. Leave wall space for future thin frame. Describe only observed light, not a hypothetical frame. All four artwork edges must be visible. Do not infer manufacturing facts. Missing evidence fails a check.`;
export function validateComposedQA(value){
 if(!value||!Array.isArray(value.issues)||!value.issues.every(x=>typeof x==='string')||typeof value.reason!=='string')throw Error('完整场景验收结构不完整');
 for(const k of COMPOSED_CHECKS)if(typeof value.checks?.[k]!=='boolean')throw Error('完整场景验收缺少 '+k);
 for(const k of ['direction','softness','contactShadow','castShadow'])if(typeof value.lighting?.[k]!=='string'||!value.lighting[k].trim())throw Error('完整场景光线分析缺少 '+k);
 const b=value.artworkBounds;
 if(!b||!['left','top','right','bottom'].every(k=>Number.isFinite(b[k])&&b[k]>=0&&b[k]<=1)||b.left>=b.right||b.top>=b.bottom)throw Error('画作定位坐标格式错误');
 const clearance=validateBackground({emptyWall:true,evidence:value.reason,objects:value.objects},b);
 const issues=[...value.issues,...COMPOSED_CHECKS.filter(k=>!value.checks[k]).map(k=>'Failed '+k),...clearance.collisions.map(x=>'Furniture overlap: '+x.name)];
 return {...value,pass:issues.length===0,failureSource:issues.length?'background':'none',issues,collisions:clearance.collisions};
}
