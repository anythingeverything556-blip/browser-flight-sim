import assert from 'node:assert/strict';import fs from 'node:fs';import {aircraftChoice,AIRCRAFT_TYPES} from '../src/aircrafts.js';
const html=fs.readFileSync('index.html','utf8');assert.doesNotMatch(html,/<link[^>]+rel="preload"[^>]+models\//);
for(const a of Object.keys(AIRCRAFT_TYPES)){assert.equal(aircraftChoice({aircraft:a}),a);assert.equal(aircraftChoice({aircraft:'sr71'},`?aircraft=${a}`),a);}
assert.equal(aircraftChoice({}), 'da40');
assert.equal(aircraftChoice({aircraft:'a380x'}), 'da40');
assert.equal(aircraftChoice({aircraft:'sr71'}, '?aircraft=a380x'), 'da40');
assert.equal(aircraftChoice({aircraft:'a380x'}, '?aircraft=c172'), 'c172');
assert.equal(aircraftChoice({}, '?aircraft=__proto__'), 'da40');
assert.equal(Object.hasOwn(AIRCRAFT_TYPES, 'a380x'), false);
assert.doesNotMatch(html, /data-v="a380x"|\/models\/a380x\//i);
const main=fs.readFileSync('src/main.js','utf8');assert.ok(main.includes('visual.load(`${BASE}models/${AC.model}`'));
console.log('Only selected aircraft model is loaded; saved and deep-link choices honored');
