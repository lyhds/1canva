import {usesArtDirection} from './art-direction.js';
import {mediaSlots} from './media.js';

export const desktopUsesScene3 = job =>
  job.mediaProfile === 'responsive-v1' && usesArtDirection(job);

export function redoSlots(job, slot) {
  if (slot === 'master') return [...new Set([...mediaSlots(job), 'texture'])];
  if (slot === 'scene-3' && desktopUsesScene3(job)) return [slot, 'scene-desktop'];
  return [slot];
}
