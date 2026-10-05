import {priceTable} from './product-studio/price-table.js';
import {seedModelKeys} from './test-support/studio-settings.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {Store} from './product-studio/store.js';
import {Pipeline} from './product-studio/pipeline.js';
import {sceneLayouts} from './product-studio/scene-publication.js';
import {mediaSlots,mediaAlt,mediaEntries} from './product-studio/media.js';
import {createApp} from './product-studio/server.js';
import {bannerRatio,bannerPrompt} from './product-studio/banner.js';

test('new products default to confirmed full delivery while explicit restrictions persist',t=>{
 const store=seedModelKeys(new Store(fs.mkdtempSync(path.join(os.tmpdir(),'studio-delivery-'))));
 t.after(()=>fs.rmSync(store.dir,{recursive:true,force:true}));
 assert.equal(store.create({}).delivery,'all');
 const restricted=store.create({delivery:'framed-only'});
 assert.equal(store.get(restricted.id).delivery,'framed-only');
});

async function fixture(t) {
 const store=seedModelKeys(new Store(fs.mkdtempSync(path.join(os.tmpdir(),'studio-no-review-'))));
 t.after(()=>fs.rmSync(store.dir,{recursive:true,force:true}));
 const job=store.create({target:'publish'});delete job.artDirectionProfile;
 job.config={autoRecovery:true,vision:{endpoint:'https://example.com',model:'test',apiKey:'test'},image:{endpoint:'https://example.com',model:'test',apiKey:'test'},profiles:{'3:4':{templateId:'t',referenceId:'r'}}};
 job.analysis={ratio:'3:4',masterPrompt:'Original artwork'};job.pricing={priceTableVersion:priceTable.version,variants:[]};
 job.copy={title:'Test',handle:'test',tags:[]};job.collections=[{id:'c'}];
 const art=await sharp({create:{width:120,height:160,channels:3,background:'black'}}).png().toBuffer();
 store.addAsset(job,'reference',art,{width:120,height:160,accepted:true});
 job.selection=[1,2,3].map(i=>({file:'ref-'+i+'.png'}));
 for(const item of job.selection)fs.writeFileSync(store.file(job.id,item.file),art);
 return {store,job,art};
}

test('six-image publication invokes only coordinate extraction after generation, with no QA receipts',async t=>{
 const {store,job,art}=await fixture(t);let generated=0,localized=0,published=0;
 const product=()=>({id:'p',title:'Test',handle:'test',status:published?'ACTIVE':'DRAFT',
  sceneLayouts:{value:JSON.stringify(sceneLayouts(job))},variants:{nodes:[],pageInfo:{}},
  media:{nodes:mediaSlots(job).map(slot=>({alt:mediaAlt(slot,job),status:'READY',image:store.active(job,slot)})),pageInfo:{}},
  collections:{nodes:[{id:'c'}],pageInfo:{}},resourcePublications:{nodes:published?[{isPublished:true,publication:{name:'Online Store'}}]:[],pageInfo:{}}});
 const worker=new Pipeline(store,{pricing:async()=>job.pricing,find:async()=>[],create:async()=> 'p',upload:async()=>{},product:async()=>product(),verifyMediaProfile:async()=>{},publish:async()=>published++},{
  generate:async(c,prompt,ratio)=>{generated++;if(ratio==='3:4')return {bytes:art};
   if(generated===5){assert.equal(ratio,'21:9');assert.match(prompt,/native 21:9/);}
   const [w,h]=ratio.split(':').map(Number);return {bytes:await sharp({create:{width:w*100,height:h*100,channels:3,background:'white'}}).composite([{input:art,left:Math.floor(w*50-60),top:200}]).png().toBuffer()};},
  vision:async(c,prompt,images)=>{localized++;assert.match(prompt,/Locate the canvas/);assert.match(prompt,/Do not review quality/);
   const m=await sharp(images[0]).metadata();return {data:{artworkBounds:{left:(m.width/2-60)/m.width,top:200/m.height,right:(m.width/2+60)/m.width,bottom:360/m.height}}};}
 });
 await worker.run(job);assert.equal(job.status,'published');assert.equal(generated,5);assert.equal(localized,4);assert.equal(published,1);
 for(const slot of mediaSlots(job))assert.equal(store.active(job,slot).qa,undefined);
 assert.equal(Object.keys(sceneLayouts(job)).length,4);
 assert.ok(!job.operations.some(op=>/验收|审核|诊断/.test(op.label)));
 await assert.rejects(()=>worker.run(job),/只读/);assert.equal(published,1);
});

test('new desktop ratio persists while existing composed and empty-room jobs retain their ratios',async t=>{
 const {store,job}=await fixture(t);
 assert.equal(job.desktopAspectRatio,'21:9');
 assert.equal(bannerRatio(store.get(job.id)),'21:9');
 assert.match(bannerPrompt(job),/middle 60% of image height/);
 const saved16={...job,desktopAspectRatio:'16:9'};store.save(saved16);assert.equal(bannerRatio(store.get(job.id)),'16:9');
 const legacy={...job};delete legacy.desktopAspectRatio;
 store.save(legacy);assert.equal(bannerRatio(store.get(job.id)),'21:9');
 assert.match(bannerPrompt(legacy),/native 21:9/);
 assert.equal(bannerRatio({bannerProfile:'fullbleed-v2',sceneWorkflow:'lighting-v1'}),'21:9');
 assert.equal(bannerRatio({}),'3:2');
 assert.equal(mediaAlt('scene-desktop',job),mediaAlt('scene-desktop',legacy));
});

test('coordinate failure preserves scene and never calls image generation on retry',async t=>{
 const {store,job,art}=await fixture(t);store.addAsset(job,'master',art,{width:120,height:160,accepted:true});
 const image=await sharp({create:{width:400,height:500,channels:3,background:'white'}}).png().toBuffer();
 const a=store.addAsset(job,'scene-1',image,{width:400,height:500,accepted:true,sceneWorkflow:job.sceneWorkflow,masterHash:store.active(job,'master').sha256});
 let calls=0;const worker=new Pipeline(store,{}, {generate:async()=>assert.fail('No regeneration'),vision:async()=>{calls++;return {data:{artworkBounds:{left:.2,top:.2,right:.5,bottom:.52}}};}});
 await assert.rejects(()=>worker.locateArtwork(job,'scene-1'),/不清晰/);
 await assert.rejects(()=>worker.locateArtwork(job,'scene-1'),/不清晰/);
 assert.equal(calls,2);assert.equal(job.assets['scene-1'].length,1);assert.ok(a.localizationError);
});

test('manual redo endpoint invalidates only the requested image; master redo invalidates dependent scenes',async t=>{
 const {store,job,art}=await fixture(t);job.status='failed';
 for(const slot of ['master','detail','scene-1','scene-2'])store.addAsset(job,slot,art,{width:120,height:160,accepted:true});
 store.save(job);
 const app=createApp({store,shopify:{configured:()=>true},pipeline:{recover(){},tick(){}}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.server.close());
 const base='http://127.0.0.1:'+app.server.address().port,{token}=await(await fetch(base+'/api/bootstrap')).json();
 const redo=slot=>fetch(base+'/api/jobs/'+job.id+'/retry',{method:'POST',headers:{'X-Studio-Token':token,'Content-Type':'application/json'},body:JSON.stringify({slot})});
 assert.equal((await redo('scene-1')).status,200);let next=store.get(job.id);
 assert.equal(store.active(next,'scene-1').invalidated,true);assert.equal(store.active(next,'scene-2').invalidated,undefined);
 assert.equal((await redo('master')).status,200);next=store.get(job.id);
 for(const slot of ['master','detail','scene-1','scene-2'])assert.equal(store.active(next,slot).invalidated,true);
});

test('baked scenes must not request an empty room',async()=>{
 // backgroundOnly appends "never place the artwork in the room" to the provider prompt;
 // leaving it on for the baked workflow produced four empty rooms in a row.
 const source=fs.readFileSync(new URL('./product-studio/pipeline.js',import.meta.url),'utf8');
 assert.match(source,/backgroundOnly:isScene&&!composed&&!baked/);
 assert.doesNotMatch(source,/backgroundOnly:isScene&&!composed,/);
});

test('baked scenes resume saved images without localization, ratio review or regeneration',async t=>{
 const {store,job,art}=await fixture(t);job.sceneWorkflow='baked-frames-v1';store.save(job);
 store.addAsset(job,'master',art,{width:120,height:160,accepted:true});
 const image=await sharp({create:{width:400,height:500,channels:3,background:'white'}}).png().toBuffer();
 const worker=new Pipeline(store,{}, {generate:async()=>{throw Error('must reuse saved image');},vision:async()=>{throw Error('must not locate or review baked scene');}});
 for(const slot of ['scene-1','scene-2','scene-3','scene-desktop']){
  const a=store.addAsset(job,slot,image,{width:400,height:500,sceneWorkflow:'baked-frames-v1',accepted:false,programError:'画作定位坐标格式错误；已保留图片，请重新定位',artworkRatioCheck:{ok:false}});
  await worker.make(job,slot,'unused','4:5',[art]);
  assert.equal(a.accepted,true);assert.equal(a.programError,undefined);assert.equal(job.assets[slot].length,1);
  assert.equal(a.artworkRatioCheck.ok,false,'retain historical evidence');
 }
 const bad=store.addAsset(job,'scene-1',image,{width:400,height:500,sceneWorkflow:'baked-frames-v1',accepted:false});
 await assert.rejects(()=>worker.make(job,'scene-1','unused','21:9',[art]),/图片比例不符合/);
 assert.equal(bad.accepted,false);
});

for(const target of ['publish','draft'])test(`redo scene-3 refreshes its PC image and requires confirmation before ${target}`,async t=>{
 let {store,job,art}=await fixture(t);
 job.target=target;job.sceneWorkflow='baked-frames-v1';job.artDirectionProfile='artwork-led-v1';job.status='paused';
 const master=store.addAsset(job,'master',art,{width:120,height:160,accepted:true});
 job.artDirection={masterHash:master.sha256,scenes:[]};
 for(const [slot,width,height]of [['scene-1',400,500],['scene-2',400,500],['scene-3',400,500],['scene-desktop',672,288]]){
  const bytes=await sharp({create:{width,height,channels:3,background:'white'}}).png().toBuffer();
  store.addAsset(job,slot,bytes,{width,height,sceneWorkflow:job.sceneWorkflow,masterHash:master.sha256,accepted:true});
 }
 let generated=0,created=0,published=0;
 const product=()=>({id:'p',title:'Test',handle:'test',status:published?'ACTIVE':'DRAFT',variants:{nodes:[],pageInfo:{}},media:{nodes:mediaEntries(job).map(e=>({alt:e.alt,status:'READY',image:store.active(job,e.slot)})),pageInfo:{}},collections:{nodes:[{id:'c'}],pageInfo:{}},resourcePublications:{nodes:published?[{isPublished:true,publication:{name:'Online Store'}}]:[],pageInfo:{}}});
 const worker=new Pipeline(store,{pricing:async()=>job.pricing,find:async()=>[],create:async()=>{created++;return 'p';},upload:async()=>{},product:async()=>product(),verifyMediaProfile:async()=>{},publish:async()=>published++},{
  generate:async(c,prompt,ratio)=>{generated++;const [w,h]=ratio.split(':').map(Number);return {bytes:await sharp({create:{width:w*32,height:h*32,channels:3,background:'#eeddaa'}}).png().toBuffer()};},vision:async()=>assert.fail('cached copy and scene plan must not need AI')});
 const app=createApp({store,shopify:{configured:()=>true},pipeline:{recover(){},tick(){}}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>app.server.close(r)));
 const base='http://127.0.0.1:'+app.server.address().port,{token}=await(await fetch(base+'/api/bootstrap')).json();
 const post=(action,body={})=>fetch(`${base}/api/jobs/${job.id}/${action}`,{method:'POST',headers:{'X-Studio-Token':token,'Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal((await post('retry',{slot:'scene-3'})).status,200);job=store.get(job.id);
 assert.equal(job.manualReviewRequired,true);assert.equal(job.target,target);
 assert.equal(store.active(job,'scene-desktop').invalidated,true);
 assert.equal(store.active(job,'scene-2').invalidated,undefined);
 assert.deepEqual(store.publicJob(job).redoDependencies['scene-3'],['scene-3','scene-desktop']);
 assert.equal((await post('confirm-redo')).status,400,'cannot confirm unfinished images');
 if(target==='draft'){delete job.manualReviewRequired;store.save(job);} // An older redo has only revision; it must also stop once.
 await worker.run(job);assert.equal(job.status,'scenes-ready');assert.equal(created,0);assert.equal(published,0);assert.equal(generated,2);
 assert.equal(store.active(job,'scene-desktop').sourceSceneHash,store.active(job,'scene-3').sha256);
 assert.equal(job.assets['scene-3'].length,2);assert.equal(job.assets['scene-desktop'].length,2);assert.equal(job.assets['scene-1'].length,1);
 assert.equal((await post('run')).status,200);job=store.get(job.id);await worker.run(job);
 assert.equal(job.status,'scenes-ready');assert.equal(created,0);assert.equal(generated,2,'continue reuses both images without bypassing review');
 store.active(job,'scene-desktop').invalidated=true;store.save(job);assert.equal((await post('confirm-redo')).status,400);delete store.active(job,'scene-desktop').invalidated;store.save(job);
 assert.equal((await post('confirm-redo')).status,200);job=store.get(job.id);assert.equal(job.target,target);assert.equal(job.manualReviewRequired,false);
 await worker.run(job);assert.equal(job.status,target==='publish'?'published':'draft');assert.equal(created,1);assert.equal(published,target==='publish'?1:0);assert.equal(generated,2);
 assert.equal((await post('retry',{slot:'scene-3'})).status,400,'existing Shopify product stays protected');
});

test('saved PC reference hashes detect a changed scene-3 and reuse the replacement on resume',async t=>{
 const {store,job,art}=await fixture(t);job.sceneWorkflow='baked-frames-v1';job.artDirectionProfile='artwork-led-v1';
 const master=store.addAsset(job,'master',art,{width:120,height:160,accepted:true});
 const bytes=await sharp({create:{width:672,height:288,channels:3,background:'white'}}).png().toBuffer();
 const room=store.addAsset(job,'scene-3',art,{width:120,height:160,accepted:true});
 const old=store.addAsset(job,'scene-desktop',bytes,{width:672,height:288,accepted:true,sceneWorkflow:job.sceneWorkflow,masterHash:master.sha256,referenceHashes:['previous-scene-3']});
 let generated=0;const worker=new Pipeline(store,{}, {generate:async()=>{generated++;return {bytes};},vision:async()=>assert.fail('no localization')});
 await worker.make(job,'scene-desktop','unused','21:9',[art]);assert.equal(generated,1);assert.equal(old.invalidated,true);assert.equal(job.manualReviewRequired,true);
 assert.equal(store.active(job,'scene-desktop').sourceSceneHash,room.sha256);
 await worker.make(job,'scene-desktop','unused','21:9',[art]);assert.equal(generated,1);
});

test('a new baked task still publishes automatically without a manual redo',async t=>{
 const {store,job,art}=await fixture(t);job.sceneWorkflow='baked-frames-v1';let generated=0,published=0;
 const product=()=>({id:'p',title:'Test',handle:'test',status:published?'ACTIVE':'DRAFT',variants:{nodes:[],pageInfo:{}},media:{nodes:mediaEntries(job).map(e=>({alt:e.alt,status:'READY',image:store.active(job,e.slot)})),pageInfo:{}},collections:{nodes:[{id:'c'}],pageInfo:{}},resourcePublications:{nodes:published?[{isPublished:true,publication:{name:'Online Store'}}]:[],pageInfo:{}}});
 const worker=new Pipeline(store,{pricing:async()=>job.pricing,find:async()=>[],create:async()=> 'p',upload:async()=>{},product:async()=>product(),verifyMediaProfile:async()=>{},publish:async()=>published++},{
  generate:async(c,prompt,ratio)=>{generated++;if(ratio==='3:4')return {bytes:art};const [w,h]=ratio.split(':').map(Number);return {bytes:await sharp({create:{width:w*32,height:h*32,channels:3,background:'white'}}).png().toBuffer()};},vision:async()=>assert.fail('baked scenes need no coordinate or quality call')});
 await worker.run(job);assert.equal(job.status,'published');assert.equal(published,1);assert.equal(generated,5);
});
