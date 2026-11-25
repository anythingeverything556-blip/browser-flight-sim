const BIOME_TINTS = {
  tropical: [1.12, 1.2, 0.98],
  'temperate-broadleaf': [1.18, 1.18, 0.94],
  'temperate-conifer': [1.06, 1.2, 0.94],
  'boreal-conifer': [1.02, 1.16, 0.9],
  'desert-scrub': [1.24, 1.18, 0.9],
  savanna: [1.25, 1.18, 0.88],
  mangrove: [1.04, 1.2, 0.98],
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function getDayOfYear(value = 172) {
  if (value instanceof Date || typeof value === 'string') {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isFinite(date.getTime())) {
      const year = date.getUTCFullYear();
      const start = Date.UTC(year, 0, 1);
      const end = Date.UTC(year + 1, 0, 1);
      const current = Date.UTC(year, date.getUTCMonth(), date.getUTCDate());
      return 1 + Math.floor(((current - start) / (end - start)) * 365);
    }
  }
  const day = Number(value);
  return Number.isFinite(day) ? ((Math.trunc(day) - 1 + 365 * 10) % 365) + 1 : 172;
}

function regionalBiome(latitude, longitude, elevation) {
  const lat = Math.abs(latitude);
  const lon = ((longitude + 180) % 360 + 360) % 360 - 180;
  const climateLat = Math.min(90, lat + Math.max(0, elevation) / 220);
  const within = (south, north, west, east) => latitude >= south && latitude <= north && lon >= west && lon <= east;

  if (elevation < 80 && (within(24, 30.5, -83.8, -79.5) || within(-3, 8, 96, 126) || within(-5, 12, -82, -76)))
    return 'mangrove';
  if (
    within(14, 35, -18, 42) ||
    within(12, 35, 35, 60) ||
    within(36, 48, 70, 120) ||
    within(25, 39, -118, -101) ||
    within(-31, -15, -78, -67) ||
    within(-34, -18, 118, 145) ||
    within(-32, -18, 12, 28)
  )
    return 'desert-scrub';
  if (
    within(-25, 18, 10, 44) ||
    within(10, 23, -17, 36) ||
    within(-25, -10, -72, -45) ||
    within(10, 24, 24, 40) ||
    within(12, 25, 102, 125) ||
    within(12, 25, 16, 35)
  )
    return 'savanna';
  if (climateLat < 23) return 'tropical';
  if (climateLat >= 55) return 'boreal-conifer';
  if (climateLat >= 43) return 'temperate-conifer';
  return 'temperate-broadleaf';
}

function taggedBiome(defaultBiome, tags, climateLat) {
  const values = Object.fromEntries(
    Object.entries(tags || {}).map(([key, value]) => [key.toLowerCase(), String(value).toLowerCase().trim()]),
  );
  const wood = values.wood || '';
  const leafType = values.leaf_type || '';
  const name = `${values.genus || ''} ${values.species || ''}`;
  if (/mangrove|rhizophora|avicennia|sonneratia/.test(`${wood} ${name}`) || values.natural === 'mangrove')
    return 'mangrove';
  if (/palm|phoenix|cocos|arecaceae/.test(`${wood} ${name}`)) return 'tropical';
  if (/needle|conifer|pine|pinus|spruce|picea|fir|abies|larch|larix|cedar/.test(`${leafType} ${wood} ${name}`))
    return climateLat >= 55 ? 'boreal-conifer' : 'temperate-conifer';
  if (/broadleaf|broad-leaf|broadleaved|broad-leaved|deciduous/.test(`${leafType} ${wood}`)) {
    if (defaultBiome === 'tropical' || defaultBiome === 'savanna' || defaultBiome === 'mangrove') return defaultBiome;
    return 'temperate-broadleaf';
  }
  if (/acacia/.test(name) && defaultBiome === 'tropical') return 'savanna';
  return defaultBiome;
}

export function getTreeClimateVariant(latitude, longitude, elevation = 0, date = 172, tags = {}) {
  const lat = Number.isFinite(Number(latitude)) ? clamp(Number(latitude), -90, 90) : 0;
  const lon = Number.isFinite(Number(longitude)) ? Number(longitude) : 0;
  const elev = Number.isFinite(Number(elevation)) ? Number(elevation) : 0;
  const climateLat = Math.min(90, Math.abs(lat) + Math.max(0, elev) / 220);
  const day = getDayOfYear(date);
  const localDay = lat < 0 ? ((day + 181 - 1) % 365) + 1 : day;
  const defaultBiome = regionalBiome(lat, lon, elev);
  const biome = taggedBiome(defaultBiome, tags, climateLat);
  const properties = Object.fromEntries(
    Object.entries(tags || {}).map(([key, value]) => [key.toLowerCase(), String(value).toLowerCase().trim()]),
  );
  const cycle = properties.leaf_cycle || '';
  const evergreen = /evergreen/.test(cycle);
  const deciduous = !evergreen &&
    (/deciduous|semi_deciduous|semi-deciduous/.test(cycle) ||
      (!cycle && (biome === 'temperate-broadleaf' || biome === 'savanna')));
  const shape = biome === 'boreal-conifer' || biome === 'temperate-conifer'
    ? { crownShape: 'conical', shapeIndex: 1 }
    : biome === 'desert-scrub'
      ? { crownShape: 'shrub', shapeIndex: 1 }
      : { crownShape: 'broad', shapeIndex: 0 };
  let crownScale = biome === 'desert-scrub' ? 0.82 : biome === 'boreal-conifer' ? 0.84 : biome === 'temperate-conifer' ? 0.9 : biome === 'savanna' ? 1.16 : 1;
  let heightScale = biome === 'tropical' ? 1.12 : biome === 'desert-scrub' ? 0.68 : biome === 'boreal-conifer' ? 0.9 : biome === 'mangrove' ? 0.92 : 1;
  let densityFactor = biome === 'desert-scrub' ? 0.58 : biome === 'savanna' ? 0.82 : biome === 'boreal-conifer' ? 0.88 : 1;
  let seasonalFactor = 1;
  let color = [...BIOME_TINTS[biome]];
  const winter = localDay <= 59 || localDay >= 334;
  const autumn = localDay >= 244 && localDay <= 333;
  const spring = localDay >= 60 && localDay <= 151;

  if (deciduous && biome !== 'tropical' && biome !== 'mangrove' && biome !== 'desert-scrub') {
    if (autumn) {
      seasonalFactor = 0.88;
      densityFactor *= 0.86;
      color = [color[0] * 1.12, color[1] * 0.78, color[2] * 0.56];
    } else if (winter) {
      seasonalFactor = climateLat >= 40 ? 0.38 : 0.68;
      densityFactor *= climateLat >= 40 ? 0.58 : 0.78;
      crownScale *= climateLat >= 40 ? 0.62 : 0.78;
      color = [color[0] * 0.83, color[1] * 0.7, color[2] * 0.55];
    } else if (spring) {
      seasonalFactor = 0.9;
      densityFactor *= 0.9;
      color = [color[0] * 0.9, color[1], color[2] * 0.78];
    }
  }
  color = color.map((channel) => clamp(channel, 0.55, 1.35));

  return {
    biome,
    crownShape: shape.crownShape,
    crownScale,
    shapeIndex: shape.shapeIndex,
    heightScale,
    color,
    densityFactor,
    seasonalFactor,
  };
}
