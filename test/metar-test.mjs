import assert from 'node:assert/strict';
import { interpretMetar, mapWmoWeather, parseMetar } from '../src/metar.js';

const us = parseMetar('KJFK 121651Z 18012G22KT 10SM -RA SCT020 BKN080 18/12 A2992');
assert.equal(us.icaoId, 'KJFK');
assert.equal(us.wdir, 180);
assert.equal(us.wspd, 12);
assert.equal(us.wgst, 22);
assert.equal(us.visibilitySM, 10);
assert.equal(us.visibilityMeters, 10 * 1609.344);
assert.equal(us.clouds[1].base, 8000);
assert.equal(us.temp, 18);
assert.equal(us.dewp, 12);
assert.ok(Math.abs(us.altim - 1013.2) < 0.2);
assert.equal(us.rainIntensity, 0.32);

const uk = parseMetar('EGLL 121650Z 24015G25KT 9999 -SHRA BKN018 15/11 Q1013');
assert.equal(uk.visibilityMeters, 10000);
assert.ok(uk.visibilitySM > 6 && uk.visibilitySM < 6.3);
assert.equal(uk.clouds[0].base, 1800);
assert.equal(uk.wgst, 25);
assert.ok(uk.rainIntensity > 0.32 && uk.rainIntensity < 0.62);

const germany = parseMetar('EDDF 121650Z 27008MPS 9999 FEW030 22/14 Q1018');
assert.equal(germany.wdir, 270);
assert.equal(germany.wspd, 16);
assert.equal(germany.clouds[0].base, 3000);

const japan = parseMetar('RJTT 121630Z 09010KMH 10SM BR FEW012 SCT040 23/20 Q1009');
assert.equal(japan.wspd, 5);
assert.equal(japan.fog, 0.4);
assert.equal(japan.clouds[0].base, 1200);

const australia = parseMetar('YSSY 121630Z 13012KT 9999 CAVOK 21/12 Q1018');
assert.equal(australia.clouds.length, 0);
assert.equal(australia.visibilityMeters, 10000);
assert.equal(australia.visibilitySM > 6, true);

const russia = parseMetar('UUEE 121630Z 22008G14MPS 9999 -SN BKN015 M02/M05 Q1004');
assert.equal(russia.wspd, 16);
assert.equal(russia.wgst, 27);
assert.equal(russia.temp, -2);
assert.equal(russia.dewp, -5);
assert.ok(russia.rainIntensity > 0);

const southAfrica = parseMetar('FAOR 121630Z VRB05KT 1 1/2SM VCTS SCT035 20/09 A3012');
assert.equal(southAfrica.wdir, 'VRB');
assert.equal(southAfrica.visibilitySM, 1.5);
assert.equal(southAfrica.thunder, true);
assert.equal(southAfrica.rainIntensity, 1);

const fractional = parseMetar('KORD 121651Z 00000KT 1/2SM FG VV003 M01/M03 Q0998');
assert.equal(fractional.visibilitySM, 0.5);
assert.equal(fractional.clouds[0].cover, 'VV');
assert.equal(fractional.clouds[0].base, 300);
assert.equal(fractional.temp, -1);
assert.equal(fractional.fog, 0.85);

const greaterVisibility = parseMetar('KAAA 010000Z 18010KT P6SM 10SM SCT020 10/05 A2992');
assert.equal(greaterVisibility.visibilitySM, 6);
assert.equal(greaterVisibility.visib, '6+');
assert.ok(Math.abs(greaterVisibility.visibilityMeters - 6 * 1609.344) < 0.01);
const metricVisibility = parseMetar('EGLL 010000Z 18010KT 9999 CAVOK 10/05 Q1013');
assert.equal(metricVisibility.visibilityMeters, 10000);
assert.equal(metricVisibility.clouds.length, 0);
const drizzle = parseMetar('KAAA 010000Z 18010KT 10SM -DZ SCT020 10/05 Q1013');
assert.equal(drizzle.rainIntensity, 0.32);

const interpretation = interpretMetar('KJFK 121651Z VRB03KT P6SM +TSRA OVC025 30/24 Q1008');
assert.equal(interpretation.rain, 1);
assert.equal(interpretation.rainIntensity, 1);
assert.equal(interpretation.storm, true);
assert.equal(interpretation.windDir, 0);
assert.ok(interpretation.gustKt === 0);
assert.equal(mapWmoWeather(95).thunder, true);
assert.equal(mapWmoWeather(61).rain > 0, true);

console.log('metar-test ok');
