import {squareSizes} from './square-sizes.js';
import {retailPrice} from './price-table.js';
export const selection=(v,name)=>v.selectedOptions.find(o=>o.name===name)?.value;
// Ordered one-to-one mapping retains IDs without assigning two old sizes to one new size.
export function nearestSizeMap(oldLabels,targets){
 const old=[...oldLabels].sort((a,b)=>parseFloat(a)-parseFloat(b));
 if(old.length>targets.length)throw Error('Cannot retain all old size IDs');
 let best,cost=Infinity;
 function visit(i,start,picked,total){if(i===old.length){if(total<cost){cost=total;best=[...picked];}return;}for(let k=start;k<=targets.length-(old.length-i);k++)visit(i+1,k+1,[...picked,targets[k]],total+Math.abs(parseFloat(old[i])-targets[k].cm));}
 visit(0,0,[],0);return new Map(old.map((label,i)=>[label,best[i]]));
}
export function squareMigrationPlan(product,largest){
 if(!['all','rolled-only'].includes(largest))throw Error('Explicit confirmed 183 cm delivery required');
 const sizeOption=product.options.find(o=>o.name==='Size'),frameOption=product.options.find(o=>o.name==='Frame');
 if(product.options.length!==2||!sizeOption||!frameOption)throw Error('Unexpected product options');
 const frames=frameOption.optionValues.map(o=>o.name),old=product.variants.nodes;
 const targets=largest==='all'?squareSizes:squareSizes.slice(0,-1);
 const map=nearestSizeMap(sizeOption.optionValues.map(o=>o.name),targets);
 const isTemplate=/^\[RATIO DRAFT\]/.test(product.title);
 const retained=new Map(old.map(v=>[map.get(selection(v,'Size')).label+'|'+selection(v,'Frame'),v]));
 const variants=[],changes=[];
 for(const size of squareSizes)for(const frame of frames){
  if(size.cm===183&&largest==='rolled-only'&&frame!=='Rolled Canvas')continue;
  const existing=retained.get(size.label+'|'+frame);
  const source=existing||old.filter(v=>selection(v,'Frame')===frame).sort((a,b)=>Math.abs(parseFloat(selection(a,'Size'))-size.cm)-Math.abs(parseFloat(selection(b,'Size'))-size.cm))[0];
  if(!source)throw Error('Missing frame source');
  if(!isTemplate&&(source.inventoryPolicy!=='CONTINUE'||!source.inventoryItem.requiresShipping))throw Error('Inventory requires manual handling');
  const v={...(existing?{id:existing.id}:{}),optionValues:[{optionName:'Size',name:size.label},{optionName:'Frame',name:frame}],position:variants.length+1,price:isTemplate?'0.00':retailPrice(size.label,frame,product.id)};
  if(!existing)Object.assign(v,{inventoryPolicy:source.inventoryPolicy,taxable:source.taxable,inventoryItem:{tracked:source.inventoryItem.tracked,requiresShipping:source.inventoryItem.requiresShipping,measurement:source.inventoryItem.measurement}});
  variants.push(v);changes.push({id:existing?.id||null,oldSize:existing?selection(existing,'Size'):null,newSize:size.label,frame,price:v.price});
 }
 if(old.some(v=>!variants.some(n=>n.id===v.id)))throw Error('Would delete an existing variant');
 const usedSizes=[...new Set(variants.map(v=>v.optionValues[0].name))];
 const oldSizeIDs=new Map(sizeOption.optionValues.map(o=>[map.get(o.name).label,o.id]));
 return {id:product.id,title:product.title,changes,input:{productOptions:[{id:sizeOption.id,name:'Size',position:sizeOption.position,values:usedSizes.map(name=>({...(oldSizeIDs.has(name)?{id:oldSizeIDs.get(name)}:{}),name}))},{id:frameOption.id,name:'Frame',position:frameOption.position,values:frameOption.optionValues.map(({id,name})=>({id,name}))}],variants}};
}
