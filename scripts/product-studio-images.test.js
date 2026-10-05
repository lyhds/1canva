import sharp from 'sharp';
import crypto from 'node:crypto';
import {editReferences,errorDetails} from './product-studio/edit-references.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {generate,UncertainError} from './product-studio/providers.js';
import {bakedFramePrompt} from './product-studio/composed-scene.js';
import {downloadResultImage,imageBytes,editSize,publicAddress,publicDohAddresses} from './product-studio/image-response.js';
import {shrinkForUpload} from './product-studio/shopify.js';

const config={endpoint:'https://provider.example/v1/images/edits',apiKey:'SECRET',model:'gpt-image-2-vip',protocol:'openai-edit'};
const bytes=Buffer.from('test image payload');

test('image edit sends one reference as image, multiple as image[], exact size and one output',async()=>{
  for(const references of [[bytes],[bytes,bytes,bytes]]){
    const result=await generate(config,'Paint','4:5',references,{fetcher:async(url,options)=>{
      assert.equal(url,config.endpoint);assert.equal(options.method,'POST');
      const form=options.body;assert.ok(form instanceof FormData);
      const name=references.length===1?'image':'image[]';
      assert.equal(form.getAll(name).length,references.length);
      for(const file of form.getAll(name))assert.deepEqual(Buffer.from(await file.arrayBuffer()),bytes);
      assert.equal(form.get('n'),'1');assert.equal(form.get('size'),'1600x2000');
      // Do not force a delivery format: the gateway ignores response_format=url
      // and only honours b64_json, which streams the whole image back inline. The
      // field is omitted so the provider may still answer with a link, and a link
      // is recoverable because the receipt is saved before the download.
      assert.equal(form.get('response_format'),null);
      return Response.json({data:[{b64_json:bytes.toString('base64')}],usage:{images:1},cost:0.1});
    }});
    assert.deepEqual(result.bytes,bytes);assert.equal(result.costUSD,0.1);
  }
});

test('both image protocols send the painting ratio separately from the output format',async()=>{
 const job={analysis:{ratio:'2:1',masterPrompt:'CHANGE_THE_ARTWORK_SHAPE'},assets:{master:[{width:2048,height:1024}]}};
 const references=[Buffer.from('room'),Buffer.from('original artwork')];
 for(const protocol of ['openai-edit','json'])for(const ratio of ['4:5','21:9']){
  const prompt=bakedFramePrompt(job,ratio==='21:9'?'scene-desktop':'scene-1',ratio);
  await generate({...config,protocol},prompt,ratio,references,{fetcher:async(url,{body})=>{
   const payload=protocol==='openai-edit'?body:JSON.parse(body);
   const sentPrompt=protocol==='openai-edit'?payload.get('prompt'):payload.prompt;
   assert.match(sentPrompt,/2:1 width-to-height ratio/);
   assert.ok(sentPrompt.includes(`The ${ratio} output format changes the room composition only`));
   assert.doesNotMatch(sentPrompt,/CHANGE_THE_ARTWORK_SHAPE|Required composition ratio/);
   if(protocol==='openai-edit'){
    assert.match(sentPrompt,/whole output image, not the shape of a painting inside a room/);
    for(const [i,file] of payload.getAll('image[]').entries())assert.deepEqual(Buffer.from(await file.arrayBuffer()),references[i]);
   }else{
    assert.equal(payload.aspect_ratio,ratio);
    assert.deepEqual(payload.input_references.map(r=>Buffer.from(r.image_url.url.split(',')[1],'base64')),references);
   }
   return Response.json({data:[{b64_json:bytes.toString('base64')}]});
  }});
 }
});

test('URL results preserve receipt before download and never repeat generation after download failure',async()=>{
  const order=[];let requests=0;
  const response={data:[{url:'https://cdn.example/image.png?signature=SIGNED'}]};
  const options={fetcher:async()=>{requests++;return Response.json(response);},onResponse:async r=>{assert.deepEqual(r,response);order.push('saved');},download:async url=>{assert.equal(url,response.data[0].url);order.push('download');return bytes;}};
  assert.deepEqual((await generate(config,'Paint','3:4',[bytes],options)).bytes,bytes);
  assert.deepEqual(order,['saved','download']);assert.equal(requests,1);
  options.download=async()=>{throw Error('SECRET SIGNED');};
  await assert.rejects(generate(config,'Paint','3:4',[bytes],options),error=>error instanceof UncertainError&&!/SECRET|SIGNED/.test(error.message));
  assert.equal(requests,2);
});

test('base64 and legacy JSON remain compatible, unsupported results fail without a new paid call',async()=>{
  await assert.rejects(imageBytes({data:[{b64_json:'%%%'}]}));
  await assert.rejects(imageBytes({data:[]}));
  await assert.rejects(generate(config,'Paint','3:4',[bytes],{fetcher:async()=>Response.json({data:[]})}),UncertainError);
  let calls=0;
  await generate({...config,protocol:'reference-json'},'Paint','3:4',[bytes],{fetcher:async(url,options)=>{
    calls++;const body=JSON.parse(options.body);assert.equal(body.aspect_ratio,'3:4');assert.equal(body.input_references.length,1);
    return Response.json({data:[{b64_json:bytes.toString('base64')}]});
  }});
  assert.equal(calls,1);
  for(const ratio of ['3:4','2:3','1:1','4:3','3:2','2:1','4:5','21:9']){
    const [w,h]=editSize(config.model,ratio).split('x').map(Number),[rw,rh]=ratio.split(':').map(Number);
    // Both dimensions must be multiples of 16 and inside Shopify's media limits
    // (4472 px per side and 20 MP per image); the ratio must stay exact, and the
    // pixel budget must hold for every ratio — a square at the long-edge target
    // produced a 22.4 MB PNG and the staged upload failed with HTTP 400.
    assert.equal(w/h,rw/rh);assert.equal(w%16,0);assert.equal(h%16,0);
    assert.ok(w<=4472&&h<=4472&&w*h<=20000000,`${ratio} -> ${w}x${h} exceeds Shopify limits`);
    assert.ok(w*h<=6000000,`${ratio} -> ${w}x${h} (${(w*h/1e6).toFixed(2)} MP) exceeds the pixel budget`);
    // The long edge snaps to a multiple of 16, so it can land just under 2048.
    assert.ok(Math.max(w,h)>=2000,`${ratio} -> ${w}x${h} fell below the 2K long edge`);
  }
  assert.equal(editSize('other-model','4:5'),'auto');
  // The 2.5 family must receive the same explicit size, not 'auto': auto let the
  // provider pick 1122x1402 instead of the size the catalog expects.
  assert.equal(editSize('gpt-image-2.5-sunburst','4:5'),editSize('gpt-image-2-vip','4:5'));
  assert.equal(editSize('gpt-image-2.5-sunburst','4:5'),'1600x2000');
  // A 2K long edge keeps the heaviest asset (1:1, 2048x2048 ≈ 11 MB) far below
  // Shopify's 20 MB ceiling; larger targets were tried and reverted.
  assert.equal(editSize('gpt-image-2-vip','21:9'),'2016x864');
  assert.equal(editSize('gpt-image-2-vip','2:1'),'2048x1024');
  assert.equal(editSize('gpt-image-2-vip','1:1'),'2048x2048');
  const [sceneW]=editSize('gpt-image-2-vip','4:5').split('x').map(Number);
  assert.ok(sceneW>=1600,`4:5 scene width ${sceneW} fell below the 2K target`);
  assert.equal(editSize('gpt-image-3-preview','4:5'),'auto');
});

test('an oversized asset is uploaded as a web-sized copy instead of failing the upload',async()=>{
 // A 1:1 master at the old long edge produced a 22.4 MB PNG and Shopify answered the
 // staged upload with HTTP 400. The copy must fit the ceiling and keep the ratio.
 const original=await sharp({create:{width:2600,height:2600,channels:3,background:'#8a8a8a'}}).png({compressionLevel:0}).toBuffer();
 const limit=Math.ceil(original.length/2);
 const copy=await shrinkForUpload(original,limit);
 assert.ok(copy.bytes.length<=limit,'copy must respect the ceiling');
 assert.equal(copy.width,copy.height,'the ratio must survive the downscale');
 assert.ok(copy.width<2600,'the copy must actually be smaller');
 // A tiny limit that no edge can satisfy must fail loudly rather than upload anyway.
 await assert.rejects(()=>shrinkForUpload(original,64),/20 MB/);
});

test('image downloads reject private destinations, strip credentials and recheck redirects',async()=>{
  for(const address of ['127.0.0.1','10.0.0.1','169.254.169.254','172.16.0.1','192.168.0.1','100.64.0.1','::1','::ffff:127.0.0.1','fc00::1'])assert.equal(publicAddress(address),false);
  for(const address of ['8.8.8.8','2606:4700:4700::1111'])assert.equal(publicAddress(address),true);
  for(const url of ['http://cdn.example/a','https://127.0.0.1/a','https://[::1]/a','https://user:SECRET@cdn.example/a','https://cdn.example:444/a']){
    await assert.rejects(downloadResultImage(url,{get:()=>assert.fail('must not connect')}));
  }
  const lookup=(_,options,callback)=>callback(null,[{address:'8.8.8.8',family:4}]);
  const get=(url,options,callback)=>{
    assert.equal(options.headers.Authorization,undefined);assert.equal(options.headers.Cookie,undefined);
    const req=new EventEmitter();
    queueMicrotask(()=>options.lookup(url.hostname,{all:true},(error,addresses)=>{
      if(error){req.emit('error',error);return;}
      assert.equal(addresses[0].address,'8.8.8.8');
      const response=Readable.from([bytes]);response.statusCode=200;response.headers={};callback(response);
    }));return req;
  };
  assert.deepEqual(await downloadResultImage('https://cdn.example/image.png',{get,lookup}),bytes);
  await assert.rejects(downloadResultImage('https://cdn.example/image.png',{get,lookup:(_,options,cb)=>cb(null,[{address:'127.0.0.1',family:4}]),verifyHost:async()=>false}));
  const redirectGet=(url,options,callback)=>{
    const req=new EventEmitter();queueMicrotask(()=>{const r=Readable.from([]);r.statusCode=302;r.headers={location:'https://127.0.0.1/private'};callback(r);});return req;
  };
  await assert.rejects(downloadResultImage('https://cdn.example/image.png',{get:redirectGet,lookup}));
});

test('fake-IP answers need an independent resolver and fail closed without one',async()=>{
  const fakeLookup=(_,options,callback)=>callback(null,[{address:'198.18.1.22',family:4}]);
  const get=(url,options,callback)=>{
    const req=new EventEmitter();
    queueMicrotask(()=>options.lookup(url.hostname,{all:true},(error,addresses)=>{
      if(error){req.emit('error',error);return;}
      // The proxied address must still be used, or a transparent proxy cannot route it.
      assert.equal(addresses[0].address,'198.18.1.22');
      const response=Readable.from([bytes]);response.statusCode=200;response.headers={};callback(response);
    }));return req;
  };
  const asked=[];
  assert.deepEqual(await downloadResultImage('https://cdn.example/image.png',{get,lookup:fakeLookup,verifyHost:async host=>{asked.push(host);return true;}}),bytes);
  assert.deepEqual(asked,['cdn.example']);
  await assert.rejects(downloadResultImage('https://cdn.example/image.png',{get,lookup:fakeLookup,verifyHost:async()=>false}));
  await assert.rejects(downloadResultImage('https://cdn.example/image.png',{get,lookup:fakeLookup,verifyHost:async()=>{throw Error('resolver unreachable');}}));
  // A real private address must never reach the independent resolver, not even
  // when it arrives beside a public or a placeholder answer.
  let consulted=0;
  for(const addresses of [[{address:'10.0.0.1',family:4},{address:'8.8.8.8',family:4}],[{address:'198.18.1.22',family:4},{address:'10.0.0.1',family:4}]]){
    await assert.rejects(downloadResultImage('https://cdn.example/image.png',{get,lookup:(_,options,cb)=>cb(null,addresses),verifyHost:async()=>{consulted++;return true;}}));
  }
  assert.equal(consulted,0);
});

test('DNS-over-HTTPS confirmation rejects private, empty, failed and non-zero answers',async()=>{
  const doh=(A,AAAA=[],Status=0)=>({ok:true,json:async()=>({Status,Answer:[...A.map(data=>({type:1,data})),...AAAA.map(data=>({type:28,data}))]})});
  assert.equal(await publicDohAddresses('cdn.example',async()=>doh(['3.175.213.136'])),true);
  assert.equal(await publicDohAddresses('cdn.example',async()=>doh(['3.175.213.136'],['2606:4700:4700::1111'])),true);
  assert.equal(await publicDohAddresses('cdn.example',async()=>doh(['127.0.0.1'])),false);
  assert.equal(await publicDohAddresses('cdn.example',async()=>doh([],['fc00::1'])),false);
  assert.equal(await publicDohAddresses('cdn.example',async()=>doh([])),false);
  assert.equal(await publicDohAddresses('cdn.example',async()=>doh([],[],3)),false);
  assert.equal(await publicDohAddresses('cdn.example',async()=>({ok:false,json:async()=>({})})),false);
  let calls=0;
  assert.equal(await publicDohAddresses('cdn.example',async()=>{calls++;throw Error('offline');}),false);
  assert.equal(calls,2); // both endpoints are tried once, then it fails closed
});

test('V-API oversized reference becomes a bounded upload copy; other providers are unchanged',async()=>{
 const pixels=Buffer.alloc(1500*1500*3);for(let i=0;i<pixels.length;i++)pixels[i]=(i*31+Math.floor(i/7)*53)%256;
 const original=await sharp(pixels,{raw:{width:1500,height:1500,channels:3}}).png({compressionLevel:0}).toBuffer();assert.ok(original.length>4000000);
 const [copy]=await editReferences({...config,endpoint:'https://api.vveai.com/v1/images/edits'},[original]);assert.ok(copy.bytes.length<4000000);assert.equal(copy.type,'image/jpeg');assert.equal((await sharp(copy.bytes).metadata()).width,1500);assert.equal((await editReferences(config,[original]))[0].bytes,original);
 await assert.rejects(()=>editReferences({...config,endpoint:'https://api.vveai.com/v1/images/edits'},Array(5).fill(bytes)),/1–4/);
});
test('HTTP 500 saves sanitized provider reason and request id without retrying',async()=>{
 let calls=0;const meta={};await assert.rejects(()=>generate(config,'Paint','4:5',[bytes],{onMeta:async m=>Object.assign(meta,m),fetcher:async()=>{calls++;return Response.json({error:{message:'upstream failed SECRET https://private.example/key',code:'upstream_error'}},{status:500,headers:{'x-request-id':'req-123'}});}}),e=>e instanceof UncertainError&&e.message.includes('upstream failed')&&!e.message.includes('SECRET'));
 assert.equal(calls,1);assert.equal(meta.requestId,'req-123');assert.equal(meta.providerCode,'upstream_error');assert.equal(meta.httpStatus,500);assert.ok(!JSON.stringify(meta).includes('private.example'));
 assert.deepEqual(await errorDetails(new Response('<html>bad gateway</html>',{status:500})),{});
});

test('V-API multi-reference edit repeats image field instead of image brackets',async()=>{
 let calls=0;await generate({...config,endpoint:'https://api.vveai.com/v1/images/edits'},'Room','4:5',[bytes,bytes],{fetcher:async(u,o)=>{calls++;assert.equal(o.body.getAll('image').length,2);assert.equal(o.body.getAll('image[]').length,0);return Response.json({data:[{b64_json:bytes.toString('base64')}]});}});assert.equal(calls,1);
});

test('compresses a large reference image below the provider limit instead of skipping it',async()=>{
  // A 6000px reference cannot pass on JPEG quality alone; it must be downscaled, or the
  // scene is skipped and the whole task stops.
  const {editReferences}=await import('./product-studio/edit-references.js');
  const noisy=await sharp(crypto.randomBytes(3000*2000*3),{raw:{width:3000,height:2000,channels:3}}).png().toBuffer();
  assert.ok(noisy.length>4*1000*1000,'fixture must start above the limit');
  const [out]=await editReferences({endpoint:'https://api.vveai.com/v1/images/edits'},[noisy]);
  assert.ok(out.bytes.length<4*1000*1000,'must land under the provider limit');
  const meta=await sharp(out.bytes).metadata();
  assert.ok(Math.max(meta.width,meta.height)<=3072,'must be downscaled, not just requantised');
});

test('a reference above the 40 MP decode guard is downscaled instead of aborting the scene',async()=>{
  // Mirrors the real failure: an 8533×4800 Bigsize room reference (≈41 MP) made sharp's
  // decode guard throw "Input image exceeds pixel limit" before any resize was tried.
  const {editReferences}=await import('./product-studio/edit-references.js');
  const huge=await sharp({create:{width:8533,height:4800,channels:3,background:{r:120,g:112,b:98}}}).jpeg({quality:80}).toBuffer();
  const [out]=await editReferences({endpoint:'https://api.vveai.com/v1/images/edits'},[huge]);
  const meta=await sharp(out.bytes).metadata();
  assert.ok(meta.width*meta.height<=4500000,'must land inside the provider pixel budget');
  assert.ok(out.bytes.length<4*1000*1000,'must land under the provider byte limit');
});
