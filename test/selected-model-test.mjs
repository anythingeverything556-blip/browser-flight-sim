import assert from 'node:assert/strict';import fs from 'node:fs';import {aircraftChoice,AIRCRAFT_TYPES} from '../src/aircrafts.js';
const html=fs.readFileSync('index.html','utf8');assert.doesNotMatch(html,/<link[^>]+rel="preload"[^>]+models\//);
for(const a of Object.keys(AIRCRAFT_TYPES)){assert.equal(aircraftChoice({aircraft:a}),a);assert.equal(aircraftChoice({aircraft:'sr71'},`?aircraft=${a}`),a);}
const main=fs.readFileSync('src/main.js','utf8');assert.ok(main.includes('visual.load(`${BASE}models/${AC.model}`'));
console.log('Only selected aircraft model is loaded; saved and deep-link choices honored');
