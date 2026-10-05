import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {replaceAtomic} from './product-studio/store.js';
import {external} from './product-studio/providers.js';
for(const code of ['EPERM','EACCES','EBUSY'])test('atomic replace recovers from '+code, t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'studio-atomic-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'job.json'),tmp=file+'.tmp';fs.writeFileSync(file,'old');fs.writeFileSync(tmp,'new');let calls=0;const delays=[];
 replaceAtomic(tmp,file,{rename:(a,b)=>{if(++calls<3){assert.equal(fs.readFileSync(file,'utf8'),'old');throw Object.assign(Error('locked'),{code});}fs.renameSync(a,b);},wait:ms=>delays.push(ms)});
 assert.equal(fs.readFileSync(file,'utf8'),'new');assert.equal(fs.existsSync(tmp),false);assert.deepEqual(delays,[25,50]);
});
test('persistent lock preserves both files and unrelated errors do not retry',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'studio-atomic-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'job.json'),tmp=file+'.tmp';fs.writeFileSync(file,'old');fs.writeFileSync(tmp,'new');
 for(const code of ['EPERM','ENOSPC']){let calls=0;assert.throws(()=>replaceAtomic(tmp,file,{rename:()=>{calls++;throw Object.assign(Error('write failed'),{code});},wait:()=>{}}),{code});assert.equal(calls,code==='EPERM'?6:1);assert.equal(fs.readFileSync(file,'utf8'),'old');assert.equal(fs.readFileSync(tmp,'utf8'),'new');}
});
test('failed pre-request save never calls provider or leaves pending operation',async()=>{
 const j={operations:[]};const e=Object.assign(Error('locked'),{code:'EPERM'});await assert.rejects(()=>external({save:()=>{throw e;}},j,'analysis',()=>assert.fail('must not send')),e);assert.equal(j.operations[0].status,'cancelled');assert.equal(j.operations[0].requestNotSent,true);
});
test('successful request remains complete when saving its receipt fails',async()=>{
 const j={operations:[]};let saves=0,calls=0;await assert.rejects(()=>external({save:()=>{if(++saves===2)throw Error('locked');}},j,'analysis',async()=>{calls++;return 1;}),/locked/);assert.equal(calls,1);assert.equal(saves,2);assert.equal(j.operations[0].status,'complete');
});
