/** Missing profile retains historical media. */
import {frameAlt} from './frame-finish.js';
export function mediaSlots(job) {
  return ['master', 'detail', ...(job.productId && job.textureWorkflow !== 'disabled' && job.analysis?.texture ? ['texture'] : []),
    'scene-1', 'scene-2', 'scene-3', ...(job.mediaProfile === 'responsive-v1' ? ['scene-desktop'] : [])];
}
export const bakedScenes = job => job?.sceneWorkflow === 'baked-frames-v1';
/** The selection entry for a scene slot; scene-desktop shares scene-3's entry. */
export function sceneSelection(job, slot) {
  return job.selection?.[['scene-1', 'scene-2', 'scene-3'].indexOf(slot === 'scene-desktop' ? 'scene-3' : slot)];
}
/** Scene slots that may use a gentle oblique camera in the baked-frame workflow.
 *  The retired overlay workflow needed a nearly frontal artwork plane to map frame
 *  coordinates; with the frame painted into the scene, the small intimate setting
 *  (scene-2) gains a more natural angled view. scene-1/scene-3/scene-desktop stay
 *  frontal so the artwork remains fully legible, and their ratio check stays strict. */
export const OBLIQUE_VIEW_SLOTS = new Set(['scene-2']);
/** Physical media list. The baked-frame workflow keeps one image per scene: the frame is
 *  painted into the scene itself, and per-finish recolouring was dropped because a baked
 *  rail is only a few pixels wide and any localisation error lands on the artwork. */
export function mediaEntries(job) {
  return mediaSlots(job).map(slot => ({
    slot,
    alt: bakedScenes(job) && slot.startsWith('scene-') ? frameAlt(slot) : mediaAlt(slot, job),
  }));
}
export function mediaEntryFile(job, entry) {
  return job.assets[entry.slot]?.at(-1)?.file ?? null;
}
export function mediaEntrySize(job, entry) {
  const a = job.assets[entry.slot]?.at(-1);
  return a ? {width: a.width, height: a.height, sha256: a.sha256} : null;
}
export function sceneRatio(job) { return job.mediaProfile === 'responsive-v1' ? '4:5' : '3:4'; }
export function mediaAlt(slot, job) {
  if (slot === 'master') return 'master';
  if(job?.sceneWorkflow==='composed-unframed-v1'&&slot.startsWith('scene-'))return 'composed-unframed-'+slot+'-v1';
  if (slot === 'scene-desktop') return job?.bannerProfile === 'clearance-v3' ? 'scene-room-desktop-v3' : job?.bannerProfile === 'fullbleed-v2' ? 'scene-room-desktop-v2' : 'scene-room-desktop-v1';
  if (slot === 'scene-3') return job?.mobileSceneProfile === 'clearance-v2' ? 'scene-room-large-v2' : 'scene-room-large-v1';
  return slot.startsWith('scene-') ? 'scene-room-v1' : `${slot} design visualization`;
}
