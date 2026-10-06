import test from 'node:test';
import assert from 'node:assert/strict';
import {directionPrompt,validateDirection} from './product-studio/art-direction.js';
import {composedPrompt} from './product-studio/composed-scene.js';
import {referenceDirection} from './product-studio/reference-direction.js';
const job={sceneWorkflow:'composed-unframed-v1',desktopAspectRatio:'16:9',bannerProfile:'clearance-v3',mediaProfile:'responsive-v1',analysis:{},selection:[{keep:'linen curtains',discard:'red sofa'},{keep:'oak bench',discard:'busy shelves'},{keep:'plaster wall',discard:'oversized lamp'}]};
test('planning uses saved ratios and the correct scene renderer',()=>{
 const prompt=directionPrompt(job);
 assert.match(prompt,/16:9 desktop companion and 4:5 mobile/);
 assert.match(prompt,/theme adds only the external frame/);
 assert.doesNotMatch(prompt,/fixed mounts|21:9/);
 assert.match(directionPrompt({...job,desktopAspectRatio:undefined}),/21:9 desktop companion/);
 const legacy=directionPrompt({});
 assert.match(legacy,/3:2 desktop companion and 3:4 mobile/);
 // A job without the overlay workflow now plans a baked float frame instead of the
 // retired empty-background overlay wording.
 assert.match(legacy,/already mounted in a slim float frame/);
 assert.doesNotMatch(legacy,/fixed mounts/);
});
test('each scene receives its selected reference instructions; desktop shares third reference',()=>{
 for(const [slot,index] of [['scene-1',0],['scene-2',1],['scene-3',2],['scene-desktop',2]]){
  const prompt=composedPrompt(job,slot,slot==='scene-desktop'?'16:9':'4:5');
  assert.ok(prompt.includes(job.selection[index].keep));
  assert.ok(prompt.includes(job.selection[index].discard));
  for(let i=0;i<3;i++)if(i!==index)assert.ok(!prompt.includes(job.selection[i].keep));
 }
 assert.equal(referenceDirection({},'scene-1'),'');
 assert.equal(referenceDirection({selection:[{styleOnly:true}]},'scene-1'),'','style-only selections carry no reference cues');
 assert.equal(referenceDirection({selection:[{keep:'k',discard:'d'}]},'scene-desktop'),'','missing desktop entry maps to scene-3 and stays empty');
 assert.doesNotThrow(()=>composedPrompt({analysis:{}},'scene-1','4:5'));
});
test('direction validation unwraps a single answer envelope like the lighting plan',()=>{
 const scenes=['scene-1','scene-2','scene-3'].map((slot,i)=>({slot,direction:'direction '+i,paletteAndMaterials:'palette '+i,composition:'composition '+i,referenceUse:'referenceUse '+i,lightingAndRenderer:'lighting '+i,frameAndScale:'scale '+i,avoid:'avoid '+i}));
 const value={artworkReading:'Observed tonal impasto abstract.',scenes};
 assert.equal(validateDirection(value),value);
 const wrapped=validateDirection({answer:value});
 assert.equal(wrapped.artworkReading,'Observed tonal impasto abstract.');
 assert.equal(wrapped.scenes.length,3);
 assert.throws(()=>validateDirection({answer:{answer:value}}),/缺少作品解读/);
 assert.throws(()=>validateDirection({plan:value}),/缺少作品解读/);
 assert.throws(()=>validateDirection({answer:{...value,scenes:value.scenes.slice(0,2)}}),/缺少作品解读/);
});
