import fs from 'node:fs';import path from 'node:path';
import {Shopify} from './product-studio/shopify.js';
import {storefrontHost,currencyCode} from './product-studio/store-identity.js';
const dir=process.argv[2];
if(!dir||!path.resolve(dir).startsWith(path.resolve('.shopify/backups')+path.sep))throw Error('Usage: node scripts/snapshot-retail-prices.js .shopify/backups/<directory>');
const s=new Shopify();
const shop=(await s.gql('query{shop{primaryDomain{host} currencyCode}}')).shop;
if(shop.primaryDomain.host!==storefrontHost()||shop.currencyCode!==currencyCode())throw Error('Wrong store');
const fields='id title handle status options{name values} variants(first:250){nodes{id price compareAtPrice selectedOptions{name value} inventoryPolicy inventoryItem{id tracked requiresShipping}}pageInfo{hasNextPage}}';
const products=[];let after=null;
for(;;){
  const d=await s.gql(`query($after:String){products(first:50,after:$after){nodes{${fields}}pageInfo{hasNextPage endCursor}}}`,{after});
  if(d.products.nodes.some(p=>p.variants.pageInfo.hasNextPage))throw Error('A product has more than 250 variants; manual handling required');
  products.push(...d.products.nodes);
  if(!d.products.pageInfo.hasNextPage)break;
  after=d.products.pageInfo.endCursor;
  if(!after||products.length>5000)throw Error('Pagination failed');
}
fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,'before.json'),JSON.stringify({shop,capturedAt:new Date().toISOString(),products},null,2));
const drafts=products.filter(p=>/^\[RATIO DRAFT\]/.test(p.title)).length;
console.log('Snapshot:',products.length,'products ('+drafts+' ratio drafts excluded from repricing) ->',path.join(dir,'before.json'));
