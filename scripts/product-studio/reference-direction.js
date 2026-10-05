/** The desktop scene uses the same reference as scene-3, with a new composition. */
export function referenceDirection(job, slot) {
  const index = ['scene-1', 'scene-2', 'scene-3'].indexOf(slot === 'scene-desktop' ? 'scene-3' : slot);
  const reference = job.selection?.[index];
  if (!reference) return '';
  const guidance = {reason: reference.reason, keep: reference.keep, discard: reference.discard};
  return `Selected room reference guidance: ${JSON.stringify(guidance)}. Retain the specified photographic/material cues; replace or omit the specified discarded furnishings, colours and layout. These instructions concern the room reference only, never alter the original artwork. ${slot === 'scene-desktop' ? 'Reuse the scene-3 reference cues but independently recompose for the requested desktop ratio.' : ''}`;
}
