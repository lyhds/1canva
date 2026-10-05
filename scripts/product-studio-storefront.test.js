import test from 'node:test';
import assert from 'node:assert/strict';
import {Shopify} from './product-studio/shopify.js';

function withFetch(handler,fn){
 const original=globalThis.fetch;
 globalThis.fetch=handler;
 return fn().finally(()=>{globalThis.fetch=original;});
}

test('marker gate skips publication checks when the domain is no longer Shopify-served',async()=>{
 const shopify=new Shopify();
 await withFetch(async()=>({ok:true,text:async()=>'<html><link href="/wp-content/themes/some-other-site/style.css">other-platform</html>'}),async()=>{
  const note=await shopify.verifyMediaProfile({sceneWorkflow:'baked-frames-v1'});
  assert.match(note,/不指向 Shopify/);
  await assert.doesNotReject(()=>shopify.verifyMediaProfile({sceneWorkflow:'composed-unframed-v1'}));
 });
});

test('marker gate still blocks Shopify-served pages without the required marker',async()=>{
 const shopify=new Shopify();
 const served=async html=>({ok:true,text:async()=>html});
 await withFetch(async()=>served('<html><script src="https://cdn.shopify.com/shop.js"></script></html>'),async()=>{
  await assert.rejects(()=>shopify.verifyMediaProfile({sceneWorkflow:'baked-frames-v1'}),/线上主题仍在叠加画框/);
  await assert.rejects(()=>shopify.verifyMediaProfile({sceneWorkflow:'composed-unframed-v1'}),/等待部署场景换框支持/);
 });
 await withFetch(async()=>served('<html><meta name="ochre-scene-frame-profile" content="baked-frames-v1"><script src="https://cdn.shopify.com/shop.js"></script></html>'),async()=>{
  const note=await shopify.verifyMediaProfile({sceneWorkflow:'baked-frames-v1'});
  assert.equal(note,undefined);
 });
});
