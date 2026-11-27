import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { AIRCRAFT_TYPES, aircraftChoice } from '../src/aircrafts.js';
import { createDiagnostics, diagnostics, installRuntimeDiagnostics, installShaderDiagnostics } from '../src/telemetry.js';
const d=createDiagnostics(3);
for(let i=0;i<10;i++)d.record('start_screen_viewed','screen');assert.equal(d.events().length,3);
d.record('https://private.example','secret');d.record('aircraft_chosen','secret');d.record('__proto__','toString');assert.equal(d.events().length,3);
const copy=d.events();copy[0].name='changed';assert.equal(d.events()[0].name,'start_screen_viewed');assert.deepEqual(Object.keys(copy[0]),['name','category']);
const target=new EventTarget();installRuntimeDiagnostics(target);installRuntimeDiagnostics(target);
const event=new Event('unhandledrejection',{cancelable:true});event.reason={message:'private secret'};target.dispatchEvent(event);assert.equal(event.defaultPrevented,false);assert.deepEqual(diagnostics.events().at(-1),{name:'runtime_error',category:'promise'});
let chained=0;const renderer={debug:{onShaderError:()=>chained++}};installShaderDiagnostics(renderer);renderer.debug.onShaderError({}, {}, {}, {});assert.equal(chained,1);assert.equal(renderer.debug.checkShaderErrors,true);assert.deepEqual(diagnostics.events().at(-1),{name:'graphics_error',category:'shader'});
console.log('PASS local diagnostics bound, sanitization, detached snapshots, console/default preservation and shader hook chaining');

// Q03: use the public selectable fleet, not dormant aircraft models, as the boundary.
const publicIds = Object.keys(AIRCRAFT_TYPES), fleet = createDiagnostics();
for (const id of publicIds) fleet.record('aircraft_chosen', id);
assert.deepEqual(fleet.events(), publicIds.map(category => ({ name: 'aircraft_chosen', category })));
for (const category of ['a380x', 'unknown', '__proto__', 'constructor', '', null, {}, ['da40'], 'DA40']) fleet.record('aircraft_chosen', category);
assert.equal(fleet.events().length, publicIds.length, 'unselectable and untrusted categories remain rejected');

// Execute the real boot setup and delegated click handler: once on load and once per
// trusted aircraft selection. No simulator, network, persistent diagnostic storage or GL.
const boot = fs.readFileSync(new URL('../src/boot.js', import.meta.url), 'utf8');
const setup = boot.slice(0, boot.indexOf('function startSimulator()')).replace(/^import .*;$/gm, '');
class Element {
  constructor(id) { this.dataset = { v: id }; }
  closest(selector) { return selector === '#ac-cards [data-v]' ? this : null; }
}
for (const id of publicIds) {
  const local = createDiagnostics(), handlers = [], target = new EventTarget();
  target.__simReady = true;
  vm.runInNewContext(setup, {
    mountSetupAccessibility() {}, diagnostics: local, installRuntimeDiagnostics() {},
    aircraftChoice, AIRCRAFT_TYPES, location: { search: `?aircraft=${id}` },
    localStorage: { getItem: () => '{}' }, window: target, Element,
    document: { getElementById: () => null, addEventListener: (name, fn) => { assert.equal(name, 'click'); handlers.push(fn); } }
  });
  const selections = () => local.events().filter(e => e.name === 'aircraft_chosen');
  assert.deepEqual(selections(), [{ name: 'aircraft_chosen', category: id }], `${id} selected once on load`);
  assert.equal(handlers.length, 1);
  handlers[0]({ target: new Element(id), isTrusted: false });
  assert.equal(selections().length, 1, 'synthetic clicks are ignored');
  handlers[0]({ target: new Element(id), isTrusted: true });
  assert.deepEqual(selections(), Array.from({ length: 2 }, () => ({ name: 'aircraft_chosen', category: id })), `${id} selected once per click`);
  handlers[0]({ target: new Element('a380x'), isTrusted: true });
  assert.equal(selections().length, 2, 'clicks cannot widen the public fleet');
}
console.log(`PASS Q03: all ${publicIds.length} public aircraft emit once on load and trusted selection; unknown IDs and synthetic clicks rejected`);
