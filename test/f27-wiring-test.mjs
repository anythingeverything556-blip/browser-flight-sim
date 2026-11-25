import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { AIRCRAFT_TYPES, aircraftChoice } from '../src/aircrafts.js';
import { F27_CG, F27_GEAR, F27_FLAP_DEG } from '../src/f27.js';
import { landingLimits } from '../src/difficulty.js';
import { cleanSetup } from '../src/logbook.js';
import { slewExitSpeed } from '../src/slew.js';

const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const main = read('src/main.js'), html = read('index.html'), visualSource = read('src/f27visual.js');
assert.equal(aircraftChoice({}, '?aircraft=f27'), 'f27');
assert.equal(aircraftChoice({ aircraft: 'f27' }), 'f27');
assert.equal(aircraftChoice({}, ''), 'da40', 'default aircraft stays unchanged');
assert.equal(AIRCRAFT_TYPES.f27.model, 'f27/f27-white-ext-v3.glb');
for (const id of ['sr71','c172','da40','sf50','il76']) assert.equal(aircraftChoice({}, '?aircraft=' + id), id);
assert.ok(cleanSetup({ aircraft:'f27', airport:'KBAB', rwy:0, end:1, mode:'runway', mission:'free', weather:'clear', hour:15 }));
assert.equal(landingLimits('f27','realistic').sinkMax, 3.7);
assert.ok(slewExitSpeed(0, 0, 'f27') < 100);
assert.match(main, /IS_F27 \? new F27Model\(\)/);
assert.match(main, /IS_F27 \? new F27Visual\(scene\)/);
assert.match(main, /IS_GA = IS_PROP \|\| IS_SF50 \|\| IS_F27/);
assert.doesNotMatch(main, /IS_PROP = [^;]*IS_F27[^;]*IS_SF50 =/);
assert.match(main, /IS_F27\) audio.configure\(\{ engines: 2, turboprop: true \}\)/);
assert.match(main, /turboprop: IS_F27 \? fdm.engines.map\(\(e,i\) => \(\{rpm:e.propRpm, turbineRpm:e.rpm/);
assert.match(main, /const N_LEVERS = IS_GA && !IS_F27 \? 1/);
assert.match(main, /s.ground && \(s.cold/);
assert.match(main, /IS_F27 \? F27_AP/);
assert.match(main, /configurePropApUi\(document, ap.cfg\)/);
assert.match(main, /ap.cfg.manualThrottle \? 'Autopilot engaged — manual throttle/);
assert.match(html, /class="ac-card" data-v="f27"/);
assert.match(html, /src="\/images\/aircraft-f27.webp"/);
assert.match(html, /id="f27-cold"/);
for (const name of ['navigation','beacon','landing','taxi','wingInspection','cockpitDome','cockpitDomeRed'])
  assert.ok(html.includes('data-f27-light="' + name + '"'));
assert.match(visualSource, /setDRACOLoader\(draco\).setMeshoptDecoder\(MeshoptDecoder\)/);
assert.match(visualSource, /root.rotation.y = Math.PI \/ 2/);
assert.match(visualSource, /webDefaultVisible === false/);
assert.match(visualSource, /e.propRpm \?\? fdm.propRpm/);
assert.match(visualSource, /m.emissiveIntensity = 0/);

// Evaluate only the local visual module with injected imports; no WebGL/network required.
const body = visualSource.replace(/^import .*;\n/gm, '').replaceAll('export ', '').replaceAll('import.meta.env.BASE_URL', '"/"');
const { F27Visual, applyF27DefaultVisibility, propellerMode, F27_EYE, F27_SOURCE_OFFSET } = new Function('THREE','F27_CG','F27_GEAR','F27_FLAP_DEG','createFokkerAdapter','lighting',
  body + '\nreturn {F27Visual,applyF27DefaultVisibility,propellerMode,F27_EYE,F27_SOURCE_OFFSET};'
)(THREE,F27_CG,F27_GEAR,F27_FLAP_DEG,null,{});
assert.deepEqual([0,142.9,143,287.4,287.5,1395].map(propellerMode), ['Still','Still','Slow','Slow','Blurred','Blurred']);
const defaults = new THREE.Group(), helper = new THREE.Object3D(), blade = new THREE.Object3D();
helper.userData.webDefaultVisible = false; defaults.add(helper,blade); applyF27DefaultVisibility(defaults);
assert.equal(helper.visible,false); assert.equal(blade.visible,true);
const sourceContact = new THREE.Vector3(-0.43 * 0.3048,-1.831394,-11.84 * 0.3048);
assert.ok(sourceContact.add(F27_SOURCE_OFFSET).sub(F27_CG).distanceTo(F27_GEAR[1].p) < 1e-9, 'authored wheel aligns with collider');
const eye = new THREE.Vector3(8.25,0.90,-0.48).add(F27_SOURCE_OFFSET).sub(F27_CG);
assert.ok(eye.distanceTo(F27_EYE) < 1e-9, 'source pilot eye survives coordinate conversion');
const v = new F27Visual(new THREE.Scene()), loads = [];
v.loadPart = async (url, kind) => { loads.push({url,kind}); return { root:new THREE.Group() }; };
await v.load('/models/' + AIRCRAFT_TYPES.f27.model);
await v.ensureView('orbit'); await v.ensureView('chase');
assert.deepEqual(loads.map(x=>x.kind), ['exterior'], 'startup and exterior views never request cockpit');
const a = v.preloadCockpit(), b = v.preloadCockpit(); assert.equal(a,b,'concurrent cockpit requests share a promise');
await a; assert.equal(v.view, 'chase', 'preload does not change the camera'); assert.equal(v.interior.root.visible,false); assert.equal(v.viewStatus.cockpit,'ready'); await v.ensureView('cockpit');
assert.deepEqual(loads.map(x=>x.kind), ['exterior','cockpit'], 'interior loads once, lazily');
assert.match(loads[1].url,/f27-white-vc-v2.glb$/);

// Verify compact game assets, not the larger reference conversions.
for (const [name, minClips] of [['f27-white-ext-v3.glb',100],['f27-white-vc-v2.glb',600]]) {
  const bytes = readFileSync(new URL('../public/models/f27/' + name, import.meta.url));
  const json = JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
  assert.ok(bytes.byteLength < (name.includes("ext") ? 1_600_000 : 5_200_000));
  assert.ok(json.animations.length >= minClips);
  assert.ok(json.nodes.some(n=>n.extras?.webDefaultVisible===false));
  assert.ok(json.nodes.some(n=>n.name==='x0_PROPELLER_BLURRED_1'));
}
assert.match(main, /if \(IS_F27 && !navigator\.connection\?\.saveData\) void f27CockpitPreload/);
assert.match(html, /id="f27-panel-light"/); assert.match(html, /id="f27-seat-height"/); assert.match(html, /id="sheet-f27"/);
console.log('PASS F27 registration, isolation, no jet rules, twin controls/audio, cold start, wheel/eye frame, default visibility, RPM modes, decoder support and lazy cockpit loading');
