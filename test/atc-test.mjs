import assert from 'node:assert/strict';
import {
  advanceAtcPhase, buildAtis, buildPhaseMessage, buildReadback, buildTrafficAdvisory, selectRunwayFromWind,
} from '../src/atc.js';

assert.equal(selectRunwayFromWind(['09', '27'], { dir: 240, kt: 15 }), '27');
assert.equal(selectRunwayFromWind([{ ident: '04L', headingDeg: 40 }, { ident: '22R', headingDeg: 220 }], { dir: 215, kt: 12 }), '22R');

const metar = 'EGLL 121650Z 24015G25KT 9999 -SHRA BKN018 15/11 Q1013';
const atis = buildAtis({ metar, information: 'C', runways: ['09', '27'], region: 'ICAO' });
assert.match(atis, /Information C/);
assert.match(atis, /runway 27 in use/);
assert.match(atis, /wind 240 degrees at 15 gusting 25 knots/);
assert.match(atis, /QNH 1013/);
assert.match(buildAtis({ metar: 'KJFK 121651Z 18012KT 10SM SCT020 18/12 A2992', region: 'FAA' }), /altimeter 29\.92/);
assert.match(buildAtis({
  metar: 'EGLL 121650Z 24015KT 9999 SCT018 15/11 Q1013',
  runways: [{ name: '09/27', hdg: 90, ends: [{ ident: '09', hdg: 90 }, { ident: '27', hdg: 270 }] }],
}), /runway 27 in use/);

const faaHold = buildPhaseMessage('hold-short', { region: 'FAA', runway: '27L' });
const icaoHold = buildPhaseMessage('hold-short', { region: 'ICAO', runway: '27L' });
assert.match(faaHold.text, /position and hold/);
assert.match(icaoHold.text, /line up and wait/);
assert.match(buildPhaseMessage('parked', { qnhHpa: 1013 }).text, /QNH 1013/);
// Q1013 is 29.91 inHg to the nearest hundredth; A2992 remains 29.92.
assert.match(buildPhaseMessage('parked', { region: 'FAA', qnhHpa: 1013 }).text, /altimeter 29\.91/);
assert.match(buildPhaseMessage('landing', { runway: '27', wind: '240 at 15' }).readback, /Cleared to land runway 27/);

const state = {};
const first = advanceAtcPhase(state, 'climb', { callsign: 'Blackbird 71' });
assert.equal(first.station, 'Departure');
assert.equal(first.handoff, true);
assert.equal(advanceAtcPhase(state, 'climb'), null);
assert.match(advanceAtcPhase(state, 'approach', { missedApproach: true }).text, /go around/);
assert.match(buildPhaseMessage('landed').text, /contact ground/);
assert.match(buildReadback(faaHold), /Blackbird 71/);

const traffic = buildTrafficAdvisory([{ lat: 0.1, lon: 0, alt: 3000 }], { lat: 0, lon: 0, alt: 2000 });
assert.match(traffic, /12 o'clock/);
assert.match(traffic, /above/);
assert.equal(buildTrafficAdvisory([], { lat: 0, lon: 0 }), null);

console.log('atc-test ok');
