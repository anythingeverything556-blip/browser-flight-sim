// Deterministic EW-45 imagery health + the real main.js sync/pending/retry paths.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import { imageryNotice } from '../src/imagery-notice.js';
import { Geo, lon2tx, lat2ty } from '../src/geo.js';
globalThis.OffscreenCanvas = class { getContext() { return {}; } };
let now = 20000;
Object.defineProperty(performance, 'now', {value: () => now, configurable: true});
const { Terrain } = await import('../src/terrain.js');
const main = fs.readFileSync('src/main.js', 'utf8');
const section = (a,b) => main.slice(main.indexOf(a), main.indexOf(b, main.indexOf(a)));
function rig(lat = 39, lon = -121) {
  const terrain = new Terrain(new THREE.Scene(), new Geo(lat,lon),null);
  Object.assign(terrain.cam,{lat,lon}); terrain.imageryFallback = true;
  const replies = new Map(), cancelled = [];
  terrain.loader.request = (m,cb) => { const id=terrain.loader.nextId++; if(m.type==='img')replies.set(id,cb); return id; };
  terrain.loader.cancel = id => {cancelled.push(id);replies.delete(id);};
  const tile = (z=15,x=Math.floor(lon2tx(lon,z)),y=Math.floor(lat2ty(lat,z))) => {
    const t=terrain.getTile(z,x,y); Object.assign(t,{wantedAt:terrain.now,d:0,inView:true,mk:'ready'}); return t;
  };
  const nodes=new Map(), $=id=>{if(!nodes.has(id))nodes.set(id,{hidden:true,textContent:''});return nodes.get(id);};
  const state={pending:null,started:true};
  const ctx=vm.createContext({state,terrain,$,performance,aircraftLatLon:()=>({lat,lon}),imageryNotice,imageryRetryAt:now+30000,IMAGERY_DEADLINE_MS:12000,groundStatus:()=>({ok:false})});
  vm.runInContext(section('function syncImageryNotice()', "$('imagery-retry').addEventListener"),ctx);
  const sync=()=>vm.runInContext('syncImageryNotice()',ctx), retry=()=>vm.runInContext('retryImagery()',ctx);
  const reply=(t,m)=>{const cb=replies.get(t.jobId);assert.ok(cb,'real Terrain.startImage callback exists');replies.delete(t.jobId);cb(m);};
  return {terrain,tile,state,ctx,$,sync,retry,reply,replies,cancelled,lat,lon};
}
{
  const r=rig(), t=r.tile(); r.terrain.startImage(t);
  r.terrain.stats.imgFail=80;r.terrain.stats.imgNodata=50;r.terrain.stats.imgWait=90;
  // A regional pool is busy even when the global Esri counter is zero.
  r.terrain.srcActive.regional=4;
  assert.equal(r.terrain.imageryActive,5);
  for (const pending of [true,false]) {
    r.state.pending=pending?{lat:r.lat,lon:r.lon,t0:0}:null;
    now+=60000;r.sync();assert.equal(r.$('imagery-notice').hidden,true);
    assert.equal(t.img,'loading'); assert.equal(r.cancelled.length,0);
  }
  r.state.pending={lat:r.lat,lon:r.lon,t0:now-13000};r.terrain.heightAt=()=>null;r.terrain.heightReady=()=>false;
  vm.runInContext(section('function finishPending()', 'function spawnAt('),r.ctx);
  vm.runInContext('finishPending()',r.ctx);
  assert.match(r.$('st-state').textContent,/Loading terrain/);assert.equal(r.$('imagery-notice').hidden,true);
  assert.equal(r.terrain.canBuild({...t,demList:[{state:'loading'}]}),false);
  assert.equal(r.terrain.canBuild({...t,demList:[{state:'ready'}]}),true);
  console.log('PASS pending deadline + active slow regional/global/queued requests stay quiet; shaded fallback retains DEM gate');
}
{
  const r=rig(), t=r.tile(); r.terrain.startImage(t);r.reply(t,{error:'controlled 503'});
  const tries=t.tries, retryAt=t.retryAt;
  // A relevant failure is not suppressed by other healthy requests.
  r.terrain.stats.imgActive=2;r.terrain.srcActive.regional=3;r.terrain.stats.imgWait=100;
  let assignments=0, status=''; Object.defineProperty(r.$('imagery-status'),'textContent',{get:()=>status,set:v=>{assignments++;status=v;}});
  r.sync();assert.equal(r.$('imagery-notice').hidden,false);assert.match(r.$('imagery-status').textContent,/failed/);
  assert.equal(t.img,'failed');assert.equal(t.tries,tries);assert.equal(t.retryAt,retryAt,'auto keeps tile backoff');
  for(let i=0;i<3;i++)r.sync();
  assert.equal(assignments,1,'unchanged status is not reassigned/announced every frame');
  assert.equal(r.$('imagery-notice').hidden,false);assert.equal(r.cancelled.length,0);
  r.retry();assert.equal(t.img,'none');assert.equal(t.tries,tries);
  r.terrain.startImage(t);r.sync();assert.equal(r.$('imagery-notice').hidden,false,'retry does not hide a still-unrecovered outage');
  r.reply(t,{bmp:{width:256,height:256,close(){}},low:new Float32Array(768)});
  r.sync();assert.equal(r.$('imagery-notice').hidden,true);assert.equal(t.imgIssue,false);
  assert.equal(r.terrain.stats.imgFail,1,'historical diagnostics remain accurate but cannot hold notice open');
  console.log('PASS real failure callback => one notice despite healthy traffic; selective manual retry and success clear it');
}
{
  const r=rig(), p=r.tile(14), child=r.tile(15);
  p.tex={};p.ready=true;r.terrain.drawn=[p];
  child.img='nodata';child.imgIssue=true;r.terrain.noSplit.add(p.key);
  // This denominator intentionally remains strict for startup sharpness.
  assert.ok(r.terrain.sceneryProgress(3000)<.9);
  r.sync();assert.equal(r.$('imagery-notice').hidden,true);assert.equal(r.terrain.imageryFallback,false);
  for (const automatic of [true,false])r.terrain.retryImagery(r.lat,r.lon,{automatic});
  assert.equal(child.img,'nodata');assert.ok(r.terrain.noSplit.has(p.key),'legitimate max detail stays settled');
  p.hi='failed';r.sync();assert.equal(r.$('imagery-notice').hidden,true,'optional sharpening is not a base coverage outage');
  // Textured children also cover an older failed parent, not only the inverse.
  p.img='failed';p.imgIssue=true;p.tex=null;
  r.terrain.drawn=[0,1,2,3].map(i=>Object.assign(r.tile(15,p.x*2+(i%2),p.y*2+(i>>1)),{tex:{}}));
  r.sync();assert.equal(r.$('imagery-notice').hidden,true);
  // An old coarse failure must not promote an unrelated offscreen gap.
  const away=r.terrain.drawn.find(t=>t.x!==child.x || t.y!==child.y);
  away.tex=null;away.inView=false;away.d=100000;
  r.terrain.stats.imgFail=1;r.sync();assert.equal(r.$('imagery-notice').hidden,true);
  console.log('PASS usable parent/children coverage wins over sharpness denominator, max-detail no-data, and optional hi-res failure');
}
{
  const r=rig(), t=r.tile();r.terrain.startImage(t);r.reply(t,{status:404});
  r.sync();assert.equal(r.$('imagery-notice').hidden,false);
  r.terrain.retryImagery(r.lat,r.lon,{automatic:true});assert.equal(t.img,'none');assert.equal(t.imgIssue,true);
  r.terrain.startImage(t);const id=t.jobId;r.retry();assert.equal(t.jobId,id);assert.equal(r.cancelled.length,0);
  r.reply(t,{status:404});r.sync();assert.equal(r.$('imagery-notice').hidden,false,'a real persistent gap remains visible after retries');
  t.wantedAt--;r.sync();assert.equal(r.$('imagery-notice').hidden,true,'old unwanted failure clears even at same coordinates');
  t.wantedAt=r.terrain.now;
  r.state.pending={lat:48.8,lon:2.3,t0:now};r.sync();assert.equal(r.$('imagery-notice').hidden,true,'teleport clears cached metrics before terrain update');
  console.log('PASS no-data gap selective auto retry, no cancellation, persistent outage, stale failure and location-change clearing');
}
{
  const r=rig(), t=r.tile();t.img='none';r.terrain.imgQueue=[t];
  r.terrain.srcActive.regional=3;r.terrain.stats.imgActive=2;
  r.terrain.retryImagery();assert.equal(t.img,'loading','queued work pumps normally');
  assert.equal(r.terrain.stats.imgActive,3);assert.equal(r.terrain.srcActive.regional,3);
  r.terrain.retryImagery(r.lat,r.lon,{automatic:true});assert.equal(r.terrain.stats.imgActive,3);
  r.reply(t,{error:'fixture'});assert.equal(r.terrain.stats.imgActive,2,'normal completion releases exactly one slot');
  // Regional base and four-slot hi-res requests retain their own accounting.
  const regional=r.tile(16);regional.src={id:'fixture',slots:8,url:()=>'/fixture'};regional.srcs=[regional.src];
  r.terrain.startImage(regional);assert.equal(r.terrain.srcActive.fixture,1);r.reply(regional,{error:'fixture'});assert.equal(r.terrain.srcActive.fixture,0);
  r.terrain.startHi(regional);assert.equal(r.terrain.srcActive.fixture,4);
  r.terrain.retryImagery(r.lat,r.lon,{automatic:true});assert.equal(r.terrain.srcActive.fixture,4);
  const cb=r.replies.get(regional.hiJob);r.replies.delete(regional.hiJob);cb({nodata:true});assert.equal(r.terrain.srcActive.fixture,0);
  console.log('PASS healthy queued, Esri, regional and 4-slot upgrade accounting preserved by retries');
}
{
  // Exercise the actual update -> loader -> textured/fallback presentation path,
  // not just a presentation function supplied with hand-picked booleans.
  const r=rig();r.terrain.maxZ=6;r.terrain.setSeg(8);r.terrain.buildMax=100;r.terrain.loadBoost=true;
  const jobs=[];let failure=true;
  r.terrain.loader.request=(m,cb)=>{jobs.push({m,cb});return r.terrain.loader.nextId++;};
  const frame=()=>{now+=1000;r.terrain.update({x:0,y:1000,z:0},r.lat,r.lon);for(const {m,cb} of jobs.splice(0)){
    if(m.type==='dem')cb({data:new Float32Array(65536)});
    else if(m.type==='mask')cb({water:0});
    else if(failure)cb({status:503});
    else cb({bmp:{width:256,height:256,close(){}},low:new Float32Array(768)});
  }r.sync();};
  frame();assert.equal(r.$('imagery-notice').hidden,false);
  frame();assert.ok(r.terrain.drawn.length>0,'real shaded roots are drawn');
  assert.equal(r.$('imagery-notice').hidden,false);
  failure=false;frame();frame();frame();
  assert.ok(r.terrain.drawn.some(t=>t.tex),'real recovered root texture uploaded');assert.equal(r.$('imagery-notice').hidden,true);
  console.log('PASS actual terrain.update, base request failure, shaded mesh drawing, automatic backoff and texture-upload recovery');
}
console.log('PASS imagery-banner hotfix regressions');
