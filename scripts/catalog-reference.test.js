import test from 'node:test';import assert from 'node:assert/strict';
import {catalogReference,catalogSizes} from './product-studio/catalog-reference.js';
import {retailPrice} from './product-studio/price-table.js';
import {productRatio} from './product-studio/rules.js';
import {matchSizes,catalogMigrationPlan} from './product-studio/catalog-migration.js';
test('modal prices retain direct evidence, orientation and exact finish',()=>{
 assert.equal(catalogReference.currency,'USD');
 for(const [ratio,sizes] of Object.entries(catalogReference.profiles))for(const s of sizes){
  assert.equal(productRatio({options:[{name:'Size',values:[s.label]}]}),ratio);
  for(const [frame,price] of Object.entries(s.prices)){const e=s.evidence[frame];assert.equal(e.distribution[price],Math.max(...Object.values(e.distribution)));assert.equal(e.modeCount,e.distribution[price]);assert.ok(e.examples.every(x=>x.price===price));assert.equal(retailPrice(s.label,frame),price);}
 }
 assert.equal(retailPrice(catalogSizes('1:1')[0].label,'Rolled Canvas'),'260.00');
 assert.throws(()=>retailPrice(catalogSizes('1:1')[0].label,'Walnut Float Frame'),/缺少/);
 assert.notEqual(retailPrice(catalogSizes('3:4').at(-1).label,'Rolled Canvas'),retailPrice(catalogSizes('4:3').at(-1).label,'Rolled Canvas'));
});
test('size matching handles reductions without duplicate target IDs',()=>{
 const targets=[{cm:[61,91],label:'a'},{cm:[81,122],label:'b'}];const m=matchSizes(['40 x 60 cm','60 x 90 cm','80 x 120 cm'],targets);
 assert.equal(m.size,2);assert.equal(new Set([...m.values()].map(s=>s.label)).size,2);assert.deepEqual([...m.keys()],['60 x 90 cm','80 x 120 cm']);
});
test('migration preserves source metadata by omission, prices new combinations, and reports retirements',()=>{
 const labels=['40 x 40 cm','60 x 60 cm'],frames=['Oak Float Frame','Walnut Float Frame'];
 const variants=labels.flatMap((size,i)=>frames.map((frame,j)=>({id:`v${i}${j}`,selectedOptions:[{name:'Size',value:size},{name:'Frame',value:frame}],inventoryPolicy:'CONTINUE',taxable:true,inventoryItem:{sku:'sku'+i+j,tracked:true,requiresShipping:true,measurement:{weight:{unit:'KILOGRAMS',value:0}}}})));
 const p={id:'p',title:'Test',status:'ACTIVE',options:[{id:'s',name:'Size',position:1,optionValues:labels.map((name,i)=>({id:'s'+i,name}))},{id:'f',name:'Frame',position:2,optionValues:frames.map((name,i)=>({id:'f'+i,name}))}],variants:{nodes:variants}};
 const plan=catalogMigrationPlan(p);assert.equal(plan.input.variants.length,70);assert.equal(plan.removed.length,2);assert.ok(plan.removed.every(v=>v.frame==='Walnut Float Frame'));assert.equal(plan.input.variants.filter(v=>v.id).length,2);
 assert.ok(plan.input.variants.filter(v=>v.id).every(v=>!('inventoryItem' in v)));assert.ok(plan.input.variants.every(v=>Number(v.price)>0));
 const draft=catalogMigrationPlan({...p,title:'[RATIO DRAFT] Test',status:'DRAFT'});assert.ok(draft.input.variants.every(v=>v.price==='0.00'));
});
