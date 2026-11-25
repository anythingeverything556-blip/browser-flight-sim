import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { F27Callouts, F27_HEIGHTS_FT, F27RadioAltimeter, f27Annunciators } from '../src/f27callouts.js';
import { AltCallouts } from '../src/callouts.js';
import { Audio } from '../src/audio.js';
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('PASS', name); };
const s = (aglFt = 200, over = {}) => ({ aglFt, vsFpm: -600, onGround: false, throttle: 0.8, radioAltValid: true, ...over });
const dur = () => 0.01;
const step = (c, h, over = {}, dt = 0.2, duration = dur) => c.step(s(h, over), dt, duration);
const armed = () => { const c = new F27Callouts(); step(c, 200); return c; };

test('Descending exact crossings; no Airbus RETARD or Five', () => {
 const c=armed(),keys=[];
 for(const h of [110,100,99,80,60,50,40,30,20,10,5,1,0]) { const k=step(c,h);if(k)keys.push(k); }
 assert.deepEqual(keys,F27_HEIGHTS_FT.map(h=>`h${h}`));
});
test('No replay from low approach spawn', () => {const c=new F27Callouts();assert.equal(step(c,95),null);assert.equal(step(c,40),null);});
test('Climb, level, rollout and bounce remain silent', () => {
 const c=armed();assert.equal(step(c,99,{vsFpm:0}),null);assert.equal(step(c,49,{vsFpm:600}),null);
 assert.equal(step(c,20,{onGround:true}),null);assert.equal(step(c,10),null);
});
test('Coarse frame says lowest crossing once', () => {
 const c=armed();step(c,110);assert.equal(step(c,19),'h20');assert.equal(step(c,18),null);assert.equal(step(c,10),'h10');
});
test('Missing, busy and warning-blocked events consumed, no backlog', () => {
 for(const mode of ['missing','warning','busy']) {const c=armed();step(c,110);if(mode==='busy')c.busyUntil=100;
 assert.equal(step(c,100,{speechBlocked:mode==='warning'},.2,mode==='missing'?()=>0:dur),null);c.busyUntil=0;assert.equal(step(c,99),null);}
});
test('Height oscillation cannot repeat spoken call', () => {
 const c=armed();step(c,110);assert.equal(step(c,100),'h100');assert.equal(step(c,102,{vsFpm:20}),null);assert.equal(step(c,99),null);
});
test('Go-around and touch-and-go rearm only above 150 ft', () => {
 const c=armed();step(c,100);step(c,110,{vsFpm:800});assert.equal(step(c,50),null);
 step(c,151,{vsFpm:800});assert.equal(step(c,100),'h100');step(c,0,{onGround:true});assert.equal(step(c,50),null);
 step(c,151,{vsFpm:800});assert.equal(step(c,100),'h100');
});
test('Pause/slew/crash/reset/teleport/gap/NaN never fake crossing', () => {
 let c=armed();step(c,110);step(c,90,{paused:true});assert.equal(step(c,80),null);
 for(const flag of ['slew','crashed','teleported']) {c=armed();step(c,110);step(c,90,{[flag]:true});assert.equal(step(c,40),null);}
 c=armed();assert.equal(step(c,20),null);assert.equal(step(c,10),null);
 c=armed();step(c,90,{},2);assert.equal(step(c,40),null);
 c=armed();step(c,NaN);assert.equal(step(c,90),null);c.reset();assert.equal(step(c,40),null);
});
test('Invalid/unpowered RA does not speak height', () => {
 for(const o of [{radioAltValid:false},{electrical:false}]) {const c=armed();step(c,110);assert.equal(step(c,90,o),null);assert.equal(step(c,80),null);}
});
test('Explicit radio DH wins simultaneous height; no hardcoded 200 ft', () => {
 const c=new F27Callouts(),o={minimums:{type:'radio',valueFt:100}};step(c,200,o);step(c,110,o);
 assert.equal(step(c,100,o),'minimums');assert.equal(step(c,99,o),null);assert.equal(step(armed(),199),null);
});
test('Barometric DA uses MSL independently of RA', () => {
 const c=new F27Callouts(),o={minimums:{type:'baro',valueFt:1120},radioAltValid:false};step(c,500,{...o,baroAltFt:1250});step(c,470,{...o,baroAltFt:1150});assert.equal(step(c,450,{...o,baroAltFt:1120}),'minimums');
});
test('Changing minimum below aircraft never invents crossing', () => {
 const c=armed();step(c,130,{minimums:{type:'radio',valueFt:200}});assert.equal(step(c,120,{minimums:{type:'radio',valueFt:150}}),null);
 assert.equal(step(c,100,{minimums:{type:'bogus',valueFt:110}}),'h100');
});
test('No guessed V1/VR callout from taxi/deceleration/missing briefing', () => {
 const c=new F27Callouts(),o={onGround:true,takeoffActive:true};step(c,0,{...o,iasKt:90});assert.equal(step(c,0,{...o,iasKt:110}),null);assert.equal(step(c,0,{...o,iasKt:90}),null);
});
test('Verified V1/Rotate upward once, no automatic V2 voice, aborted takeoff reset', () => {
 const c=new F27Callouts(),o={onGround:true,takeoffActive:true,takeoffSpeeds:{v1:100,vr:108,v2:118,verified:true,source:'test-only briefing, not real performance data'}};
 step(c,0,{...o,iasKt:90});assert.equal(step(c,0,{...o,iasKt:100}),'v1');assert.equal(step(c,0,{...o,iasKt:108}),'rotate');
 assert.equal(step(c,0,{...o,iasKt:100}),null);assert.equal(step(c,0,{...o,iasKt:108}),null);assert.equal(step(c,10,{...o,onGround:false,iasKt:118,vsFpm:400}),null);
 for(let i=0;i<11;i++)step(c,0,{...o,iasKt:0});step(c,0,{...o,iasKt:90});assert.equal(step(c,0,{...o,iasKt:100}),'v1');
});
test('Invalid/unverified/missing-source V-speeds remain silent', () => {
 for(const v of [{v1:100,vr:90,v2:118,verified:true,source:'x'},{v1:100,vr:108,v2:118,verified:false,source:'x'},{v1:100,vr:108,v2:118,verified:true,source:''}]) {
 const c=new F27Callouts(),o={onGround:true,takeoffActive:true,takeoffSpeeds:v};step(c,0,{...o,iasKt:90});assert.equal(step(c,0,{...o,iasKt:110}),null);}
});
test('Pilot assistance off remains silent', () => {const c=armed();step(c,110);assert.equal(step(c,99,{assistance:false}),null);});
test('Documented RA switches off above 5000, requires fresh manual ON', () => {
 const r=new F27RadioAltimeter();assert.equal(r.step({aglFt:200}),false);assert.equal(r.step({aglFt:200,radioAltOn:true}),true);
 assert.equal(r.step({aglFt:5000,radioAltOn:true}),true);assert.equal(r.step({aglFt:5001,radioAltOn:true}),false);
 assert.equal(r.step({aglFt:4900,radioAltOn:true}),false);r.step({aglFt:4900,radioAltOn:false});assert.equal(r.step({aglFt:4900,radioAltOn:true}),true);
});
test('DH lamp, 900 AMV test, 200 rising runway, 227 klaxon, inactive altitude alert', () => {
 const b={radioAltValid:true,minimums:{type:'radio',valueFt:150},iasKt:227,ilsApproach:true};
 assert.equal(f27Annunciators({...b,aglFt:900}).testAmv,false);assert.equal(f27Annunciators({...b,aglFt:899}).testAmv,true);
 assert.equal(f27Annunciators({...b,aglFt:150}).decisionHeight,false);assert.equal(f27Annunciators({...b,aglFt:149}).decisionHeight,true);
 assert.equal(f27Annunciators({...b,aglFt:100}).risingRunway,.5);assert.equal(f27Annunciators({...b,aglFt:0}).risingRunway,1);
 assert.equal(f27Annunciators({...b,aglFt:100}).overspeedHorn,false);assert.equal(f27Annunciators({...b,aglFt:100,iasKt:227.1}).overspeedHorn,true);assert.equal(f27Annunciators({...b,aglFt:100}).altitudeAlert,false);
});

// Test actual Audio routing, not a second implementation of the player.
const starts=[],a=new Audio();a.configure({turboprop:true,engines:2});
a.ctx={createBufferSource(){return {connect(to){this.to=to;},start(){starts.push(this);},stop(){this.stopped=true;},disconnect(){}};}};
a.voiceGain={};a.calloutClips=Object.fromEntries(F27_HEIGHTS_FT.map(h=>[`h${h}`,{duration:.01}]));a._loadCallouts=()=>{};
const call=(h,more={})=>a._calloutStep({callout:s(h),...more},a.callouts.t+.2,.2);
test('F27 has dedicated scheduler, legacy aircraft unchanged', () => {assert.ok(a.callouts instanceof F27Callouts);assert.ok(new Audio().callouts instanceof AltCallouts);});
test('Existing height sample routed through master-controlled voiceGain', () => {
 call(200);call(110);call(100);assert.equal(starts.length,1);assert.equal(starts[0].buffer,a.calloutClips.h100);assert.equal(starts[0].to,a.voiceGain);
});
test('Callout setting stops current clip', () => {const src=a.calloutSrc;a.setCallouts(false);assert.ok(src.stopped);assert.equal(a.calloutSrc,null);a.setCallouts(true);});
test('Mute/zero volume/pause/slew immediately stop speech', () => {
 for(const mode of ['enabled','volume','paused','slew']) {a.callouts.reset();a.enabled=true;a.volume=.7;call(200);call(110);call(100);const src=a.calloutSrc,n=starts.length;
 const extra={};if(mode==='enabled')a.enabled=false;else if(mode==='volume')a.volume=0;else extra[mode]=true;
 call(90,extra);assert.ok(src.stopped);assert.equal(a.calloutSrc,null);assert.equal(starts.length,n);a.enabled=true;a.volume=.7;}
});
test('Warning priority drops height, never replays', () => {
 a.callouts.reset();a.voiceSched.reset();call(200);call(110);a.voiceSched.playing='pullUp';a.voiceSched.until=100;const n=starts.length;call(100);a.voiceSched.reset();call(99);assert.equal(starts.length,n);
});
test('Critical warning tone suppresses height even with no warning recording',()=>{
 a.callouts.reset();call(200);call(110);const n=starts.length;call(100,{warn:{pullUp:true}});call(99);assert.equal(starts.length,n);
});
test('All retained height assets exist; no OS speech bypass', () => {
 for(const h of F27_HEIGHTS_FT)assert.ok(readFileSync(new URL(`../public/audio/voice/callouts/h${h}.mp3`,import.meta.url)).length>0);
 assert.ok(!readFileSync(new URL('../src/f27callouts.js',import.meta.url),'utf8').includes('speechSynthesis'));
});
// Exercise the actual asynchronous loader and URL selection, not only key lists.
const oldWindow=globalThis.window,oldFetch=globalThis.fetch,paths=[];
try {
 globalThis.window={};globalThis.fetch=async url=>{paths.push(url);return {ok:true,arrayBuffer:async()=>new ArrayBuffer(1)};};
 const loader=new Audio();loader.configure({turboprop:true});loader.voiceBase='/flight/';loader.ctx={decodeAudioData:async()=>({duration:.5})};loader._loadCallouts();
 await new Promise(resolve=>setTimeout(resolve,0));
 test('F27 loader requests only six present height clips at the app base',()=>{
  assert.deepEqual(paths,F27_HEIGHTS_FT.map(h=>`/flight/audio/voice/callouts/h${h}.mp3`));
  assert.equal(Object.keys(loader.calloutClips).filter(k=>k.startsWith('h')).length,6);
  assert.ok(!paths.some(p=>/retard|h5\.mp3|minimums|v1|rotate/.test(p)));
 });
} finally {globalThis.fetch=oldFetch;if(oldWindow===undefined)delete globalThis.window;else globalThis.window=oldWindow;}
console.log(`PASS ${passed} F27 callout scenarios`);
