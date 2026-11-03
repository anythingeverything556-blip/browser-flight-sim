// Imagery source selection: the government sources apply only inside their own country, everything else falls through to Esri (null).
import assert from 'node:assert/strict';
import { sourceFor } from '../src/imagery-sources.js';
const t = (n, f) => { f(); console.log('PASS ', n); };
const id = (z, lon, lat) => sourceFor(z, lon, lat)?.id ?? null;
t('new national sources cover their capitals', () => {
  assert.equal(id(17, -3.70, 40.42), 'es'); assert.equal(id(17, 2.17, 41.39), 'es'); assert.equal(id(17, -15.41, 28.12), 'es'); assert.equal(id(17, 2.65, 39.57), 'es');
  assert.equal(id(17, 21.01, 52.23), 'pl'); assert.equal(id(17, 19.94, 50.06), 'pl'); assert.equal(id(17, 18.65, 54.35), 'pl');
  assert.equal(id(17, 24.745, 59.437), 'ee'); assert.equal(id(17, 6.13, 49.61), 'lu');
});
t('neighbouring countries are not claimed', () => {
  assert.equal(id(17, -9.14, 38.72), null, 'Lisbon'); assert.equal(id(17, 2.35, 48.85), 'ign', 'Paris stays IGN'); assert.equal(id(17, 13.4, 52.52), null, 'Berlin');
  assert.equal(id(17, 24.1, 56.95), null, 'Riga'); assert.equal(id(17, 30.3, 59.93), null, 'St Petersburg'); assert.equal(id(17, 14.42, 50.08), 'cz', 'Prague stays CZ');
  assert.equal(id(17, 5.4, 43.3) !== 'es', true); assert.equal(id(17, -5.35, 35.89), null, 'Gibraltar');
});
t('coarse zooms and the existing sources are untouched', () => { assert.equal(id(10, -3.7, 40.4), null); assert.equal(id(17, 139.7, 35.7), 'jp'); assert.equal(id(17, 7.45, 46.95), 'ch'); });
console.log('all imagery tests passed');
