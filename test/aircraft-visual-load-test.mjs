import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { aircraftChoice, AIRCRAFT_TYPES } from '../src/aircrafts.js';

const requested = [];
const source = readFileSync(new URL('../src/aircraft-visual.js', import.meta.url), 'utf8')
  .replaceAll('export function', 'function')
  .replace(/import\('(\.\/[^']+)'\)/g, (_, path) => `load(${JSON.stringify(path)})`);
const context = vm.createContext({ load: path => { requested.push(path); return Promise.resolve({ path }); } });
vm.runInContext(source, context);
assert.deepEqual(requested, [], 'registering loaders must not evaluate any aircraft');
for (const aircraft of ['c172', 'da40', 'f27', 'sf50', 'a380x', 'il76', 'sr71']) {
  const start = requested.length;
  const choice = Object.hasOwn(AIRCRAFT_TYPES, aircraft) ? aircraftChoice({ aircraft: 'sr71' }, '?aircraft=' + aircraft) : aircraft;
  const module = await context.loadAircraftVisual(choice);
  assert.equal(module.path, `./${aircraft}visual.js`);
  assert.deepEqual(requested.slice(start), [`./${aircraft}visual.js`], 'one selected import, never the fleet');
}
for (const unknown of ['unknown', 'constructor', '__proto__', null]) {
  assert.equal((await context.loadAircraftVisual(unknown)).path, './da40visual.js', 'invalid choices retain the DA40 default');
}
assert.equal(aircraftChoice({ aircraft: 'da40' }, ''), 'da40', 'saved choice is retained');
const boot = readFileSync(new URL('../src/boot.js', import.meta.url), 'utf8');
assert.match(boot, /Promise\.all\(\[import\('\.\/main.js'\), loadAircraftVisual\(selectedAircraft\)\]/, 'main and visual transfers overlap');
assert.match(boot, /simulator\.startSimulator\(visual\)/, 'initialization waits for the selected module');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
assert.doesNotMatch(main, /^import .*from ['"]\.\/\w+visual\.js['"]/m, 'no eager visual imports may bypass the loader');
console.log('PASS selected visual import isolation, seven choices, safe fallback, saved/URL choice and parallel bootstrap');
