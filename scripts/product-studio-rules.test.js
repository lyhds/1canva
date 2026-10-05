import test from 'node:test';
import assert from 'node:assert/strict';
import {productRatio, resolveStoreRules, validatePricing} from './product-studio/rules.js';
import {salePrice,productPriceOffset,priceOffsetHalfRange} from './product-studio/price-table.js';
import {Shopify} from './product-studio/shopify.js';
import {storefrontHost} from './product-studio/store-identity.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store, atomic} from './product-studio/store.js';
import {Pipeline} from './product-studio/pipeline.js';
import {createApp} from './product-studio/server.js';

function fixture() {
  const options = [{name:'Size',values:['30 x 40 cm / 11.8 x 15.7 in','150 x 200 cm / 59.1 x 78.7 in']},{name:'Frame',values:['Rolled Canvas','Oak Float Frame']}];
  const variant = (size,frame,i) => ({id:'v'+i,price:'105.00',availableForSale:true,selectedOptions:[{name:'Size',value:size},{name:'Frame',value:frame}],inventoryPolicy:'CONTINUE',inventoryItem:{tracked:false,requiresShipping:true}});
  const template = {id:'t',title:'[RATIO DRAFT] Test — 3:4 Portrait',status:'DRAFT',options,variants:{nodes:[variant(options[0].values[0],'Rolled Canvas',1),variant(options[0].values[0],'Oak Float Frame',2),variant(options[0].values[1],'Rolled Canvas',3)],pageInfo:{hasNextPage:false}}};
  template.variants.nodes.forEach(v => v.price = '0.00');
  const reference = structuredClone(template);Object.assign(reference,{id:'a',title:'Active artwork',status:'ACTIVE'});reference.variants.nodes.forEach(v => {v.id='a'+v.id;v.price='105.00';});
  const products = new Map([['t',template],['a',reference]]);
  const catalog = {shop:{primaryDomain:{host:storefrontHost()},currencyCode:'USD'},templates:{nodes:[template],pageInfo:{hasNextPage:false}},references:{nodes:[reference],pageInfo:{hasNextPage:false}}};
  const shop = {pricingProduct:async id => products.get(id)};
  return {template,reference,products,catalog,shop,resolve:profiles=>resolveStoreRules(shop,catalog,profiles,['3:4'])};
}

test('automatic rules use matching live nonzero prices, preserve rolled-only combinations and compare equivalent references',async()=>{
  const f=fixture(),second=structuredClone(f.reference);second.id='b';second.variants.nodes.reverse().forEach(v=>{v.id='b'+v.id;v.price='105';v.selectedOptions.reverse();});f.products.set('b',second);f.catalog.references.nodes.unshift(second);
  const rules=await f.resolve();assert.equal(rules.rows[0].status,'ready');assert.equal(rules.rows[0].sourceCount,2);assert.equal(rules.profiles['3:4'].referenceId,'a');
  const all=validatePricing(f.template,f.reference,'all');assert.equal(all.variants.length,3);assert.ok(all.variants.every(v=>Number(v.price)>0));
  const framed=validatePricing(f.template,f.reference,'framed-only');assert.equal(framed.variants.length,1);assert.equal(framed.variants[0].frame,'Oak Float Frame');
});

test('reference price differences do not override the project price table',async()=>{
  const f=fixture(),other=structuredClone(f.reference);other.id='b';other.variants.nodes[0].price='999';f.products.set('b',other);f.catalog.references.nodes.push(other);
  const conflict=await f.resolve();assert.equal(conflict.rows[0].status,'ready');
  assert.equal(validatePricing(f.template,other).variants[0].compareAtPrice,'69.99');
  assert.equal(validatePricing(f.template,other).variants[0].price,'41.99');
  const saved=await f.resolve({'3:4':{templateId:'t',referenceId:'a'}});assert.equal(saved.rows[0].status,'ready');assert.equal(saved.rows[0].source,'saved');
});

test('zero, invalid, sold-out, incomplete and stock-limited references never become automatic rules',async()=>{
  for(const change of [r=>r.variants.nodes[0].price='0',r=>r.variants.nodes[0].price='invalid',r=>r.variants.nodes[0].availableForSale=false,r=>r.variants.nodes.pop(),r=>{r.variants.nodes[0].inventoryPolicy='DENY';r.variants.nodes[0].inventoryItem.tracked=true;},r=>r.variants.pageInfo.hasNextPage=true]) {
    const f=fixture();change(f.reference);const result=await f.resolve();assert.equal(result.rows[0].status,'error');assert.deepEqual(result.profiles,{});
  }
});

test('studio pricing publishes the 60% selling price and the offset original as compare-at',()=>{
  const f=fixture();
  const key='gid://shopify/Product/1';
  const plan=validatePricing(f.template,f.reference,'all',key);
  const expected=(69.99+productPriceOffset(key)).toFixed(2);
  assert.equal(plan.variants[0].compareAtPrice,expected);
  assert.equal(plan.variants[0].price,salePrice(expected));
  for(const v of plan.variants){
    assert.ok(Number(v.compareAtPrice)>Number(v.price),'compare-at must exceed the selling price');
    assert.equal(v.price,salePrice(v.compareAtPrice));
  }
  // The same key always yields the same prices; the offset stays in its documented band.
  assert.deepEqual(plan,validatePricing(f.template,f.reference,'all',key));
  const base=Number(validatePricing(f.template,f.reference,'all').variants[0].compareAtPrice);
  assert.equal(base,69.99);
  assert.ok(Math.abs(Number(plan.variants[0].compareAtPrice)-base)<=priceOffsetHalfRange);
});

test('missing, ambiguous and mislabeled draft ratios fail without guessing',async()=>{
  const missing=fixture();missing.catalog.templates.nodes=[];assert.equal((await missing.resolve()).rows[0].status,'error');
  const duplicate=fixture();duplicate.catalog.templates.nodes.push({...duplicate.template,id:'t2'});assert.match((await duplicate.resolve()).rows[0].error,/多个/);
  const wrong=fixture();wrong.template.options[0].values=['40 x 30 cm'];assert.equal(productRatio(wrong.template),'4:3');assert.equal((await wrong.resolve()).rows[0].status,'error');
});

test('incomplete catalog and failed reference reads cannot falsely report price agreement',async()=>{
  const f=fixture();f.catalog.references.pageInfo.hasNextPage=true;await assert.rejects(f.resolve,/读取完整/);f.catalog.references.pageInfo.hasNextPage=false;
  f.shop.pricingProduct=async id=>{if(id==='a')throw Error('network failure');return f.template;};await assert.rejects(f.resolve,/network failure/);
});

test('catalog scans subsequent draft and active pages before discovery',async()=>{
  const shop=new Shopify(),calls=[];shop.gql=async(q,v)=>{
    if(!v)return {shop:{primaryDomain:{host:storefrontHost()},currencyCode:'USD'}};
    calls.push(v);return {products:{nodes:[{id:v.q+(v.after?'2':'1')}],pageInfo:{hasNextPage:!v.after,endCursor:v.after?'end':'next'}}};
  };
  const c=await shop.catalog();assert.equal(c.templates.nodes.length,2);assert.equal(c.references.nodes.length,2);assert.equal(calls.length,4);assert.equal(c.references.pageInfo.hasNextPage,false);
});

test('task needs no saved profiles and resumes using its pinned live pricing source',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'canvasra-auto-rules-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=new Store(dir),settings=store.settings();settings.vision=settings.image={endpoint:'https://example.com/api',model:'test',apiKey:'test-secret'};atomic(path.join(dir,'settings.json'),settings);
  const j=store.create({delivery:'framed-only'});j.analysis={ratio:'3:4',texture:false,masterPrompt:'test'};store.addAsset(j,'reference',Buffer.from('fixture'),{});
  const f=fixture();let resolutions=0;
  const shop={catalog:async()=>f.catalog,rules:async(...args)=>{resolutions++;return resolveStoreRules(f.shop,...args);},pricing:async profile=>{assert.equal(profile.templateId,'t');assert.equal(profile.referenceId,'a');return validatePricing(f.template,f.reference,j.delivery);}};
  const pipeline=new Pipeline(store,shop);pipeline.make=async()=>{assert.equal(j.pricing.variants.length,1);throw Error('test checkpoint before generation');};
  await assert.rejects(()=>pipeline.run(j),/test checkpoint before generation/);assert.equal(j.config.profiles['3:4'].referenceId,'a');assert.ok(fs.existsSync(store.file(j.id,'store-rules.json')));assert.deepEqual(store.settings().profiles,{});
  j.config=store.settings();await assert.rejects(()=>pipeline.run(j),/test checkpoint before generation/);assert.equal(j.config.profiles['3:4'].referenceId,'a');assert.equal(resolutions,1);
});

test('catalog API returns resolved rules without saving settings or calling models',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'canvasra-rules-api-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=new Store(dir),f=fixture();const shop={catalog:async()=>f.catalog,rules:async c=>resolveStoreRules(f.shop,c,{},['3:4'])};
  const app=createApp({store,shopify:shop,pipeline:{recover(){},tick(){}}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>app.server.close(r)));
  const response=await fetch('http://127.0.0.1:'+app.server.address().port+'/api/catalog');assert.equal(response.status,200);const data=await response.json();assert.equal(data.rules.rows[0].status,'ready');assert.deepEqual(store.settings().profiles,{});
});
