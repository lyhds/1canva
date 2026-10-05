import fs from 'node:fs';
import path from 'node:path';

// One process may operate a task directory, even if a second port is requested.
export function acquireLock(dir) {
 const file=path.join(dir,'worker.lock');
 try {fs.writeFileSync(file,String(process.pid),{flag:'wx'});}
 catch(error){
  if(error.code!=='EEXIST')throw error;
  const pid=Number(fs.readFileSync(file,'utf8'));
  if(!Number.isInteger(pid)||pid<=0)throw Error('任务锁无法识别，请核对后台进程');
  let alive=true;
  try {process.kill(pid,0);}catch(e){if(e.code==='ESRCH')alive=false;else throw e;}
  if(alive)throw Error('已有 Product Studio 后台在运行，请打开现有页面');
  fs.unlinkSync(file);
  fs.writeFileSync(file,String(process.pid),{flag:'wx'});
 }
 return ()=>{if(fs.existsSync(file)&&fs.readFileSync(file,'utf8')===String(process.pid))fs.unlinkSync(file);};
}
