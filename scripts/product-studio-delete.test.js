import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from './product-studio/store.js';
import {Pipeline} from './product-studio/pipeline.js';
import {createApp} from './product-studio/server.js';

async function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'studio-delete-')),store=new Store(root);
 const shopify=new Proxy({configured:()=>false},{get:(target,key)=>key in target?target[key]:()=>assert.fail('Deletion must not call Shopify: '+String(key))});
 const app=createApp({store,shopify,pipeline:{recover(){},tick(){}}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await new Promise(resolve=>app.server.close(resolve));fs.rmSync(root,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+app.server.address().port;
 const {token}=await(await fetch(base+'/api/bootstrap')).json();
 const post=(id,action)=>fetch(`${base}/api/jobs/${id}/${action}`,{method:'POST',headers:{'X-Studio-Token':token,'Content-Type':'application/json'},body:'{}'});
 return {store,shopify,base,token,post};
}

test('one deletion hides every idle task type, preserving files, external results and Shopify IDs',async t=>{
 const {store,base,post}=await fixture(t);
 const keeper=store.create({title:'Keep this task'});
 for(const status of ['new','queued','paused','failed','uncertain','scenes-ready','draft','awaiting-theme','published']){
  const job=store.create({title:status});job.status=status;job.productId='saved-product-'+status;
  job.operations=[{id:'request-1',status:'uncertain',label:'生成 scene-1',resultFile:'provider-result.json'}];
  const original=Buffer.from('original artwork and all saved versions');
  const a=store.addAsset(job,'master',original,{width:100,height:100,accepted:true});
  fs.writeFileSync(store.file(job.id,'provider-result.json'),'saved external receipt');
  assert.equal((await post(job.id,'delete')).status,200);
  const saved=store.get(job.id);
  assert.ok(saved.deletedAt);assert.equal(saved.status,status);assert.equal(saved.productId,job.productId);
  assert.deepEqual(saved.operations,job.operations);assert.deepEqual(saved.assets,job.assets);
  assert.deepEqual(fs.readFileSync(store.file(job.id,a.file)),original);
  assert.equal(fs.readFileSync(store.file(job.id,'provider-result.json'),'utf8'),'saved external receipt');
  for(const action of ['run','pause','retry','publish','confirm-redo','resolve','reconcile']){
   const response=await post(job.id,action);assert.equal(response.status,400,action);
   assert.match((await response.json()).error,/任务已删除/);
  }
  // Repeated clicks are harmless and leave the original deletion timestamp/event.
  assert.equal((await post(job.id,'delete')).status,200);
  assert.deepEqual(store.get(job.id),saved);
 }
 assert.deepEqual((await(await fetch(base+'/api/jobs')).json()).map(j=>j.id),[keeper.id]);
 assert.deepEqual((await(await fetch(base+'/api/bootstrap')).json()).jobs.map(j=>j.id),[keeper.id]);
 const reopened=new Store(store.dir);
 assert.deepEqual(reopened.list().map(j=>j.id),[keeper.id]);
 assert.equal(reopened.list({includeDeleted:true}).length,10);
});

test('running tasks cannot be deleted based on a stale queued snapshot',async t=>{
 const {store,post}=await fixture(t);const job=store.create({});job.status='running';store.save(job);
 const before=fs.readFileSync(store.file(job.id,'job.json'));
 const response=await post(job.id,'delete');assert.equal(response.status,400);
 assert.match((await response.json()).error,/先暂停/);
 assert.deepEqual(fs.readFileSync(store.file(job.id,'job.json')),before);
 // Store.delete always re-reads the record rather than trusting a prior UI snapshot.
 const stale=store.get(job.id);stale.status='queued';
 assert.throws(()=>store.delete(stale.id),/先暂停/);
 job.status='paused';store.save(job);
 assert.equal((await post(job.id,'delete')).status,200);
});

test('deleted queued jobs stay out of the scheduler after restart and cannot run directly',async t=>{
 const {store,shopify,post}=await fixture(t);const job=store.create({});job.status='queued';store.save(job);
 await post(job.id,'delete');
 const worker=new Pipeline(new Store(store.dir),shopify,{vision:async()=>assert.fail('No analysis'),generate:async()=>assert.fail('No generation')});
 worker.recover();await worker.tick();
 assert.equal(store.get(job.id).status,'queued');
 await assert.rejects(()=>worker.run(store.get(job.id)),/任务已删除/);
 const next=store.create({});next.status='queued';store.save(next);
 const executed=[];worker.run=async j=>executed.push(j.id);await worker.tick();
 assert.deepEqual(executed,[next.id]);
});

test('deletion requires the token and POST and rejects unknown task IDs',async t=>{
 const {store,base,token,post}=await fixture(t);const job=store.create({});
 const url=`${base}/api/jobs/${job.id}/delete`;
 assert.equal((await fetch(url,{method:'POST',body:'{}'})).status,403);
 assert.equal((await fetch(url,{method:'DELETE',headers:{'X-Studio-Token':token}})).status,405);
 assert.equal((await fetch(url)).status,200);assert.equal(store.get(job.id).deletedAt,undefined);
 assert.equal((await post('missing','delete')).status,400);
});
