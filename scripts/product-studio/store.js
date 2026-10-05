import {pendingRecovery} from './recovery-actions.js';
import {redoSlots} from './scene-dependencies.js';
import {mediaSlots} from './media.js';
import {IMAGE_POLICY,canSkipReviews} from './image-readiness.js';
import {ART_DIRECTION_VERSION} from './art-direction.js';
import {assertSceneStyle} from './scene-styles.js';
import {COMPOSED_SCENE} from './composed-scene.js';
import {sumCosts} from './cost.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROOT=path.resolve(import.meta.dirname,'../..');
export const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
// A job keeps its model snapshot (endpoint, model, protocol, profiles) but never the
// key: the credential lives only in settings.json and is merged back in through
// config() when the job runs, so a rotated key leaves no stale copy in job files.
export function withoutSecrets(job){if(!job.config)return job;const {vision,image,...rest}=job.config;return {...job,config:{...rest,vision:{...vision,apiKey:undefined},image:{...image,apiKey:undefined}}};}
// Windows readers/scanners can briefly deny replacement. Keep the old file intact.
export function replaceAtomic(tmp,file,{rename=fs.renameSync,wait=ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms)}={}){
 const delays=[25,50,100,200,400];
 for(let attempt=0;;attempt++){
  try{return rename(tmp,file);}catch(e){
   if(!['EPERM','EACCES','EBUSY'].includes(e.code)||attempt===delays.length)throw e;
   wait(delays[attempt]);
  }
 }
}
export function atomic(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value,null,2),{mode:0o600});replaceAtomic(tmp,file);}
export function json(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
export function safeId(id){if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id||''))throw Error('无效的记录编号');return id;}
export class Store {
 constructor(dir=path.join(ROOT,'.shopify/product-studio')){this.dir=path.resolve(dir);fs.mkdirSync(this.dir,{recursive:true});this.jobs=path.join(this.dir,'jobs');fs.mkdirSync(this.jobs,{recursive:true});}
 jobDir(id){return path.join(this.jobs,safeId(id));}
 get(id){const j=json(path.join(this.jobDir(id),'job.json'));if(!j)throw Error('任务不存在');return j;}
 list({includeDeleted=false}={}){return fs.readdirSync(this.jobs).filter(id=>/^[\w-]+$/.test(id)).map(id=>json(path.join(this.jobs,id,'job.json'))).filter(j=>j&&(includeDeleted||!j.deletedAt)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
 delete(id){const j=this.get(id);if(j.deletedAt)return j;if(j.status==='running')throw Error('任务正在执行，请先暂停，等待当前步骤完成后再删除');j.deletedAt=new Date().toISOString();this.event(j,'任务已从工作台删除，原图、素材版本和操作记录保留');return j;}
 save(j){j.updatedAt=new Date().toISOString();atomic(path.join(this.jobDir(j.id),'job.json'),withoutSecrets(j));return j;}
 create(input){const j={id:crypto.randomUUID(),title:input.title||'未命名作品',brief:String(input.brief||'').slice(0,4000),sceneBrief:String(input.sceneBrief||'').slice(0,4000),sceneStyle:assertSceneStyle(input.sceneStyle),artDirectionProfile:ART_DIRECTION_VERSION,mode:input.mode==='extract'?'extract':'create',delivery:input.delivery||'all',target:input.target==='publish'?'publish':'draft',publicationRequested:true,imagePolicy:IMAGE_POLICY,mediaProfile:'responsive-v1',mobileSceneProfile:'clearance-v2',textureWorkflow:'disabled',bannerProfile:'clearance-v3',desktopAspectRatio:'21:9',sceneWorkflow:this.settings().sceneWorkflow==='baked-frames-v1'?'baked-frames-v1':COMPOSED_SCENE,status:'new',stage:'upload',createdAt:new Date().toISOString(),assets:{},events:[],operations:[],revision:0};return this.save(j);}
 event(j,text){j.events.push({at:new Date().toISOString(),text});this.save(j);}
 settings(){return {autoRecovery:true,backgroundCheck:true,...json(path.join(this.dir,'settings.json'),{vision:{endpoint:'',model:'',apiKey:''},image:{endpoint:'',model:'',apiKey:'',protocol:'reference-json'},maxAttempts:3,libraryRoot:path.join(ROOT,'scene-references'),profiles:{}})};}
 /** Saved model snapshot with the current credential merged in from settings.
  *  Snapshot values win when present (a job keeps the model it started with) and
  *  settings fill the gaps; the key only ever comes from settings. */
 config(job){const s=this.settings(),snap=job?.config||{};const merge=(snapshot={},current={})=>({...current,...snapshot,endpoint:snapshot.endpoint||current.endpoint,model:snapshot.model||current.model,apiKey:current.apiKey});return {...s,...snap,vision:merge(snap.vision,s.vision),image:merge(snap.image,s.image)};}
 publicSettings(){const c=this.settings();return {...c,vision:{...c.vision,apiKey:undefined,hasKey:!!c.vision.apiKey},image:{...c.image,apiKey:undefined,hasKey:!!c.image.apiKey}};}
 saveSettings(input){const old=this.settings();const next={...old};for(const key of ['vision','image'])if(input[key]){const v=input[key];const endpoint=new URL(v.endpoint||old[key].endpoint);if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw Error('模型地址必须是无密钥参数的 HTTPS URL');next[key]={...old[key],endpoint:endpoint.href,model:String(v.model||'').trim(),apiKey:v.apiKey||old[key].apiKey};if(!next[key].model)throw Error('请填写模型名称');if(key==='image'){next[key].protocol=v.protocol==='openai-edit'?'openai-edit':'reference-json';}}if(input.profiles)next.profiles=input.profiles;atomic(path.join(this.dir,'settings.json'),next);return this.publicSettings();}
 publicJob(j){const {config,staged,...visible}=j;return {...visible,recoveryKind:pendingRecovery(j).kind,recoverySlot:pendingRecovery(j).slot,redoDependencies:Object.fromEntries(mediaSlots(j).map(slot=>[slot,redoSlots(j,slot)])),canSkipReviews:canSkipReviews(j),imagePolicy:IMAGE_POLICY,recoveryPolicy:{enabled:config?.autoRecovery??this.settings().autoRecovery,maxGenerations:config?.maxAttempts??this.settings().maxAttempts},modelSnapshot:config?{vision:config.vision.model,image:config.image.model}:null,costSummary:sumCosts(j.assets),operations:j.operations.map(({request,...op})=>op),assets:Object.fromEntries(Object.entries(j.assets).map(([slot,v])=>[slot,v.map(a=>({...a,url:`/media/${j.id}/${a.file}`}))]))};}
 file(id,name){safeId(id);if(path.basename(name)!==name||!/^[-\w.]+$/.test(name))throw Error('无效素材路径');return path.join(this.jobDir(id),name);}
 active(j,slot){return j.assets[slot]?.at(-1);}
 addAsset(j,slot,bytes,meta={}){const file=`${slot}-${crypto.randomUUID()}.png`;fs.writeFileSync(this.file(j.id,file),bytes,{flag:'wx'});const a={file,sha256:hash(bytes),createdAt:new Date().toISOString(),...meta};(j.assets[slot]??=[]).push(a);this.save(j);return a;}
}
