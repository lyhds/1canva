import {ModelFormatError} from './product-studio/model-format.js';
import {priceTable} from './product-studio/price-table.js';
import {seedModelKeys} from './test-support/studio-settings.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {Store,atomic} from './product-studio/store.js';
import {Pipeline} from './product-studio/pipeline.js';
import {UncertainError} from './product-studio/providers.js';
import {SCENE_CHECKS,rendererFingerprint} from './product-studio/scene-quality.js';

async function fixture(t){
 const store=seedModelKeys(new Store(fs.mkdtempSync(path.join(os.tmpdir(),'canvasra-auto-'))));t.after(()=>fs.rmSync(store.dir,{recursive:true,force:true}));
 const j=store.create({});j.sceneWorkflow='lighting-v1';delete j.artDirectionProfile;
 j.config={autoRecovery:true,maxAttempts:3,vision:{},image:{model:'test'}};
 const bytes=await sharp({create:{width:300,height:400,channels:3,background:'#ccc'}}).png().toBuffer();
 store.addAsset(j,'master',bytes,{width:300,height:400,accepted:true});j.pricing={priceTableVersion:priceTable.version,variants:[{frame:'Oak Float Frame'}]};
 return {store,j,bytes};
}
const qa=(pass,source='none')=>({pass,failureSource:source,issues:pass?[]:['Sofa overlaps artwork'],reason:pass?'Clear furniture':'Sofa overlaps artwork',checks:Object.fromEntries(SCENE_CHECKS.map(k=>[k,{pass,evidence:pass?'Clear':'Overlap'}]))});
const plan={key:'test',plan:{compatible:true}};

test('legacy scene generation calls no reviewer or repair model',async t=>{
 const {store,j,bytes}=await fixture(t);let generated=0;
 const p=new Pipeline(store,{}, {vision:async()=>assert.fail('No AI review'),generate:async()=>{generated++;return {bytes};}});
 await p.make(j,'scene-1','Empty room','3:4',[bytes]);await p.make(j,'scene-1','Empty room','3:4',[bytes]);
 assert.equal(generated,1);assert.equal(store.active(j,'scene-1').accepted,true);assert.equal(store.active(j,'scene-1').qa,undefined);
});

test('old failed AI opinion is retained but does not block a valid saved image',async t=>{
 const {store,j,bytes}=await fixture(t);const a=store.addAsset(j,'scene-1',bytes,{width:300,height:400,accepted:false,qa:qa(false)});
 const p=new Pipeline(store,{}, {vision:async()=>assert.fail('No review'),generate:async()=>assert.fail('Reuse saved image')});
 await p.make(j,'scene-1','Empty','3:4',[bytes]);assert.equal(a.accepted,true);assert.equal(a.qa.pass,false);assert.equal(a.readinessPolicy,'generation-only-v1');
});

test('wrong image ratio stops without automatic generation on resume',async t=>{
 const {store,j,bytes}=await fixture(t);let generated=0;
 const p=new Pipeline(store,{}, {vision:async()=>assert.fail('No review'),generate:async()=>{generated++;return {bytes};}});
 await assert.rejects(()=>p.make(j,'scene-1','Empty','4:5',[bytes]),/比例/);
 await assert.rejects(()=>p.make(j,'scene-1','Empty','4:5',[bytes]),/比例/);
 assert.equal(generated,1);assert.equal(store.active(j,'scene-1').accepted,false);
});

test('uncertain generation never starts a duplicate paid request',async t=>{
 const {store,j,bytes}=await fixture(t);let generated=0;
 const p=new Pipeline(store,{}, {generate:async()=>{generated++;throw new UncertainError('receipt unavailable');}});p.planScene=async()=>plan;
 await assert.rejects(()=>p.make(j,'scene-1','Empty room','3:4',[bytes]),UncertainError);assert.equal(generated,1);assert.equal(j.operations.at(-1).status,'uncertain');
});
test('legacy AI renderer verdict no longer triggers rework',async t=>{
 const {store,j,bytes}=await fixture(t);const a=store.addAsset(j,'scene-3',bytes,{width:300,height:400,accepted:false,qa:qa(false,'renderer'),mobileEvidence:{views:[{pass:false}]}});
 const p=new Pipeline(store,{}, {generate:async()=>assert.fail('Preserve image'),vision:async()=>assert.fail('No reviewer')});
 await p.make(j,'scene-3','Empty','3:4',[bytes]);assert.equal(a.accepted,true);assert.equal(a.mobileEvidence.views[0].pass,false);
});

test('format recovery has a bound and a user pause interrupts recovery',async t=>{
 const {store,j}=await fixture(t);const p=new Pipeline(store,{});let count=0;
 await assert.rejects(()=>p.step(j,'分析',async()=>{count++;throw new ModelFormatError('返回结构不完整');}));assert.equal(count,3);
 atomic(path.join(store.jobDir(j.id),'pause.json'),{});await assert.rejects(()=>p.step(j,'分析',async()=>assert.fail('paused')));assert.equal(j.status,'paused');
});
test('one conclusive scene failure does not prevent other scenes from completing or publish partial media',async t=>{
 const {store,j,bytes}=await fixture(t);j.analysis={ratio:'3:4',masterPrompt:'art'};j.selection=[1,2,3].map(n=>({file:`ref-${n}.png`}));for(const r of j.selection)fs.writeFileSync(store.file(j.id,r.file),bytes);
 store.addAsset(j,'reference',bytes,{width:300,height:400,accepted:true});const calls=[];const p=new Pipeline(store,{create:async()=>assert.fail('Do not publish partial media')});j.config.vision=j.config.image={endpoint:'https://example.com',model:'test',apiKey:'test'};
 p.make=async(job,slot)=>{calls.push(slot);if(slot==='scene-1')throw Error('Budget exhausted');if(slot!=='master')store.addAsset(j,slot,bytes,{width:300,height:400,accepted:true});};
 await assert.rejects(()=>p.run(j),/以下场景仍需处理/);assert.deepEqual(calls,['master','scene-1','scene-2','scene-3','scene-desktop']);assert.equal(store.active(j,'scene-2').accepted,true);assert.equal(j.sceneFailures.length,1);
});
test('read-only analysis timeout retries within a persistent bound and records unknown billing',async t=>{
 const {store,j}=await fixture(t);let calls=0;const p=new Pipeline(store,{}, {vision:async()=>{if(++calls===1)throw new UncertainError('timeout');return {data:{pass:true}};}});
 const result=await p.aiCall(j,'analysis','test',[]);assert.equal(result.pass,true);assert.equal(calls,2);assert.equal(j.operations[0].status,'superseded');assert.match(j.operations[0].resolution,/计费仍未知/);assert.equal(j.operations[1].status,'complete');
});
test('saved receipt stays uncertain without a repeated generation request',async t=>{
 const {store,j,bytes}=await fixture(t);let generated=0;
 const p=new Pipeline(store,{}, {generate:async(c,p,r,refs,options)=>{generated++;await options.onResponse({data:[{b64_json:bytes.toString('base64')}]});throw new UncertainError('download interrupted');}});
 await assert.rejects(()=>p.make(j,'scene-1','Empty','3:4',[bytes]),UncertainError);
 await assert.rejects(()=>p.make(j,'scene-1','Empty','3:4',[bytes]),UncertainError);
 assert.equal(generated,1);assert.ok(fs.existsSync(store.file(j.id,j.operations[0].resultFile)));
});

test('manual invalidation generates only the requested slot and preserves prior versions',async t=>{
 const {store,j,bytes}=await fixture(t);const a=store.addAsset(j,'scene-1',bytes,{width:300,height:400,accepted:false,invalidated:true});
 const other=store.addAsset(j,'scene-2',bytes,{width:300,height:400,accepted:true});
 let generated=0;const p=new Pipeline(store,{}, {generate:async()=>{generated++;return {bytes};},vision:async()=>assert.fail('No review')});
 await p.make(j,'scene-1','Empty','3:4',[bytes]);await p.make(j,'scene-2','Empty','3:4',[bytes]);
 assert.equal(generated,1);assert.equal(j.assets['scene-1'].length,2);assert.equal(j.assets['scene-1'][0],a);assert.equal(store.active(j,'scene-2'),other);
});

// Model format recovery must be bounded and must not retry a paid image request.
test('design omissions are corrected with field-specific feedback and no leakage to the next step',async t=>{
 const {validateDirection,DIRECTION_FIELDS}=await import('./product-studio/art-direction.js');
 const {store,j}=await fixture(t);const prompts=[];
 const valid={artworkReading:'Visible artwork',scenes:['scene-1','scene-2','scene-3'].map(slot=>({slot,...Object.fromEntries(DIRECTION_FIELDS.map(k=>[k,slot+' '+k]))}))};
 let count=0;const p=new Pipeline(store,{}, {vision:async(c,prompt)=>{prompts.push(prompt);const answer=structuredClone(valid);if(count++===0)delete answer.scenes[2].avoid;return {data:answer};}});
 await p.step(j,'制定作品专属场景方案',async()=>validateDirection(await p.aiCall(j,'制定场景方案','Return all scene fields',[])));
 assert.equal(count,2);assert.match(prompts[1],/scene-3 缺少设计依据 avoid/);assert.match(prompts[1],/COMPLETE requested JSON/);
 await p.step(j,'下一步',()=>p.aiCall(j,'其他分析','Fresh request',[]));assert.equal(prompts.at(-1),'Fresh request');
 let imageCalls=0;await assert.rejects(()=>p.step(j,'生成图片',async()=>{imageCalls++;throw Error('Image JSON response missing');}));assert.equal(imageCalls,1);
});

test('missing selection slots and wrong field types are model format errors, never TypeErrors',async()=>{
 const {validateSelection,validateDirection}=await import('./product-studio/art-direction.js');
 const {shortlistIndices}=await import('./product-studio/selection.js');
 for(const scenes of [[],[null,null,null],[{slot:'scene-2'},{slot:'scene-2'},{slot:'scene-3'}],[{slot:'scene-1',index:1,reason:2,keep:{},discard:[]},{slot:'scene-2'},{slot:'scene-3'}]]){
  assert.throws(()=>validateSelection({scenes},[{id:'a'}]),ModelFormatError);
 }
 assert.throws(()=>validateDirection({artworkReading:'x',scenes:[null,null,null]}),ModelFormatError);
 assert.throws(()=>shortlistIndices({shortlist:{}},[]),ModelFormatError);
});
