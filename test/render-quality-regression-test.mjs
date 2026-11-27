import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { normalizeRenderScale, effectiveRenderRatio } from '../src/renderer-size.js';
import { startupWeather } from '../src/flight-weather.js';
import { nextScale, nextPressure, floorFor, dynReady, lowerPreset, DYN } from '../src/dynres.js';
const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const section = (start, end) => main.slice(main.indexOf(start), main.indexOf(end, main.indexOf(start)));

for (const bad of ['auto', '', ' ', null, undefined, true, false, {}, [], NaN, Infinity, -Infinity]) {
  assert.equal(normalizeRenderScale(bad), 1, `malformed ${String(bad)}`);
}
for (let tick = 15; tick <= 50; tick++) {
  const valid = tick / 20;
  assert.equal(normalizeRenderScale(valid), valid);
  assert.equal(normalizeRenderScale(String(valid)), valid);
}
for (const [value, expected] of [[0,.75], [-1,.75], [.5,.75], [3,2.5], [1e20,2.5], [.83,.85]]) {
  assert.equal(normalizeRenderScale(value), expected);
}
const range = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').match(/<input[^>]+id="rscale"[^>]+>/)[0];
assert.match(range, /min="0.75"/); assert.match(range, /max="2.5"/); assert.match(range, /step="0.05"/);
console.log('PASS E22: malformed values default, out-of-range values clamp, every valid manual scale survives');

// Exercise the real load-time wiring with a JSON-serialized bad save, not just the normalizer.
for (const [value, expected] of [['auto',1], ['1.25',1.25], [.75,.75], [1.65,1.65], [2.5,2.5]]) {
  const settings = JSON.parse(JSON.stringify({rscale:value, dynres:false, gfx:'low', volume:.3}));
  let saved;
  const context = vm.createContext({settings, normalizeRenderScale, LS:{set(key, value){saved=JSON.parse(JSON.stringify(value));}}});
  vm.runInContext(section('// Normalize before any migration', '// earlier builds forced Normal'), context);
  assert.equal(settings.rscale, expected); assert.equal(settings.dynres,false); assert.equal(settings.volume,.3);
  if (typeof value !== 'number') assert.equal(saved.rscale, expected);
  else assert.equal(saved,undefined, 'valid choices are not rewritten');
}
console.log('PASS E22: saved-state normalization runs before graphics migrations and preserves other preferences');
{
  // The exact E22 persisted JSON runs through the production LS reader, settings
  // defaults/weather policy, normalization, base ratio and range/label bindings.
  let stored = '{"gfx":"low","rscale":"auto","dynres":false,"volume":0.3}';
  const nodes = {'rscale':{addEventListener(){}}, 'rscale-l':{}};
  const c = vm.createContext({localStorage:{getItem(){return stored;},setItem(key,value){assert.equal(key,'sr71sim.settings');stored=value;}},
    FT:3.28084,KT:1.94384,DEFAULT_VOICE_STYLE:'test',startupWeather,normalizeRenderScale,devicePixelRatio:1,
    $:id=>nodes[id],saveSettings(){},rebase(){}});
  vm.runInContext(section('const LS =', 'const logbook =')+
    section('const firstRun =', '// earlier builds forced Normal')+
    section('const MAX_RATIO =','function viewRenderRatio()')+
    section("$('rscale').value =", '// browser zoom'),c);
  assert.equal(JSON.parse(stored).rscale,1);
  assert.equal(vm.runInContext('baseRatio({dpr:[1,1.5]})',c),1);
  assert.equal(nodes.rscale.value,1);assert.equal(nodes['rscale-l'].textContent,'100%');
  assert.equal(vm.runInContext('settings.dynres',c),false);
}
console.log('PASS E22: exact localStorage rscale:auto is repaired by production load/baseRatio/slider/label wiring');


// Production adaptResolution integration: no simulated GPU/FPS benchmark.
const settings = {dynres:true, rscale:1.65, gfx:'high'};
const pressure = {level:3, slowN:0, fastN:0};
const dynres = {base:1, scale:.55, times:[], at:0, changed:0};
const context = vm.createContext({settings, pressure, dynres, state:{paused:false,pending:null}, devicePixelRatio:1,
  nextScale, nextPressure, floorFor, dynReady, lowerPreset, DYN, setRenderScale(){}, setDetail(){throw Error('unexpected preset change');}});
vm.runInContext(section('function adaptResolution(', 'let aoBase'),context);
for (let i=1; i<=400*90; i++) vm.runInContext(`adaptResolution(1/60, ${i*1000/60})`,context);
assert.equal(pressure.level,0); assert.equal(dynres.scale,1);
assert.equal(settings.rscale,1.65); assert.equal(settings.gfx,'high');
// The caller must pass p90: repeated hitches cannot count as a clean recovery window.
Object.assign(pressure,{level:2,slowN:0,fastN:0});
for (let i=1; i<=90; i++) vm.runInContext(`adaptResolution(${i>75 ? 1/25 : 1/60}, ${600000+i*1000/60})`,context);
assert.equal(pressure.level,2); assert.equal(pressure.fastN,0);
// Manual rendering remains independent of all automatic pressure/scale choices.
for (const manual of [.75,1,1.65,2.5]) {
  assert.equal(effectiveRenderRatio(manual,.55,false,1,false,false),manual);
  assert.equal(effectiveRenderRatio(manual,.55,false,1,true,false),manual);
}
console.log('PASS E13: real 60 fps integration recovers pressure and scale; hitchy windows do not; manual choices stay intact');
