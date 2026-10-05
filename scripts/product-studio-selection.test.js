import {ModelFormatError} from './product-studio/model-format.js';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import sharp from 'sharp';
import {Store} from './product-studio/store.js';import {selectCandidates,selectionIndices,shortlistIndices} from './product-studio/selection.js';
import {validateSelection} from './product-studio/art-direction.js';import {formatFailure} from './product-studio/recovery.js';
test('a mis-assigned BIGSIZE index is re-asked instead of failing the run',()=>{
 const candidates=[{id:'a',name:'a.png',bigsize:false},{id:'b',name:'b.png',bigsize:true},{id:'c',name:'c.png',bigsize:false}];
 const row=(slot,index)=>({slot,index,reason:'fits',keep:'wall',discard:'sofa'});
 assert.deepEqual(validateSelection({scenes:[row('scene-1',1),row('scene-2',3),row('scene-3',2)]},candidates).map(c=>c.id),['a','c','b']);
 // Model may return indices as numeric strings; they normalize like batch confirm does.
 assert.deepEqual(validateSelection({scenes:[row('scene-1','1'),row('scene-2','3'),row('scene-3','2')]},candidates).map(c=>c.id),['a','c','b']);
 assert.throws(()=>validateSelection({scenes:[row('scene-1','0'),row('scene-2',3),row('scene-3',2)]},candidates),/缺少有效索引/);
 assert.throws(()=>validateSelection({scenes:[row('scene-1','99'),row('scene-2',3),row('scene-3',2)]},candidates),/缺少有效索引/);
 // The observed failure: BIGSIZE went to scene-1 and scene-3 got a plain candidate.
 assert.throws(()=>validateSelection({scenes:[row('scene-1',2),row('scene-2',3),row('scene-3',1)]},candidates),/需要三个不同参考/);
 for(const message of ['参考终选需要三个场景','参考终选缺少有效索引或取舍依据','需要三个不同参考，第三个为适配的大尺寸参考'])
  assert.equal(formatFailure(new ModelFormatError(message)),true,message);
 assert.equal(formatFailure(Error('生图服务商超时')),false);
});
test('selection normalizes numeric strings but never guesses global or zero-based indices',()=>{
 assert.deepEqual(selectionIndices({indices:[' 2 ',2,3]},12),[2,3]);assert.deepEqual(selectionIndices({indices:[]},12),[]);assert.deepEqual(selectionIndices({answer:{indices:[7,12,10]}},12),[7,12,10]);assert.throws(()=>selectionIndices({answer:{indices:[13]}},12));
 for(const indices of [[0],[37],['1a'],[1.5],[1,2,3,4]])assert.throws(()=>selectionIndices({indices},12));
});
test('failed batch saves response, prior successes survive restart, changed images invalidate only affected batches',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'canvasra-selection-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new Store(dir),j=store.create({});j.config={vision:{model:'test',endpoint:'https://example.com'}};j.analysis={ratio:'3:4'};
 const bytes=await sharp({create:{width:30,height:40,channels:3,background:'#abc'}}).png().toBuffer();store.addAsset(j,'master',bytes,{});
 const files=Array.from({length:13},(_,i)=>{const file=path.join(dir,i+'.png');fs.writeFileSync(file,bytes);return {id:String(i),name:i+'.png',path:file,bigsize:i===12};});let calls=[];
 await assert.rejects(()=>selectCandidates(store,j,files,async label=>{calls.push(label);return {indices:label==='选图 1-12'?[2]:[13],reason:'fit'};}),/13–13/);
 assert.equal(Object.keys(store.get(j.id).selectionBatches).length,1);assert.equal(fs.readdirSync(store.jobDir(j.id)).filter(f=>f.startsWith('selection-response-')).length,2);
 calls=[];const restored=store.get(j.id),chosen=await selectCandidates(store,restored,files,async label=>{calls.push(label);return {indices:['1'],reason:'big'};});assert.deepEqual(calls,['选图 13-13','补选普通参考 1-11']);assert.deepEqual(chosen.map(f=>f.id),['1','12','0']);
 calls=[];await selectCandidates(store,store.get(j.id),files,async()=>assert.fail('cached batches must not call model'));
 fs.writeFileSync(files[12].path,await sharp({create:{width:30,height:40,channels:3,background:'#fff'}}).png().toBuffer());await selectCandidates(store,store.get(j.id),files,async label=>{calls.push(label);return {indices:[1]};});assert.deepEqual(calls,['选图 13-13']);
});
test('shortlist and confirm validation stay inside bounded format recovery',()=>{
 const files=Array.from({length:30},(_,i)=>({id:String(i),name:i+'.png',bigsize:i%10===4}));
 assert.throws(()=>shortlistIndices({shortlist:[1,2,3]},files),/12 到 24/);
 assert.throws(()=>shortlistIndices({shortlist:[1,2,3,4,6,7,8,9,10,11,12,13]},files),/BIGSIZE/);
 assert.doesNotThrow(()=>shortlistIndices({shortlist:[1,2,3,4,5,6,7,8,9,10,11,12]},files));
 assert.throws(()=>selectionIndices({indices:[1,2,3,4,5,6,7]},12,6),/最多选择 6 张参考/);
 for(const message of ['参考粗筛返回格式错误：参考粗筛必须返回 12 到 24 个互不相同的候选编号','图库档案返回结构不完整：缺少 descriptions 数组'])
  assert.equal(formatFailure(new ModelFormatError(message)),true,message);
});
test('large libraries build a shared archive, shortlist by description and confirm once',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'canvasra-archive-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=new Store(dir);
 const bytes=async seed=>sharp({create:{width:30,height:40,channels:3,background:{r:seed%255,g:40,b:80}}}).png().toBuffer();
 const files=[];for(let i=0;i<30;i++){const file=path.join(dir,'room-'+i+'.png');fs.writeFileSync(file,await bytes(i));files.push({id:String(i),name:(i%10===4?'bigsize/':'')+'room-'+i+'.png',path:file,bigsize:i%10===4});}
 const describe=async(label,prompt,images)=>{const m=label.match(/建立图库档案 (\d+)-(\d+)/);if(!m)throw Error('unexpected call '+label);const count=Number(m[2])-Number(m[1])+1;return {descriptions:Array.from({length:count},(_,n)=>({label:n+1,room:'living room',view:'frontal',wall:'bone plaster',palette:'warm neutrals',density:'low',notes:'soft daylight'}))};};
 const job=async()=>{const j=store.create({});j.config={vision:{model:'test',endpoint:'https://example.com'}};j.analysis={ratio:'3:4'};const master=await bytes(999);store.addAsset(j,'master',master,{});return j;};
 const stubs=calls=>async(label,prompt,images)=>{calls.push(label);if(label.startsWith('建立图库档案'))return await describe(label,prompt,images);if(label==='参考粗筛')return {shortlist:[1,2,3,4,5,6,7,8,9,10,11,12],reason:'bright rooms'};if(label==='参考精选')return {indices:[1,2,5],reason:'fit'};throw Error('unexpected call '+label);};
 let calls=[];
 const j1=await job();const c1=await selectCandidates(store,j1,files,stubs(calls));
 assert.deepEqual(calls,['建立图库档案 1-12','建立图库档案 13-24','建立图库档案 25-30','参考粗筛','参考精选']);
 assert.deepEqual(c1.map(f=>f.id),['0','1','4']);
 const index=JSON.parse(fs.readFileSync(path.join(store.dir,'library-index.json'),'utf8'));
 assert.equal(Object.keys(index.entries).length,30);assert.equal(index.entries[Object.keys(index.entries)[0]].description.room,'living room');
 // a fresh job reuses the shared archive and pays only for its own shortlist and confirm
 calls=[];const j2=await job();const c2=await selectCandidates(store,j2,files,stubs(calls));
 assert.deepEqual(calls,['参考粗筛','参考精选']);assert.deepEqual(c2.map(f=>f.id),['0','1','4']);
 // resuming a saved job reuses both receipts without any model call
 await selectCandidates(store,store.get(j2.id),files,async()=>assert.fail('cached shortlist and confirm must not call the model'));
 // a changed file is re-described in its own batch; the archive stays incremental
 fs.writeFileSync(files[7].path,await bytes(500));
 calls=[];await selectCandidates(store,await job(),files,stubs(calls));
 assert.deepEqual(calls,['建立图库档案 8-8','参考粗筛','参考精选']);
});

for(const count of [5,30])test('omitted Bigsize is repaired from cached selections: '+count,async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'canvasra-bigsize-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=new Store(dir),job=store.create({});job.config={vision:{model:'test',endpoint:'test'}};job.analysis={ratio:'1:1'};
 const bytes=await sharp({create:{width:30,height:30,channels:3,background:'#abc'}}).png().toBuffer();store.addAsset(job,'master',bytes,{});
 const files=Array.from({length:count},(_,i)=>{const file=path.join(dir,i+'.png');fs.writeFileSync(file,bytes);return {id:String(i),name:i+'.png',path:file,bigsize:i===4};});
 const initial=async(label)=>{
  if(label.startsWith('建立图库档案')){const m=label.match(/(\d+)-(\d+)/);return {descriptions:Array.from({length:Number(m[2])-Number(m[1])+1},(_,i)=>({label:i+1,room:'living',view:'frontal',wall:'plaster',palette:'warm',density:'low',notes:'light'}))};}
  if(label==='参考粗筛')return {shortlist:Array.from({length:12},(_,i)=>i+1)};
  if(label.startsWith('补选'))return {indices:[]};
  return {indices:[1,2,3],reason:'3 is BIGSIZE (incorrect model claim)'};
 };
 const expanded=await selectCandidates(store,job,files,initial);assert.ok(expanded.some(f=>f.bigsize));
 const saved=store.get(job.id);assert.ok(saved.selectionConfirm||saved.selectionBatches);
 await assert.rejects(()=>selectCandidates(store,saved,files,async label=>{assert.match(label,/^补选 Bigsize/);return {indices:[2]};}),ModelFormatError);
 let calls=0;const chosen=await selectCandidates(store,store.get(job.id),files,async(label,prompt)=>{calls++;assert.match(label,/^补选 Bigsize/);assert.match(prompt,/ALL selectable references belong to the BIGSIZE/);return {indices:[1],reason:'frontal wall'};});
 assert.equal(calls,1);assert.equal(chosen.at(-1).id,'4');assert.equal(chosen.at(-1).bigsize,true);
 await selectCandidates(store,store.get(job.id),files,async()=>assert.fail('successful repair must be cached'));
 const changed=await sharp({create:{width:30,height:30,channels:3,background:'#fff'}}).png().toBuffer();fs.writeFileSync(files[4].path,changed);
 let repaired=false;await selectCandidates(store,store.get(job.id),files,async(label,...args)=>{if(label.startsWith('补选')){repaired=true;return {indices:[1]};}return initial(label,...args);});assert.ok(repaired);
});

test('ordinary shortage expands even when model returns no additional matches',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'canvasra-ordinary-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new Store(dir),job=store.create({});job.config={vision:{model:'test',endpoint:'test'}};job.analysis={ratio:'1:1'};
 const bytes=await sharp({create:{width:30,height:30,channels:3,background:'#abc'}}).png().toBuffer();store.addAsset(job,'master',bytes,{});
 const files=Array.from({length:8},(_,i)=>{const file=path.join(dir,i+'.png');fs.writeFileSync(file,bytes);return {id:String(i),name:i+'.png',path:file,bigsize:i<5};});
 const calls=[];const chosen=await selectCandidates(store,job,files,async label=>{calls.push(label);return {indices:label.startsWith('选图')?[1,2,6]:[],reason:'fit'};});
 assert.equal(chosen.filter(f=>!f.bigsize).length,3);assert.ok(calls.some(x=>x.startsWith('补选普通')));assert.equal(new Set(chosen.map(f=>f.id)).size,chosen.length);
 await selectCandidates(store,store.get(job.id),files,async()=>assert.fail('reuse ordinary supplement receipts'));
});

test('per-slot recovery cannot choose a duplicate or the wrong category',async()=>{
 const {selectBySlot}=await import('./product-studio/selection.js');
 const candidates=[{id:'big',bigsize:true},{id:'ordinary-a',bigsize:false},{id:'ordinary-b',bigsize:false}];
 const selected=await selectBySlot(candidates,async(slot,pool)=>{assert.ok(pool.every(f=>Boolean(f.bigsize)===(slot==='scene-3')));return {index:1,reason:'fits',keep:'wall',discard:'decor'};});
 assert.deepEqual(selected.map(x=>x.id),['ordinary-a','ordinary-b','big']);
});
