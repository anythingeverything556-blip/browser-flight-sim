import assert from 'node:assert/strict';
import {SR71Audio} from '../src/sr71audio.js';

// Deterministic one-shot ownership: no device, network, manifest or timers.
function fixture(){
 const audio=new SR71Audio(),sources=[];
 audio.ctx={createBufferSource(){
  const source={connected:false,started:false,stops:0,disconnects:0,
   connect(){this.connected=true;},disconnect(){this.connected=false;this.disconnects++;},
   start(){this.started=true;},stop(){this.stops++;},onended:null};
  sources.push(source);return source;
 }};
 audio.mix={};audio.flightActive=true;audio.load=async()=>({duration:10});
 return {audio,sources};
}
let count=0;
async function test(name,fn){await fn();count++;console.log('PASS',name);}

await test('spawn reset stops and disconnects every started gear/canopy/seal event',async()=>{
 const {audio,sources}=fixture();
 for(const key of ['gearTravelA','canopyLock','sealOn'])await audio.playOriginal(key);
 assert.equal(sources.length,3);assert(sources.every(s=>s.started&&s.connected));
 audio.resetForSpawn();
 assert(sources.every(s=>s.stops===1&&!s.connected),'old event sources must not reappear when a new flight opens the shared mix');
 assert.equal(audio.flightActive,false);
 audio.flightActive=true;await audio.playOriginal('sealOff');
 assert.equal(sources.length,4);assert(sources[3].started&&sources[3].connected,'new flight can play its own event');
 audio.resetForSpawn();assert.equal(sources[3].stops,1);
 assert(sources.slice(0,3).every(s=>s.stops===1),'old events are not retained and stopped repeatedly');
});
await test('normally ended events disconnect and are not retained until the next spawn',async()=>{
 const {audio,sources}=fixture();await audio.playOriginal('canopyLock');
 assert.equal(typeof sources[0].onended,'function');sources[0].onended();
 assert.equal(sources[0].connected,false);
 audio.resetForSpawn();assert.equal(sources[0].stops,0);
});
await test('reset during media decode cannot start an obsolete event in the next flight',async()=>{
 const {audio,sources}=fixture();let decode;
 audio.load=()=>new Promise(resolve=>{decode=resolve;});
 const pending=audio.playOriginal('gearTravelA');audio.resetForSpawn();audio.flightActive=true;
 decode({duration:10});await pending;assert.equal(sources.length,0);
 audio.load=async()=>({duration:10});await audio.playOriginal('gearTravelA');
 assert.equal(sources.length,1);assert(sources[0].started);
});
await test('muted, paused/held and inactive flights cannot create event sources',async()=>{
 for(const setting of [{enabled:false},{held:true},{flightActive:false}]){
  const {audio,sources}=fixture();Object.assign(audio,setting);await audio.playOriginal('gearTravelA');
  assert.equal(sources.length,0);
 }
});
await test('reset remains safe before unlock and after a source already stopped',async()=>{
 new SR71Audio().resetForSpawn();
 const {audio,sources}=fixture();await audio.playOriginal('gearTravelA');
 sources[0].stop=()=>{throw Error('already stopped');};audio.resetForSpawn();
 assert.equal(sources[0].connected,false);audio.resetForSpawn();
});
await test('failed playback start releases its source and reports the error',async()=>{
 const {audio,sources}=fixture(),create=audio.ctx.createBufferSource;let error;
 audio.ctx.createBufferSource=()=>{const source=create();source.start=()=>{throw Error('start failed');};return source;};
 audio.report=e=>{error=e;};await audio.playOriginal('gearTravelA');
 assert.equal(error?.message,'start failed');assert.equal(sources[0].connected,false);
 audio.resetForSpawn();assert.equal(sources[0].stops,0,'failed source was released immediately');
});
console.log(count+' SR-71 event lifecycle checks passed');
