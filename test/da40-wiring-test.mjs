import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AIRCRAFT_TYPES, aircraftChoice } from '../src/aircrafts.js';
import { KEY_ACTIONS } from '../src/controls.js';
import { landingLimits } from '../src/difficulty.js';
import { cleanSetup } from '../src/logbook.js';
import { slewExitSpeed } from '../src/slew.js';

assert.equal(aircraftChoice({}, '?aircraft=da40'), 'da40');
assert.equal(aircraftChoice({ aircraft: 'da40' }), 'da40');
assert.equal(AIRCRAFT_TYPES.da40.model, 'da40/da40-ng.glb');
for (const name of ['sr71', 'c172', 'sf50', 'il76']) assert.equal(aircraftChoice({}, `?aircraft=${name}`), name);
assert.ok(KEY_ACTIONS.find((action) => action.id === 'engineStart').keys.includes('Shift+KeyI'));
assert.ok(KEY_ACTIONS.find((action) => action.id === 'doors').keys.includes('Shift+KeyN'));
assert.deepEqual(landingLimits('da40', 'realistic'), landingLimits('c172', 'realistic'));
assert.ok(cleanSetup({ aircraft: 'da40', airport: 'KBAB', rwy: 0, end: 1, mode: 'runway', mission: 'free', weather: 'clear', hour: 15 }));
assert.ok(slewExitSpeed(0, 0, 'da40') < 100);
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
assert.match(html, /class="ac-card" data-v="da40"/);
assert.match(main, /IS_DA40 \? new DA40Model\(\)/);
assert.match(main, /IS_DA40 \? new DA40Visual\(scene\)/);
assert.match(main, /IS_DA40 \? \(rig\.view === 'cockpit' \? \(\) => da40State\(att, warn\)/);
console.log('DA40 selection, controls, flight model, visual, display feed, logbook and difficulty wiring pass');

// A view switch must reapply the cockpit's configured pixel floor immediately,
// even if the adaptive controller's scale has stayed unchanged.
const {runInNewContext} = await import('node:vm');
const ratioPolicy = main.slice(main.indexOf('function viewRenderRatio()'), main.indexOf('function setRenderScale()'));
const graphics = {IS_F27:false,devicePixelRatio:1, dynres:{base:1,scale:0.67}, settings:{dynres:true}, rig:{view:'chase'}};
const ratio = () => runInNewContext(ratioPolicy+'\nviewRenderRatio()', graphics);
assert.equal(ratio(),0.67);
graphics.rig.view='cockpit'; assert.equal(ratio(),1);
graphics.dynres.base=0.8; assert.equal(ratio(),0.8);
graphics.devicePixelRatio=2; graphics.dynres.base=1.5; assert.equal(ratio(),1.5);
assert.match(main, /if \(IS_DA40 && Math\.abs\(renderer\.getPixelRatio\(\) - viewRenderRatio\(\)\)/);
graphics.IS_F27=true; assert.equal(ratio(),1.5*0.67,'F27 keeps adaptive resolution in both views');
console.log('DA40 cockpit render scale is reapplied on view switch, respecting the manual quality cap');
