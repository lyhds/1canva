// Baked-frame workflow: the generator paints the frame into the scene, so the pipeline
// never locates a canvas edge and the theme never draws a second frame. Per-finish
// recolouring was tried and dropped — a baked rail is only 5-10px wide in a 1600px image,
// so a localisation error of a few pixels is visible as a band across the artwork. Frame
// colour switching stays on the master image, which the theme already renders itself.
export const BAKED_FRAMES = 'baked-frames-v1';
export const FRAME_SELECTION_POLICY = 'artwork-fit-v3';
const SCENE_FINISHES=['Oak Float Frame','Black Float Frame'];
export const frameAlt = slot => `composed-framed-${slot}-v1`;

export function sceneFrameOptions(job){
 // Production planning happens after pricing resolves actual purchasable variants.
 // Scene styling is restricted to the owner's two colours, independently of
 // the broader purchase options. Prompt previews use that same two-colour palette.
 const variants=job.pricing?.variants;
 const frames=variants?.length?variants.filter(v=>v.availableForSale!==false).map(v=>v.frame):SCENE_FINISHES;
 const names=['Oak','Black'];
 const canonical=frame=>{const match=String(frame||'').trim().match(/^(oak|black)(?:\s+(?:float\s+)?frame)?$/i);return match?names.find(n=>n.toLowerCase()===match[1].toLowerCase())+' Float Frame':String(frame||'').trim().toLowerCase()==='wood'?'Oak Float Frame':null;};
 const options=[...new Set(frames.map(canonical).filter(Boolean))];
 if(!options.length)throw Error('当前商品没有可用的浮框颜色，无法生成带框场景');
 return options;
}

export function sceneFrameGuidance(job,{planning=false,slot}={}){
 const allowed=sceneFrameOptions(job);
 return `FRAME FINISH SELECTION. Allowed finishes for this artwork: ${allowed.join(', ')}. Choose exactly ONE of these finishes for each scene based on the artwork's colours, edge contrast, visual weight and the room's materials. There is no default finish: do not automatically choose oak or copy a reference frame. Different rooms may use different finishes when the pairing benefits the artwork; do not force variety for its own sake. ${planning?'In each frameAndScale field, state the exact chosen finish name from this list and explain why it suits this artwork and room. The desktop companion uses the scene-3 finish.':'Use the finish specified in the scene direction only if it belongs to this allowed list; otherwise choose the best fit from this list. Any older fixed-oak instruction or unavailable colour is superseded by this selection rule.'} ${slot==='scene-desktop'?'Keep the scene-3 frame finish visible in image 1 when it is allowed, while reconstructing the artwork itself from image 2 at its original ratio; if that finish is unavailable, choose an allowed finish that suits the same room.':''} Keep all four rails in the same finish, slim and realistic. Use only natural oak or black from the allowed list above; no white, gold, silver, walnut or other frame colours, ornate gilding or extra matting. Frame colour selection must not change the artwork's palette, content or proportions.`;
}
