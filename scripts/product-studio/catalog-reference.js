import fs from 'node:fs';
export const catalogReference=JSON.parse(fs.readFileSync(new URL('../../data/pricing/mesonart-catalog.json',import.meta.url),'utf8'));
export const catalogSizes=ratio=>catalogReference.profiles[ratio]||[];
export function catalogSize(size){return Object.values(catalogReference.profiles).flat().find(s=>s.label===size);}
