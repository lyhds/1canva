// User-selectable room style presets. Without a selection the pipeline keeps its
// artwork-led freedom (historical behaviour). With a selection the style constrains
// all three prompt layers: the art-direction plan must stay inside the style family,
// reference selection prefers matching rooms, and scene generation follows the chosen
// reference's furnishings and materials instead of freely redecorating it.
export const SCENE_STYLES = [
  {
    id: 'bright-minimal',
    label: '明亮极简白',
    summary: '白或米白墙面、浅色漆柜或浅橡木、通透日光、极少摆件',
    directive: 'Bright minimalist rooms: white or warm off-white walls, pale lacquer or light oak furniture, airy daylight, very few quiet props. No dark woods, no heavy textiles, no busy styling.',
    seek: 'bright white or off-white rooms, pale lacquer or light-wood sideboards, airy daylight, minimal styling',
    avoid: 'dark or saturated walls, walnut or dark-stained woods, heavy drapes, maximalist decor',
  },
  {
    id: 'warm-wood',
    label: '暖调木色',
    summary: '暖灰泥墙、胡桃木/柚木中古家具、亚麻织物、陶土色点缀',
    directive: 'Warm mid-century-adjacent rooms: warm plaster or greige walls, walnut or teak sideboards and benches, linen upholstery, muted terracotta or ochre accents, soft directional daylight.',
    seek: 'warm plaster walls, mid-century walnut or teak credenzas, linen sofas, terracotta or ochre accents',
    avoid: 'cool grey showroom rooms, glossy lacquer, chrome and glass, stark white gallery walls',
  },
  {
    id: 'dark-gallery',
    label: '深色画廊',
    summary: '炭黑/墨绿深墙、聚光画灯、深色极简家具、戏剧化明暗',
    directive: 'Dark gallery rooms: deep charcoal, ink or dark-green walls, a focused picture-light wash on the artwork, minimal dark furniture with slim silhouettes, dramatic but coherent chiaroscuro. Keep the artwork clearly lit and all four frame edges readable.',
    seek: 'dark charcoal or ink walls, moody gallery rooms, picture-light spots, dark minimal furniture',
    avoid: 'bright airy white rooms, pastel palettes, cluttered daylight living rooms',
  },
  {
    id: 'soft-neutral',
    label: '柔和中性',
    summary: '米灰/蘑菇色墙、bouclé 与亚麻、浅石材、安静的侘寂感',
    directive: 'Soft neutral rooms: mushroom, greige or chalky-white walls, bouclé and linen textures, pale stone or limewash, low quiet furniture, diffused even light. Calm japandi-adjacent restraint; the artwork supplies the colour.',
    seek: 'greige or mushroom walls, bouclé armchairs, linen and pale stone, diffused soft light, quiet minimal rooms',
    avoid: 'bold accent walls, glossy modern showrooms, strong colour pops in furniture',
  },
  {
    id: 'retro-glam',
    label: '复古摩登',
    summary: '丝绒、黄铜点缀、浓郁墙面（墨绿/酒红）、复古家具轮廓',
    directive: 'Retro-glam rooms: rich saturated walls (deep green, burgundy or aubergine), velvet seating, restrained brass accents, vintage silhouettes, warm lamp glow. Glamorous but curated — one or two statement pieces, never a cluttered maximalist salon.',
    seek: 'saturated deep wall colours, velvet armchairs or sofas, brass floor lamps, vintage or retro furniture',
    avoid: 'stark white minimalism, cool grey corporate rooms, scandi pale-wood showrooms',
  },
];

export const listSceneStyles = () => SCENE_STYLES.map(({ id, label, summary }) => ({ id, label, summary }));
export const getSceneStyle = id => SCENE_STYLES.find(s => s.id === id) || null;

/** Validate job-creation input: '' (automatic) or a known preset id. */
export function assertSceneStyle(value) {
  const id = String(value || '').trim();
  if (!id) return '';
  if (!getSceneStyle(id)) throw Error('未知的场景风格：' + id);
  return id;
}

/** Art-direction layer: the three room plans must stay inside the chosen style. */
export function styleDirectionClause(job) {
  const style = getSceneStyle(job?.sceneStyle);
  if (!style) return '';
  return `User-selected room style (MANDATORY, it overrides your default styling freedom): ${style.label} — ${style.directive} All three scene directions must stay inside this style family; vary scale, camera and furniture arrangement, but never leave its palette and material family.`;
}

/** Reference-selection layer: prefer library rooms that already speak the style. */
export function styleSelectionClause(job) {
  const style = getSceneStyle(job?.sceneStyle);
  if (!style) return '';
  return `The user selected the room style "${style.label}" for this product. Prefer references matching: ${style.seek}. Reject references dominated by: ${style.avoid}. Style fit outranks palette matching.`;
}

/** Generation layer: the chosen reference's room design is followed, not reinvented. */
export function styleFidelityClause(job) {
  const style = getSceneStyle(job?.sceneStyle);
  if (!style) return '';
  return `Stay close to image 1's furniture style, materials and palette: the user chose the "${style.label}" style and this reference speaks it. Adapt the reference only where the artwork's own ratio, the clearance band, light coherence or the output format require it; the room must remain recognizably the reference's room.`;
}
