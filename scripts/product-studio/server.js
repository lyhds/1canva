import {pendingRecovery,retryPending} from './recovery-actions.js';
import {redoSlots} from './scene-dependencies.js';
import {skipReviews} from './image-readiness.js';
import {mediaSlots} from './media.js';
import {connectionConfig,testConnection} from './connection.js';
import {acquireLock} from './lock.js';
import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import sharp from 'sharp';
import {Store,ROOT,atomic} from './store.js';import {Shopify} from './shopify.js';import {Pipeline} from './pipeline.js';import {library} from './library.js';import {sceneHTML,bannerHTML} from './render.js';import {listSceneStyles} from './scene-styles.js';
const WEB=path.join(import.meta.dirname,'web');
async function body(req){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>30*1024*1024)throw Error('上传文件不能超过20MB');chunks.push(chunk);}return chunks.length?JSON.parse(Buffer.concat(chunks).toString()):{};}
export function createApp({store=new Store(),shopify=new Shopify(),pipeline,port=4310,connectionTest=testConnection}={}){
 const worker=pipeline||new Pipeline(store,shopify);worker.recover();const csrf=crypto.randomBytes(32).toString('hex');
 const testing=new Set();
 const server=http.createServer(async(req,res)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cache-Control','no-store');res.setHeader('Content-Security-Policy',"default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'self'");const send=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
 try{const host=req.headers.host;if(!host||!/^((127\.0\.0\.1)|(localhost)):\d+$/.test(host))return send({error:'只允许本机访问'},403);const url=new URL(req.url,`http://${host}`),parts=url.pathname.split('/').filter(Boolean);
 if(req.method!=='GET'){if(req.headers.origin&&req.headers.origin!==`http://${host}`||req.headers['x-studio-token']!==csrf)return send({error:'请求来源验证失败，请刷新页面'},403);}
 if(url.pathname==='/api/connections/test'){
  if(req.method!=='POST')return send({error:'请使用 POST 测试连接'},405);
  const input=await body(req),kind=input.kind;
  if(!['vision','image'].includes(kind))throw Error('请选择有效的模型配置');
  if(testing.has(kind))return send({error:'该模型正在测试，请等待结果'},409);
  const config=connectionConfig(input,store.settings()[kind]);
  testing.add(kind);
  try{return send(await connectionTest(config));}finally{testing.delete(kind);}
 }
 if(url.pathname==='/api/bootstrap'&&req.method==='GET')return send({token:csrf,settings:store.publicSettings(),shopifyConfigured:shopify.configured(),styles:listSceneStyles(),jobs:store.list().map(j=>store.publicJob(j))});
 if(url.pathname==='/api/settings'){if(req.method==='GET')return send(store.publicSettings());if(worker.busy)throw Error('任务运行中不能更改模型配置');return send(store.saveSettings(await body(req)));}
 if(url.pathname==='/api/catalog'&&req.method==='GET'){const catalog=await shopify.catalog();return send({...catalog,rules:await shopify.rules(catalog,store.settings().profiles)});}
 if(url.pathname==='/api/library'){const items=await library(store.settings().libraryRoot);if(req.method==='GET')return send(items.map(({path,...x})=>({...x,url:'/library/'+x.id})));const input=await body(req),bytes=await sharp(Buffer.from(input.data||'','base64'),{limitInputPixels:40000000}).rotate().png().toBuffer();const dir=path.join(store.settings().libraryRoot,input.bigsize?'bigsize':'uploaded');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,crypto.randomUUID()+'.png'),bytes);return send({ok:true});}
 if(parts[0]==='library'&&req.method==='GET'){const item=(await library(store.settings().libraryRoot)).find(x=>x.id===parts[1]);if(!item)return send({error:'图片不存在'},404);res.writeHead(200,{'Content-Type':/webp$/i.test(item.path)?'image/webp':/jpe?g$/i.test(item.path)?'image/jpeg':'image/png'});return fs.createReadStream(item.path).pipe(res);}
 if(url.pathname==='/api/jobs'){if(req.method==='GET')return send(store.list().map(j=>store.publicJob(j)));const input=await body(req);if(!['framed-only','all'].includes(input.delivery||'all'))throw Error('无效交付方式');if(!input.data)throw Error('请上传参考图');const bytes=await sharp(Buffer.from(input.data,'base64'),{limitInputPixels:40000000}).rotate().png().toBuffer();const meta=await sharp(bytes).metadata();const j=store.create(input);store.addAsset(j,'reference',bytes,{width:meta.width,height:meta.height,accepted:true});j.status='queued';j.stage='排队等待';store.event(j,'任务已创建并自动排队，轮到后开始制作');return send(store.publicJob(j),201);}
 if(parts[0]==='api'&&parts[1]==='jobs'&&parts[2]){if(req.method==='GET')return send(store.publicJob(store.get(parts[2])));const input=await body(req),action=parts[3];
 if(action==='delete'){if(req.method!=='POST')return send({error:'请使用 POST 删除任务'},405);store.delete(parts[2]);return send({ok:true});}
 const j=store.get(parts[2]);if(j.deletedAt)throw Error('任务已删除，不能继续执行');if(action==='pause'){atomic(path.join(store.jobDir(j.id),'pause.json'),{requested:true});return send({ok:true});}if(['running','queued'].includes(j.status))throw Error('任务正在执行，请等待或暂停');if(j.status==='published')throw Error('已发布任务只读；如需新版本请新建任务');
 if(action==='query-result'){
  const r=pendingRecovery(j);if(j.status!=='uncertain'||r.kind!=='image')throw Error('当前不是待核对的生图请求');
  const receipts=r.pending.map(o=>({id:o.id,label:o.label,startedAt:o.startedAt,hasReceipt:!!o.resultFile&&fs.existsSync(store.file(j.id,o.resultFile))}));
  return send({message:receipts.some(o=>o.hasReceipt)?'本地已有服务商响应回执，已保留。可直接点击重试此图重新生成。':'本地未收到图片回执。当前接口未提供自动查询能力，请按请求时间在生图服务商后台核对；未收到不代表未生成。',requests:receipts});
 }
 if(action==='retry-analysis'||action==='retry-image'){
  const r=pendingRecovery(j);
  if(action==='retry-image'&&r.slot&&store.active(j,r.slot))throw Error('该图片已有结果，请先核对已有素材');
  retryPending(j,{kind:action==='retry-analysis'?'analysis':'image'});
  store.event(j,action==='retry-analysis'?'重新分析并继续，保留已有图片':'用户直接重试缺失图片并继续，保留旧回执');return send(store.publicJob(j));
 }
 if(action==='retry-plan'){const pending=j.operations.filter(o=>o.status==='uncertain');if(j.status!=='uncertain'||!pending.length||pending.some(o=>o.label!=='制定场景方案')||j.artDirection||j.productId)throw Error('当前任务不符合重试场景方案的条件');for(const op of pending){op.status='superseded';op.resolution='用户选择重试场景方案；旧请求结果及计费仍未知';}j.status='queued';j.config=store.settings();j.error=null;store.event(j,'保留已有图片，重试场景方案并继续；本次分析可能计费');return send(store.publicJob(j));}
 if(action==='skip-reviews'||action==='retry-review'){skipReviews(j);j.status='queued';j.config=store.settings();j.error=null;store.event(j,'已取消旧 AI 审核，保留已有图片继续；历史请求计费仍未知');return send(store.publicJob(j));}
 if(action==='run'){if(j.status==='uncertain')throw Error('请先核对未确认请求');for(const slot of Object.keys(j.attempts||{}))if(!store.active(j,slot))j.attempts[slot]=0;j.status='queued';j.config=store.settings();j.error=null;store.save(j);return send(store.publicJob(j));}
 if(action==='retry'){if(j.productId)throw Error('已有 Shopify 商品时不能替换素材；请新建修订任务');const slot=input.slot;if(!mediaSlots(j).filter(x=>x!=='detail').includes(slot))throw Error('无效素材');if(j.status==='uncertain')throw Error('请先核对未确认请求');const affected=redoSlots(j,slot);for(const s of affected){for(const a of j.assets[s]||[]){a.accepted=false;a.invalidated=true;}(j.attempts??={})[s]=0;}if(slot==='master'){j.copy=null;j.selection=null;j.artDirection=null;j.assets.detail?.forEach(a=>a.invalidated=true);}j.manualReviewRequired=true;j.status='paused';j.revision++;store.save(j);return send(store.publicJob(j));}
 if(action==='resolve'){if(j.status!=='uncertain'||input.resolution!=='confirmed-no-result'||String(input.evidence||'').trim().length<8)throw Error('需填写在服务商核对无结果的依据');if(j.productId||j.operations.some(o=>/Shopify/.test(o.label))&&(await shopify.find(`canvasra-studio-${j.id}`)).length)throw Error('Shopify 已创建记录，请使用核对远端');for(const op of j.operations.filter(o=>['pending','uncertain'].includes(o.status))){op.status='cancelled';op.resolution=input.evidence;}j.status='paused';store.save(j);return send(store.publicJob(j));}
 if(action==='reconcile'){if(pendingRecovery(j).kind!=='shopify')throw Error('只有 Shopify 未确认请求可以核对店铺');const found=await shopify.find(`canvasra-studio-${j.id}`);if(found.length!==1)throw Error(`找到 ${found.length} 个商品，请人工核对后再继续`);const p=await shopify.product(found[0].id);j.productId=p.id;const expected=mediaSlots(j).length;if(p.media.nodes.length===expected&&p.media.nodes.every(m=>m.status==='READY'))j.mediaAttached=true;for(const op of j.operations.filter(o=>o.status==='uncertain'&&/Shopify/.test(o.label))){op.status='complete';op.resolution='按唯一任务标签回读商品 '+p.id;}if(j.operations.some(o=>o.status==='uncertain'))throw Error('另有生图请求待核对');j.status='paused';store.save(j);return send(store.publicJob(j));}
 if(action==='confirm-redo'){
  if(j.status!=='scenes-ready'||!j.manualReviewRequired||j.productId)throw Error('请先完成重做图片，再确认继续');
  if(j.operations.some(o=>['pending','uncertain'].includes(o.status)))throw Error('请先核对未确认请求');
  if(mediaSlots(j).some(slot=>{const a=store.active(j,slot);return !a?.accepted||a.invalidated;}))throw Error('请先完成全部商品图片');
  j.manualReviewRequired=false;j.publicationRequested=true;j.status='queued';j.error=null;
  store.event(j,'已确认重做图片，继续'+(j.target==='publish'?'发布到 Shopify':'保存 Shopify 草稿'));return send(store.publicJob(j));
 }
 if(action==='publish'){if(!['draft','scenes-ready','awaiting-theme'].includes(j.status))throw Error('请先完成全部商品图片');if(mediaSlots(j).some(slot=>{const a=store.active(j,slot);return !a?.accepted||a.invalidated;}))throw Error('请先完成全部商品图片');j.publicationRequested=true;j.target='publish';j.ratioReview=null;j.manualReviewRequired=false;j.status='queued';store.save(j);return send(store.publicJob(j));}
 if(action==='delivery'){if(j.productId)throw Error('商品已经建立');j.delivery='framed-only';j.pricing=null;j.config=null;store.save(j);return send(store.publicJob(j));}throw Error('未知操作');}
 if(parts[0]==='media'&&req.method==='GET'){if(parts.length!==3||!/^[-\w]+\.png$/.test(parts[2]))return send({error:'图片不存在'},404);const file=store.file(parts[1],parts[2]);if(!fs.existsSync(file))return send({error:'文件不存在'},404);res.writeHead(200,{'Content-Type':'image/png'});return fs.createReadStream(file).pipe(res);}
 if(parts[0]==='scene'&&req.method==='GET'){const j=store.get(parts[1]);if(!mediaSlots(j).filter(x=>x.startsWith('scene-')).includes(parts[2]))throw Error('无效场景');const frame=url.searchParams.get('frame')||'Oak Float Frame';if(!['Oak','Black','Walnut','White','Gold','Silver'].some(x=>frame===x+' Float Frame')&&frame!=='Stretched Canvas'&&frame!=='Rolled Canvas'&&!j.pricing?.variants?.some(v=>v.frame===frame))throw Error('无效装裱');const fullBanner=parts[2]==='scene-desktop'&&url.searchParams.get('view')==='desktop';const html=fullBanner?await bannerHTML(store,j,frame):await sceneHTML(store,j,parts[2],frame);res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});if(fullBanner)return res.end(html);return res.end(`<style>${fs.readFileSync(path.join(ROOT,'assets/theme.css'),'utf8')}html,body{margin:0;width:100%;height:100%;overflow:hidden}</style>${html}`);}
 const file=path.join(WEB,url.pathname==='/'?'index.html':path.basename(url.pathname));if(!['index.html','app.js','style.css'].includes(path.basename(file)))return send({error:'不存在'},404);res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8'});fs.createReadStream(file).pipe(res);
 }catch(e){send({error:e.message},400);}});
 const timer=setInterval(()=>worker.tick(),1000);timer.unref();server.on('close',()=>{clearInterval(timer);worker.stopped=true;});return {server,store,worker,port};
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(import.meta.filename)){const port=Number(process.env.STUDIO_PORT||4310);const store=new Store();const release=acquireLock(store.dir);process.on('exit',release);process.on('SIGINT',()=>process.exit(0));process.on('SIGTERM',()=>process.exit(0));const app=createApp({port,store});app.server.listen(port,'127.0.0.1',()=>console.log(`Product Studio: http://127.0.0.1:${port}`));}
