import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {Store} from './product-studio/store.js';
import {Pipeline} from './product-studio/pipeline.js';
import {SCENE_CHECKS,validateSceneQA} from './product-studio/scene-quality.js';

const plan = () => ({lightSource:'Right window visible',shadowDirection:'Reference casts left',softness:'Soft side light',wallPerspective:'Frontal wall',sharpness:'Fine wall texture',adaptation:'Retain furniture, diffuse window and add broad frontal fill consistently',compatible:true});
const qa = () => ({pass:true,issues:[],reason:'All inspected frames match diffuse wall lighting',failureSource:'none',checks:Object.fromEntries(SCENE_CHECKS.map(k=>[k,{pass:true,evidence:'Observed '+k}]))});
async function fixture(t,review=qa,compatible=true) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'canvasra-light-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=new Store(dir),job=store.create({});job.sceneWorkflow='lighting-v1';delete job.artDirectionProfile;
  job.config={maxAttempts:2,vision:{},image:{}};
  job.pricing={variants:[{frame:'Oak Float Frame'},{frame:'Black Float Frame'},{frame:'Oak Float Frame'}]};
  const png=await sharp({create:{width:80,height:100,channels:3,background:'#bea899'}}).png().toBuffer();
  store.addAsset(job,'master',png,{width:80,height:100,accepted:true});
  const calls={plans:0,generated:[],frames:[],reviews:0};
  const pipeline=new Pipeline(store,{}, {
    vision:async(c,p,images)=>{
      if(p.startsWith('Plan')){calls.plans++;assert.equal(images.length,2);return {data:{...plan(),compatible}};}
      calls.reviews++;assert.equal(images.length,4);return {data:review()};
    },
    generate:async(c,p,r,refs)=>{calls.generated.push({prompt:p,refs});return {bytes:png};},
    render:async(s,j,slot,frame)=>{if(frame)calls.frames.push(frame);return png;},
  });
  return {store,job,png,calls,pipeline,run:()=>pipeline.make(job,'scene-1','Empty room','4:5',[png])};
}

test('legacy room generation stores its source and makes no quality calls',async t=>{
 const f=await fixture(t);await f.run();const a=f.store.active(f.job,'scene-1');
 assert.equal(a.accepted,true);assert.equal(f.calls.plans,0);assert.equal(f.calls.reviews,0);
 assert.equal(a.referenceHashes.length,1);await f.run();assert.equal(f.calls.generated.length,1);
});

test('old AI compatibility verdict cannot block generation',async t=>{
 const f=await fixture(t,qa,false);await f.run();assert.equal(f.calls.generated.length,1);assert.equal(f.calls.plans,0);
});

test('quality model cannot reject a generated image because it is never invoked',async t=>{
 const f=await fixture(t,()=>{assert.fail('No AI quality responsibility');});
 await f.run();await f.run();assert.equal(f.calls.generated.length,1);assert.equal(f.calls.reviews,0);
});

test('saved AI rejection is not appended to new generation prompts',async t=>{
 const f=await fixture(t);const prior=f.store.addAsset(f.job,'scene-1',f.png,{width:80,height:100,accepted:false,invalidated:true,qa:{pass:false,issues:['OLD AI REPAIR']}});
 await f.run();assert.equal(f.calls.generated.length,1);assert.doesNotMatch(f.calls.generated[0].prompt,/OLD AI REPAIR/);assert.equal(f.job.assets['scene-1'][0],prior);
});

test('an interrupted review leaves a reusable image without another model call',async t=>{
 const f=await fixture(t);f.store.addAsset(f.job,'scene-1',f.png,{width:80,height:100,accepted:false});
 await f.run();assert.equal(f.calls.generated.length,0);assert.equal(f.calls.reviews,0);
});

test('overall pass cannot override failed or missing visual checks',()=>{
  const result=qa();result.checks.contactShadow.pass=false;assert.equal(validateSceneQA(result).pass,false);
  delete result.checks.clearance;assert.throws(()=>validateSceneQA(result),/clearance/);
});


test('artwork-led review rejects missing aesthetic evidence and a failed visual hierarchy',async()=>{
 const {AESTHETIC_CHECKS}=await import('./product-studio/art-direction.js');const j={artDirectionProfile:'artwork-led-v1'};
 assert.throws(()=>validateSceneQA(qa(),j),/artworkRoomFit/);const result=qa();for(const key of AESTHETIC_CHECKS)result.checks[key]={pass:true,evidence:'Observed'};result.checks.visualHierarchy.pass=false;assert.equal(validateSceneQA(result,j).pass,false);
});
test('historical viewport records remain available without invoking reviewer',async t=>{
 const f=await fixture(t);const a=f.store.addAsset(f.job,'scene-3',f.png,{width:80,height:100,accepted:false,mobileEvidence:{views:[{pass:false}]}});
 await f.pipeline.make(f.job,'scene-3','Empty','4:5',[f.png]);assert.equal(f.calls.generated.length,0);assert.equal(f.calls.reviews,0);assert.equal(a.mobileEvidence.views[0].pass,false);
});
