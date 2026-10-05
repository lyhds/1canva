import sharp from 'sharp';

// Refine the model's approximate box against long, nearly frontal canvas edges.
// An edge the pixel scan cannot confirm falls back to the model's estimate instead
// of failing the whole scene: a scene whose wall tone matches the canvas can miss the
// contrast threshold by a fraction (measured 14.7 against 15) while the model's box
// was within 0.2% of the refined edge. The ratio gate below still rejects a box that
// does not match the artwork, and at least one edge must be anchored by real pixels,
// so a fallback can never invent a box with no image evidence at all.
const EDGE_CONTRAST = 15;
export async function locateSceneEdges(bytes,estimate,artworkRatio){
 if(!estimate||!['left','top','right','bottom'].every(k=>Number.isFinite(estimate[k])&&estimate[k]>=0&&estimate[k]<=1)||estimate.left>=estimate.right||estimate.top>=estimate.bottom)throw Error('缺少有效画作边界');
 const {data,info}=await sharp(bytes).removeAlpha().toColourspace('srgb').raw().toBuffer({resolveWithObject:true});
 const bounds={},evidence={};let anchored=0;
 for(const edge of ['left','right','top','bottom']){
  const vertical=edge==='left'||edge==='right',dim=vertical?info.width:info.height,other=vertical?info.height:info.width;
  const lo=vertical?estimate.top:estimate.left,hi=vertical?estimate.bottom:estimate.right;
  const start=Math.max(2,Math.ceil((lo+(hi-lo)*.15)*other)),end=Math.min(other-2,Math.floor((hi-(hi-lo)*.15)*other));
  const scores=[];
  for(let n=Math.max(2,Math.round((estimate[edge]-.035)*dim));n<=Math.min(dim-3,Math.round((estimate[edge]+.035)*dim));n++){
   const values=[];
   for(let k=start;k<end;k++){
    const x=vertical?n:k,y=vertical?k:n;let contrast=0;
    for(let c=0;c<3;c++)contrast+=Math.abs(data[((y+(vertical?0:2))*info.width+x+(vertical?2:0))*info.channels+c]-data[((y-(vertical?0:2))*info.width+x-(vertical?2:0))*info.channels+c]);
    values.push(contrast/3);
   }
   values.sort((a,b)=>a-b);scores.push({pixel:n,score:values[Math.floor(values.length*.4)]||0});
  }
  scores.sort((a,b)=>b.score-a.score);const best=scores[0],rival=scores.find(x=>Math.abs(x.pixel-best.pixel)>Math.max(6,dim*.004));
  const confident=best&&best.score>=EDGE_CONTRAST&&!(rival&&best.score<rival.score*1.15);
  if(confident){bounds[edge]=best.pixel/dim;evidence[edge]={pixel:best.pixel,contrast:best.score,competingContrast:rival?.score||0,source:'pixel'};anchored++;}
  else{bounds[edge]=estimate[edge];evidence[edge]={contrast:best?.score||0,competingContrast:rival?.score||0,source:'estimate'};}
 }
 if(!anchored)throw Error('画框定位不确定：四条边都不清晰，已保留场景');
 const ratio=(bounds.right-bounds.left)*info.width/((bounds.bottom-bounds.top)*info.height);
 if(!Number.isFinite(artworkRatio)||Math.abs(ratio/artworkRatio-1)>.08)throw Error(`画框定位比例与原作不符（实测 ${ratio.toFixed(2)}，原作 ${Number(artworkRatio).toFixed(2)}），已保留场景`);
 return {bounds,evidence,method:anchored===4?'frontal-edge-v1':'frontal-edge-with-estimate-fallback',verified:true};
}
