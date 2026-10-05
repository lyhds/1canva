import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBackground} from './product-studio/background.js';
import {generate} from './product-studio/providers.js';
const footprint={left:.42,top:.18,right:.58,bottom:.64};
test('furniture below the actual frame or beside it does not collide with the larger mount',()=>{
 const r=validateBackground({emptyWall:true,evidence:'Furniture below',furnitureClear:false,objects:[{name:'sofa',left:.3,top:.75,right:.65,bottom:.95},{name:'side table',left:.7,top:.6,right:.78,bottom:.9}]},footprint);
 assert.equal(r.furnitureClear,true);assert.equal(r.collisions.length,0);
});
test('frame and shadow margin collisions are rejected using both axes',()=>{
 const r=validateBackground({emptyWall:true,evidence:'Pillow',objects:[{name:'pillow',left:.5,top:.65,right:.55,bottom:.8}]},footprint);assert.equal(r.furnitureClear,false);
 assert.throws(()=>validateBackground({emptyWall:true,evidence:'Bad coordinates',objects:[{name:'sofa',left:42,top:70,right:60,bottom:90}]},footprint),/坐标/);
});
test('room generation does not append the artwork-preservation instruction',async()=>{
 const bytes=Buffer.from('image');await generate({endpoint:'https://example.com/v1/images/edits',model:'gpt-image-2-vip',apiKey:'test',protocol:'openai-edit'},'Empty room','21:9',[bytes],{backgroundOnly:true,fetcher:async(url,options)=>{const prompt=options.body.get('prompt');assert.match(prompt,/empty room/);assert.doesNotMatch(prompt,/Preserve the complete artwork/);return Response.json({data:[{b64_json:bytes.toString('base64')}]});}});
});
