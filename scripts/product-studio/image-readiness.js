import sharp from 'sharp';
import crypto from 'node:crypto';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

export const IMAGE_POLICY = 'generation-only-v1';

// Historical AI opinions are retained as evidence, never used as a new gate.
export function validateBounds(bounds) {
  if (!bounds || !['left','top','right','bottom'].every(k =>
    Number.isFinite(bounds[k]) && bounds[k] >= 0 && bounds[k] <= 1) ||
    bounds.left >= bounds.right || bounds.top >= bounds.bottom) {
    throw Error('画作定位坐标格式错误；已保留图片，请重新定位');
  }
  return bounds;
}

export const boundsPrompt = `Locate the canvas in this finished room image for a software frame overlay. Return only JSON {artworkBounds:{left:number,top:number,right:number,bottom:number}} in normalized 0..1 coordinates. Identify the four canvas edges, excluding contact shadows and any external frame. Image 2 is the original artwork to identify. Do not review quality, aesthetics, lighting, fidelity or furniture; do not return pass/fail, issues or repair instructions. If the canvas cannot be located, return {artworkBounds:null}.`;

// View-aware variant for baked scenes whose slot allows a gentle oblique camera
// (OBLIQUE_VIEW_SLOTS). Perspective legitimately compresses the measured bounds, so the
// caller relaxes its numeric tolerance for oblique views and relies on `stretched` —
// a perspective-corrected comparison against the master — to catch re-proportioned art.
export const boundsViewPrompt = `Locate the canvas in this finished room image. Return only JSON {artworkBounds:{left:number,top:number,right:number,bottom:number},view:string,stretched:boolean} in normalized 0..1 coordinates. Identify the four canvas edges, excluding contact shadows and any external frame. Image 2 is the original artwork to identify. view is "frontal" when the camera faces the artwork nearly squarely, "oblique" when it clearly views the artwork from one side. stretched is true only when, after accounting for the viewing perspective, the artwork content still looks re-proportioned (squashed or stretched) compared with image 2. Do not review quality, aesthetics, lighting, fidelity or furniture; do not return pass/fail, issues or repair instructions. If the canvas cannot be located, return {artworkBounds:null,view:"frontal",stretched:false}.`;

// Some model responses nest the requested object one level deep in `answer`
// (intermittent, per call). Unwrap exactly one known envelope; never invent data.
export const unwrapAnswer = value =>
  value && typeof value === 'object' && value.artworkBounds === undefined &&
  value.answer && typeof value.answer === 'object' && !Array.isArray(value.answer)
    ? value.answer : value;

export async function checkImage(bytes, asset, ratio) {
  if (hash(bytes) !== asset.sha256) throw Error('素材哈希不符，保留文件并核对来源');
  const image = sharp(bytes, {limitInputPixels:40000000});
  const meta = await image.metadata();
  await image.stats(); // Decode pixels, not just a potentially truncated header.
  const [w,h] = ratio.split(':').map(Number);
  if (!meta.width || !meta.height || !w || !h || Math.abs(meta.width/meta.height-w/h) > .02) {
    throw Error(`图片比例不符合 ${ratio}；已保留图片，请手动重做此图`);
  }
  if (asset.width !== meta.width || asset.height !== meta.height) throw Error('素材尺寸记录不符');
  return {policy:IMAGE_POLICY, sha256:asset.sha256, ratio, width:meta.width, height:meta.height};
}

export const retiredReview = op => /^(验收 |真实感验收 |检查完整场景 |检查原始背景 |自动诊断 |分析场景光线 )/.test(op.label || '');
export function canSkipReviews(job) {
  const pending = job.operations.filter(op => ['pending','uncertain'].includes(op.status));
  return pending.length > 0 && pending.every(retiredReview) && !job.productId;
}
export function skipReviews(job) {
  if (!canSkipReviews(job)) throw Error('存在非审核请求待核对，不能跳过');
  for (const op of job.operations.filter(op => ['pending','uncertain'].includes(op.status))) {
    op.status = 'superseded';
    op.resolution = '用户取消 AI 审核职责；不再调用审核，旧请求结果及计费仍未知';
  }
}
