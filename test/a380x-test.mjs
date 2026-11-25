import assert from 'node:assert/strict';
import * as THREE from 'three';
import { A380XModel, A380X, A380X_CG, NOTCHES, NOTCH_TAKEOFF, thrustMax } from '../src/a380x.js';
import { A380X_AP } from '../src/a380xap.js';
import { readFileSync } from 'node:fs';
import { Autobrake } from '../src/autobrake.js';
import { a380xWarn, a380xWarnReset } from '../src/a380xfeed.js';
import { makeA380xControls } from '../src/a380xctl.js';
import { AIRCRAFT_TYPES, aircraftChoice } from '../src/aircrafts.js';
import { landingLimits } from '../src/difficulty.js';
const KT = 1.943844, wind = new THREE.Vector3();
function step(f, seconds, control) { for (let i = 0; i < seconds * 120; i++) { control?.(f, i / 120); f.step(1 / 120, () => 0, wind); if (f.crashed) break; } }
function fresh(alt = 10668, speed = 250, mass = 482000, onGround = false) { const f = new A380XModel(); f.fuel = mass - A380X.EMPTY - A380X.PAYLOAD; f.setMode('realistic'); f.reset(new THREE.Vector3(0, onGround ? A380X_CG.y : alt, 0), 90, speed, onGround); return f; }
assert.equal(aircraftChoice({}, '?aircraft=a380x'), 'da40');
assert.equal(aircraftChoice({ aircraft: 'a380x' }), 'da40');
for (const id of ['sr71', 'c172', 'sf50', 'il76']) assert.ok(AIRCRAFT_TYPES[id]);
assert.equal(AIRCRAFT_TYPES.a380x, undefined); assert.equal(A380X.B, 79.75); assert.equal(A380X.S, 845);
assert.equal(A380X.EMPTY + A380X.PAYLOAD + A380X.FUEL_MAX, A380X.MTOW);
assert.equal(thrustMax(1.225, 0), A380X.THRUST0);
for (const [alt, speed, mass] of [[10668,250,482000], [1500,145 / KT,394000]]) {
  const f = fresh(alt,speed,mass), start = f.pos.y; assert.ok(f.throttle < 1);
  step(f,60); assert.equal(f.crashed,null); assert.ok(Math.abs(f.pos.y - start) < 100, `${alt} m trimmed flight drift: ${f.pos.y-start}`); assert.ok(Math.abs(f.vel.length()-speed)<6);
  assert.equal(f.engines.length,4); assert.equal(f.contacts.length,5); assert.ok(f.fuel<mass-A380X.EMPTY-A380X.PAYLOAD);
}
const f=fresh(0,0,482000,true); f.parkingBrake=false; f.throttle=1; f.setFlaps(NOTCH_TAKEOFF); f.flaps=NOTCHES[NOTCH_TAKEOFF].flap; f.slats=NOTCHES[NOTCH_TAKEOFF].slat; f.setTakeoffTrim();
let airborne=false; step(f,70,(g)=>{if(g.out.ias*KT>g.vSpeed(A380X.VR_575))g.ctrl.de=.15;if(!g.onGround&&g.pos.y>10)airborne=true;});
assert.equal(f.crashed,null);assert.ok(airborne,'normal mass takes off with indicative controls'); assert.ok(f.pos.y>20);
const air=fresh(); assert.equal(air.setReverser(true),false); air.setGear(false); step(air,22); assert.equal(air.gearPos,0); air.setGear(true); step(air,22); assert.equal(air.gearPos,1);
const g=fresh(0,0,394000,true); step(g,3); assert.equal(g.setGear(false),false); assert.equal(g.setReverser(true),true); g.throttle=.8; step(g,8); assert.deepEqual(g.engines.map(e=>e.rev>.9),[false,true,true,false]);
const messages=[], ctl=makeA380xControls({fdm:g,toast:m=>messages.push(m),casKt:()=>140}); for(let i=0;i<8;i++)ctl.flapsDown();assert.equal(g.flapCmd,4);ctl.flapsUp();assert.equal(g.flapCmd,3);ctl.spoilers();assert.ok(g.spoilerCmd);ctl.doors();assert.match(messages.at(-1),/not interactive/);
assert.equal(A380X_AP.machLimit,.89);assert.equal(A380X_AP.iasLimit*KT,340);assert.equal(landingLimits('a380x','realistic').sinkMax,3.7);
const warning=Array.from({length:200},()=>a380xWarn(air,{casKt:360,iasMs:185,agl:3000,dt:.02})).at(-1);assert.ok(warning.overspeed);
a380xWarnReset(air);assert.equal(a380xWarn(air,{casKt:200,iasMs:103,agl:3000,dt:.01}).overspeed,false,'respawn warning reset');
const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');assert.match(main,/if \(IS_A380X\) a380xWarnReset\(fdm\)/);
assert.match(main,/throttle: IS_A380X && fdm\.reverserCmd \? 0 : controls\.throttle/);
const ab=new Autobrake();ab.level=3;ab.flew=true;assert.equal(ab.update({onGround:true,gs:60,accel:0,throttle:0,pedal:0},.1),1);assert.equal(ab.update({onGround:true,gs:55,accel:-1,throttle:0,pedal:0},.1),1,'reverse power must not cancel autobraking');
console.log('A380X: independent mass/geometry/thrust, cruise/final trim, takeoff, five contact units, inboard reverse, gear/flaps controls and warnings pass');
