import assert from 'node:assert/strict';import fs from 'node:fs';
const h=fs.readFileSync('index.html','utf8'),m=fs.readFileSync('src/main.js','utf8');
for(const id of ['airports','ap','env','settings','help'])assert.match(h.slice(h.indexOf(`id="sheet-${id}"`)),/class="panel-summary"/);
assert.doesNotMatch(h,/id="relief"/);assert.doesNotMatch(m,/\$\('relief'\)/);assert.match(m,/TERRAIN_UNIFORMS.uRelief.value = settings.relief/);
assert.match(h,/Runways ≥ 3 km/);assert.match(m,/settings-reset/);assert.match(m,/dispatchEvent\(new Event\('change'\)\)/);assert.match(m,/weather-reset/);
console.log('Panel explanations, native Advanced groups, live reset paths and dead relief UI removal');
