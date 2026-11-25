import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { F27SampleAudio, bankCurve, seamLoop, layerWeights, bufferRms, F27_AUDIO_GAIN, F27_LOOP_RMS } from '../src/f27audio.js';
import { Audio } from '../src/audio.js';
const dir = new URL('../public/models/f27/audio/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', dir)));
let bytes = 0;
for (const m of manifest.samples) {
  const b = readFileSync(new URL(m.file, dir)); bytes += b.length;
  assert.equal(b.length, m.bytes); assert.equal(createHash('sha256').update(b).digest('hex'), m.sha256);
  assert.equal(b.subarray(4, 8).toString(), 'ftyp', 'original AAC/M4A container');
}
assert.equal(bytes, manifest.totalMediaBytes);
assert.ok(bytes + readFileSync(new URL('manifest.json', dir)).length < 800000, 'entire optional audio directory under 0.8 MB');
assert.equal(readdirSync(dir).length, manifest.samples.length + 1);
assert.equal(manifest.groups.length, 4);
assert.deepEqual(manifest.groups.map(g => [g.engine, g.view, g.clips.length]), [[1,'inside',4],[2,'inside',4],[1,'outside',4],[2,'outside',4]]);
console.log('PASS original media hashes, four bank layers, asset budget:', bytes, 'media bytes');

let calls = 0;
const param = () => ({ value: 0, last: undefined, targets: [], setTargetAtTime(v,t,tc) { assert.ok(Number.isFinite(v)); this.last = v; this.targets.push({v,t,tc}); calls++; }, setValueAtTime(v) { this.last = v; }, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} });
const nodes = [];
const node = type => {
 const n = { type, connections: [], connect(to) { this.connections.push(to); }, disconnect() { this.gone = true; }, start(...args) { this.started = args; }, stop(t) { this.stopped = t ?? true; } };
 for (const k of ['gain','frequency','Q','pan','playbackRate','detune','threshold','knee','ratio','attack','release']) n[k] = param();
 nodes.push(n); return n;
};
const buffer = (c = 1, length = 22050, sr = 22050) => {
 const channels = Array.from({length:c}, () => Float32Array.from({length}, (_, i) => Math.sin(i * 0.17) * 0.4));
 return { numberOfChannels:c, length, sampleRate:sr, duration:length/sr, getChannelData:i => channels[i] };
};
const C = { state:'running', currentTime:0, sampleRate:8000, destination:node('destination'), createBuffer:buffer, suspend() { this.state='suspended'; return Promise.resolve(); }, resume() { this.state='running'; return Promise.resolve(); }, async decodeAudioData() { return buffer(); } };
for (const name of ['Gain','BufferSource','StereoPanner','BiquadFilter','DynamicsCompressor','Oscillator']) C['create'+name] = () => node(name);
const seam = seamLoop(C, buffer(2,22050,22050));
assert.equal(seam.length, 22050 - Math.floor(22050*0.08)); assert.equal(seam.numberOfChannels,2);
for (let c=0;c<2;c++) {
 const d=seam.getChannelData(c);
 assert.ok(Math.abs(d.at(-1)-d[0]) < 0.08, 'continuous wrap after 80ms original-sample splice');
}
for (const g of manifest.groups) {
 for (const rpm of [0.47,0.55,0.66,0.75,0.85,0.95,1.05]) {
  const power = g.clips.reduce((n,c)=>n + bankCurve(c.curve,rpm)**2,0);
  assert.ok(power > 0.97 && power < 1.03, 'constant-power bank crossfade at ' + rpm);
 }
 for (const c of g.clips) assert.ok(bankCurve(c.curve,0.01)>=0);
}
assert.equal(bankCurve([[0,0,9],[1,10,4]],0.5),0);
assert.equal(bankCurve([[0,0,4],[1,10,4]],0.5),5);
for (const g of manifest.groups) {
  let prev;
  for (let rpm=0;rpm<=1.2;rpm+=0.0005) {
    const w=layerWeights(g,rpm);
    assert.ok(Math.abs(w.reduce((s,x)=>s+x*x,0)-1)<1e-12);
    if(prev) assert.ok(Math.max(...w.map((x,i)=>Math.abs(x-prev[i])))<0.01,'no layer jump');
    prev=w;
  }
}
assert.equal(F27_AUDIO_GAIN,0.11);
console.log('PASS normalized zero-slope joins and original RTPC constant-power crossfades, interpolation and loop seam');

let requests=[];
const f = new F27SampleAudio(C,C.destination,{base:'/game/',fetcher:async u => { requests.push(u); return {ok:true,json:async()=>manifest,arrayBuffer:async()=>new ArrayBuffer(2)}; }});
const state = (over = {}) => ({ cockpit:true, paused:false, crashed:false, engineRunning:true, camDist:40, ias:0, gs:0, onGround:true, engines:[], turboprop:[{rpm:651,turbineRpm:7000,lit:true,thr:0},{rpm:1395,turbineRpm:15000,lit:true,thr:1}], ...over });
C.state='suspended'; f.update(state()); assert.equal(requests.length,0,'no pre-unlock fetch');
C.state='running'; f.update(state({paused:true})); assert.equal(requests.length,0,'no paused fetch');
f.update(state()); await f.loading; f.update(state());
assert.equal(f.status,'ready'); assert.equal(requests.length,manifest.samples.length+1);
assert.equal(requests[0],'/game/models/f27/audio/manifest.json');
assert.equal(nodes.filter(n=>n.type==='Oscillator').length,0,'sample mixer never creates oscillators');
assert.equal(f.voices.length,4);
for (const v of f.voices) for (const n of v.clips.values()) assert.equal(n.source.loop,true);
const targetSum = (engine,view) => f.voices.filter(v=>v.group.engine===engine && v.group.view===view).reduce((s,v)=>s+[...v.clips.values()].reduce((s,n)=>s+n.gain.gain.last,0),0);
assert.ok(targetSum(1,'inside')>0 && targetSum(2,'inside')>0); assert.equal(targetSum(1,'outside'),0);
const left = f.voices.find(v=>v.group.engine===1 && v.group.view==='inside');
assert.ok(left.clips.get(726197048).gain.gain.last>0,'bank low-idle source active');
const right = f.voices.find(v=>v.group.engine===2 && v.group.view==='inside');
assert.ok(right.clips.get(1046894101).gain.gain.last>0,'bank high-power source active independently');
assert.equal(left.pan.pan.value,-0.32); assert.equal(right.pan.pan.value,0.32);
f.update(state({cockpit:false}),{near:1,dop:1.2}); assert.equal(targetSum(1,'inside'),0); assert.ok(targetSum(1,'outside')>0);
for (const v of f.voices) for (const n of v.clips.values()) assert.equal(n.gain.gain.targets.at(-1).tc,0.16,'view switch fades, no gain step');
const exterior = f.voices.find(v=>v.group.engine===2 && v.group.view==='outside');
const high = exterior.group.clips.find(c=>c.id===240433614);
assert.ok(Math.abs(exterior.clips.get(high.id).source.playbackRate.last - Math.pow(2,(bankCurve(exterior.group.pitch,1)+high.cents)/1200)*1.2)<1e-8);
f.update(state({engines:[],turboprop:[{rpm:651,turbineRpm:7000,lit:false,fail:true},{rpm:1395,turbineRpm:15000,lit:true,thr:1}]}));
assert.ok(targetSum(1,'inside')>0, 'unlit failed engine still rotates and sounds'); assert.ok(targetSum(2,'inside')>0,'failed left engine does not kill right');
f.update(state({turboprop:[{rpm:0,turbineRpm:0,lit:false,fail:true},{rpm:1395,turbineRpm:15000,lit:true}]}));
assert.equal(targetSum(1,'inside'),0,'only stopped engine is silent');
const stationary = state({turboprop:[{turbineRpm:11000,lit:true,thr:0},{turbineRpm:15000,lit:true,thr:1}]});
f.update(stationary); const beforeThrottle = [...left.clips.values()].map(n=>[n.gain.gain.last,n.source.playbackRate.last]);
stationary.turboprop[0].thr=1;f.update(stationary);
assert.deepEqual([...left.clips.values()].map(n=>[n.gain.gain.last,n.source.playbackRate.last]),beforeThrottle,'throttle without spool cannot switch timbre or level');
for (const n of left.clips.values()) assert.ok(Math.abs(n.level * bufferRms(n.source.buffer)-F27_LOOP_RMS)<1e-6,'PCM RMS calibrated before crossfade');
f.update(state({engineRunning:false,turboprop:[{turbineRpm:3500,lit:false,starting:false},{turbineRpm:15000,lit:true,starting:false}]}));
assert.ok(targetSum(1,'inside')>0,'shutdown remains audible at half idle RPM');
assert.ok(left.clips.get(726197048).source.playbackRate.last<0.6,'pitch descends with actual rundown');
assert.equal(f.starters[0],null,'unpowered windmill never restarts starter');
f.update(state({paused:true})); assert.equal(targetSum(2,'inside'),0);
f.update(state({crashed:true})); assert.equal(targetSum(1,'inside'),0);
f.update(state(),{enabled:false}); assert.equal(targetSum(2,'inside'),0);
console.log('PASS gesture-only loading, original sample playback, twin state, pitch/Doppler, view fades, mute/pause/failure/crash');

const starting = state({turboprop:[{rpm:100,turbineRpm:1000,lit:false,starting:true},{rpm:0,turbineRpm:0,lit:false,starting:false}]});
f.update(starting); const starter=f.starters[0]; assert.equal(starter.length,2); assert.equal(f.starters[1],null);
f.update(starting); assert.equal(f.starters[0],starter,'starter only starts once per transition');
f.update(state()); assert.equal(f.starters[0],null); assert.ok(starter.every(v=>v.source.stopped===0.2));
f.update(starting); assert.ok(f.starters[0]); f.reset(); assert.equal(f.starters[0],null);
const count=nodes.length; f.click(); assert.equal(nodes.length,count+2); f.reset(); assert.equal(f.oneshots.size,0);
console.log('PASS per-engine original starter trigger, cutoff, restart/reset and cockpit switch');

let failure=true;
const partial = new F27SampleAudio(C,C.destination,{fetcher:async u=>({ok:!failure || !u.includes('726197048'),status:404,json:async()=>manifest,arrayBuffer:async()=>new ArrayBuffer(2)})});
await partial.load(); assert.equal(partial.status,'partial'); assert.equal(partial.errors.length,1);
partial.build(); assert.ok(partial.voices.length===4); assert.equal(partial.voices[0].clips.has(726197048),false);
failure=false; partial.retryAt=0; await partial.load();partial.build(); assert.equal(partial.status,'ready');assert.equal(partial.voices[0].clips.has(726197048),true);
assert.equal(partial.voices.length,4,'retry does not duplicate sources');
console.log('PASS missing media stays silent without synthesis and retries only failed samples');

// Audio integration: existing master/pause/cabin routes remain in charge; the
// source interior bypasses the generic jet cabin lowpass to avoid double filtering.
const audio=new Audio(); audio.configure({engines:2,turboprop:true});audio.init(C);
assert.ok(audio.f27); assert.equal(audio.f27.destination,audio.master);
audio.f27.manifest=manifest; audio.f27.status='ready'; for (const m of manifest.samples) audio.f27.buffers.set(m.id,buffer());
const full = { ...state(), camFwdDot:0, doppler:1, mach:0, rho:1.225, engines:[{dry:0.5,ab:0,unstart:0,rpm:7000,lit:true},{dry:0.5,ab:0,unstart:0,rpm:15000,lit:true}], rain:0,warnTone:0 };
audio.update(full);
assert.equal(audio.eng[0].roar.g.gain.last,0); assert.equal(audio.humGain.gain.last,0);assert.equal(audio.ac.g.gain.last,0);
assert.equal(audio.wind.g.gain.last,0);assert.equal(audio.roll.g.gain.last,0);assert.equal(audio.hyd.pumpG.gain.last,0);
assert.equal(audio.turbopropV,undefined,'no old synthesized prop voice');
audio.enabled=false;audio.update(full);assert.equal(audio.master.gain.last,0);
audio.enabled=true;audio.update({...full,paused:true});assert.equal(audio.master.gain.last,0);
audio.resetForSpawn();
console.log('PASS Audio integration: sample-only F27 engine/cabin, shared master mute/pause/reset');

// A true gear caution still reaches its horn, never the generic spoken clip.
const gearWarn = { gearUnsafe:true, pullUp:true, stall:true };
let speechWarn; const stepVoice = audio.voiceSched.step;
audio.voiceSched.step = w => { speechWarn = w; return null; };
audio.update({...full, warn:gearWarn, warnTone:3});
assert.equal(speechWarn.gearUnsafe,false);
const gearScheduler=new audio.voiceSched.constructor();
for(const time of [0,4,8,12])assert.equal(gearScheduler.step({...speechWarn,pullUp:false,stall:false},time,()=>.5),null,'no repeated GEAR voice');
assert.equal(speechWarn.pullUp,true); assert.equal(speechWarn.stall,true);
assert.equal(gearWarn.gearUnsafe,true,'visual/horn warning remains intact');
assert.equal(audio.warnOsc[0].frequency.last,740,'configuration horn retained');
audio.cfg.turboprop=false; audio.update({...full,warn:gearWarn,warnTone:3});
assert.equal(speechWarn.gearUnsafe,true,'other aircraft retain spoken gear warning');
audio.voiceSched.step=stepVoice;
console.log('PASS F27 gear speech filtered, actual configuration horn and other warnings retained');
