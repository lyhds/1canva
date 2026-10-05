// Use the same latest master as Store.active(); planning's nominal ratio is only
// a fallback for historical jobs that have no saved master dimensions.
export function artworkGeometry(job) {
 const master=job?.assets?.master?.at(-1);
 const measured=Number.isInteger(master?.width)&&master.width>0&&Number.isInteger(master?.height)&&master.height>0;
 const parts=measured?[master.width,master.height]:String(job?.analysis?.ratio||'').split(':').map(Number);
 if(parts.length!==2||!parts.every(n=>Number.isInteger(n)&&n>0))return null;
 const [w,h]=parts,gcd=(a,b)=>b?gcd(b,a%b):a,d=gcd(w,h);
 return {width:w/d,height:h/d,ratio:w/h,label:`${w/d}:${h/d}`,pixels:measured?`${w}x${h}`:null};
}

export function artworkShape(job) {
 const g=artworkGeometry(job);
 const dimensions=g?`${g.pixels?`The original artwork measures ${g.pixels} px, an exact`:'The artwork has an exact'} ${g.label} width-to-height ratio: ${g.width} units wide for every ${g.height} units high.`:'Read the width-to-height ratio directly from the separate original artwork reference.';
 return `ARTWORK GEOMETRY — highest priority. ${dimensions} This describes the painted canvas surface, excluding frame rails and shadow. Treat the complete artwork as one fixed rectangular object: scale width and height together by the same factor. Keep its orientation, full composition and all four original edges. Build the room and frame around that rectangle; never reshape the painting to fit a wall, furniture, scene format or styling suggestion. Change the camera distance, wall space or furniture placement when space is tight. Do not crop, extend the painted content, add blank canvas bands or hide edge content behind the frame to fake the ratio.`;
}
