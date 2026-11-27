// E18–E21: record real feed/Canvas commands in Node; no renderer, network or flight-state writes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { attitude } from '../src/autopilot.js';
import { il76Feed } from '../src/il76feed.js';
import { IL76Displays } from '../src/il76displays.js';
import { makeSF50Feed, cabinAt } from '../src/sf50feed.js';
import { SF50Displays } from '../src/sf50displays.js';

const near = (a, b, eps = 1e-7) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
let failures = 0;
function check(name, fn) {
  try { console.log('PASS', name, fn() || ''); }
  catch (e) { failures++; console.error('FAIL', name, e.stack); }
}
// Small affine canvas recorder: keep transformed geometry and paint, not just the requested rotate argument.
function recorder() {
  let m = [1, 0, 0, 1, 0, 0], path = [], arcs = [];
  const stack = [], strokes = [], fills = [];
  const point = (x, y) => [m[0]*x + m[2]*y + m[4], m[1]*x + m[3]*y + m[5]];
  const ctx = {
    strokes, fills,
    setTransform(...a) { m = a; },
    save() { stack.push({ m: [...m], fill: this.fillStyle, stroke: this.strokeStyle }); },
    restore() { const s = stack.pop(); assert.ok(s, 'balanced canvas stack'); m = s.m; this.fillStyle = s.fill; this.strokeStyle = s.stroke; },
    translate(x, y) { const p = point(x, y); m[4] = p[0]; m[5] = p[1]; },
    rotate(a) { const c = Math.cos(a), s = Math.sin(a), [a0,b,c0,d] = m; m[0] = a0*c+c0*s; m[1] = b*c+d*s; m[2] = c0*c-a0*s; m[3] = d*c-b*s; },
    beginPath() { path = []; arcs = []; },
    moveTo(x, y) { path.push(point(x,y)); }, lineTo(x, y) { path.push(point(x,y)); },
    arc(x,y,r) { arcs.push({ center: point(x,y), r }); },
    fill() { fills.push({ style: this.fillStyle, points: [...path] }); },
    stroke() { strokes.push({ style: this.strokeStyle, points: [...path], arcs: [...arcs] }); },
    measureText(s) { return { width: String(s).length * 10 }; },
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
  };
  return new Proxy(ctx, { get: (o,k) => k in o ? o[k] : () => {} });
}
globalThis.OffscreenCanvas = class {
  constructor(w,h) { this.width = w; this.height = h; this.g = recorder(); }
  getContext() { return this.g; }
};
const frozen = o => { Object.freeze(o); for (const v of Object.values(o)) if (v && typeof v === 'object' && !Object.isFrozen(v)) frozen(v); return o; };
const fdmAt = (ft = 25000) => frozen({
  pos: { x:0, y:ft / 3.28084, z:0 }, vel: { x:0, y:2, z:-80 },
  out: { V:80, M:0.3, T:250, nz:1 }, engines: [{ n1:70, n2:80, ff:0.05, lit:true, dry:0.5 }],
  fuel:600, engineOn:true, throttle:0.5, sasOn:true, onGround:false, gearDown:false,
});
const context = (heading = 0, flightT = 0, extra = {}) => frozen({ att: { pitch:0.1, bank:0.05, heading }, casMs:80, gsMs:80, flightT, ...extra });
const ap = frozen({ on:true, modes: { hdg:true, alt:true }, status: { lat:'HDG', vert:'ALT' }, target: { spd:80, alt:7620, hdg:90 } });
const drawSF = s => { const d = new SF50Displays({ scale:1 }); d.ensureMap = () => ({}); d.drawPFD(frozen(s)); return d.pfd.g; };
const magenta = g => g.fills.filter(f => f.style === '#ff47fa').length;

check('E18 Il-76 actual ±30° attitude/feed gives opposite horizon slope and preserves flight state', () => {
  for (const bank of [-30, 0, 30]) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), -Math.PI/2)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0), bank*Math.PI/180));
    const att = attitude(q), f = fdmAt(), before = JSON.stringify(f), pose = q.toArray();
    const s = il76Feed(f, frozen({ att: { pitch:att.pitch*180/Math.PI, roll:att.bank*180/Math.PI, heading:att.heading }, altM:f.pos.y }));
    near(s.bank, bank);
    const d = new IL76Displays(); d.drawPFD(frozen(s));
    const horizon = d.pfd.g.strokes.find(x => x.points.length === 2); assert.ok(horizon);
    const deltaY = horizon.points[1][1] - horizon.points[0][1];
    near(deltaY, -800*Math.sin(bank*Math.PI/180));
    assert.equal(JSON.stringify(f), before); assert.deepEqual(q.toArray(), pose);
    console.log(`  bank ${bank}°: horizon right-minus-left y=${deltaY.toFixed(3)}`);
  }
});
check('E19 shortest signed FPM track difference across north, including bank projection', () => {
  for (const [hdg,trk,drift] of [[359,1,2],[1,359,-2],[0,360,0],[360,0,0],[719,1,2],[-359,359,-2],[100,105,5]]) {
    for (const bank of [0,30,-30]) {
      const g = drawSF({ hdg,trk,bank,pitch:0,fpa:0 });
      const marker = g.strokes.flatMap(s => s.style === '#33fa55' ? s.arcs : []).find(a => a.r === 15);
      assert.ok(marker); near(marker.center[0], 1280 + drift*20*Math.cos(bank*Math.PI/180)); near(marker.center[1], 600);
    }
  }
  return '359°/1° → x=1320; 1°/359° → x=1240 (2560-wide display)';
});
check('E20 uncommanded/departure FD hidden, valid commands shown, then removed without stale cues', () => {
  const feed = makeSF50Feed(), f = fdmAt(), before = JSON.stringify(f);
  const base = magenta(drawSF({ pitch:5,bank:3,ap:{ fd:false } }));
  for (const extra of [{}, {ap}, {ap,fdPitch:6}, {ap,fdBank:12}, {ap,fdPitch:NaN,fdBank:12}, {ap:{...ap,on:false},fdPitch:6,fdBank:12}]) {
    const s = feed(f, context(90,1,extra));
    assert.equal(s.ap.fd, false); assert.equal(s.fdPitch, undefined); assert.equal(magenta(drawSF(s)), base);
  }
  const commanded = feed(f, context(90,2,{ap,fdPitch:6,fdBank:12}));
  assert.equal(commanded.ap.fd, true); assert.equal(commanded.fdPitch,6); assert.equal(commanded.fdBank,12);
  assert.equal(magenta(drawSF(commanded)), base+2);
  const departed = feed(f, context(90,3,{ap})); assert.equal(departed.ap.fd,false); assert.equal(magenta(drawSF(departed)),base);
  for (const s of [{ap:{}}, {ap:{fd:true}}, {ap:{fd:true},fdPitch:6}, {ap:{fd:true},fdPitch:6,fdBank:Infinity}, {ap:{fd:false},fdPitch:6,fdBank:12}]) assert.equal(magenta(drawSF(s)),base);
  assert.equal(JSON.stringify(f), before);
});
check('E21 rates follow actual simulation intervals, not legacy render dt; wrap at north', () => {
  const f = fdmAt(), feed = makeSF50Feed(); let s;
  for (let i=0;i<=60;i++) s = feed(f, context((359+i*0.6)%360, i*0.2), 0.1);
  near(s.turnRate, 3, 0.001); near(s.cabRate,0);
  return `3°/s fixture sampled at 0.2 s: ${s.turnRate.toFixed(6)}°/s`;
});
check('E21 20-minute cockpit gap reseeds finite rates, and normal samples recover', () => {
  const feed = makeSF50Feed(); feed(fdmAt(0),context(90,0));
  const gap = feed(fdmAt(31000),context(180,1200));
  assert.deepEqual([gap.turnRate,gap.cabRate],[0,0]);
  const next = feed(fdmAt(31010),context(180.3,1200.1));
  near(next.turnRate,0.2);
  near(next.cabRate,(cabinAt(31010).cabAlt-cabinAt(31000).cabAlt)*15,0.01);
  assert.ok(Number.isFinite(next.cabRate) && Math.abs(next.cabRate)<1000);
  return `gap → ${gap.turnRate}°/s, ${gap.cabRate} fpm; next → ${next.turnRate.toFixed(3)}°/s, ${next.cabRate.toFixed(3)} fpm`;
});
check('E21 discontinuities, paused clock, explicit reset and invalid samples cannot poison derivatives', () => {
  const feed=makeSF50Feed();
  for (const time of [10,10,9,Infinity,NaN,0,0.1]) {
    const s=feed(fdmAt(),context(90,time)); assert.equal(s.turnRate,0); assert.equal(s.cabRate,0);
  }
  feed(fdmAt(),context(90.3,0.2)); feed.reset();
  const reset=feed(fdmAt(31000),context(180,0.3)); assert.deepEqual([reset.turnRate,reset.cabRate],[0,0]);
  feed(fdmAt(NaN),context(NaN,0.4));
  const valid=feed(fdmAt(),context(90,0.5)); assert.deepEqual([valid.turnRate,valid.cabRate],[0,0]);
  const fallback=makeSF50Feed();
  fallback(fdmAt(), {att:{heading:0,pitch:0,bank:0}},0.2);
  const s=fallback(fdmAt(),{att:{heading:0.6,pitch:0,bank:0}},0.2); near(s.turnRate,0.4);
});
check('E21 precise main call sites use flightT, reset on spawn and stop SF50 redraws during pause/load', () => {
  const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
  const call=main.slice(main.indexOf('function sf50State('),main.indexOf('// the Il-76\'s PFD'));
  assert.match(call,/flightT: state.flightT/); assert.doesNotMatch(call,/\}, 0\.1\)/);
  assert.match(main,/sf50Feed\?\.reset\(\)/);
  assert.match(main,/visual\.update\(\(AIRCRAFT === 'sr71' \|\| IS_SF50\) && \(state\.paused \|\| state\.pending\) \? 0 : dt/);
});
if (failures) process.exitCode=1;
else console.log('instrument-display-truth-test ok (7 groups)');
