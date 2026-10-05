import sharp from 'sharp';

// V-API's documented image-edit limit: 4 MB per file, 1–4 references. The provider
// also enforces an input pixel gate (it rejects huge references), and the largest
// input already proven accepted is 2048×2048, hence the 4.5 MP ceiling.
export const REFERENCE_PIXEL_CAP = 4500000;

export async function editReferences(config,references){
 const limited=['api.vveai.com','api.gpt.ge'].includes(new URL(config.endpoint).hostname);
 if(limited&&(references.length<1||references.length>4))throw Error('该生图服务商要求 1–4 张参考图，未发送请求');
 const limit=4*1000*1000;
 return Promise.all(references.map(async bytes=>{
  if(!limited)return {bytes,type:'image/png',extension:'png'};
  let meta=null;
  try{meta=await sharp(bytes,{limitInputPixels:120000000}).metadata();}catch{meta=null;}
  // Not locally decodable: pass through unchanged, exactly as before.
  if(!meta)return {bytes,type:'image/png',extension:'png'};
  if(meta.width*meta.height<=REFERENCE_PIXEL_CAP&&bytes.length<limit)return {bytes,type:'image/png',extension:'png'};
  // Quality first (keeps the artwork's own pixels), then a dimension ladder; a large room
  // reference could never pass on quality alone, and skipping the scene blocked the task.
  // A copy is only sent when it clears the byte budget AND the pixel gate.
  for(const edge of [null,3072,2560,2048]){
   for(const quality of [92,88,84]){
    let img=sharp(bytes,{limitInputPixels:120000000}).rotate().flatten({background:'#ffffff'});
    if(edge)img=img.resize({width:edge,height:edge,fit:'inside',withoutEnlargement:true});
    const copy=await img.jpeg({quality,chromaSubsampling:'4:4:4'}).toBuffer();
    const out=await sharp(copy).metadata();
    if(copy.length<limit&&out.width*out.height<=REFERENCE_PIXEL_CAP)return {bytes:copy,type:'image/jpeg',extension:'jpg'};
   }
  }
  throw Error('参考图压缩后仍超过服务商限制（4 MB 或像素上限），未发送生图请求；原图已保留');
 }));
}

export async function errorDetails(response,authorization=''){
 const secret=authorization.replace(/^Bearer\s+/i,'');
 const scrub=value=>{let text=String(value||'');if(secret)text=text.split(secret).join('[redacted]');return text.replace(/Bearer\s+\S+/gi,'Bearer [redacted]').replace(/https?:\/\/\S+/gi,'[URL]').replace(/data:[^\s]+/gi,'[image data]').slice(0,400);};
 const meta={};const id=response.headers?.get('x-request-id')||response.headers?.get('request-id');if(id)meta.requestId=scrub(id);
 // Never retain HTML proxy pages or arbitrary response bodies.
 const reader=response.body?.getReader();if(!reader)return meta;let size=0;const chunks=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();return meta;}chunks.push(value);}const data=JSON.parse(Buffer.concat(chunks).toString());const error=data.error;if(error&&typeof error==='object'){if(typeof error.message==='string')meta.providerMessage=scrub(error.message);if(typeof error.code==='string'||typeof error.code==='number')meta.providerCode=scrub(error.code);}else if(typeof data.message==='string')meta.providerMessage=scrub(data.message);}
 catch{/* Preserve the HTTP status even when the error response cannot be read. */}
 return meta;
}
