import {catalogReference,catalogSizes} from './catalog-reference.js';
import {productRatio} from './rules.js';
export const selection=(v,name)=>v.selectedOptions.find(o=>o.name===name)?.value;
// Maximum-cardinality, order-preserving minimum-distance match. Never duplicate an ID.
export function matchSizes(oldLabels,targets){
 const old=[...oldLabels].sort((a,b)=>parseFloat(a)-parseFloat(b));
 const distance=(a,b)=>Math.abs(Math.log(parseFloat(a)/b.cm[0]));
 const memo=new Map();
 function solve(i,j){if(i===old.length||j===targets.length)return {count:0,cost:0,pairs:[]};const key=i+':'+j;if(memo.has(key))return memo.get(key);
  const rest=solve(i+1,j+1),take={count:rest.count+1,cost:rest.cost+distance(old[i],targets[j]),pairs:[[old[i],targets[j]],...rest.pairs]};
  const best=[take,solve(i+1,j),solve(i,j+1)].sort((a,b)=>b.count-a.count||a.cost-b.cost)[0];memo.set(key,best);return best;}
 return new Map(solve(0,0).pairs);
}
export function catalogMigrationPlan(product){
 const ratio=productRatio({...product,options:product.options.map(o=>({...o,values:o.optionValues.map(v=>v.name)}))});
 if(!ratio)throw Error('No unambiguous catalog ratio: '+product.title);
 const targets=catalogSizes(ratio),frames=Object.keys(catalogReference.frames),old=product.variants.nodes;
 const sizeOption=product.options.find(o=>o.name==='Size'),frameOption=product.options.find(o=>o.name==='Frame');
 if(product.options.length!==2||!sizeOption||!frameOption||!targets.length)throw Error('Unexpected options');
 const map=matchSizes(sizeOption.optionValues.map(o=>o.name),targets),draft=/^\[RATIO DRAFT\]/.test(product.title);
 if(!draft&&product.status!=='ACTIVE')throw Error('Unexpected status');
 const retained=new Map(old.filter(v=>map.has(selection(v,'Size'))&&frames.includes(selection(v,'Frame'))).map(v=>[map.get(selection(v,'Size')).label+'|'+selection(v,'Frame'),v]));
 const variants=targets.flatMap(size=>frames.map(frame=>{
  const existing=retained.get(size.label+'|'+frame),source=existing||old.filter(v=>selection(v,'Frame')===frame).sort((a,b)=>Math.abs(parseFloat(selection(a,'Size'))-size.cm[0])-Math.abs(parseFloat(selection(b,'Size'))-size.cm[0]))[0]||old.find(v=>v.inventoryPolicy==='CONTINUE'&&v.inventoryItem.requiresShipping);
  if(!source||(!draft&&(source.inventoryPolicy!=='CONTINUE'||!source.inventoryItem.requiresShipping)))throw Error('Inventory requires review');
  return {...(existing?{id:existing.id}:{}),optionValues:[{optionName:'Size',name:size.label},{optionName:'Frame',name:frame}],price:draft?'0.00':size.prices[frame],...(!existing?{inventoryPolicy:source.inventoryPolicy,taxable:source.taxable,inventoryItem:{tracked:source.inventoryItem.tracked,requiresShipping:source.inventoryItem.requiresShipping,measurement:source.inventoryItem.measurement}}:{})};
 })).map((v,i)=>({...v,position:i+1}));
 const sizeIDs=new Map(sizeOption.optionValues.filter(o=>map.has(o.name)).map(o=>[map.get(o.name).label,o.id]));
 return {id:product.id,title:product.title,ratio,removed:old.filter(v=>!variants.some(n=>n.id===v.id)).map(v=>({id:v.id,size:selection(v,'Size'),frame:selection(v,'Frame'),sku:v.inventoryItem.sku})),input:{productOptions:[{id:sizeOption.id,name:'Size',position:sizeOption.position,values:targets.map(s=>({...(sizeIDs.has(s.label)?{id:sizeIDs.get(s.label)}:{}),name:s.label}))},{id:frameOption.id,name:'Frame',position:frameOption.position,values:frames.map(name=>{const existing=frameOption.optionValues.find(o=>o.name===name);return {...(existing?{id:existing.id}:{}),name};})}],variants}};
}
