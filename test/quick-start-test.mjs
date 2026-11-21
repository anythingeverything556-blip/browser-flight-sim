import assert from 'node:assert/strict';
import fs from 'node:fs';
const html = fs.readFileSync('index.html','utf8'), main = fs.readFileSync('src/main.js','utf8');
assert.ok(html.indexOf('id="just-fly"') < html.indexOf('id="ac-slot"'));
const quick = main.slice(main.indexOf('// Explicit quick-start'), main.indexOf("const missionKindSet"));
assert.match(quick, /applyWeather\('clear', false\)/);
assert.match(quick, /homeAirport\(\)/); assert.doesNotMatch(quick, /saveSettings\(|navigator.geolocation/);
assert.match(quick, /searchParams.set\('aircraft', quickAircraft\)/);
console.log('Quick start: explicit choice, home runway, transient clear weather');
