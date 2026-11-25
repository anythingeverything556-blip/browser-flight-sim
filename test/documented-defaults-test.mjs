import assert from 'node:assert/strict';import fs from 'node:fs';
const h=fs.readFileSync('index.html','utf8'),r=fs.readFileSync('README.md','utf8'),m=fs.readFileSync('src/main.js','utf8');
assert.match(h,/<input[^>]+id="rscale"[^>]+value="1"/);assert.match(h,/id="opt-dynres" checked/);assert.doesNotMatch(r,/defaults to 200/);assert.match(r,/defaults to \*\*100%\*\*/);assert.match(r,/It now flies four/);assert.match(r,/Local logbook/);assert.match(m,/if \(IS_C172\) \{ missionKind = 'c172guide'/);
console.log('README/HTML native 100%, adaptive on, four aircraft, C172 guide and local setup/logbook copy match release');
