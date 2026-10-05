// Offline derivation from saved public variant records; never writes Shopify.
// Writes to data/pricing/mesonart-catalog.json and docs/PRICE_TABLE.md are
// gated: the default run only reports what would change, and --apply first
// copies both files into a timestamped .shopify/backups/ directory.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const file=process.argv[2];
if(!file)throw Error('Usage: node scripts/build-mesonart-catalog.js <saved variants.json> [--apply]');
const bytes=fs.readFileSync(file),raw=JSON.parse(bytes);
const ratios=['3:4','2:3','1:1','4:3','3:2','2:1'];
const frames={'Rolled Canvas':'Rolled Canvas','Stretched Canvas':'Frameless','Oak Float Frame':'Stretch+Wood Frame','Black Float Frame':'Stretch+Black Frame','White Float Frame':'Stretch+White Frame','Gold Float Frame':'Stretch + Gold Frame','Silver Float Frame':'Stretch+Silver Frame'};
const mode=values=>{const counts=new Map();for(const v of values)counts.set(v,(counts.get(v)||0)+1);const sorted=[...counts].sort((a,b)=>b[1]-a[1]);if(!sorted.length||sorted[0][1]===sorted[1]?.[1])throw Error('Missing or tied mode');return {value:sorted[0][0],count:sorted[0][1],distribution:Object.fromEntries(sorted)};};
const profiles={};
for(const ratio of ratios){
 const rows=raw.filter(r=>r.ratio===ratio&&Object.values(frames).includes(r.frame));
 const dimensions=[...new Set(rows.map(r=>r.inches.join('x')))].filter(key=>new Set(rows.filter(r=>r.inches.join('x')===key).map(r=>r.productId)).size>=100).sort((a,b)=>parseFloat(a)-parseFloat(b));
 profiles[ratio]=dimensions.map(key=>{
  const same=rows.filter(r=>r.inches.join('x')===key),cm=mode(same.map(r=>r.cm.join('x'))).value.split('x').map(Number),inches=key.split('x').map(Number);
  const prices={},evidence={};
  for(const [local,remote] of Object.entries(frames)){
   const group=same.filter(r=>r.frame===remote&&r.cm.join('x')===cm.join('x'));
   const unique=new Map();for(const r of group){if(unique.has(r.productId)&&unique.get(r.productId).price!==r.price)throw Error('Conflicting product price');unique.set(r.productId,r);}
   const sample=[...unique.values()],m=mode(sample.map(r=>r.price));prices[local]=m.value;
   evidence[local]={sampleProducts:sample.length,modeCount:m.count,distribution:m.distribution,examples:sample.filter(r=>r.price===m.value).slice(0,3).map(r=>({url:'https://www.mesonart.com/products/'+r.handle+'?variant='+r.variantId,price:r.price}))};
  }
  return {ratio,cm,inches,label:`${cm[0]} x ${cm[1]} cm / ${inches[0]} x ${inches[1]} in`,prices,evidence};
 });
}
const out={version:'2026-09-09-mesonart-modal-v3',currency:'USD',basis:'Modal actual public variant price per oriented size and finish; no promotion, interpolation or .99 rounding',source:{date:'2026-09-09',products:2000,pages:[1,2,3,4,5,6,7,9],completeCensus:false,limitation:'Public endpoint rate limited. Non-random 2,000-product sample; not a claim of a full-store mode.',variantFileSha256:crypto.createHash('sha256').update(bytes).digest('hex'),sizeSelection:'Exact nominal inch ratios; dimensions seen on at least 100 distinct products. Excludes multi-piece, unsupported ratios and rare bespoke frames.'},authorization:{price:'User selected most frequent actual price per size and frame; no promotion',production:'User confirmed all referenced combinations can be supplied'},frames,profiles};
let report='# 商品尺码与美元标价\n\n版本：'+out.version+'。按店主 2026-09-09 确认：每个尺寸、方向、装裱采用样本中最常见的实际页面标价；不复制促销、不插值、不取 .99。\n\n来源：Mesonart 公开商品接口的 2,000 款非随机样本（页 1–7、9）；接口限流，未完成全站普查。不是全站众数的声明。原始记录、哈希和逐价频次见 [机器价表](../data/pricing/mesonart-catalog.json)。排除套画、异常选项及少量特殊宽框。尺寸以名义英寸精确比例归组，不将其他比例混入同一画作。\n\n木色使用本店 Oak Float Frame，映射对方 Stretch+Wood Frame；Stretched Canvas 对应 Frameless。本店明确保留自己的名称和材料说明，不宣称对方 Wood 的具体木种。常规选择共七种，Walnut 不进入新标准；历史别名兼容代码保留。店主已确认本次对应尺寸和组合均可交付，故不再使用旧的 180 cm 门槛。这不替代未来不同工艺的生产核实。\n\n六个草稿保持 DRAFT 和零价，创建商品读取同一精确价表并核对实时模板、可售参照及库存规则。旧 retail-usd.json 只保留历史尺寸兼容，不作为本次标准。\n';
for(const [ratio,sizes] of Object.entries(profiles)){report+='\n## '+ratio+'\n\n| cm（宽 × 高） | in | 卷装 | 绷框 | Oak | Black | White | Gold | Silver |\n| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n';for(const s of sizes)report+='| '+s.cm.join(' × ')+' | '+s.inches.join(' × ')+' | '+Object.keys(frames).map(f=>s.prices[f]).join(' | ')+' |\n';}
const targets=['data/pricing/mesonart-catalog.json','docs/PRICE_TABLE.md'];
const serialized=[JSON.stringify(out,null,2)+'\n',report];
const summary=Object.fromEntries(Object.entries(profiles).map(([k,v])=>[k,v.length]));
const sizes=Object.values(profiles).flat().length;
if(!process.argv.includes('--apply')){
 const changes=targets.map((target,i)=>({file:target,changed:!fs.existsSync(target)||fs.readFileSync(target,'utf8')!==serialized[i]}));
 console.log(JSON.stringify({mode:'dry-run',summary,sizes,changes,note:'No file was written. Re-run with --apply to back up and write both files.'},null,2));
 process.exit(0);
}
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const backup=path.join('.shopify','backups',stamp+'-price-table');
fs.mkdirSync(backup,{recursive:true});
for(const target of targets){
 const saved=path.join(backup,path.basename(target));
 if(fs.existsSync(target))fs.copyFileSync(target,saved);else fs.writeFileSync(saved+'.absent','');
}
for(let i=0;i<targets.length;i++)fs.writeFileSync(targets[i],serialized[i]);
console.log(JSON.stringify({mode:'apply',summary,sizes,backup,written:targets},null,2));
