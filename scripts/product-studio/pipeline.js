import {ModelFormatError,nonEmptyText} from './model-format.js';
import {desktopUsesScene3} from './scene-dependencies.js';
import {IMAGE_POLICY,checkImage,validateBounds,boundsPrompt,unwrapAnswer} from './image-readiness.js';
import {catalogTags,matchingCollections} from './catalog-copy.js';
import {sceneLayouts,verifySceneMetafield} from './scene-publication.js';
import {locateSceneEdges} from './scene-edges.js';
import {bakedScenes, mediaEntries, mediaEntrySize, mediaSlots as mediaSlotList} from './media.js';
import {BAKED_FRAMES,FRAME_SELECTION_POLICY} from './frame-finish.js';
import {COMPOSED_SCENE,composedScenes,composedPrompt,bakedFramePrompt} from './composed-scene.js';
import {styleSelectionClause} from './scene-styles.js';
import {automatic,formatFailure} from './recovery.js';
import {selectCandidates,selectBySlot} from './selection.js';
import {referenceDirection} from './reference-direction.js';
import {OIL_PAINTING_GUIDANCE} from './oil-painting.js';
import {priceTable} from './price-table.js';
import {usesArtDirection,directionPrompt,validateDirection,sceneDirection,validateSelection} from './art-direction.js';
import {bannerPrompt,bannerRatio} from './banner.js';
import {mediaSlots, mediaAlt, sceneRatio} from './media.js';
import fs from 'node:fs';import path from 'node:path';import sharp from 'sharp';
import {external,vision,generate,UncertainError,configured} from './providers.js';import {library,contactSheet} from './library.js';import {atomic,hash,ROOT} from './store.js';
const ratios=['3:4','2:3','1:1','4:3','3:2','2:1'];
const escape=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const read=(store,j,a)=>fs.readFileSync(store.file(j.id,a.file));
const LESSONS_FILE=path.join(ROOT,'.agents/skills/canvasra-product/references/scene-lessons.md');
/**
 * Scene lessons are an input to the scene prompts. They live with the Codex
 * product skill, so the location is overridable (CANVASRA_SCENE_LESSONS) instead
 * of being a hidden hard dependency; a missing file fails the job with an
 * actionable message rather than a bare ENOENT.
 */
export function sceneLessons(){
 const file=process.env.CANVASRA_SCENE_LESSONS||LESSONS_FILE;
 try{return fs.readFileSync(file,'utf8');}
 catch{
  const shown=file.startsWith(ROOT)?path.relative(ROOT,file):file;
  throw Error(`缺少场景经验文件 ${shown}：生成场景提示词需要它。请从 Git 恢复该文件，或用 CANVASRA_SCENE_LESSONS 指向实际路径后重试。`);
 }
}
export class Pipeline {
 constructor(store,shopify,adapters={}){this.store=store;this.shopify=shopify;this.ai=adapters.vision||vision;this.gen=adapters.generate||generate;this.busy=false;this.stopped=false;}
 recover(){for(const j of this.store.list())if(j.status==='running'){const pending=j.operations.filter(o=>o.status==='pending');pending.forEach(o=>o.status='uncertain');j.status=pending.length?'uncertain':'paused';j.error=pending.length?'服务重启时有外部请求未完成，请核对后恢复':'后台重启，已保存进度，可继续';this.store.save(j);}}
 async tick(){if(this.busy||this.stopped)return;const j=this.store.list().reverse().find(x=>x.status==='queued');if(!j)return;this.busy=true;try{await this.run(j);}catch(e){j.status=e instanceof UncertainError?'uncertain':'failed';j.error=e.message;this.store.event(j,e.message);}finally{this.busy=false;}}
 checkPause(j){const file=path.join(this.store.jobDir(j.id),'pause.json');if(fs.existsSync(file)){fs.unlinkSync(file);j.status='paused';this.store.save(j);throw new Pause();}}
 async step(j,name,fn){
  const previous=this.formatFeedback;this.formatFeedback=null;
  j.stage=name;this.store.event(j,`正在${name}`);
  try{for(let attempt=0;;attempt++){
   this.checkPause(j);
   try{const result=await fn();this.checkPause(j);return result;}
   catch(e){
    if(e instanceof Pause||e instanceof UncertainError||!automatic(j)||!formatFailure(e)||attempt>=2)throw e;
    this.formatFeedback={label:this.lastAnalysisLabel,message:e.message};
    this.store.event(j,`${name}返回格式不合规，自动补问 ${attempt+1}/2：${e.message}`);
   }
  }}finally{this.formatFeedback=previous;}
 }
 async aiCall(j,label,prompt,images,options){
  for(;;){this.checkPause(j);try{return await this.aiCallOnce(j,label,prompt,images,options);}catch(e){
   const key=label+':transport',count=j.recoveryCounts?.[key]||0;
   if(!automatic(j)||!(e instanceof UncertainError)||count>=2)throw e;
   (j.recoveryCounts??={})[key]=count+1;
   const op=j.operations.at(-1);op.status='superseded';op.resolution='自动重试只读分析；旧请求结果及计费仍未知';
   this.store.event(j,`${label}连接中断，保留图片自动重试分析 ${count+1}/2`);
   await new Promise(resolve=>setTimeout(resolve,1000*(count+1)));
  }}
 }
 async aiCallOnce(j,label,prompt,images,options){this.lastAnalysisLabel=label;if(this.formatFeedback?.label===label)prompt+='\nThe previous response failed validation: '+JSON.stringify(this.formatFeedback.message)+'. Correct this specific error and return the COMPLETE requested JSON object, not a partial patch. Keep valid content and keep explanations concise.';j.stage=label;this.store.save(j);const r=await external(this.store,j,label,()=>this.ai(this.store.config(j).vision,prompt,images,{...options,onMeta:async meta=>{const op=j.operations.at(-1);op.diagnostics={...op.diagnostics,...meta};this.store.save(j);}}));const op=j.operations.at(-1);const resultFile=`analysis-result-${op.id}.json`;atomic(this.store.file(j.id,resultFile),{label,data:r.data,usage:r.usage||null});op.resultFile=resultFile;(j.usage??=[]).push({stage:label,usage:r.usage,costUSD:null});this.store.save(j);return r.data;}

 async make(j,slot,prompt,ratio,refs){
  const store=this.store, isScene=slot.startsWith('scene-'), composed=isScene&&composedScenes(j), baked=isScene&&bakedScenes(j);
  const master=store.active(j,'master');
  let asset=store.active(j,slot);
  if(asset?.invalidated || (asset&&isScene&&(asset.masterHash&&asset.masterHash!==master.sha256 ||
    composed&&asset.sceneWorkflow!==COMPOSED_SCENE || baked&&asset.sceneWorkflow!==BAKED_FRAMES))) asset=null;
  const sourceScene=slot==='scene-desktop'&&desktopUsesScene3(j)?store.active(j,'scene-3'):null;
  const previousSource=asset?.sourceSceneHash||asset?.referenceHashes?.[0];
  if(asset&&sourceScene&&previousSource&&previousSource!==sourceScene.sha256){
   if(j.productId)throw Error('PC 场景参考已变化，但商品已建立；请新建修订任务');
   asset.invalidated=true;asset.accepted=false;asset=null;
   j.manualReviewRequired=true;store.save(j);
  }
  if(!asset){
   const pending=j.operations.filter(o=>['pending','uncertain'].includes(o.status));
   if(pending.length)throw new UncertainError('存在未确认请求，请先核对；未重复生图');
   this.checkPause(j);
   const key=composed?COMPOSED_SCENE+':'+slot:slot;
   (j.attempts??={})[key]=(j.attempts?.[key]||0)+1;
   const generationRefs=composed||baked?[refs[0],read(store,j,master)]:refs;
   let finalPrompt=baked?bakedFramePrompt(j,slot,ratio):composed?composedPrompt(j,slot,ratio):prompt;
   if(!composed&&!baked&&isScene)finalPrompt+='\n'+referenceDirection(j,slot);
   if(!composed&&!baked&&isScene&&usesArtDirection(j))finalPrompt+='\nMandatory artwork direction: '+JSON.stringify(sceneDirection(j,slot));
   store.save(j);
   asset=await external(store,j,'生成 '+slot+' #'+j.attempts[key],async()=>{
    const result=await this.gen(this.store.config(j).image,finalPrompt,ratio,generationRefs,{
     backgroundOnly:isScene&&!composed&&!baked,
     onMeta:async meta=>{const op=j.operations.at(-1);op.diagnostics={...op.diagnostics,...meta};store.save(j);},
     onResponse:async response=>{const op=j.operations.at(-1),file='provider-result-'+op.id+'.json';atomic(store.file(j.id,file),response);op.resultFile=file;store.save(j);}
    });
    try{
     const bytes=await sharp(result.bytes,{limitInputPixels:40000000}).rotate().png().toBuffer();
     const meta=await sharp(bytes).metadata();
     return store.addAsset(j,slot,bytes,{width:meta.width,height:meta.height,prompt:finalPrompt,
      sceneWorkflow:composed?COMPOSED_SCENE:(isScene?j.sceneWorkflow:undefined),
      masterHash:isScene?master.sha256:null,referenceHashes:generationRefs.map(hash),sourceSceneHash:sourceScene?.sha256,
      model:this.store.config(j).image.model,usage:result.usage,cost:result.cost,costUSD:result.costUSD,accepted:false});
    }catch{throw new UncertainError('生图已返回但图片保存失败；保留回执，请核对，未重复生图');}
   });
  }
  asset.accepted=false;
  try{
   asset.programCheck=await checkImage(read(store,j,asset),asset,ratio);
   asset.accepted=true;
   asset.readinessPolicy=IMAGE_POLICY;
   delete asset.programError;
  }catch(error){asset.programError=error.message;throw error;}
  finally{store.save(j);}
 }
 async locateArtwork(j,slot){
  const s=this.store,a=s.active(j,slot),master=s.active(j,'master');
  if(a.frameMapping?.verified&&a.frameMapping.sourceHash===a.sha256)return;
  let bounds=a.localizationError?null:a.artworkBounds;
  try{validateBounds(bounds);}catch{
   const result=await this.step(j,'定位画作 '+slot,()=>this.aiCall(j,'定位画作 '+slot,boundsPrompt,
    [read(s,j,a),read(s,j,master)],{review:true}));
   bounds=validateBounds(unwrapAnswer(result).artworkBounds);
   a.artworkBounds=bounds;
   a.localization={sourceHash:a.sha256,bounds};
   s.save(j);
  }
  try{
   a.frameMapping={...await locateSceneEdges(read(s,j,a),bounds,master.width/master.height),sourceHash:a.sha256};
   delete a.localizationError;
  }catch(error){a.localizationError=error.message;throw error;}
  finally{s.save(j);}
 }
 async run(j){const s=this.store;if(j.deletedAt)throw Error('任务已删除，不能继续执行');if(j.status==='published')throw Error('已发布任务只读');if(j.operations.some(o=>['pending','uncertain'].includes(o.status)))throw new UncertainError('存在未确认请求，请先核对');if(!j.productId&&j.revision>0&&j.manualReviewRequired===undefined)j.manualReviewRequired=true;j.imagePolicy=IMAGE_POLICY;j.status='running';j.error=null;if(!j.productId)j.textureWorkflow='disabled';j.config=s.config(j);s.save(j);
 try{configured(j.config.vision);configured(j.config.image);if(j.pricing?.template?.id&&j.pricing?.reference?.id&&j.analysis?.ratio){j.config.profiles??={};j.config.profiles[j.analysis.ratio]={templateId:j.pricing.template.id,referenceId:j.pricing.reference.id};s.save(j);}
 if(!s.active(j,'reference'))throw Error('请上传参考图');
 if(!j.analysis)await this.step(j,'分析作品',async()=>{const a=await this.aiCall(j,'分析作品',`Analyze commercially authorized artwork reference. User brief: ${j.brief}. Mode ${j.mode}. Return {title:string,ratio:one of ${ratios.join(',')},palette:string,masterPrompt:string}. Prompt must describe complete unframed artwork no room, no extra writing, no border. ${j.mode==='extract'?'For extract mode preserve reference composition, color, content rather than reinterpret.':'For create mode design a clearly different original artwork: keep only the broad subject family, medium and overall mood, and change the composition, viewpoint, element arrangement, background and palette interpretation; masterPrompt must describe that new artwork, not restate the reference.'} Overlaid watermarks, stock/platform text, logos, account handles and UI are not part of the artwork, even when they sit mid-image inside an abstract composition — distinguish them from genuine painted content: overlays are semi-transparent or uniform text/logos that ignore the brushwork, while signatures and painted text are integral to the style. Under the owner’s standing authorization remove overlaid marks completely and reconstruct whatever they cover in the painting’s own style; never blur, fade or leave ghost traces. Preserve genuine signatures and painted text. masterPrompt must explicitly instruct full removal of these overlays. ${OIL_PAINTING_GUIDANCE} Do not infer manufacturing or delivery.`,[read(s,j,s.active(j,'reference'))]);if(!ratios.includes(a?.ratio)||!nonEmptyText(a?.masterPrompt)||!nonEmptyText(a?.title))throw new ModelFormatError('作品分析结构不完整');j.analysis=a;j.title=a.title;s.save(j);});
 if(!j.productId&&j.pricing&&j.pricing.priceTableVersion!==priceTable.version){j.pricing=null;s.save(j);}
 if(!j.pricing)await this.step(j,'读取店铺规则',async()=>{const catalog=await this.shopify.catalog();j.config.profiles??={};const ratio=j.analysis.ratio;if(!j.config.profiles[ratio]?.templateId||!j.config.profiles[ratio]?.referenceId){const rules=await this.shopify.rules(catalog,j.config.profiles,[ratio]);if(!rules.profiles[ratio])throw Error(rules.rows[0]?.error||'该比例店铺规则未通过核对');j.config.profiles[ratio]=rules.profiles[ratio];atomic(path.join(s.jobDir(j.id),'store-rules.json'),rules);s.save(j);}j.pricing=await this.shopify.pricing(j.config.profiles[ratio],j.delivery,j.id);atomic(path.join(s.jobDir(j.id),'pricing-source.json'),j.pricing);s.save(j);});
 await this.step(j,'生成正面主图',()=>this.make(j,'master',`${j.analysis.masterPrompt}\n${j.mode==='extract'?'Faithfully preserve the supplied artwork except for overlaid watermarks, platform text, logos or UI, which are not part of the artwork even when they sit mid-image in an abstract composition: remove them completely and reconstruct the covered areas in the painting’s own style; never blur, fade or leave ghost traces. If its proportions differ from the requested ratio, reconcile them with a slight overall proportional adjustment across the whole artwork; never crop, trim or omit any edge content — every outermost stroke must remain fully visible.':'Use the reference only for its broad subject family, medium and overall mood. Compose an original artwork from scratch with a different composition, viewpoint, element arrangement, background and palette interpretation. Do not copy the reference layout, poses, proportions or element placement, and never reproduce any watermark or overlaid text from the reference.'} Edge-to-edge complete unframed artwork. Ratio ${j.analysis.ratio}. ${OIL_PAINTING_GUIDANCE}`,j.analysis.ratio,[read(s,j,s.active(j,'reference'))]));
 if(!s.active(j,'detail')?.accepted||s.active(j,'detail').sourceHash!==s.active(j,'master').sha256)await this.step(j,'裁切真实细节',async()=>{const a=s.active(j,'master'),w=Math.floor(a.width*.45),h=Math.min(a.height,Math.floor(w*4/3)),rect={left:Math.floor((a.width-w)/2),top:Math.floor((a.height-h)/2),width:w,height:h};const bytes=await sharp(read(s,j,a)).extract(rect).png().toBuffer();s.addAsset(j,'detail',bytes,{width:w,height:h,sourceHash:a.sha256,crop:rect,accepted:true});});
 if(usesArtDirection(j)&&j.artDirection?.masterHash!==s.active(j,'master').sha256)await this.step(j,'制定作品专属场景方案',async()=>{const result=validateDirection(await this.aiCall(j,'制定场景方案',directionPrompt(j),[read(s,j,s.active(j,'master'))]));j.artDirection={...result,frameSelectionPolicy:bakedScenes(j)?FRAME_SELECTION_POLICY:undefined,profile:j.artDirectionProfile,masterHash:s.active(j,'master').sha256,createdAt:new Date().toISOString()};atomic(path.join(s.jobDir(j.id),'scene-art-direction.json'),j.artDirection);j.selection=null;s.save(j);});
 if(!j.selection)await this.step(j,'挑选场景参考',async()=>{const files=await library(j.config.libraryRoot);if(!files.length)throw Error('参考图库为空，请上传场景参考');atomic(path.join(s.jobDir(j.id),'scene-library-inventory.json'),{scannedAt:new Date().toISOString(),files:files.map(({path,...f})=>f)});const candidates=await selectCandidates(s,j,files,(label,prompt,images)=>this.aiCall(j,label,prompt,images));
 const ordinary=candidates.filter(x=>!x.bigsize),big=candidates.find(x=>x.bigsize);if(!big)throw Error('Bigsize 图库没有通过筛选的大尺寸参考，请补充适合的正面房间');const pool=ordinary.length>=2?ordinary:candidates.filter(x=>x.id!==big.id);if(pool.length<2)throw Error('需要三个可区分的场景参考');const bigsizeIndices=candidates.map((x,i)=>x.bigsize?i+1:null).filter(Boolean);let selected=[pool[0],pool[1],big];if(usesArtDirection(j)){const ranked=await this.aiCall(j,'跨图库终选与参考取舍',`Select exactly three different references from all shortlisted candidates for these directions: ${JSON.stringify(j.artDirection)}. ${styleSelectionClause(j)} Image 1 is the master; remaining images are contact sheets in batches of 12. Return {scenes:[{slot:string,index:number,reason:string,keep:string,discard:string}]}. Every scene object MUST carry all five keys as non-empty strings: reason (how the room fits this artwork, one sentence under 25 words), keep (the photographic and material cues to retain), discard (the furniture, colours and layout to reject). Never merge keep or discard into reason, never omit them, and never return extra keys. index is GLOBAL 1-based across batches (sheet 2 starts at 13), not within-sheet numbering. The only BIGSIZE indices are ${bigsizeIndices.join(', ')}; scene-3 must be one of those and scene-1/scene-2 must not. Scene-1 and scene-3 need frontal room views; scene-2 may be a gently angled view when it fits the intimate setting. For a wide landscape artwork prefer references with a broad, mostly empty wall for scene-1 and scene-3, and let the scene-2 nook keep the canvas as a small jewel. Explicitly justify the artwork fit, photographic/material cues retained and furniture/colors/layout discarded. Do not choose by directory order.`,[read(s,j,s.active(j,'master')),...await Promise.all(Array.from({length:Math.ceil(candidates.length/12)},(_,n)=>contactSheet(candidates.slice(n*12,n*12+12),n*12+1)))]);atomic(s.file(j.id,'selection-final-'+Date.now()+'.json'),{ranked,candidates:candidates.map(({path,...c})=>c)});try{selected=validateSelection(ranked,candidates);}catch(e){if(!(e instanceof ModelFormatError))throw e;s.event(j,'跨图库终选不合规，自动按场景类别分别选图');selected=await selectBySlot(candidates,async(slot,pool)=>this.aiCall(j,'分场景终选 '+slot,`Select the best adaptable reference for ${slot}. Image 1 is the artwork; subsequent images are contact sheets numbered globally from 1. All candidates are eligible for this slot and already exclude earlier selections. Return JSON {index:number,reason:string,keep:string,discard:string}. Choose exactly one real printed index. Explain artwork fit, cues to retain and changes needed; rooms can be restyled to fit. Directions: ${JSON.stringify(sceneDirection(j,slot))}.`,[read(s,j,s.active(j,'master')),...await Promise.all(Array.from({length:Math.ceil(pool.length/12)},(_,n)=>contactSheet(pool.slice(n*12,n*12+12),n*12+1)))]));}}j.selection=selected.map((x,i)=>{const file=`scene-reference-${i+1}.png`;return {...x,file};});for(const x of j.selection){const bytes=await sharp(x.path).png().toBuffer();fs.writeFileSync(s.file(j.id,x.file),bytes);x.sha256=hash(bytes);delete x.path;}s.save(j);});
 const sceneFailures=[];const sceneStep=async(name,fn)=>{try{return await this.step(j,name,fn);}catch(e){if(!automatic(j)||e instanceof UncertainError||e instanceof Pause)throw e;sceneFailures.push({stage:name,reason:e.message});j.sceneFailures=sceneFailures;this.store.event(j,name+'暂未完成，继续其他场景：'+e.message);}};
 for(let i=1;i<=3;i++)await sceneStep(`生成场景 ${i}`,()=>this.make(j,`scene-${i}`,`Create a native ${sceneRatio(j)} portrait EMPTY room background inspired by the supplied room. Remove ALL artwork, frames, wall outlines, logos and UI. Frontal wall plane, soft uniform light, no strong mismatched directional light. Keep top 12% clean light wall for dark header. ${i===3?(j.mobileSceneProfile==='clearance-v2'?'Clear wall x18–82%, y18–62%; header zone above18%; all furniture and lamp tops below66%, with a visible gap below the artwork.':'Close composition for large artwork, clear wall x10–90%, y0–78% plus shadow clearance; furniture below82%.'):'Clear wall x23–77%, y14–58%; furniture below62%.'} Realistic furniture scale and breathing room. Adapt furniture, materials and visual weight to the accepted artwork; the reference is inspiration, not a room template. Avoid competing heavy furnishings for delicate artwork. Palette ${j.analysis.palette} is a starting cue, not a requirement for an all-matching room. The painting and frame will be overlaid separately; never draw either. ${sceneLessons()}`,sceneRatio(j),[fs.readFileSync(s.file(j.id,j.selection[i-1].file))]));
 if(j.mediaProfile==='responsive-v1'&&(!automatic(j)||s.active(j,'scene-3')?.accepted))await sceneStep('生成 PC 横版首屏',()=>this.make(j,'scene-desktop',bannerPrompt(j),bannerRatio(j),[usesArtDirection(j)?read(s,j,s.active(j,'scene-3')):fs.readFileSync(s.file(j.id,j.selection[2].file))]));
 if(sceneFailures.length)throw Error('以下场景仍需处理：'+sceneFailures.map(x=>x.stage+'：'+x.reason).join('；'));j.sceneFailures=[];s.save(j);
 if(j.manualReviewRequired){j.status='scenes-ready';j.stage='确认重做图片';j.error=null;s.event(j,'重做图片已就绪，请确认效果后继续；尚未创建或发布 Shopify 商品');s.save(j);return;}
 if(composedScenes(j)&&!j.publicationRequested){j.status='scenes-ready';j.stage='完整场景已完成';j.error=null;s.event(j,'无外框完整场景已完成；保留完整场景；发布时定位画框边界。');return;}
 if(composedScenes(j)){await this.step(j,'校准场景画框边界',async()=>{for(const slot of mediaSlots(j).filter(x=>x.startsWith('scene-')))await this.locateArtwork(j,slot);sceneLayouts(j);});}
 if(!j.copy)await this.step(j,'编写商品文案',async()=>{const all=await this.shopify.collections(),allowed=catalogTags(all);const a=await this.aiCall(j,'商品文案',`Write English product copy. Return {title,handle,paragraphs:[string,string],seoTitle,seoDescription,tags:string[]}. Handle ASCII lowercase hyphens. Describe only visible subject, palette and styling. Do not mention AI, artificial intelligence, image-generation tools or the creation workflow in customer-facing copy. No invented artist/materials, manufacturing, reviews or sales. Tags choose only visually justified matches from ${allowed.join(", ")}. Omit unsuitable categories; never label a recognizable figurative portrait as abstract or force wabi-sabi. Describe gold tones as color, not actual gold leaf material. Artwork analysis ${JSON.stringify(j.analysis)}.`,[read(s,j,s.active(j,'master'))]);if(!nonEmptyText(a?.title)||!Array.isArray(a?.paragraphs)||!a.paragraphs.length||!a.paragraphs.every(nonEmptyText)||!nonEmptyText(a?.handle)||!/^[a-z0-9-]+$/.test(a.handle)||!Array.isArray(a?.tags)||!a.tags.every(nonEmptyText))throw new ModelFormatError('文案结构不完整：请提供 title、handle、paragraphs 文本数组和 tags 文本数组');j.copy={title:String(a.title).slice(0,180),handle:a.handle+'-'+j.id.slice(0,6),seoTitle:String(a.seoTitle||a.title).slice(0,70),seoDescription:String(a.seoDescription||'').slice(0,160),descriptionHtml:a.paragraphs.map(p=>`<p>${escape(p)}</p>`).join('')+`<p>One artwork per selection. ${j.delivery==='framed-only'?'Available stretched or in a float frame; not offered rolled.':''}</p>`,tags:[...new Set([...(a.tags||[]).filter(t=>allowed.includes(t)),'new-arrival','oversized-art','ratio-'+j.analysis.ratio.replace(':','-')])]};j.title=j.copy.title;j.collections=matchingCollections(all,j.copy.tags);if(!j.collections.some(c=>c.handle==='all-products'))throw Error('缺少 all-products 集合');s.save(j);});
 await this.step(j,'发布前复核',async()=>{const fresh=await this.shopify.pricing(j.config.profiles[j.analysis.ratio],j.delivery,j.id);if(JSON.stringify(fresh.variants)!==JSON.stringify(j.pricing.variants))throw Error('统一价格表或可售组合已变化，请重新核对后继续');for(const slot of mediaSlots(j)){const a=s.active(j,slot);if(!a?.accepted)throw Error('素材未全部通过程序检查');if(usesArtDirection(j)&&slot.startsWith('scene-')){if(j.artDirection?.masterHash!==s.active(j,'master').sha256||a.masterHash!==s.active(j,'master').sha256)throw Error('场景与主画来源已失效');}}});
  if(j.mediaProfile==='responsive-v1'&&!composedScenes(j)&&!bakedScenes(j)){const note=await this.shopify.verifyMediaProfile(j);if(note)s.event(j,note);}
 if(!j.productId)await this.step(j,'创建商品草稿',async()=>{const found=await this.shopify.find(`canvasra-studio-${j.id}`);if(found.length>1)throw Error('发现重复任务标记，请核对商品');j.productId=found[0]?.id||await external(s,j,'创建 Shopify 草稿',()=>this.shopify.create(j));s.save(j);});
 if(!j.mediaAttached)await this.step(j,'上传商品素材',async()=>{await external(s,j,'上传 Shopify 媒体',()=>this.shopify.upload(s,j));j.mediaAttached=true;s.save(j);});
 await this.step(j,'核对线上草稿',async()=>{let p;for(let i=0;i<12;i++){p=await this.shopify.product(j.productId);if(p.media.nodes.every(x=>x.status==='READY')&&p.media.nodes.length===mediaSlots(j).length&&j.collections.every(c=>p.collections.nodes.some(x=>x.id===c.id)))break;await new Promise(r=>setTimeout(r,5000));}validateProduct(j,p);j.remote=p;atomic(path.join(s.jobDir(j.id),'shopify-readback.json'),p);s.save(j);});
  if((composedScenes(j)||bakedScenes(j))&&j.target==='publish'){try{const note=await this.shopify.verifyMediaProfile(j);if(note)s.event(j,note);}catch(e){j.status='awaiting-theme';j.stage='草稿已就绪，等待店铺换框支持';j.error=e.message;s.event(j,e.message);return;}}
 if(j.target==='publish'){await this.step(j,'发布到店铺',async()=>{await external(s,j,'发布 Shopify',()=>this.shopify.publish(j.productId));const p=await this.shopify.product(j.productId);validateProduct(j,p);if(p.status!=='ACTIVE'||!p.resourcePublications.nodes.some(x=>x.isPublished&&x.publication.name==='Online Store'))throw Error('发布回读未通过');j.remote=p;j.url=p.onlineStoreUrl;s.save(j);});j.status='published';}else j.status='draft';j.stage='完成';s.event(j,j.target==='publish'?'商品已发布，回读验证通过':'商品草稿已创建，回读验证通过');
 }catch(e){if(e instanceof Pause)return;throw e;}}
}
class Pause extends Error{}
export function validateProduct(j,p){verifySceneMetafield(j,p);if(!p||p.id!==j.productId)throw Error('商品回读不匹配');for(const key of ['variants','media','collections','resourcePublications'])if(p[key].pageInfo.hasNextPage)throw Error('回读数据不完整');if(p.title!==j.copy.title||p.handle!==j.copy.handle||p.variants.nodes.length!==j.pricing.variants.length)throw Error('商品内容或变体数量不符');for(const v of j.pricing.variants){const actual=p.variants.nodes.find(a=>a.selectedOptions.some(o=>o.name==='Size'&&o.value===v.size)&&a.selectedOptions.some(o=>o.name==='Frame'&&o.value===v.frame));if(!actual||actual.price!==v.price||actual.compareAtPrice!==v.compareAtPrice||!actual.availableForSale||actual.inventoryPolicy!==v.inventoryPolicy)throw Error('变体价格、原价或可售状态不符');}const media=mediaEntries(j);if(p.media.nodes.length!==media.length||p.media.nodes.some(m=>m.status!=='READY'))throw Error('媒体尚未就绪');for(let i=0;i<media.length;i++){const e=media[i],m=p.media.nodes[i],d=j.mediaDimensions?.[e.alt]||mediaEntrySize(j,e);if(!d||m.image.width!==d.width||m.image.height!==d.height)throw Error('媒体尺寸或顺序不符');if(m.alt!==e.alt)throw Error('媒体标识不符');}for(const c of j.collections)if(!p.collections.nodes.some(x=>x.id===c.id))throw Error('集合归属不符');}
