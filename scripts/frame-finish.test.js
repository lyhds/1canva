import test from 'node:test';
import assert from 'node:assert/strict';
import {BAKED_FRAMES,FRAME_SELECTION_POLICY,frameAlt,sceneFrameOptions} from './product-studio/frame-finish.js';
import {directionPrompt} from './product-studio/art-direction.js';
import {mediaEntries} from './product-studio/media.js';
import {bakedFramePrompt,composedPrompt} from './product-studio/composed-scene.js';

test('the baked-frame prompt asks for a real frame and keeps the clearance rules',()=>{
 const p=bakedFramePrompt({analysis:{ratio:'2:1'},assets:{master:[{width:2048,height:1024}]}},'scene-1','4:5');
 assert.match(p,/FLOAT FRAME whose rail sits proud/);
 assert.match(p,/never draw a second frame, mat, border/);
 assert.match(p,/at least 4% of the image height clear/);
 assert.match(p,/Judge occlusion from the camera's viewpoint/);
 assert.doesNotMatch(p,/unframed stretched canvas/);
 assert.match(p,/2048x1024/);
 // The baked prompt is derived from the overlay prompt so the sentences that make the
 // generator place the artwork are inherited; a rewritten version lost them and every
 // scene came back as an empty room.
 assert.match(p,/The painting is the visual focus/);
 assert.match(p,/never stretch, squash, crop or re-proportion/);
 assert.match(p,/no duplicate painting or extra wall art/);
 assert.match(p,/Image 2 is the sole source/);
 assert.match(p,/ignore its proportions and replace it with image 2/);
});

test('only baked scene-2 may use a gentle oblique view; every other scene stays frontal',()=>{
 const job={analysis:{ratio:'2:1'},assets:{master:[{width:2048,height:1024}]}};
 const p2=bakedFramePrompt(job,'scene-2','4:5');
 assert.match(p2,/gentle oblique angle/);
 assert.match(p2,/all four frame edges must remain completely visible/);
 assert.match(p2,/no fisheye or extreme wide-angle distortion/);
 assert.doesNotMatch(p2,/nearly frontal and all four frame edges/);
 for(const slot of ['scene-1','scene-3','scene-desktop']){
  const p=bakedFramePrompt(job,slot,'4:5');
  assert.match(p,/nearly frontal and all four frame edges clearly visible/,slot);
  assert.doesNotMatch(p,/oblique/,slot);
 }
 // The overlay workflow still needs a frontal plane everywhere for frame coordinate mapping.
 const composed=composedPrompt(job,'scene-2','4:5');
 assert.match(composed,/nearly frontal and all four canvas edges clearly visible/);
 assert.doesNotMatch(composed,/oblique/);
});

test('wide artworks get an anti-stretch landscape cue on portrait scenes only',()=>{
 const job={analysis:{ratio:'3:2'},assets:{master:[{width:2016,height:1344}]}};
 const portrait=bakedFramePrompt(job,'scene-1','4:5');
 assert.match(portrait,/wide landscape \(3:2\)/);
 assert.match(portrait,/about 45%/);
 assert.match(portrait,/never stretch, elongate or vertically enlarge/i);
 assert.doesNotMatch(portrait,/oblique/);
 const panorama=bakedFramePrompt({analysis:{ratio:'2:1'},assets:{master:[{width:2048,height:1024}]}},'scene-2','4:5');
 assert.match(panorama,/about 36%/);
 const wide=bakedFramePrompt(job,'scene-desktop','21:9');
 assert.doesNotMatch(wide,/wide landscape/);
 const square=bakedFramePrompt({analysis:{ratio:'1:1'},assets:{master:[{width:1024,height:1024}]}},'scene-1','4:5');
 assert.doesNotMatch(square,/wide landscape/);
});

test('the baked workflow uploads one image per scene, not one per finish',()=>{
 const job={sceneWorkflow:BAKED_FRAMES,mediaProfile:'responsive-v1',assets:{}};
 const entries=mediaEntries(job);
 assert.equal(entries.length,6,'master, detail and four scenes');
 assert.deepEqual(entries.map(e=>e.alt),['master','detail design visualization',
  'composed-framed-scene-1-v1','composed-framed-scene-2-v1','composed-framed-scene-3-v1','composed-framed-scene-desktop-v1']);
 assert.equal(frameAlt('scene-2'),'composed-framed-scene-2-v1');
 const legacy={...job,sceneWorkflow:'composed-unframed-v1'};
 assert.equal(mediaEntries(legacy).length,6);
 assert.match(mediaEntries(legacy)[2].alt,/composed-unframed/);
});

test('frame selection uses actual product finishes and preserves legacy aliases without inventing availability',()=>{
 assert.deepEqual(sceneFrameOptions({}),['Oak Float Frame','Black Float Frame']);
 const job={sceneWorkflow:BAKED_FRAMES,analysis:{ratio:'3:4'},pricing:{variants:[{frame:'Rolled Canvas'},{frame:'Stretched Canvas'},{frame:'Black frame'},{frame:'black'},{frame:'Walnut Float Frame'},{frame:'Gold Float Frame'},{frame:'Silver Float Frame'},{frame:'White Float Frame'}]}};
 assert.deepEqual(sceneFrameOptions(job),['Black Float Frame']);
 const planning=directionPrompt(job),scene=bakedFramePrompt(job,'scene-1','4:5');
 for(const prompt of [planning,scene]){
  assert.match(prompt,/Allowed finishes for this artwork: Black Float Frame\./);
  assert.doesNotMatch(prompt,/light-oak|Oak Float Frame|Gold Float Frame|Silver Float Frame|Walnut Float Frame|White Float Frame/);
 }
 assert.match(planning,/In each frameAndScale field, state the exact chosen finish name/);
 assert.match(scene,/no default finish/);
 assert.throws(()=>sceneFrameOptions({pricing:{variants:[{frame:'Rolled Canvas'},{frame:'Black Float Frame',availableForSale:false}]}}),/没有可用的浮框颜色/);
});

test('new frame plans reach scene generation while old fixed-oak guidance is not reused or mutated',()=>{
 const job={analysis:{ratio:'2:1'},pricing:{variants:[{frame:'Black Float Frame'},{frame:'White Float Frame'}]},artDirection:{scenes:[{slot:'scene-3',direction:'Quiet plaster wall',frameAndScale:'OLD_OAK_ONLY_RULE'}]}};
 const before=JSON.stringify(job);
 const oldPrompt=bakedFramePrompt(job,'scene-3','4:5');
 assert.doesNotMatch(oldPrompt,/OLD_OAK_ONLY_RULE|light-oak/);
 assert.match(oldPrompt,/Quiet plaster wall/);
 assert.equal(JSON.stringify(job),before);
 const previousPolicy={...job,artDirection:{...job.artDirection,frameSelectionPolicy:'artwork-fit-v2',scenes:[{slot:'scene-3',frameAndScale:'White Float Frame from the previous policy'}]}};
 assert.doesNotMatch(bakedFramePrompt(previousPolicy,'scene-3','4:5'),/White Float Frame from the previous policy/);
 job.artDirection.frameSelectionPolicy=FRAME_SELECTION_POLICY;
 job.artDirection.scenes[0].frameAndScale='Black Float Frame for the cool grey edges, with medium scale';
 for(const slot of ['scene-3','scene-desktop'])assert.match(bakedFramePrompt(job,slot,slot==='scene-3'?'4:5':'21:9'),/Black Float Frame for the cool grey edges/);
 assert.match(bakedFramePrompt(job,'scene-desktop','21:9'),/Keep the scene-3 frame finish visible in image 1 when it is allowed/);
 assert.doesNotMatch(composedPrompt(job,'scene-1','4:5'),/FRAME FINISH SELECTION/,'historical overlay scenes retain their unframed contract');
});
