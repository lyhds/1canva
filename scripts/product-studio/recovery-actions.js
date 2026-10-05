export function pendingRecovery(job){
 const pending=(job.operations||[]).filter(o=>['pending','uncertain'].includes(o.status));
 const kinds=pending.map(o=>/Shopify/.test(o.label)?'shopify':/^生成 (master|scene-[123]|scene-desktop|texture)(?: |$)/.test(o.label)?'image':/^(分析|制定|参考|选图|补选|跨图库|分场景|检查|审核|撰写|定位)/.test(o.label)?'analysis':'unknown');
 const kind=pending.length&&kinds.every(k=>k===kinds[0])?kinds[0]:'unknown';
 const slots=[...new Set(pending.map(o=>o.label.match(/^生成 (\S+) #/)?.[1]).filter(Boolean))];
 return {kind,pending,slot:kind==='image'&&slots.length===1?slots[0]:null};
}
export function retryPending(job,{kind}={}){
 const r=pendingRecovery(job);
 if(job.status!=='uncertain'||r.kind!==kind||!['analysis','image'].includes(kind))throw Error('当前请求不符合此恢复操作');
 if(kind==='image'&&(!r.slot||job.productId))throw Error('当前没有可重试的独立图片，或已关联 Shopify 商品');
 for(const op of r.pending){op.status='superseded';op.resolution=kind==='analysis'?'用户重新分析；历史请求结果及计费仍未知':'用户直接重试此图；保留旧请求及回执，旧结果状态不变';}
 if(kind==='image'){(job.attempts??={})[r.slot]=0;}
 job.status='queued';job.error=null;
 return r;
}
