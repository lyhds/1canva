import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import sharp from 'sharp';import {chromium} from 'playwright';
import {bannerHTML} from './product-studio/render.js';import {BANNER_VIEWPORTS,bannerRatio} from './product-studio/banner.js';import {mediaAlt} from './product-studio/media.js';

test('banner profiles preserve saved v1 media contracts',()=>{assert.equal(bannerRatio({}),'3:2');assert.equal(mediaAlt('scene-desktop'),'scene-room-desktop-v1');const j={bannerProfile:'fullbleed-v2'};assert.equal(bannerRatio(j),'21:9');assert.equal(mediaAlt('scene-desktop',j),'scene-room-desktop-v2');});

// The browser-backed case is bounded on purpose: node:test has no default timeout, so a stalled
// Chromium launch or page evaluation used to hang the whole suite instead of failing it.
test('v2 covers ultra-wide viewport beyond body cap and preserves all six art ratios',{timeout:120000},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'canvasra-banner-'));let browser;
 t.after(async()=>{await browser?.close();fs.rmSync(dir,{recursive:true,force:true});});
 browser=await chromium.launch({headless:true,timeout:60000,channel:process.env.CANVASRA_BROWSER_CHANNEL||undefined});
 await sharp({create:{width:2100,height:900,channels:3,background:'#dedad3'}}).png().toFile(path.join(dir,'room.png'));const store={file:(id,f)=>path.join(dir,f),active:(j,s)=>j.assets[s]};const page=await browser.newPage();
 for(const profile of ['fullbleed-v2','clearance-v3'])for(const [w,h]of [[3,4],[2,3],[1,1],[4,3],[3,2],[2,1]]){
  await sharp({create:{width:w*100,height:h*100,channels:3,background:'#459bc6'}}).png().toFile(path.join(dir,'art.png'));const j={id:'test',title:'Banner test',bannerProfile:profile,assets:{master:{file:'art.png',width:w*100,height:h*100},'scene-desktop':{file:'room.png',width:2100,height:900}}};const html=await bannerHTML(store,j);
  for(const viewport of BANNER_VIEWPORTS){await page.setViewportSize(viewport);await page.setContent(html);await page.locator('img').evaluateAll(imgs=>Promise.all(imgs.map(i=>i.decode())));const r=await page.evaluate(()=>{const rect=s=>{const b=document.querySelector(s).getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height,right:b.right,bottom:b.bottom}};return {hero:rect('[data-desktop-product-hero]'),room:rect('[data-scene-layout] > div > div'),art:rect('[data-frame-box]'),image:rect('.frame-art-image'),label:rect('.desktop-product-intro')}});assert(Math.abs(r.hero.x)<1);assert.equal(r.hero.w,viewport.width);assert.equal(r.hero.h,viewport.height);assert(r.room.x<=.5&&r.room.right>=viewport.width-.5&&r.room.y<=.5&&r.room.bottom>=viewport.height-.5);assert(r.art.x>12&&r.art.right<viewport.width-12&&r.art.y>76&&r.art.bottom<r.label.y-12,JSON.stringify({ratio:[w,h],viewport,r}));assert(Math.abs(r.image.w/r.image.h-w/h)<.001);}
 }
});
