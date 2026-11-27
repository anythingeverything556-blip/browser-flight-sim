// B08/B09: use the real client methods with deterministic Leaflet/canvas doubles.
// No browser, tiles, traffic service or live provider is contacted.
import assert from 'node:assert/strict';
import { register } from 'node:module';
const stub = `
const node=()=>({style:{},dataset:{},classList:{contains(){return false;},toggle(){}},events:{},
  setAttribute(){},addEventListener(k,f){this.events[k]=f;},querySelector(s){return this.nodes[s] ||= node();},
  querySelectorAll(){return [];},nodes:{}});
export default {DomUtil:{create:()=>node()},DomEvent:{disableClickPropagation(){},disableScrollPropagation(){}},
 Control:{extend:d=>class {addTo(map){this.el=d.onAdd(map);return this;} getContainer(){return this.el;}}},
 control:{scale:()=>({addTo(){}})}};`;
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s,c,n) {
 if(s==='leaflet')return {url:'data:text/javascript,'+encodeURIComponent(${JSON.stringify(stub)}),shortCircuit:true};
 return n(s,c);
}`));
const { LiveAdsb, normalize, project, nearestWorldPosition } = await import('../src/adsbmap.js');
let checks = 0;
async function check(name, fn) { await fn(); checks++; console.log(`PASS ${name}`); }
const entry = (hex, lat=0, lon=179.99, extra={}) => normalize({hex, lat, lon, gs:0, track:90, ...extra}, performance.now()/1000);
function fixture(centerLon=-179.99) {
  const pixels=[], segments=[], calls=[], pans=[];
  let start;
  const ctx = new Proxy({
    measureText:()=>({width:30}),
    moveTo(x,y){start=[x,y];}, lineTo(x,y){segments.push([start,[x,y]]);},
  }, {get(o,k){return o[k] || ((...args)=>{for(const v of args)if(typeof v==='number')assert.ok(Number.isFinite(v),`${k} received ${v}`);});}});
  const map={getCenter:()=>({lat:0,lng:centerLon}), getZoom:()=>8, getSize:()=>({x:800,y:400}),
    latLngToContainerPoint(ll) {
      assert.ok(ll && ll.every(Number.isFinite),'never project a nonfinite coordinate'); calls.push(ll);
      if(ll[0]===9)throw new Error('fixture projection error');
      if(ll[0]===8)return {x:NaN,y:10};
      // A local linear longitude axis makes world-copy choices directly observable.
      const p={x:400+(ll[1]-centerLon)*100,y:200-ll[0]*10}; pixels.push(p); return p;
    },panTo(ll){pans.push(ll);},hasLayer:()=>false,getContainer:()=>({}),removeLayer(){}};
  const canvas={width:800,height:400,clientWidth:800,getContext:()=>ctx};
  const live=Object.create(LiveAdsb.prototype);
  Object.assign(live,{map,o:{},list:new Map(),trails:new Map(),active:false,on:true,viewOk:false,mode:'mil',
    next:Infinity,busy:false,fails:0,status:{at:0,err:''},sel:null,query:'',labels:false,coverage:null,glyphs:{airliner:{}},
    renderUi(){},renderCard(){},layer:{draw(){live.draw(canvas,map);}}});
  return {live,map,canvas,pixels,segments,calls,pans};
}
function withTimers(fn) {
  const old={setTimeout:globalThis.setTimeout,requestAnimationFrame:globalThis.requestAnimationFrame,warn:console.warn};
  const ticks=[];
  globalThis.setTimeout=(f,ms)=>{ticks.push({f,ms});return ticks.length;};
  globalThis.requestAnimationFrame=f=>f(); console.warn=()=>{};
  try { return fn(ticks); } finally {Object.assign(globalThis,{setTimeout:old.setTimeout,requestAnimationFrame:old.requestAnimationFrame});console.warn=old.warn;}
}
await check('B08: markers, hit testing and selection stay beside the dateline in both directions and repeated worlds',()=>{
  for(const center of [-179.99,179.99,-539.99,539.99]) {
    const f=fixture(center), lon=center<0?179.99:-179.99, e=entry('wrapped',0,lon);
    f.live.list.set(e.hex,e); f.live.layer.draw();
    assert.equal(f.live.inView,1); const p=f.live.drawn[0][1];assert.ok(Math.abs(p.x-400)<3);
    assert.equal(f.live.pick(p),e); f.live.active=true;assert.equal(f.live.click(p),true);assert.equal(f.live.sel,e.hex);
    assert.equal(e.lon,lon,'world copies never rewrite canonical observations');
    assert.ok(f.calls.every(ll=>Math.abs(ll[1]-center)<.1));
  }
});
await check('B08: selected trails unwrap adjacent points, anchored on the visible marker',()=>{
  for(const center of [-179.99,179.99,-539.99,539.99]) {
    const f=fixture(center), sign=center<0?1:-1, e=entry('track',0,-sign*179.99);
    f.live.list.set(e.hex,e);f.live.sel=e.hex;
    f.live.trails.set(e.hex,[[0,sign*179.97,1000],[0,-sign*179.98,2000],[0,-sign*179.99,3000]]);
    f.live.layer.draw();assert.equal(f.segments.length,3);
    for(const [a,b] of f.segments){assert.ok(Math.abs(a[0]-b[0])<10);assert.ok(Math.abs(a[0]-400)<10);}
  }
});
await check('B08: follow uses the current map world, including a dead-reckoned crossing',()=>{
  for(const center of [-179.99,179.99,-539.99,539.99])withTimers(()=>{
    const f=fixture(center), e=entry('follow',0,center<0?179.99:-179.99,{gs:360,track:center<0?90:270});
    e.at-=30;f.live.list.set(e.hex,e);Object.assign(f.live,{active:true,sel:e.hex,followSel:true});
    f.live.loop();assert.equal(f.pans.length,1);assert.ok(Math.abs(f.pans[0][1]-center)<.1);
  });
});
await check('B08: Enter search pans to the selected aircraft in the nearest world',()=>{
  for(const center of [-179.99,179.99,-539.99,539.99]) {
    const f=fixture(center),e=entry('search',0,center<0?179.99:-179.99,{flight:'FINDME'});
    f.live.list.set(e.hex,e);f.live.query='findme';f.live.buildUi();
    const input=f.live.box.querySelector('input[type=search]');
    input.events.keydown({key:'Enter',stopPropagation(){}});
    assert.equal(f.live.sel,e.hex);assert.equal(f.pans.length,1);assert.ok(Math.abs(f.pans[0][1]-center)<.1);
  }
});
await check('B09: reject NaN, infinite, out-of-range and nonnumeric coordinates, preserving valid zero and boundaries',()=>{
  for(const bad of [NaN,Infinity,-Infinity,'NaN','Infinity','broken','', ' ',null,undefined,true,false,[],{},181,-181]) {
    assert.equal(normalize({hex:'bad',lat:0,lon:bad},10),null,`longitude ${String(bad)}`);
  }
  for(const bad of [NaN,Infinity,-Infinity,'NaN',null,undefined,true,[],{},90.001,-90.001])assert.equal(normalize({hex:'bad',lat:bad,lon:0},10),null);
  for(const [lat,lon] of [[0,0],[-90,-180],[90,180],['12.5','-170.25']])assert.ok(normalize({hex:'valid',lat,lon},10));
  assert.equal(normalize({hex:'bad',lat:1,lon:2},NaN),null);
  assert.equal(normalize({hex:'bad',lat:1,lon:2,seen_pos:'NaN'},10),null);
  const e=entry('motion',0,0,{gs:'NaN',track:'Infinity',baro_rate:'bad',alt_baro:'bad'});
  assert.equal(e.gs,0);assert.equal(e.trk,0);assert.equal(e.vr,0);assert.equal(e.alt,null);assert.deepEqual(project(e,performance.now()/1000),[0,0]);
  for(const field of ['lat','lon','gs','trk','at'])assert.equal(project({...e,[field]:NaN},10),null);
  assert.equal(nearestWorldPosition([NaN,0]),null);
});
await check('B09: a mixed response isolates malformed records and keeps valid neighbours, trails and future polls',async()=>{
  const f=fixture(),old=globalThis.fetch;let requests=0;
  const invalidMeta={hex:'throws',lat:0,lon:179.99,flight:{toString(){throw new Error('bad metadata');}}};
  const aircraft=[{hex:'first',lat:0,lon:179.99},null,{hex:'nan',lat:NaN,lon:0},{hex:'range',lat:91,lon:0},invalidMeta,{hex:'last',lat:0,lon:179.98}];
  globalThis.fetch=async()=>{requests++;return {ok:true,json:async()=>({aircraft,acquiredAt:Date.now()})};};
  try {
    await f.live.poll(); assert.deepEqual([...f.live.list.keys()],['first','last']);assert.deepEqual([...f.live.trails.keys()],['first','last']);
    assert.equal(f.live.inView,2);assert.equal(f.live.busy,false);assert.equal(f.live.fails,0);assert.ok(f.live.next>performance.now()/1000);
    await f.live.poll();assert.equal(requests,2);assert.equal(f.live.fails,0);
  }finally{globalThis.fetch=old;}
});
await check('B09: corrupt cached coordinates and a failing projection cannot hide valid neighbours or join a broken trail',()=>{
  const f=fixture(), e=entry('good');
  for(const item of [entry('before'),{...e,hex:'nan',lat:NaN},entry('throws',9),entry('nan-pixels',8),e])f.live.list.set(item.hex,item);
  f.live.sel=e.hex;f.live.trails.set(e.hex,[[0,179.95,1000],[NaN,179.96,1000],[0,179.98,1000],[0,179.99,1000]]);
  assert.doesNotThrow(()=>f.live.layer.draw());assert.deepEqual(f.live.drawn.map(([e])=>e.hex),['before','good']);
  assert.equal(f.segments.length,2,'invalid trail point breaks the segment');
  f.live.sel='nan';f.live.card={};LiveAdsb.prototype.renderCard.call(f.live);assert.equal(f.live.card.hidden,true);
});
await check('B09: display exceptions cannot reject successful polls or prevent the next scheduled iteration',async()=>{
  const f=fixture(), oldFetch=globalThis.fetch,oldWarn=console.warn;
  globalThis.fetch=async()=>({ok:true,json:async()=>({aircraft:[],acquiredAt:Date.now()})});console.warn=()=>{};
  let draws=0;
  f.live.renderUi=()=>{throw new Error('UI fixture failure');};f.live.layer.draw=()=>{draws++;throw new Error('canvas fixture failure');};
  try{await assert.doesNotReject(f.live.poll());assert.equal(f.live.busy,false);assert.equal(f.live.fails,0);assert.ok(f.live.next>performance.now()/1000);assert.equal(draws,1);}
  finally{globalThis.fetch=oldFetch;console.warn=oldWarn;}
  withTimers(ticks=>{
    f.live.active=true;f.live.loop();assert.equal(ticks.length,1);assert.equal(ticks[0].ms,150);
    let polls=0;f.live.viewOk=true;f.live.next=0;f.live.lastPoll=null;f.live.poll=()=>{polls++;};
    ticks[0].f();assert.equal(polls,1);assert.equal(ticks.length,2,'reschedule after the next canvas failure too');
    f.live.active=false;ticks[1].f();assert.equal(ticks.length,2,'closing the map still stops the loop');
  });
});
console.log(`${checks} B08/B09 regression groups passed`);
