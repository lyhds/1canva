import {sceneLayouts} from './scene-publication.js';
import {mediaAlt} from './media.js';
import {BANNER_VIEWPORTS} from './banner.js';
import fs from 'node:fs';import path from 'node:path';import {Liquid} from 'liquidjs';import {chromium} from 'playwright';import {ROOT} from './store.js';
const data=(file,mime)=>`data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
export function renderer(){const templates={};for(const name of ['frame-key','frame-preview','artwork-scene','composed-scene'])templates[name]=fs.readFileSync(path.join(ROOT,'snippets',name+'.liquid'),'utf8').replace(/{%-?\s*doc\s*-?%}[\s\S]*?{%-?\s*enddoc\s*-?%}/g,'');const liquid=new Liquid({templates});liquid.registerFilter('image_url',i=>i.src);liquid.registerFilter('asset_url',name=>data(path.join(ROOT,'assets',name),'image/webp'));return liquid;}
export async function sceneHTML(store,j,slot,frame='Oak Float Frame'){
 const master=store.active(j,'master'),room=store.active(j,slot);if(!master||!room)throw Error('缺少主图或场景');if(j.sceneWorkflow==='baked-frames-v1')return `<div data-composed-scene style="width:100%;height:100%"><img src="${data(store.file(j.id,room.file),'image/png')}" alt="带框场景" style="width:100%;height:100%;display:block;object-fit:contain"></div>`;if(room.sceneWorkflow==='composed-unframed-v1'&&!room.frameMapping?.verified)return `<div data-composed-scene style="width:100%;height:100%"><img src="${data(store.file(j.id,room.file),'image/png')}" alt="无外框完整场景" style="width:100%;height:100%;display:block;object-fit:contain"></div>`;return renderer().renderFile('artwork-scene',{scene_layouts:room.frameMapping?.verified?sceneLayouts(j):{},master:{src:data(store.file(j.id,master.file),'image/png'),width:master.width,height:master.height},room:{src:data(store.file(j.id,room.file),'image/png'),width:room.width,height:room.height,aspect_ratio:room.width/room.height,alt:mediaAlt(slot,{...j,sceneWorkflow:room.sceneWorkflow||'lighting-v1'})},frame,alt:j.title});
}
export async function sceneScreenshot(store,j,slot,frame='Oak Float Frame'){const browser=await chromium.launch({headless:true,channel:process.env.CANVASRA_BROWSER_CHANNEL||undefined});try{const viewport=slot==='scene-desktop'?{width:1440,height:960}:{width:750,height:j.mediaProfile==='responsive-v1'?938:1000};const page=await browser.newPage({viewport,deviceScaleFactor:1});await page.setContent(`<style>${fs.readFileSync(path.join(ROOT,'assets/theme.css'),'utf8')}body{margin:0;width:${viewport.width}px;height:${viewport.height}px}</style>${await sceneHTML(store,j,slot,frame)}`);await page.locator('img').evaluateAll(images=>Promise.all(images.map(i=>i.decode())));return await page.screenshot();}finally{await browser.close();}}

export async function bannerHTML(store,j,frame='Oak Float Frame') {
 if(store.active(j,'scene-desktop')?.sceneWorkflow==='composed-unframed-v1'&&!store.active(j,'scene-desktop')?.frameMapping?.verified)return `<style>${fs.readFileSync(path.join(ROOT,'assets/theme.css'),'utf8')}html,body{margin:0;width:100%;height:100%}[data-composed-scene] img{object-fit:contain!important}</style>${await sceneHTML(store,j,'scene-desktop',frame)}`;
 return `<style>${fs.readFileSync(path.join(ROOT,'assets/theme.css'),'utf8')}html{margin:0}body{margin-block:0} .banner-review-header{position:absolute;z-index:50;top:0;left:0;width:100%;height:64px;display:flex;align-items:center;justify-content:center;font:22px Georgia;letter-spacing:4px;color:#171717}</style><div class="banner-review-header">CANVASRA</div><div data-desktop-product-hero>${await sceneHTML(store,j,'scene-desktop',frame)}<a class="desktop-product-intro"><span><strong>${j.title.replace(/[<>&]/g,'')}</strong><span>Banner composition preview</span></span></a></div>`;
}

// This models the header/label exclusion zones. Live agent-browser QA is still required.
export async function bannerScreenshots(store,j,frame='Oak Float Frame') {
 const browser=await chromium.launch({headless:true,channel:process.env.CANVASRA_BROWSER_CHANNEL||undefined});
 try{const page=await browser.newPage();const html=await bannerHTML(store,j,frame),results=[];
  for(const viewport of BANNER_VIEWPORTS){await page.setViewportSize(viewport);await page.setContent(html);await page.locator('img').evaluateAll(images=>Promise.all(images.map(i=>i.decode())));
   const geometry=await page.evaluate(()=>{const box=e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};return {art:box(document.querySelector('[data-frame-box]')),room:box(document.querySelector('[data-scene-layout] > div > div')),hero:box(document.querySelector('[data-desktop-product-hero]')),label:box(document.querySelector('.desktop-product-intro'))}});
   const {art,room,hero,label}=geometry;const pass=room.left<=0.5&&room.top<=0.5&&room.right>=viewport.width-.5&&room.bottom>=viewport.height-.5&&art.left>=12&&art.right<=viewport.width-12&&art.top>=76&&art.bottom<=label.top-12&&Math.abs(hero.width-viewport.width)<1&&Math.abs(hero.height-viewport.height)<1;
   results.push({viewport,geometry,pass,bytes:await page.screenshot()});
  }return results;
 }finally{await browser.close();}
}

export const MOBILE_VIEWPORTS=[{width:375,height:667},{width:390,height:844}];
export async function mobileScreenshots(store,j,frame='Oak Float Frame') {
 const browser=await chromium.launch({headless:true,channel:process.env.CANVASRA_BROWSER_CHANNEL||undefined});
 try{const page=await browser.newPage(),results=[];
  const scene=await sceneHTML(store,j,'scene-3',frame);
  for(const viewport of MOBILE_VIEWPORTS){await page.setViewportSize(viewport);await page.setContent(`<style>${fs.readFileSync(path.join(ROOT,'assets/theme.css'),'utf8')}html,body{margin:0;width:100%;max-width:none}.mobile-review{width:100%;aspect-ratio:4/5}.review-header{position:absolute;top:0;left:0;width:100%;height:64px;z-index:50;display:flex;align-items:center;justify-content:center;font:20px Georgia;background:transparent}</style><div class="review-header">CANVASRA</div><div class="mobile-review">${scene}</div>`);await page.locator('img').evaluateAll(images=>Promise.all(images.map(i=>i.decode())));
   const geometry=await page.evaluate(()=>{const box=e=>{const r=e.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};return {art:box(document.querySelector('[data-frame-box]')),room:box(document.querySelector('.mobile-review'))}});
   const {art,room}=geometry;results.push({viewport,geometry,pass:art.top>=76&&art.left>=8&&art.right<=viewport.width-8&&art.bottom<=room.bottom-8,bytes:await page.screenshot()});
  }return results;
 }finally{await browser.close();}
}

export async function nativeFrameFootprint(store,j,slot){
 const room=store.active(j,slot),browser=await chromium.launch({headless:true,channel:process.env.CANVASRA_BROWSER_CHANNEL||undefined});
 try{const page=await browser.newPage({viewport:{width:room.width,height:room.height}}),boxes=[];
 for(const frame of [...new Set((j.pricing?.variants||[{frame:'Oak Float Frame'}]).map(v=>v.frame))]){await page.setContent(`<style>${fs.readFileSync(path.join(ROOT,'assets/theme.css'),'utf8')}html,body{margin:0;width:100%;height:100%;max-width:none}</style>${await sceneHTML(store,j,slot,frame)}`);boxes.push(await page.locator('[data-frame-box]').evaluate(e=>{const b=e.getBoundingClientRect();return {left:b.left/innerWidth,top:b.top/innerHeight,right:b.right/innerWidth,bottom:b.bottom/innerHeight};}));}
 return {left:Math.min(...boxes.map(b=>b.left)),top:Math.min(...boxes.map(b=>b.top)),right:Math.max(...boxes.map(b=>b.right)),bottom:Math.max(...boxes.map(b=>b.bottom))};
 }finally{await browser.close();}
}
