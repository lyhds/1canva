import {ModelFormatError} from './model-format.js';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {atomic,hash} from './store.js';
import {contactSheet} from './library.js';
import {ensureLibraryIndex} from './library-index.js';
import {styleSelectionClause} from './scene-styles.js';

export function selectionResult(result){return result?.indices===undefined&&result?.answer&&typeof result.answer==='object'?result.answer:result;}
export function selectionIndices(result,count,max=3){
 result=selectionResult(result);
 if(!Array.isArray(result?.indices))throw new ModelFormatError('indices 必须是数组');
 const indices=result.indices.map(n=>typeof n==='string'&&/^\d+$/.test(n.trim())?Number(n.trim()):n);
 if(indices.some(n=>!Number.isInteger(n)||n<1||n>count))throw new ModelFormatError(`编号必须是本张联系表的 1–${count}，不能使用全图库编号或图片序号`);
 const unique=[...new Set(indices)];if(unique.length>max)throw new ModelFormatError(`每批最多选择 ${max} 张参考`);
 return unique;
}

// Above this size a library pays for a shared, hash-keyed description archive
// plus one text shortlist instead of re-reading every photo for every artwork.
export const SHORTLIST_LIMIT=24;
const archiveLine=(index,f,desc)=>`${index}. ${f.name}${f.bigsize?' BIGSIZE':''} — room: ${desc.room}; view: ${desc.view}; wall: ${desc.wall}; palette: ${desc.palette}; density: ${desc.density}; notes: ${desc.notes}`;
export function shortlistIndices(result,files){
 result=selectionResult(result);
 const indices=Array.isArray(result?.shortlist)?result.shortlist.map(n=>typeof n==='string'&&/^\d+$/.test(n.trim())?Number(n.trim()):n):null;
 if(!Array.isArray(indices)||indices.length<12||indices.length>SHORTLIST_LIMIT||indices.some(n=>!Number.isInteger(n)||n<1||n>files.length)||new Set(indices).size!==indices.length)throw new ModelFormatError(`参考粗筛必须返回 12 到 ${SHORTLIST_LIMIT} 个互不相同的候选编号`);
 if(files.some(f=>f.bigsize)&&!indices.some(n=>files[n-1].bigsize))throw new ModelFormatError('参考粗筛缺少 BIGSIZE 候选，必须返回至少一个 BIGSIZE 编号');
 return indices;
}
async function shortlistedCandidates(store,job,files,call,context){
 const index=await ensureLibraryIndex(store,job,files,call);
 const described=files.map(f=>{const h=hash(fs.readFileSync(f.path));return {f,hash:h,desc:index.entries[h]?.description};});
 if(described.some(x=>!x.desc))throw new ModelFormatError('图库档案缺少描述，请重试选图步骤');
 const skey=hash(Buffer.from(JSON.stringify({context,files:described.map(x=>({id:x.f.id,hash:x.hash,desc:x.desc}))})));
 job.selectionShortlist??={};
 let shortlist=job.selectionShortlist[skey];
 if(!shortlist){
  const listing=described.map((x,i)=>archiveLine(i+1,x.f,x.desc)).join('\n');
  const response=await call('参考粗筛',`Shortlist room references for this artwork from a pre-described library; no images are attached. Artwork analysis: ${JSON.stringify(job.analysis)}. Artwork design directions: ${JSON.stringify(job.artDirection||null)}. ${styleSelectionClause(job)} Library archive (global 1-based index, name, description):\n${listing}\nReturn JSON {shortlist:number[],reason:string}; shortlist must return 12 to ${SHORTLIST_LIMIT} different global indices. Include at least one BIGSIZE entry when the library has any. Prefer clean bright walls and coherent light: frontal rooms remain the priority for the medium and statement settings, while a gently angled view of a nook, hallway or corner is also a welcome candidate for the small intimate setting. Judge subject, mood, visual density and palette fit from the descriptions; do not choose by directory order.`,[]);
  const responseFile=`shortlist-response-${crypto.randomUUID()}.json`;
  atomic(store.file(job.id,responseFile),{files:described.map(x=>({id:x.f.id,name:x.f.name})),response});
  let indices;try{indices=shortlistIndices(response,files);}catch(e){throw new ModelFormatError(`参考粗筛返回格式错误：${e.message}。响应已保存为 ${responseFile}。`);}
  shortlist={indices,reason:String(selectionResult(response).reason||''),responseFile};job.selectionShortlist[skey]=shortlist;store.save(job);
 }
 const picked=shortlist.indices.map(n=>described[n-1]);
 const ckey=hash(Buffer.from(JSON.stringify({skey,files:picked.map(x=>x.hash)})));
 job.selectionConfirm??={};
 let confirm=job.selectionConfirm[ckey];
 if(!confirm){
  const response=await call('参考精选',`Choose up to 6 best room references for this artwork. Image 1 is the artwork, NOT a selectable reference. Image 2 is a contact sheet of the ${picked.length} shortlisted candidates. Select ONLY the printed labels on image 2: ${picked.map((_,n)=>n+1).join(', ')}. Return JSON {indices:number[],reason:string}; use integers, at most 6 different labels, or [] if none fit. Artwork analysis: ${JSON.stringify(job.analysis)}. Artwork design directions: ${JSON.stringify(job.artDirection||null)}. ${styleSelectionClause(job)} Judge subject, mood, visual density and palette. Explain photographic/material cues to keep and furnishings/colors to discard. Do not choose by palette alone. Prefer clean bright walls and coherent light: frontal rooms remain the priority for the medium and statement settings, while a gently angled view of a nook, hallway or corner is also a welcome candidate for the small intimate setting. The only BIGSIZE labels on this sheet are ${picked.map((x,n)=>x.f.bigsize?n+1:null).filter(Boolean).join(", ")||"none"}. Include a suitable one if present; never infer BIGSIZE membership from the room appearance.`,[fs.readFileSync(store.file(job.id,store.active(job,'master').file)),await contactSheet(picked.map(x=>x.f))]);
  const responseFile=`selection-response-${crypto.randomUUID()}.json`;
  atomic(store.file(job.id,responseFile),{shortlist:shortlist.indices,count:picked.length,files:picked.map(x=>({id:x.f.id,name:x.f.name})),response});
  let indices;try{indices=selectionIndices(response,picked.length,6);}catch(e){throw new ModelFormatError(`参考精选返回格式错误：${e.message}。本批响应已保存，已完成步骤会保留。`);}
  confirm={indices,reason:String(selectionResult(response).reason||''),responseFile};job.selectionConfirm[ckey]=confirm;store.save(job);
 }
 return confirm.indices.map(n=>({...picked[n-1].f,reason:confirm.reason}));
}

async function initialCandidates(store,job,files,call,context){
 if(files.length>SHORTLIST_LIMIT)return shortlistedCandidates(store,job,files,call,context);
 const candidates=[];
 job.selectionBatches??={};
 for(let i=0;i<files.length;i+=12){
  const batch=files.slice(i,i+12),key=hash(Buffer.from(JSON.stringify({context,files:batch.map(f=>({id:f.id,bigsize:f.bigsize,hash:hash(fs.readFileSync(f.path))}))})));
  let saved=job.selectionBatches[key];
  if(!saved){
   const response=await call(`选图 ${i+1}-${i+batch.length}`,`Choose up to 3 best room references for this artwork. Image 1 is the artwork, NOT a selectable reference. Image 2 is a contact sheet. Select ONLY the printed labels on image 2: ${batch.map((_,n)=>n+1).join(', ')}. Each sheet restarts at 1; do NOT return global library positions. Return JSON {indices:number[],reason:string}; use integers, at most 3 different labels, or [] if none fit. Artwork analysis: ${JSON.stringify(job.analysis)}. Artwork design directions: ${JSON.stringify(job.artDirection||null)}. Judge subject, mood, visual density and palette. Explain photographic/material cues to keep and furnishings/colors to discard. Do not choose by palette alone. Prefer clean bright walls and coherent light: frontal rooms remain the priority for the medium and statement settings, while a gently angled view of a nook, hallway or corner is also a welcome candidate for the small intimate setting. The only BIGSIZE labels on this sheet are ${batch.map((x,n)=>x.bigsize?n+1:null).filter(Boolean).join(", ")||"none"}. Include a suitable one if present; never infer BIGSIZE membership from the room appearance.`,[fs.readFileSync(store.file(job.id,store.active(job,'master').file)),await contactSheet(batch)]);
   const responseFile=`selection-response-${crypto.randomUUID()}.json`;
   atomic(store.file(job.id,responseFile),{batchStart:i+1,count:batch.length,files:batch.map(f=>({id:f.id,name:f.name})),response});
   let indices;try{indices=selectionIndices(response,batch.length);}catch(e){throw new ModelFormatError(`选图 ${i+1}–${i+batch.length} 返回格式错误：${e.message}。本批响应已保存，已完成批次会保留。`);}
   saved={indices,reason:String(selectionResult(response).reason||''),responseFile};job.selectionBatches[key]=saved;store.save(job);
  }
  for(const n of saved.indices)candidates.push({...batch[n-1],reason:saved.reason});
 }
 return candidates;
}

// Repair omitted categories using library metadata, including older cached selections.
export async function selectCandidates(store,job,files,call){
 const context={version:2,master:store.active(job,'master').sha256,analysis:job.analysis,direction:job.artDirection||null,sceneStyle:job.sceneStyle||'',model:job.config.vision.model,endpoint:job.config.vision.endpoint};
 const candidates=await initialCandidates(store,job,files,call,context);
 // Expand the candidate pool rather than asking the final selector to solve an impossible quota.
 const ordinary=files.filter(f=>!f.bigsize);
 if(ordinary.length<2)throw Error('普通参考图库至少需要两张不同图片');
 if(candidates.filter(f=>!f.bigsize).length<2){
  const missing=ordinary.filter(f=>!candidates.some(c=>c.id===f.id));
  store.event(job,'普通参考不足两张，自动扩大到普通图库补选');
  for(let i=0;i<missing.length&&candidates.filter(f=>!f.bigsize).length<2;i+=12){
   const batch=missing.slice(i,i+12);
   const key=hash(Buffer.from(JSON.stringify({context,files:batch.map(f=>({id:f.id,hash:hash(fs.readFileSync(f.path))}))})));
   job.selectionOrdinary??={};
   const response=job.selectionOrdinary[key]||await call('补选普通参考 '+(i+1)+'-'+(i+batch.length),`Choose up to 3 best ordinary room references for scene-1 (medium frontal setting) and scene-2 (intimate corner). Image 1 is the artwork; image 2 is a contact sheet. All references here are NON-BIGSIZE. Return JSON {indices:number[],reason:string} using printed local labels 1 through ${batch.length}. Judge wall space, viewpoint and material fit for this artwork: ${JSON.stringify(job.analysis)}; directions: ${JSON.stringify(job.artDirection||null)}. ${styleSelectionClause(job)} Rooms will be adapted, not copied: explain what to retain and what to change. Prefer the closest adaptable references over rejecting a room for removable decor.`,[fs.readFileSync(store.file(job.id,store.active(job,'master').file)),await contactSheet(batch)]);
   atomic(store.file(job.id,'ordinary-selection-response-'+crypto.randomUUID()+'.json'),{files:batch.map(({id,name,bigsize})=>({id,name,bigsize})),response});
   const indices=selectionIndices(response,batch.length);
   job.selectionOrdinary[key]=response;store.save(job);
   for(const n of indices)candidates.push({...batch[n-1],reason:String(selectionResult(response).reason||'')});
  }
  // Empty model shortlists are not evidence that every library image is unusable.
  // Forward the remaining actual images for artwork-specific final comparison.
  if(candidates.filter(f=>!f.bigsize).length<2){
   store.event(job,'普通参考补选不足，自动将完整普通图库交给终选比较与适配');
   for(const f of ordinary)if(!candidates.some(c=>c.id===f.id))candidates.push({...f,reason:'Expanded candidate; final selector must assess artwork fit and adaptation.'});
  }
 }
 if(candidates.some(f=>f.bigsize))return candidates;
 const big=files.filter(f=>f.bigsize);
 if(!big.length)throw Error('参考图库中没有 Bigsize 分类图片，请在 Bigsize 图库添加大尺寸房间参考');
 job.selectionBigsize??={};
 for(let i=0;i<big.length;i+=12){
  const batch=big.slice(i,i+12);
  const key=hash(Buffer.from(JSON.stringify({context,files:batch.map(f=>({id:f.id,bigsize:f.bigsize,hash:hash(fs.readFileSync(f.path))}))})));
  let saved=job.selectionBigsize[key];
  if(saved){try{if(selectionIndices(saved,batch.length,1).length!==1)saved=null;}catch{saved=null;}}
  if(!saved){
   const response=await call('补选 Bigsize '+(i+1)+'-'+(i+batch.length),'Choose the best frontal room reference for the large statement artwork scene. Image 1 is the artwork; image 2 is a contact sheet. ALL selectable references belong to the BIGSIZE library. Use ONLY printed local labels 1 through '+batch.length+'; never use global indices. Return JSON {indices:number[],reason:string}, with exactly one best suitable label, or [] only if none is suitable. Judge wall space, frontal viewpoint, artwork proportions, palette and mood. Artwork analysis: '+JSON.stringify(job.analysis)+'. Design directions: '+JSON.stringify(job.artDirection||null)+'. '+styleSelectionClause(job)+' Explain suitability or why none fit.',[fs.readFileSync(store.file(job.id,store.active(job,'master').file)),await contactSheet(batch)]);
   const responseFile='bigsize-selection-response-'+crypto.randomUUID()+'.json';
   atomic(store.file(job.id,responseFile),{files:batch.map(({id,name,bigsize})=>({id,name,bigsize})),response});
   const indices=selectionIndices(response,batch.length,1);
   if(!indices.length)continue;
   saved={indices,reason:String(selectionResult(response).reason||''),responseFile};
   job.selectionBigsize[key]=saved;store.save(job);
  }
  candidates.push({...batch[saved.indices[0]-1],reason:saved.reason});
 }
 if(!candidates.some(f=>f.bigsize)){store.event(job,'Bigsize 补选为空，自动扩大到完整大尺寸图库进行终选与适配');for(const f of big)candidates.push({...f,reason:'Expanded candidate; final selector must assess wall space and adaptation.'});}
 return candidates;
}

// A category/duplicate error is repaired with disjoint pools, not another identical global prompt.
export async function selectBySlot(candidates,call){
 const selected=[];
 for(const slot of ['scene-1','scene-2','scene-3']){
  const pool=candidates.filter(f=>Boolean(f.bigsize)===(slot==='scene-3')&&!selected.some(s=>s.id===f.id));
  if(!pool.length)throw Error('参考图库缺少 '+slot+' 所需类别');
  const result=selectionResult(await call(slot,pool));
  const row=result?.scenes?.[0]||result;
  const index=Number(row?.index);
  if(!Number.isInteger(index)||index<1||index>pool.length||['reason','keep','discard'].some(k=>typeof row[k]!=='string'||!row[k].trim()))throw new ModelFormatError('分场景终选缺少有效编号或适配依据：'+slot);
  selected.push({...pool[index-1],reason:row.reason,keep:row.keep,discard:row.discard});
 }
 return selected;
}
