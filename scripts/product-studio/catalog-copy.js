export function catalogTags(collections){
 return [...new Set(collections.flatMap(c=>c.ruleSet?.rules||[]).filter(r=>r.column==='TAG'&&r.relation==='EQUALS'&&/^(subject|style|mood|space)-/.test(r.condition)).map(r=>r.condition))];
}
export function matchingCollections(collections,tags){
 return collections.filter(c=>{
  if(c.handle==='all-products')return true;
  const rules=c.ruleSet?.rules;
  if(!rules?.length||rules.some(r=>r.column!=='TAG'||r.relation!=='EQUALS'))return false;
  const matches=rules.map(r=>tags.includes(r.condition));
  return c.ruleSet.appliedDisjunctively?matches.some(Boolean):matches.every(Boolean);
 });
}
