import test from 'node:test';import assert from 'node:assert/strict';
import {retailPrice,salePrice,priceTable,productPriceOffset,priceOffsetHalfRange} from './product-studio/price-table.js';
test('retail table covers all rows with positive .99 prices and increasing finish costs',()=>{
 assert.equal(priceTable.currency,'USD');assert.equal(new Set(priceTable.rows.map(r=>r.key)).size,priceTable.rows.length);
 for(const r of priceTable.rows){for(const p of Object.values(r.prices))assert.match(p,/^[1-9]\d*\.99$/);assert.ok(+r.prices.Rolled<+r.prices.Stretched);assert.ok(+r.prices.Stretched<+r.prices.Framed);}
});
test('orientation and size-label formatting do not change retail prices',()=>{
 assert.equal(retailPrice('60 x 80 cm / 23.6 x 31.5 in','Oak Float Frame'),retailPrice('80 × 60 cm','Black Float Frame'));
 assert.equal(retailPrice('100 x 100 cm','Stretched Canvas'),'989.99');
 assert.throws(()=>retailPrice('13 x 17 cm','Rolled Canvas'),/缺少/);
 assert.throws(()=>retailPrice('100 x 100 cm','Unknown'),/缺少/);
});
test('per-product offsets are deterministic whole dollars within the half range',()=>{
 const size='61 x 81 cm / 24 x 32 in',frame='Oak Float Frame',base=Number(retailPrice(size,frame));
 assert.equal(retailPrice(size,frame,'gid://shopify/Product/1'),retailPrice(size,frame,'gid://shopify/Product/1'));
 assert.equal(retailPrice(size,frame,'gid://shopify/Product/1'),(base+productPriceOffset('gid://shopify/Product/1')).toFixed(2));
 const offset=productPriceOffset('gid://shopify/Product/1');
 assert.ok(Number.isInteger(offset)&&Math.abs(offset)<=priceOffsetHalfRange);
 assert.equal(retailPrice(size,frame,null),retailPrice(size,frame));
});
test('same size stays within the maximum spread across sampled product keys',()=>{
 const size='61 x 81 cm / 24 x 32 in',frame='Oak Float Frame',base=Number(retailPrice(size,frame));
 const prices=[];for(let i=0;i<500;i++){const p=Number(retailPrice(size,frame,'gid://shopify/Product/'+i));assert.ok(Math.abs(p-base)<=priceOffsetHalfRange);assert.ok(p>0);prices.push(p);}
 assert.equal(new Set(prices).size,new Set(prices.map(p=>p-base)).size);
 assert.ok(Math.max(...prices)-Math.min(...prices)<=2*priceOffsetHalfRange);
 assert.ok(Math.max(...prices)-Math.min(...prices)>0);
 assert.equal(new Set(prices.map((p,i)=>retailPrice(size,frame,'gid://shopify/Product/'+i)===p.toFixed(2))).size,1);
});
test('sale price is exactly 60 percent of the standing original',()=>{
 assert.equal(salePrice('600.00'),'360.00');
 assert.equal(salePrice('292.00'),'175.20');
 assert.equal(salePrice('67.99'),'40.79');
 assert.equal(salePrice('989.99'),'593.99');
 assert.throws(()=>salePrice('0.00'),/非法/);
});
