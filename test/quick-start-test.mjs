import assert from 'node:assert/strict';
import fs from 'node:fs';
const html = fs.readFileSync('index.html','utf8'), main = fs.readFileSync('src/main.js','utf8');
// The standard start is the persistent primary action; Quick start is still
// an explicit, clearly labeled secondary action in the setup panel.
const setup = html.slice(html.indexOf('id="sheet-flight"'), html.indexOf('id="sheet-map"'));
assert.match(setup, /aria-label="Quick start"[\s\S]*?id="just-fly" class="ghost wide"/);
assert.match(setup, /<footer class="sheet-foot">[\s\S]*?id="start-btn" class="cta"/);
const quick = main.slice(main.indexOf('// Explicit quick-start'), main.indexOf("const missionKindSet"));
assert.match(quick, /applyWeather\('clear', false\)/);
assert.match(quick, /homeAirport\(\)/); assert.doesNotMatch(quick, /saveSettings\(|navigator.geolocation/);
assert.match(quick, /searchParams.set\('aircraft', quickAircraft\)/);
console.log('Quick start: explicit choice, home runway, transient clear weather');

const boot=fs.readFileSync('src/boot.js','utf8');assert.match(boot,/quickButton.textContent = `Just fly/);assert.match(boot,/#resume-flight/);
