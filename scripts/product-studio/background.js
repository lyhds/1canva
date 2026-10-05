export function validateBackground(value, footprint) {
 if(typeof value?.emptyWall!=='boolean'||typeof value.evidence!=='string'||!Array.isArray(value.objects))throw Error('背景检查返回结构不完整');
 for(const b of value.objects)if(typeof b.name!=='string'||!['left','top','right','bottom'].every(k=>Number.isFinite(b[k])&&b[k]>=0&&b[k]<=1)||b.left>=b.right||b.top>=b.bottom)throw Error('背景物体坐标格式错误');
 const margin=.015;
 const collisions=value.objects.filter(b=>b.left<footprint.right+margin&&b.right>footprint.left-margin&&b.top<footprint.bottom+margin&&b.bottom>footprint.top-margin);
 return {...value,footprint,collisions,furnitureClear:collisions.length===0};
}
