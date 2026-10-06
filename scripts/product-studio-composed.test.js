import {priceTable} from './product-studio/price-table.js';
import {seedModelKeys} from './test-support/studio-settings.js';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import sharp from 'sharp';
import {Store} from './product-studio/store.js';import {Pipeline} from './product-studio/pipeline.js';import {sceneHTML} from './product-studio/render.js';import {COMPOSED_SCENE,COMPOSED_CHECKS,composedPrompt,bakedFramePrompt,validateComposedQA} from './product-studio/composed-scene.js';
import {directionPrompt} from './product-studio/art-direction.js';
import {locateSceneEdges} from './product-studio/scene-edges.js';
const review=()=>({checks:Object.fromEntries(COMPOSED_CHECKS.map(k=>[k,true])),artworkBounds:{left:.35,top:.15,right:.65,bottom:.7},objects:[{name:'sofa',left:.2,top:.8,right:.8,bottom:.95}],lighting:{direction:'Soft light from left',softness:'Broad diffuse',contactShadow:'Narrow attached edge',castShadow:'Short soft shadow to right'},issues:[],reason:'Single frontal canvas with light and clear edges'});
async function fixture(t){const s=seedModelKeys(new Store(fs.mkdtempSync(path.join(os.tmpdir(),'composed-scene-'))));t.after(()=>fs.rmSync(s.dir,{recursive:true,force:true}));const j=s.create({});j.config={autoRecovery:true,maxAttempts:3,vision:{},image:{model:'test'}};j.analysis={ratio:'3:4',palette:'warm'};const art=await sharp({create:{width:300,height:400,channels:3,background:'red'}}).png().toBuffer(),room=await sharp({create:{width:400,height:500,channels:3,background:'beige'}}).png().toBuffer();s.addAsset(j,'master',art,{width:300,height:400,accepted:true});return {s,j,art,room};}
test('complete scenes request the original painting, coherent light and natural attached shadows',()=>{const prompt=composedPrompt({analysis:{}},'scene-desktop','21:9');assert.match(prompt,/image 2 is the exact original artwork/i);assert.match(prompt,/Do NOT enlarge\/darken the shadow/);
 // Only the large-format scene defends the canvas from being shrunk; the wide hero is
 // room-led and must never be widened to fill its frame.
 const statement=composedPrompt({analysis:{}},'scene-3','4:5');
 assert.match(statement,/Do not shrink the artwork/);assert.doesNotMatch(prompt,/Do not shrink the artwork/);
 // One generated scene painted a literal lighter rectangle on the wall because the
 // contrast requirement named a "panel"; the wall colour itself must carry it.
 assert.match(prompt,/never by painting a separate panel, rectangle, border, mat or outline/);
 // The frame overlay is composited on top of the whole scene, so anything rising in
 // front of the canvas reads as if it passed behind the frame; clearance has to be
 // judged from the camera, not from the floor plan.
 assert.match(prompt,/at least 4% of the image height clear/);
 assert.match(prompt,/Judge occlusion from the camera's viewpoint/);
 assert.match(prompt,/no plant, vase, lamp, chair back, tabletop object/);});
test('a faint canvas edge falls back to the model estimate instead of failing the scene',async()=>{
 // A scene whose wall tone matches the canvas can miss the contrast threshold on one
 // edge by a fraction; the other edges are crisp, so the box stays anchored in pixels.
 const W=400,H=500;
 const svg=`<svg width="${W}" height="${H}">
  <defs><linearGradient id="g" x1="0" y1="150" x2="0" y2="410" gradientUnits="userSpaceOnUse">
   <stop offset="0" stop-color="rgb(200,190,175)"/><stop offset="1" stop-color="rgb(120,110,100)"/>
  </linearGradient></defs>
  <rect width="${W}" height="${H}" fill="rgb(200,190,175)"/>
  <rect x="100" y="150" width="200" height="260" fill="url(#g)"/>
 </svg>`;
 const bytes=await sharp(Buffer.from(svg)).png().toBuffer();
 const estimate={left:0.25,top:0.30,right:0.75,bottom:0.82};
 const mapping=await locateSceneEdges(bytes,estimate,200/260);
 assert.equal(mapping.verified,true);
 assert.equal(mapping.method,'frontal-edge-with-estimate-fallback');
 assert.equal(mapping.evidence.top.source,'estimate','the blending top edge must fall back');
 assert.equal(mapping.bounds.top,estimate.top);
 for(const edge of ['left','right','bottom'])assert.equal(mapping.evidence[edge].source,'pixel',edge);

 // With no usable edge anywhere there is no image evidence, so it must still refuse.
 const flat=await sharp({create:{width:W,height:H,channels:3,background:'#c8beb0'}}).png().toBuffer();
 await assert.rejects(()=>locateSceneEdges(flat,{left:.25,top:.3,right:.75,bottom:.82},200/260),/四条边都不清晰/);
});

test('the three scenes carry different artwork scales so the set reads small to large',()=>{
 const medium=composedPrompt({analysis:{}},'scene-1','4:5');
 const small=composedPrompt({analysis:{}},'scene-2','4:5');
 const large=composedPrompt({analysis:{}},'scene-3','4:5');
 const desktop=composedPrompt({analysis:{}},'scene-desktop','21:9');
 assert.match(medium,/MEDIUM setting/);assert.match(small,/SMALL, intimate setting/);
 assert.match(large,/LARGE-FORMAT statement setting/);
 assert.doesNotMatch(medium,/LARGE-FORMAT/);assert.doesNotMatch(small,/LARGE-FORMAT/);
 // The wide hero is room-led: asking for a big canvas inside a 21:9 frame made the
 // generator re-proportion a 3:4 artwork to 1.11, so only scene-3 is the statement.
 assert.match(desktop,/ROOM-LED wide composition/);
 assert.doesNotMatch(desktop,/LARGE-FORMAT/);
 assert.match(desktop,/middle 60% of the image height/);
 assert.match(medium,/do not enlarge it to fill the wall/);assert.match(small,/do not enlarge it to fill the wall/);
 assert.doesNotMatch(medium,/Do not shrink the artwork/);assert.doesNotMatch(small,/Do not shrink the artwork/);
 assert.doesNotMatch(desktop,/Do not shrink the artwork/);
 assert.match(large,/Do not shrink the artwork/);
});
test('scene prompt states the artwork ratio numerically, and still builds without a master',()=>{ const withMaster=composedPrompt({analysis:{},assets:{master:[{width:2048,height:1024}]}},'scene-1','4:5');
 assert.match(withMaster,/2048x1024 px/);assert.match(withMaster,/2:1 width-to-height ratio/);assert.match(withMaster,/the scene ratio is not the artwork ratio/);
 const withoutMaster=composedPrompt({analysis:{}},'scene-1','4:5');
 assert.doesNotMatch(withoutMaster,/\d+x\d+ px/);assert.match(withoutMaster,/never stretch, squash, crop or re-proportion/);
});
 test('composed generation preserves references without any AI quality review',async t=>{const {s,j,art,room}=await fixture(t);let generations=0;const p=new Pipeline(s,{}, {vision:async()=>assert.fail('Generation must not call a reviewer'),generate:async(c,prompt,ratio,refs,options)=>{generations++;assert.deepEqual(refs,[room,art]);assert.equal(options.backgroundOnly,false);assert.doesNotMatch(prompt,/NEVER paint the product/);return {bytes:room};}});p.assessScene=async()=>assert.fail('No empty-room or multi-frame QA');await p.make(j,'scene-1','legacy empty prompt','4:5',[room]);const a=s.active(j,'scene-1');assert.equal(a.sceneWorkflow,COMPOSED_SCENE);assert.equal(a.accepted,true);assert.equal(a.qa,undefined);assert.equal(a.artworkBounds,undefined);await p.make(j,'scene-1','unused','4:5',[room]);assert.equal(generations,1);const html=await sceneHTML(s,j,'scene-1');assert.equal((html.match(/<img /g)||[]).length,1);assert.doesNotMatch(html,/frame-preview|frame-box/);});
test('style-only scenes design the room themselves when the library is empty',()=>{
 const styleOnly={analysis:{},sceneStyle:'warm-wood',selection:[{styleOnly:true},{styleOnly:true},{styleOnly:true}]};
 const p=composedPrompt(styleOnly,'scene-1','4:5');
 assert.doesNotMatch(p,/Image 1 is the room reference/);
 assert.match(p,/Image 1 is the exact original artwork/);
 assert.match(p,/No room reference photo is provided: design the room yourself/);
 assert.match(p,/walnut or teak/); // the selected style directive drives the room
 assert.doesNotMatch(p,/Room reference cues may be adapted|image 2 artwork/);
 assert.match(p,/The artwork must not be redesigned\./);
 const desktop=composedPrompt({...styleOnly},'scene-desktop','21:9');
 assert.doesNotMatch(desktop,/Image 1 is the room reference/);
 assert.doesNotMatch(desktop,/borrow the scene-3 room materials/);
 // With art direction on, the desktop hero borrows the generated scene-3 room again.
 const artDirDesktop=composedPrompt({analysis:{},artDirectionProfile:'artwork-led-v1',selection:styleOnly.selection},'scene-desktop','21:9');
 assert.match(artDirDesktop,/Image 1 is the room reference/);
 assert.match(artDirDesktop,/borrow the scene-3 room materials/);
 // Style presets stay optional: without one the room follows the artwork plan alone.
 const automatic=composedPrompt({analysis:{},selection:styleOnly.selection},'scene-1','4:5');
 assert.match(automatic,/design a coherent, restrained interior yourself/);
});
test('planning and every finished scene use the current master geometry without leaking creation instructions',()=>{
 for(const ratio of ['3:4','2:3','1:1','4:3','3:2','2:1']){
  const [w,h]=ratio.split(':').map(Number);
  const job={sceneWorkflow:'baked-frames-v1',analysis:{ratio:'5:7',palette:'warm linen',masterPrompt:'RECOMPOSE_AND_ADJUST_PROPORTIONS'},assets:{master:[{width:500,height:700},{width:w*400,height:h*400}]}};
  const plan=directionPrompt(job);
  assert.ok(plan.includes(`${ratio} width-to-height ratio`));
  for(const build of [composedPrompt,bakedFramePrompt])for(const slot of ['scene-1','scene-2','scene-3','scene-desktop']){
   const outputRatio=slot==='scene-desktop'?'21:9':'4:5',p=build(job,slot,outputRatio);
   assert.ok(p.includes(`${w*400}x${h*400} px`));
   assert.ok(p.includes(`${ratio} width-to-height ratio: ${w} units wide for every ${h} units high`));
   assert.doesNotMatch(p,/RECOMPOSE_AND_ADJUST_PROPORTIONS|5:7|500x700/);
   assert.match(p,/scale width and height together by the same factor/);
   assert.match(p,/excluding frame rails and shadow/);
   assert.ok(p.includes(`The ${outputRatio} output format changes the room composition only`));
   if(slot==='scene-desktop')assert.match(p,/proportion error in the earlier scene is not carried forward/);
  }
 }
 // Historical jobs without master dimensions still get the known numeric ratio.
 assert.match(bakedFramePrompt({analysis:{ratio:'2:3'}},'scene-1','4:5'),/2:3 width-to-height ratio/);
});

test('portrait canvases in the wide hero get side seating instead of a squeeze',()=>{
 const portrait=composedPrompt({analysis:{ratio:'3:4'}},'scene-desktop','21:9');
 assert.match(portrait,/middle 60% of the image height/);
 assert.match(portrait,/to the left and right sides of the artwork instead of directly beneath it/);
 const landscape=composedPrompt({analysis:{ratio:'3:2'}},'scene-desktop','21:9');
 const square=composedPrompt({analysis:{ratio:'1:1'}},'scene-desktop','21:9');
 const noRatio=composedPrompt({analysis:{}},'scene-desktop','21:9');
 for(const prompt of [landscape,square,noRatio])assert.doesNotMatch(prompt,/instead of directly beneath it/);
 assert.doesNotMatch(composedPrompt({analysis:{ratio:'3:4'}},'scene-1','4:5'),/instead of directly beneath it/);
});
test('complete-scene QA rejects frames, missing boundaries and furniture collisions',()=>{const r=review();r.checks.unframed=false;assert.equal(validateComposedQA(r).pass,false);const b=review();b.objects[0].top=.6;assert.equal(validateComposedQA(b).pass,false);assert.throws(()=>validateComposedQA({...review(),artworkBounds:null}),/坐标/);});
test('new workflow preserves old scene versions and does not reuse accepted empty backgrounds',async t=>{const {s,j,room}=await fixture(t);s.addAsset(j,'scene-1',room,{width:400,height:500,accepted:true});const p=new Pipeline(s,{}, {vision:async()=>assert.fail('Generation must not call a reviewer'),generate:async()=>({bytes:room})});await p.make(j,'scene-1','unused','4:5',[room]);assert.equal(j.assets['scene-1'].length,2);assert.equal(j.attempts[COMPOSED_SCENE+':scene-1'],1);assert.equal(j.assets['scene-1'][0].accepted,true);});
test('finished scene workflow stops before Shopify content writes',async t=>{const {s,j,art,room}=await fixture(t);j.publicationRequested=false;delete j.artDirectionProfile;j.pricing={priceTableVersion:priceTable.version,variants:[]};j.selection=[1,2,3].map(n=>({file:`ref-${n}.png`}));for(const r of j.selection)fs.writeFileSync(s.file(j.id,r.file),room);s.addAsset(j,'reference',art,{width:300,height:400,accepted:true});j.config.vision=j.config.image={endpoint:'https://example.com',model:'test',apiKey:'test'};const p=new Pipeline(s,{create:async()=>assert.fail('No Shopify writes'),verifyMediaProfile:async()=>assert.fail('Integration deferred')});p.make=async(job,slot)=>{if(slot!=='master')s.addAsset(j,slot,room,{width:400,height:500,accepted:true,sceneWorkflow:COMPOSED_SCENE});};await p.run(j);assert.equal(j.status,'scenes-ready');assert.equal(j.productId,undefined);});
