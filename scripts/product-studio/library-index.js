import {ModelFormatError} from './model-format.js';
// Shared scene-reference archive: every library photo is described ONCE by the
// vision model and reused by later jobs. Entries are keyed by content hash, so
// changed or added files are re-described and untouched files never cost a call.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {atomic,hash,json} from './store.js';
import {contactSheet} from './library.js';

export const ARCHIVE_BATCH=12;
const indexFile=dir=>path.join(dir,'library-index.json');
export function loadIndex(dir){
 const data=json(indexFile(dir),null);
 return data&&data.version===1&&data.entries&&typeof data.entries==='object'?data:{version:1,entries:{}};
}
const fileHash=f=>hash(fs.readFileSync(f.path));
export function archivePrompt(count){
 return `Describe each labeled room photo on the contact sheet for a scene-reference archive. Return only JSON {descriptions:[{label:number,room:string,view:string,wall:string,palette:string,density:string,notes:string}]}. label is the printed number on the sheet (1-${count}). view is "frontal" when the camera faces the wall squarely, "angled" for a gently oblique view. room: room type and setting in a few words. wall: wall colour and material. palette: dominant colours. density: visual busyness of furniture and decor. notes: photographic/material cues a stylist should notice, under 20 words. Describe only what is visible; do not review quality or judge artwork fit.`;
}
/** Describe every not-yet-archived file through the calling job (audit receipts
 *  land in that job's directory), updating the shared index after each batch. */
export async function ensureLibraryIndex(store,job,files,call){
 const index=loadIndex(store.dir);
 const model=store.config(job).vision.model;
 const pending=files.filter(f=>!index.entries[fileHash(f)]);
 for(let i=0;i<pending.length;i+=ARCHIVE_BATCH){
  const batch=pending.slice(i,i+ARCHIVE_BATCH),start=files.indexOf(batch[0])+1;
  const sheet=await contactSheet(batch);
  const response=await call(`建立图库档案 ${start}-${start+batch.length-1}`,archivePrompt(batch.length),[sheet]);
  const descriptions=response?.descriptions;
  if(!Array.isArray(descriptions))throw new ModelFormatError('图库档案返回结构不完整：缺少 descriptions 数组');
  const byLabel=new Map();
  for(const d of descriptions)byLabel.set(Number(d?.label),d);
  for(let n=0;n<batch.length;n++){
   const d=byLabel.get(n+1);
   const text=v=>typeof v==='string'&&v.trim()?v.trim().slice(0,200):'';
   const description=d&&['room','view','wall','palette','density','notes'].every(k=>text(d[k]))?{room:text(d.room),view:text(d.view),wall:text(d.wall),palette:text(d.palette),density:text(d.density),notes:text(d.notes)}:null;
   if(!description)throw new ModelFormatError(`图库档案返回结构不完整：缺少第 ${n+1} 张的描述`);
   index.entries[fileHash(batch[n])]={name:batch[n].name,bigsize:!!batch[n].bigsize,description,model,describedAt:new Date().toISOString()};
  }
  atomic(indexFile(store.dir),index);
  const receiptFile=`library-archive-${crypto.randomUUID()}.json`;
  atomic(store.file(job.id,receiptFile),{batchStart:start,count:batch.length,files:batch.map(f=>({id:f.id,name:f.name})),descriptions});
 }
 return index;
}
