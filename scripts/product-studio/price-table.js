import fs from 'node:fs';
import {catalogReference,catalogSize} from './catalog-reference.js';
const legacyTable=JSON.parse(fs.readFileSync(new URL('../../data/pricing/retail-usd.json',import.meta.url),'utf8'));
export const priceTable={...legacyTable,version:catalogReference.version,catalog:catalogReference};
export const priceOffsetHalfRange=15;
// Storewide sale policy (owner-confirmed 2026-09-10): the offset table price
// is the standing original (compareAtPrice); the selling price is exactly 60%.
export const saleRate=0.6;
export function salePrice(original){
  const v=Number(original)*saleRate;
  if(!(v>0))throw Error('折扣价非法：'+original);
  return v.toFixed(2);
}
// Deterministic per-product offset: the same product always maps to the same
// whole-dollar shift, two products of one size differ by at most 2*halfRange.
export function productPriceOffset(key){
  const s=String(key??'');let h=2166136261;
  for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}
  return (h%(2*priceOffsetHalfRange+1))-priceOffsetHalfRange;
}
function basePrice(size,frame){
  const current=catalogSize(size);
  if(current){const price=current.prices[frame];if(!price||!/^\d+\.\d{2}$/.test(price)||Number(price)<=0)throw Error('统一价格表缺少尺寸或装裱：'+size+' / '+frame);return price;}
  const m=String(size).match(/^\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*cm\b/i);
  if(!m)throw Error('价格表无法识别尺寸：'+size);
  const key=m.slice(1).map(Number).sort((a,b)=>a-b).join('x');
  const type=frame==='Rolled Canvas'?'Rolled':frame==='Stretched Canvas'?'Stretched':/^(Oak|Black|Walnut|White|Gold|Silver) Float Frame$/.test(frame)?'Framed':null;
  const price=priceTable.rows.find(r=>r.key===key)?.prices[type];
  if(!price||!/^\d+\.99$/.test(price)||Number(price)<=0)throw Error('统一价格表缺少尺寸或装裱：'+size+' / '+frame);
  return price;
}
export function retailPrice(size,frame,key){
  const base=basePrice(size,frame);
  if(key===undefined||key===null)return base;
  const value=Number(base)+productPriceOffset(key);
  if(!(value>0))throw Error('偏移后价格非法：'+size+' / '+frame+' / '+key);
  return value.toFixed(2);
}
