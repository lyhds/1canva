// Store-specific, backup-first catalog migration. Plan is default; never changes theme files.
// Pass --exclude=gid://shopify/Product/<id> to leave one product out of the run.
import fs from 'node:fs';import path from 'node:path';import {isDeepStrictEqual} from 'node:util';
import {Shopify} from './product-studio/shopify.js';
import {catalogMigrationPlan,selection} from './product-studio/catalog-migration.js';
const args=process.argv.slice(2),dir=args.find(a=>a.startsWith('--backup='))?.slice(9),apply=args.includes('--apply'),exclude=args.find(a=>a.startsWith('--exclude='))?.slice(10);
if(!dir||!path.resolve(dir).startsWith(path.resolve('.shopify/backups')+path.sep))throw Error('Provide --backup=.shopify/backups/<directory>');
const snapshot=JSON.parse(fs.readFileSync(path.join(dir,'before.json'))),plans=snapshot.products.filter(p=>!exclude||p.id!==exclude).map(p=>catalogMigrationPlan(p));
fs.writeFileSync(path.join(dir,'plan.json'),JSON.stringify({plans},null,2));
console.log('Plan:',plans.length,'products;',plans.reduce((n,p)=>n+p.input.variants.length,0),'variants;',plans.reduce((n,p)=>n+p.removed.length,0),'retired combinations');
if(!apply&&!args.includes('--preflight'))process.exit(0);
const api=new Shopify();const shop=(await api.gql('query{shop{primaryDomain{host}currencyCode}}')).shop;if(!isDeepStrictEqual(shop,snapshot.shop))throw Error('Wrong store');
const inventoryFile=path.join(dir,'retired-inventory.json');
if(!fs.existsSync(inventoryFile)){
 const records=[];
 for(const plan of plans){const ids=plan.removed.map(v=>v.id);if(!ids.length)continue;
  const data=await api.gql('query($ids:[ID!]!){nodes(ids:$ids){... on ProductVariant{id inventoryQuantity sellableOnlineQuantity}}}',{ids});
  for(const variant of data.nodes){if(!variant||variant.inventoryQuantity!==0||variant.sellableOnlineQuantity!==0)throw Error('Retiring variant has nonzero or unknown available stock: '+variant?.id);records.push(variant);}
 }
 fs.writeFileSync(inventoryFile,JSON.stringify(records,null,2));
}
if(!apply){console.log('Inventory backup and preflight complete; no writes.');process.exit(0);}
const query='query($id:ID!){product(id:$id){id title handle status descriptionHtml tags vendor productType options{id name position optionValues{id name}} variants(first:250){nodes{id title price compareAtPrice barcode taxable position selectedOptions{name value} inventoryPolicy inventoryItem{id sku tracked requiresShipping measurement{weight{unit value}}} media(first:10){nodes{id}}}pageInfo{hasNextPage}} media(first:100){nodes{id alt status}pageInfo{hasNextPage}} collections(first:100){nodes{id}pageInfo{hasNextPage}} resourcePublications(first:100){nodes{publication{id name}isPublished}pageInfo{hasNextPage}}metafields(first:100){nodes{id namespace key type value}pageInfo{hasNextPage}}}}';
const read=async id=>(await api.gql(query,{id})).product;
function verify(before,after,plan){
 for(const k of ['variants','media','collections','resourcePublications','metafields'])if(after[k].pageInfo.hasNextPage)throw Error('Incomplete readback');
 const rest=p=>{const {variants,options,...x}=p;return x;};
 if(!isDeepStrictEqual(rest(before),rest(after)))throw Error('Unrelated product fields changed: '+before.id);
 if(after.variants.nodes.length!==plan.input.variants.length)throw Error('Variant count mismatch');
 for(const opt of plan.input.productOptions){const found=after.options.find(o=>o.id===opt.id);if(!found||!isDeepStrictEqual(found.optionValues.map(x=>x.name),opt.values.map(x=>x.name)))throw Error('Options or order mismatch');}
 for(const intended of plan.input.variants){const found=after.variants.nodes.find(v=>intended.optionValues.every(o=>selection(v,o.optionName)===o.name));if(!found||found.price!==intended.price||found.position!==intended.position||(intended.id&&found.id!==intended.id))throw Error('Variant readback mismatch');
  if(intended.id){const old=before.variants.nodes.find(v=>v.id===intended.id);for(const key of ['compareAtPrice','barcode','taxable','inventoryPolicy','inventoryItem','media'])if(!isDeepStrictEqual(old[key],found[key]))throw Error('Unrelated variant field changed: '+key);}
  else if(found.inventoryPolicy!==intended.inventoryPolicy||found.inventoryItem.tracked!==intended.inventoryItem.tracked||found.inventoryItem.requiresShipping!==intended.inventoryItem.requiresShipping)throw Error('New variant inventory mismatch');
 }
}
const logFile=path.join(dir,'applied.json'),log=fs.existsSync(logFile)?JSON.parse(fs.readFileSync(logFile)):[];
// Resume only after a full readback matches; never blindly repeat uncertain writes.
for(const plan of plans){
 const before=snapshot.products.find(p=>p.id===plan.id),current=await read(plan.id);
 if(log.some(p=>p.id===plan.id)){verify(before,current,plan);continue;}
 if(!isDeepStrictEqual(current,before)){verify(before,current,plan);log.push({id:plan.id,verified:true,reconciled:true});fs.writeFileSync(logFile,JSON.stringify(log,null,2));continue;}
 if(plan.removed.length){const data=await api.gql('query($ids:[ID!]!){nodes(ids:$ids){... on ProductVariant{id inventoryQuantity sellableOnlineQuantity}}}',{ids:plan.removed.map(v=>v.id)});if(data.nodes.some(v=>!v||v.inventoryQuantity!==0||v.sellableOnlineQuantity!==0))throw Error('Available inventory changed; stopped before write');}
 fs.writeFileSync(path.join(dir,'pending.json'),JSON.stringify({id:plan.id,at:new Date().toISOString(),input:plan.input},null,2));
 await api.gql('mutation($id:ProductSetIdentifiers!,$input:ProductSetInput!){productSet(identifier:$id,input:$input,synchronous:true){product{id}userErrors{field message}}}',{id:{id:plan.id},input:plan.input});
 const after=await read(plan.id);fs.writeFileSync(path.join(dir,plan.id.split('/').at(-1)+'-after.json'),JSON.stringify(after,null,2));verify(before,after,plan);
 log.push({id:plan.id,title:plan.title,variants:after.variants.nodes.length,verified:true});fs.writeFileSync(logFile,JSON.stringify(log,null,2));fs.writeFileSync(path.join(dir,'pending.json'),'null');console.log('Verified:',plan.title);
}
console.log('All records verified; planned variant IDs, media, content and publication verified.');
