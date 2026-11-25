import assert from 'node:assert/strict';
import { getDayOfYear, getTreeClimateVariant } from '../src/treeclimate.js';

const locations = [
  ['Beale CA', 39.1, -121.4, 'temperate-broadleaf'],
  ['Amazon', -3, -60, 'tropical'],
  ['Sahara edge', 25, 0, 'desert-scrub'],
  ['Siberia', 60, 110, 'boreal-conifer'],
  ['Norway', 60, 10, 'boreal-conifer'],
  ['Florida mangrove coast', 25.7, -80.2, 'mangrove'],
  ['Kenya savanna', 0.5, 37.9, 'savanna'],
  ['Sydney', -33.9, 151.2, 'temperate-broadleaf'],
];

for (const [name, lat, lon, biome] of locations) {
  const variant = getTreeClimateVariant(lat, lon, 20, 172);
  assert.equal(variant.biome, biome, `${name} biome`);
  assert.ok(variant.crownShape && variant.shapeIndex >= 0 && variant.shapeIndex <= 2, `${name} crown`);
  assert.ok(variant.crownScale > 0 && variant.heightScale > 0 && variant.densityFactor > 0, `${name} scales`);
  assert.ok(variant.color.every((value) => Number.isFinite(value) && value >= 0.55 && value <= 1.35), `${name} tint bounds`);
  const brightness = variant.color.reduce((sum, value) => sum + value, 0) / 3;
  assert.ok(brightness >= 0.7 && brightness <= 1.25, `${name} tint brightness`);
}

const sydneySummer = getTreeClimateVariant(-33.9, 151.2, 20, 15);
const sydneyWinter = getTreeClimateVariant(-33.9, 151.2, 20, 196);
assert.ok(sydneySummer.seasonalFactor > sydneyWinter.seasonalFactor, 'southern seasons flip');
assert.notDeepEqual(sydneySummer.color, sydneyWinter.color, 'southern winter tint changes');

const taggedConifer = getTreeClimateVariant(39.1, -121.4, 20, 15, {
  leaf_type: 'needleleaved',
  leaf_cycle: 'evergreen',
  genus: 'Pinus',
  natural: 'wood',
});
assert.equal(taggedConifer.biome, 'temperate-conifer', 'needleleaf OSM tags override climate default');
assert.equal(taggedConifer.crownShape, 'conical');
assert.equal(taggedConifer.seasonalFactor, 1, 'evergreen OSM tag suppresses deciduous seasonality');
assert.equal(
  getTreeClimateVariant(25, 0, 20, 172, { leaf_type: 'broadleaved', landuse: 'forest' }).biome,
  'temperate-broadleaf',
  'broadleaf OSM tag overrides desert default',
);
assert.equal(
  getTreeClimateVariant(25.7, -80.2, 20, 172, { species: 'Rhizophora mangle' }).biome,
  'mangrove',
  'mangrove species tag overrides climate default',
);
assert.equal(getDayOfYear(new Date('2026-10-12T00:00:00Z')), 285);
assert.equal(getDayOfYear(new Date('2024-12-31T00:00:00Z')), 365, 'leap-year dates normalize to the seasonal calendar');

console.log(`checked ${locations.length} regional tree variants, seasonal colours, and OSM overrides`);
