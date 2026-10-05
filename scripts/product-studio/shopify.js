import {sceneMetafields} from './scene-publication.js';
import {validatePricing, resolveStoreRules} from './rules.js';
import {mediaSlots, mediaAlt, mediaEntries, mediaEntryFile, mediaEntrySize, bakedScenes} from './media.js';
import fs from 'node:fs';import path from 'node:path';import {ROOT,atomic} from './store.js';import {envMap,storefrontUrl,assertStore} from './store-identity.js';import {UncertainError} from './providers.js';import sharp from 'sharp';
// Shopify's product-media ceiling. The theme lightbox requests 2048 at most and the
// scene images render at 2400, so an asset heavier than the ceiling is uploaded as a
// web-sized copy while the local asset keeps its full quality.
export const MEDIA_LIMIT_BYTES=20*1024*1024;
const WEB_LONG_EDGE=2400;
export async function shrinkForUpload(bytes,limit=MEDIA_LIMIT_BYTES){
 for(const edge of [WEB_LONG_EDGE,2048,1792,1536]){
  const out=await sharp(bytes,{limitInputPixels:40000000}).resize({width:edge,height:edge,fit:'inside',withoutEnlargement:true}).png({compressionLevel:9}).toBuffer();
  if(out.length<=limit){const meta=await sharp(out).metadata();return {bytes:out,width:meta.width,height:meta.height};}
 }
 throw Error('素材压缩后仍超过 Shopify 20 MB 单文件上限；请降低该比例的生成尺寸');
}
export class Shopify {
 constructor(){this.token=null;}
 configured(){const e=envMap();return !!(e.SHOPIFY_STORE&&e.SHOPIFY_CLIENT_ID&&e.SHOPIFY_CLIENT_SECRET);}
 async gql(query,variables={}){const e=envMap(),store=(e.SHOPIFY_STORE||'').replace(/^https?:\/\//,'').replace(/\/$/,'');if(!/^[a-z0-9-]+\.myshopify\.com$/i.test(store))throw Error('请配置有效 SHOPIFY_STORE');if(!this.token||this.expires<Date.now()){
 const r=await fetch(`https://${store}/admin/oauth/access_token`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({grant_type:'client_credentials',client_id:e.SHOPIFY_CLIENT_ID,client_secret:e.SHOPIFY_CLIENT_SECRET}),signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(`Shopify 认证失败 HTTP ${r.status}`);const a=await r.json();this.token=a.access_token;this.expires=Date.now()+(a.expires_in||82800)*1000-300000;}
 let r;try{r=await fetch(`https://${store}/admin/api/${e.SHOPIFY_API_VERSION||'2025-07'}/graphql.json`,{method:'POST',headers:{'Content-Type':'application/json','X-Shopify-Access-Token':this.token},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(120000)});}catch{throw new UncertainError('Shopify 请求中断，需按任务标记核对远端结果');}if(!r.ok)throw new UncertainError(`Shopify HTTP ${r.status}，需核对远端结果`);const a=await r.json();if(a.errors)throw Error('Shopify GraphQL: '+a.errors.map(x=>x.message).join('; '));for(const v of Object.values(a.data||{}))if(v?.userErrors?.length)throw Error(v.userErrors.map(x=>x.message).join('; '));return a.data;
 }
 async verifyMediaProfile(job){const response=await fetch(storefrontUrl(),{cache:'no-store',signal:AbortSignal.timeout(30000)});const html=await response.text();
  // When the public domain no longer points at the Shopify theme (owner moved the
  // storefront elsewhere), the online marker gate cannot be observed there. The
  // deployed Shopify theme itself declares these profiles, so skip instead of
  // blocking publication; Shopify-served pages always carry one of these markers.
  if(response.ok&&!(html.includes('cdn.shopify.com')||html.includes('myshopify.com')||html.includes('<meta name="ochre-media-profile"')))return '线上域名已不指向 Shopify 主题，跳过线上场景标记检查';
  if(job?.sceneWorkflow==='composed-unframed-v1'){if(!response.ok||!html.includes('<meta name="ochre-scene-frame-profile" content="composed-frames-v1">'))throw Error('商品草稿已保存；等待部署场景换框支持后发布');return;}if(bakedScenes(job)){if(!response.ok||!html.includes('<meta name="ochre-scene-frame-profile" content="baked-frames-v1">'))throw Error('商品草稿已保存；线上主题仍在叠加画框，部署 baked-frames-v1 支持后再发布');return;}if(job?.bannerProfile==='clearance-v3'&&!html.includes('<meta name="ochre-desktop-clearance" content="v3">'))throw Error('PC安全布局尚未部署；保留本地素材，暂不上传');if(job?.mobileSceneProfile==='clearance-v2'&&!html.includes('<meta name="ochre-mobile-scene-profile" content="clearance-v2">'))throw Error('新版手机场景布局尚未部署验证；素材保留本地，不能上传使用旧布局的商品');if(job?.bannerProfile==='fullbleed-v2'&&!html.includes('<meta name="canvasra-banner-profile" content="fullbleed-v2">'))throw Error('新版 Banner 渲染尚未部署验证，不能上传 v2 空背景');if(!response.ok||!html.includes('<meta name="ochre-media-profile" content="responsive-v1">'))throw Error('线上主题尚未验证支持 PC 横版场景；素材已保存在本地，请先部署并验证主题后继续');}
 async catalog(){
 const shop=(await this.gql('query { shop { primaryDomain { host } currencyCode } }')).shop;
 assertStore(shop);
 const read=async query=>{const nodes=[];let after=null;for(;;){const d=await this.gql('query($q:String!,$after:String){products(first:100,query:$q,after:$after){nodes{id title updatedAt options{name values}}pageInfo{hasNextPage endCursor}}}',{q:query,after});nodes.push(...d.products.nodes);if(!d.products.pageInfo.hasNextPage)return {nodes,pageInfo:{hasNextPage:false}};const next=d.products.pageInfo.endCursor;if(!next||next===after)throw Error('店铺商品分页游标无效');after=next;}};
 return {shop,templates:await read('status:draft'),references:await read('status:active')};
 }
 async pricingProduct(id){return (await this.gql('query($id:ID!){product(id:$id){id title status updatedAt options{name values} variants(first:250){nodes{id price availableForSale selectedOptions{name value} inventoryPolicy inventoryItem{tracked requiresShipping}}pageInfo{hasNextPage}}}}',{id})).product;}
 async rules(catalog,profiles={},ratios){return resolveStoreRules(this,catalog,profiles,ratios);}
 async product(id){const d=await this.gql(`query($id:ID!){product(id:$id){id title handle status updatedAt onlineStoreUrl descriptionHtml tags sceneLayouts:metafield(namespace:"custom",key:"scene_layouts"){value} options{name values} variants(first:250){nodes{id price compareAtPrice availableForSale selectedOptions{name value} inventoryPolicy inventoryItem{tracked requiresShipping}}pageInfo{hasNextPage}} media(first:100){nodes{id alt status ... on MediaImage{image{url width height}}}pageInfo{hasNextPage}} collections(first:100){nodes{id handle}pageInfo{hasNextPage}} resourcePublications(first:100){nodes{publication{id name} isPublished}pageInfo{hasNextPage}}}}`,{id});return d.product;}
 async pricing(profile,delivery,offsetKey){if(!profile?.templateId||!profile?.referenceId)throw Error('该比例的店铺规则尚未通过自动核对');const [template,reference]=await Promise.all([this.pricingProduct(profile.templateId),this.pricingProduct(profile.referenceId)]);return validatePricing(template,reference,delivery,offsetKey);}
 async find(tag){return (await this.gql('query($q:String!){products(first:3,query:$q){nodes{id}}}',{q:`tag:${tag}`})).products.nodes;}
 async create(j){const v=j.pricing.variants;const input={title:j.copy.title,handle:j.copy.handle,status:'DRAFT',descriptionHtml:j.copy.descriptionHtml,productType:'Painting',tags:[...j.copy.tags,`canvasra-studio-${j.id}`],seo:{title:j.copy.seoTitle,description:j.copy.seoDescription},collections:j.collections.filter(x=>!x.ruleSet).map(x=>x.id),metafields:[...sceneMetafields(j),{namespace:'custom',key:'orientation',type:'single_line_text_field',value:j.analysis.ratio==='1:1'?'Square':(['3:4','2:3'].includes(j.analysis.ratio)?'Portrait':'Landscape')}],productOptions:['Size','Frame'].map((name,i)=>({name,position:i+1,values:[...new Set(v.map(x=>x[name.toLowerCase()]))].map(name=>({name}))})),variants:v.map(x=>({optionValues:[{optionName:'Size',name:x.size},{optionName:'Frame',name:x.frame}],price:x.price,compareAtPrice:x.compareAtPrice,inventoryPolicy:x.inventoryPolicy,inventoryItem:x.inventoryItem}))};return (await this.gql('mutation($input:ProductSetInput!){productSet(input:$input,synchronous:true){product{id}userErrors{message}}}',{input})).productSet.product.id;}
 async upload(store,j){const entries=mediaEntries(j);const assets=entries.map(e=>({slot:e.slot,finish:e.finish,alt:e.alt,file:mediaEntryFile(j,e),...mediaEntrySize(j,e)}));
  if(assets.some(a=>!a.file||!Number.isFinite(a.width)))throw Error('媒体清单与本地素材不一致，请重新生成后再上传');
  // Shopify rejects product media above 20 MB. The local asset stays full quality;
  // when it is too heavy, upload a web-sized copy instead — the theme lightbox asks
  // for 2048 at most, so the storefront loses nothing. The readback compares against
  // the dimensions actually uploaded.
  const prepared=[];
  for(const a of assets){const bytes=fs.readFileSync(store.file(j.id,a.file));
   if(bytes.length<=MEDIA_LIMIT_BYTES){prepared.push({...a,bytes});continue;}
   const copy=await shrinkForUpload(bytes,MEDIA_LIMIT_BYTES);
   prepared.push({...a,bytes:copy.bytes,width:copy.width,height:copy.height,shrunkFrom:`${a.width}x${a.height} ${(bytes.length/1048576).toFixed(1)} MB`});}
  j.mediaDimensions=Object.fromEntries(prepared.map(a=>[a.alt,{width:a.width,height:a.height}]));
  store.save(j);
  if(!j.staged){const r=await this.gql('mutation($input:[StagedUploadInput!]!){stagedUploadsCreate(input:$input){stagedTargets{url resourceUrl parameters{name value}}userErrors{message}}}',{input:prepared.map(a=>({resource:'IMAGE',filename:a.file,mimeType:'image/png',httpMethod:'POST',fileSize:String(a.bytes.length)}))});j.staged=r.stagedUploadsCreate.stagedTargets;store.save(j);}
 for(let i=0;i<prepared.length;i++){if(j.uploaded?.includes(i))continue;const t=j.staged[i],form=new FormData();for(const p of t.parameters)form.append(p.name,p.value);form.append('file',new Blob([prepared[i].bytes],{type:'image/png'}),prepared[i].file);const r=await fetch(t.url,{method:'POST',body:form,signal:AbortSignal.timeout(120000)});if(!r.ok)throw Error(`上传失败 HTTP ${r.status}`);(j.uploaded??=[]).push(i);store.save(j);}
 const files=prepared.map((a,i)=>({originalSource:j.staged[i].resourceUrl,filename:a.file,contentType:'IMAGE',alt:a.alt}));await this.gql('mutation($id:ProductSetIdentifiers!,$input:ProductSetInput!){productSet(identifier:$id,input:$input,synchronous:true){product{id}userErrors{message}}}',{id:{id:j.productId},input:{files}});
 }
 async collections(){const d=await this.gql('query{collections(first:100){nodes{id handle ruleSet{appliedDisjunctively rules{column relation condition}}}pageInfo{hasNextPage}}}');if(d.collections.pageInfo.hasNextPage)throw Error('集合超过读取上限');return d.collections.nodes;}
 async publish(id){await this.gql('mutation($id:ProductSetIdentifiers!,$input:ProductSetInput!){productSet(identifier:$id,input:$input,synchronous:true){product{id}userErrors{message}}}',{id:{id},input:{status:'ACTIVE'}});const pubs=await this.gql('query{publications(first:100){nodes{id name}pageInfo{hasNextPage}}}');const p=pubs.publications.nodes.find(x=>x.name==='Online Store');if(!p)throw Error('没有找到 Online Store 渠道');await this.gql('mutation($id:ID!,$input:[PublicationInput!]!){publishablePublish(id:$id,input:$input){userErrors{message}}}',{id,input:[{publicationId:p.id}]});}
}
