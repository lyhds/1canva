import {validatePlan} from './product-studio/scene-quality.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {vision,UncertainError} from './product-studio/providers.js';
import {Store} from './product-studio/store.js';
import {Pipeline} from './product-studio/pipeline.js';
import {createApp} from './product-studio/server.js';

const config={endpoint:'https://open.bigmodel.cn/api/paas/v4/chat/completions',model:'glm-5.3-flash',apiKey:'test-secret'};
test('master review sends a bounded copy and GLM reasoning budget without modifying source',async()=>{
 const bytes=await sharp({create:{width:2400,height:3200,channels:3,background:'#aaa'}}).png().toBuffer(),original=Buffer.from(bytes);
 let request;
 const fetcher=async(url,options)=>{request=JSON.parse(options.body);return Response.json({choices:[{message:{content:'{"pass":true,"issues":[],"reason":"visible"}'}}],usage:{total_tokens:20}});};
 const result=await vision(config,'review',[bytes],{fetcher,review:true});assert.equal(result.data.pass,true);assert.deepEqual(bytes,original);assert.equal(request.reasoning_effort,'low');assert.equal(request.max_tokens,4096);
 const url=request.messages[1].content[1].image_url.url;assert.match(url,/^data:image\/jpeg;base64,/);const meta=await sharp(Buffer.from(url.split(',')[1],'base64')).metadata();assert.equal(meta.width,1536);assert.equal(meta.height,2048);
 await vision({...config,endpoint:'https://example.com/api'},'review',[bytes],{fetcher,review:true});assert.equal(request.reasoning_effort,undefined);
});
test('review timeouts stay uncertain and truncated answers never pass validation',async()=>{
 await assert.rejects(()=>vision(config,'review',[],{fetcher:async()=>{throw new DOMException('timeout','TimeoutError');},review:true}),e=>e instanceof UncertainError&&e.message.includes('240 秒'));
 await assert.rejects(()=>vision(config,'review',[],{fetcher:async()=>Response.json({choices:[{finish_reason:'length',message:{content:'{"pass":true}'}}]}),review:true}),/长度限制/);
});

async function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'canvasra-review-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new Store(dir),j=store.create({});j.sceneWorkflow='lighting-v1';j.config={vision:config,image:config,maxAttempts:2};const bytes=await sharp({create:{width:300,height:400,channels:3,background:'#aaa'}}).png().toBuffer();store.addAsset(j,'master',bytes,{width:300,height:400,accepted:false});return {store,j};}
test('resuming a master requires only program checks, never AI review',async t=>{
 const {store,j}=await fixture(t);const worker=new Pipeline(store,{}, {vision:async()=>assert.fail('No review'),generate:async()=>assert.fail('No regeneration')});
 await worker.make(j,'master','unused','3:4',[]);assert.equal(j.assets.master.length,1);assert.equal(store.active(j,'master').accepted,true);assert.equal(store.active(j,'master').qa,undefined);
});

test('previous rejected master is reusable without deleting its old review',async t=>{
 const {store,j}=await fixture(t);const a=store.active(j,'master');a.qa={pass:false,issues:['border'],reason:'Old AI opinion'};
 const worker=new Pipeline(store,{}, {vision:async()=>assert.fail('No review'),generate:async()=>assert.fail('No regeneration')});
 await worker.make(j,'master','unused','3:4',[]);assert.equal(a.accepted,true);assert.equal(a.qa.pass,false);
});

test('explicit retry keeps old request uncertainty and rejects uncertain generation',async t=>{
 const {store,j}=await fixture(t);j.status='uncertain';j.operations=[{id:'old',label:'验收 master',status:'uncertain'}];store.save(j);
 const app=createApp({store,shopify:{configured:()=>true},pipeline:{recover(){},tick(){}}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>app.server.close(r)));
 const base='http://127.0.0.1:'+app.server.address().port,boot=await (await fetch(base+'/api/bootstrap')).json();
 const retry=(action='retry-review')=>fetch(base+'/api/jobs/'+j.id+'/'+action,{method:'POST',headers:{'X-Studio-Token':boot.token,'Content-Type':'application/json'},body:'{}'});
 assert.equal((await retry()).status,200);const next=store.get(j.id);assert.equal(next.status,'queued');assert.equal(next.operations[0].status,'superseded');assert.match(next.operations[0].resolution,/未知/);assert.equal(next.assets.master.length,1);
 next.status='uncertain';next.operations.push({id:'other',label:'生成 master #2',status:'uncertain'});store.save(next);assert.equal((await retry()).status,400);assert.equal((await retry('retry-plan')).status,400);next.operations=[{id:'plan',label:'制定场景方案',status:'uncertain'}];store.save(next);assert.equal((await retry('retry-plan')).status,200);assert.equal(store.get(j.id).assets.master.length,1);
});

test('scene planning preserves resolution, sets budget and records safe request diagnostics',async()=>{
 const bytes=await sharp({create:{width:2100,height:2800,channels:3,background:'#abc'}}).png().toBuffer();let body;const meta={};
 await vision(config,'Design scenes',[bytes],{onMeta:async m=>Object.assign(meta,m),fetcher:async(u,o)=>{body=JSON.parse(o.body);return Response.json({choices:[{message:{content:'{}'}}]});}});
 const image=await sharp(Buffer.from(body.messages[1].content[1].image_url.url.split(',')[1],'base64')).metadata();assert.equal(image.width,2100);assert.equal(image.height,2800);assert.equal(body.max_tokens,8192);assert.equal(body.reasoning_effort,'low');assert.equal(meta.imageCount,1);assert.ok(meta.requestBytes>0);assert.equal(meta.phase,'响应完整');assert.ok(!JSON.stringify(meta).includes('test-secret'));
});

test('lighting plan accepts explicit boolean strings and known envelopes but never invents compatibility',()=>{
 const plan={lightSource:'frontal',shadowDirection:'down',softness:'soft',wallPerspective:'front',sharpness:'matched',adaptation:'diffuse',compatible:true};
 assert.equal(validatePlan({...plan,compatible:' true '}).compatible,true);assert.equal(validatePlan({answer:{...plan,compatible:'false'}}).compatible,false);assert.equal(validatePlan({plan}).compatible,true);
 for(const compatible of [undefined,null,1,'yes','unknown'])assert.throws(()=>validatePlan({...plan,compatible}),/兼容性/);
 assert.throws(()=>validatePlan({answer:{compatible:true}}),/lightSource/);assert.equal(plan.compatible,true);
});
