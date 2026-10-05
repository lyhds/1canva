import test from 'node:test';import assert from 'node:assert/strict';
import {nearestSizeMap,squareMigrationPlan} from './product-studio/square-migration.js';
import {squareSizes} from './product-studio/square-sizes.js';
import {retailPrice} from './product-studio/price-table.js';
test('square ladder matches the ten merchant-provided nominal inch/cm pairs',()=>{
 assert.deepEqual(squareSizes.map(s=>s.cm),[61,76,81,91,102,112,122,140,153,183]);
 assert.deepEqual(squareSizes.map(s=>s.inches),[24,30,32,36,40,44,48,55,60,72]);
 for(const size of squareSizes)assert.ok(+retailPrice(size.label,'Oak Float Frame')>0);
});
test('old square sizes retain a unique ordered mapping including the largest size',()=>{
 const map=nearestSizeMap([40,60,80,100,120,150,180].map(s=>`${s} x ${s} cm`),squareSizes);
 assert.equal(map.get('180 x 180 cm').cm,183);assert.equal(new Set([...map.values()].map(s=>s.cm)).size,7);
});
const fixture=()=>({id:'p',title:'Square painting',options:[{id:'size',name:'Size',position:1,optionValues:[{id:'old-size',name:'180 x 180 cm'}]},{id:'frame',name:'Frame',position:2,optionValues:[{id:'oak',name:'Oak Float Frame'}]}],variants:{nodes:[{id:'v',price:'100.00',selectedOptions:[{name:'Size',value:'180 x 180 cm'},{name:'Frame',value:'Oak Float Frame'}],inventoryPolicy:'CONTINUE',taxable:true,inventoryItem:{tracked:true,requiresShipping:true,measurement:{weight:{unit:'KILOGRAMS',value:0}}}}]}});
test('plan preserves variants and original delivery restrictions without publishing or copying stock',()=>{
 const p=fixture(),plan=squareMigrationPlan(p,'all');assert.equal(plan.input.variants.length,10);assert.equal(plan.input.variants.at(-1).id,'v');assert.equal(plan.input.status,undefined);assert.ok(plan.input.variants.every(v=>!('inventoryQuantities' in v)));assert.ok(plan.changes.every(c=>c.frame==='Oak Float Frame'));
 const limited=squareMigrationPlan(p,'rolled-only');assert.equal(limited.input.variants.length,9);assert.ok(limited.input.variants.some(v=>v.id==='v'));
 p.title='[RATIO DRAFT] Square';assert.ok(squareMigrationPlan(p,'all').input.variants.every(v=>v.price==='0.00'));
 assert.throws(()=>squareMigrationPlan(p),/confirmed/);
});
