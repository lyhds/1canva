import fs from 'node:fs';import path from 'node:path';import {isDeepStrictEqual} from 'node:util';
import {Shopify} from './product-studio/shopify.js';import {retailPrice,salePrice,priceTable,productPriceOffset} from './product-studio/price-table.js';
import {storefrontHost,currencyCode} from './product-studio/store-identity.js';
const args=process.argv.slice(2),apply=args.includes('--apply');const dir=args.find(a=>a.startsWith('--backup='))?.slice(9);
if(!dir||!path.resolve(dir).startsWith(path.resolve('.shopify/backups')+path.sep))throw Error('Provide --backup=.shopify/backups/<directory> with before.json');
const snapshot=JSON.parse(fs.readFileSync(path.join(dir,'before.json')));if(snapshot.shop.currencyCode!==currencyCode()||snapshot.shop.primaryDomain.host!==storefrontHost())throw Error('Wrong store snapshot');
const plan=snapshot.products.filter(p=>!/^\[RATIO DRAFT\]/.test(p.title)).map(p=>({id:p.id,title:p.title,offset:productPriceOffset(p.id),variants:p.variants.nodes.map(v=>{const original=retailPrice(v.selectedOptions.find(o=>o.name==='Size')?.value,v.selectedOptions.find(o=>o.name==='Frame')?.value,p.id);return {id:v.id,price:salePrice(original),compareAtPrice:original};})}));
fs.writeFileSync(path.join(dir,'plan.json'),JSON.stringify({version:priceTable.version,plan},null,2));console.log('Plan:',plan.length,'products,',plan.reduce((n,p)=>n+p.variants.length,0),'variants');if(!apply)process.exit(0);
const s=new Shopify();const shop=(await s.gql('query{shop{primaryDomain{host} currencyCode}}')).shop;if(!isDeepStrictEqual(shop,snapshot.shop))throw Error('Wrong live store');
const fields='id title handle status options{name values} variants(first:250){nodes{id price compareAtPrice selectedOptions{name value} inventoryPolicy inventoryItem{id tracked requiresShipping}}pageInfo{hasNextPage}}';
const read=async id=>(await s.gql(`query($id:ID!){product(id:$id){${fields}}}`,{id})).product;
const logFile=path.join(dir,'applied.json'),log=fs.existsSync(logFile)?JSON.parse(fs.readFileSync(logFile)):[];
for(const p of plan){const before=snapshot.products.find(x=>x.id===p.id),expected=structuredClone(before);for(const v of expected.variants.nodes){const target=p.variants.find(x=>x.id===v.id);v.price=target.price;v.compareAtPrice=target.compareAtPrice;}
 const current=await read(p.id);if(isDeepStrictEqual(current,expected)){if(!log.some(x=>x.id===p.id))log.push({id:p.id,status:'verified'});continue;}
 if(!isDeepStrictEqual(current,before))throw Error('Concurrent or partial change: '+p.id);
 fs.writeFileSync(path.join(dir,'pending.json'),JSON.stringify({id:p.id,expected},null,2));
 await s.gql('mutation($id:ID!,$variants:[ProductVariantsBulkInput!]!){productVariantsBulkUpdate(productId:$id,variants:$variants,allowPartialUpdates:false){productVariants{id price}userErrors{field message}}}',{id:p.id,variants:p.variants});
 const after=await read(p.id);if(!isDeepStrictEqual(after,expected))throw Error('Readback differs: '+p.id);
 fs.writeFileSync(path.join(dir,p.id.split('/').at(-1)+'-after.json'),JSON.stringify(after,null,2));log.push({id:p.id,title:p.title,status:'verified',variants:p.variants.length});fs.writeFileSync(logFile,JSON.stringify(log,null,2));console.log('Verified',p.title);
}
fs.writeFileSync(logFile,JSON.stringify(log,null,2));fs.writeFileSync(path.join(dir,'pending.json'),'null');console.log('All prices verified; unrelated fields preserved');
