// E14/E15: production scheduler/inset, deterministic clock and local DEM replies.
import assert from 'node:assert/strict';
import * as THREE from 'three';
let clock=1000;
Object.defineProperty(performance,'now',{value:()=>clock,configurable:true});
globalThis.fetch=()=>{throw Error('Network forbidden in DEM lifecycle fixture');};
globalThis.OffscreenCanvas=class {getContext(){return {};}};
const {Terrain}=await import('../src/terrain.js');
const {F27RunwayInset}=await import('../src/f27runway.js');
const {AirportDB,Runway}=await import('../src/airportdb.js');
const {Geo,tx2lon,ty2lat}=await import('../src/geo.js');
function rig(db=null,lat=34.92,lon=-117.88){
  const geo=new Geo(lat,lon),scene=new THREE.Scene(),terrain=new Terrain(scene,geo,db);
  const pending=new Map(),starts=[];let next=1,peak=0;
  terrain.loader.request=(msg,cb)=>{
    assert.equal(msg.type,'dem','only fixture DEM demand is allowed');
    const key=`${msg.z}/${msg.x}/${msg.y}`;
    assert(![...pending.values()].some(p=>p.key===key),'single-flight per DEM');
    const id=next++;pending.set(id,{msg,cb,key});starts.push({key,at:clock});peak=Math.max(peak,pending.size);return id;
  };
  terrain.loader.cancel=id=>pending.delete(id);
  const flush=reply=>{while(pending.size){const [id,p]=pending.entries().next().value;pending.delete(id);p.cb({id,...(typeof reply==='function'?reply(p.msg):reply)});}};
  const arrive=(L,lat,lon,h)=>{const e=terrain.demAt(L,lat,lon);terrain.startDem(e);flush({data:new Float32Array(65536).fill(h)});return e;};
  return {terrain,scene,geo,pending,starts,flush,arrive,get peak(){return peak;}};
}
function stationary(status){
  clock=1000;const r=rig(),t=r.terrain;
  t.maxZ=6;t.setSeg(8);t.imageryFallback=true;
  const tile=t.getTile(6,36,24);
  tile.img='nodata';t.setRoots=()=>[tile];
  const tick=(dt=100)=>{clock+=dt;t.update({x:0,y:100,z:0},34,34);};
  t.update({x:0,y:100,z:0},34,34);r.flush({status});
  const dependencies=tile.demList.length;assert.equal(dependencies,4);
  const end=clock+130000;
  while(clock<end){tick();r.flush({status});}
  assert(tile.built&&tile.usedFallback,'stationary view builds settled fallback geometry');
  assert.equal(t.stats.demActive,0);assert(r.peak<=12);
  for(const e of tile.demList){
    const attempts=r.starts.filter(s=>s.key===`${e.z}/${e.x}/${e.y}`).map(s=>s.at-1000);
    assert.deepEqual(attempts,status===404||status===410?[0]:[0,600,1800,4200,64200,124200],'bounded exponential then minute cooldown, no frame-rate retries');
  }
  if(status===503){
    const builtCount=t.stats.built,coarse=new Float32Array(65536).fill(180);
    // The same built tile recovers without camera motion or new tile demand.
    clock=Math.max(...tile.demList.map(e=>e.retryAt));tick(0);r.flush({data:coarse});tick();
    assert.equal(t.stats.built,builtCount,'recovery refits rather than rebuilding an already built tile');
    assert(tile.demList.every(e=>e.state==='ready'));assert.equal(tile.usedFallback,false);
    assert(Math.abs(tile.mesh.geometry.attributes.position.getY(40)-180)<1e-5,'rendered terrain refitted after late recovery');
    const p=tile.mesh.geometry.attributes.position,lat=tile.lat[5],lon=tile.lon[5];
    assert(Math.abs(p.getY(40)-t.heightAt(lat,lon))<1e-5,'terrain mesh/collision agree on recovered DEM');
    const requests=r.starts.length;for(let i=0;i<100;i++)tick(1000);
    assert.equal(r.starts.length,requests,'ready data never retried');
  }else{
    clock=601000;tick(0);assert.equal(r.pending.size,dependencies,'permanent misses retry only at ten-minute deadline');r.flush({status});
    const requests=r.starts.length;t.setRoots=()=>[];clock+=600000;tick(0);
    assert.equal(r.starts.length,requests,'unwanted cached failures do not retain demand');
  }
  console.log(`PASS stationary DEM ${status}: ${dependencies} dependencies, bounded retries, fallback${status===503?' and recovery':''}`);
}
stationary(503);stationary(404);stationary(410);
{
  clock=1000;const r=rig(),t=r.terrain;t.maxZ=6;t.imageryFallback=true;
  const roots=[];for(let i=0;i<16;i++){const tile=t.getTile(6,(i%4)*12+4,Math.floor(i/4)*12+4);tile.img='nodata';roots.push(tile);}
  t.setRoots=()=>roots;t.update({x:0,y:100,z:0},34,34);
  assert.equal(r.pending.size,12,'DEM slot cap retained');
  r.flush({status:503});assert.equal(r.peak,12);assert.equal(t.stats.demActive,0);
  const requests=r.starts.length;t.update({x:0,y:100,z:0},34,34);assert.equal(r.starts.length,requests,'no duplicate retries during cooldown');
  console.log('PASS DEM concurrency: twelve slots, single-flight and no cooldown busy loop');
}
{
  clock=1000;
  const runway=new Runway({ident:'LOCAL'},['18','36',34.916,-117.88,34.924,-117.88,100,100,30,1,0]);
  const db=new AirportDB();db.ready=true;db.activeRunways=[runway];db.setActiveBox();
  const r=rig(db,runway.lat,runway.lon),t=r.terrain,inset=new F27RunwayInset(r.scene,t,r.geo),cw={x:0,y:140,z:0};
  const update=()=>inset.update(runway,cw,1);
  const sample=runway.pointAlong(0,runway.width/2+190-1e-4);
  const verify=()=>{
    const positions=inset.mesh.geometry.attributes.position,c=r.geo.toXZ(runway.lat,runway.lon);let worst=0;
    for(let i=0;i<positions.count;i++){
      const ll=r.geo.toLatLon(positions.getX(i)+c.x,positions.getZ(i)+c.z);
      worst=Math.max(worst,Math.abs(positions.getY(i)-t.heightAt(ll.lat,ll.lon)));
    }
    assert(worst<0.001,`inset vertices match collision to a millimetre (${worst})`);
    const p=r.geo.toXZ(sample.lat,sample.lon),ray=new THREE.Raycaster(new THREE.Vector3(p.x-cw.x,1000,p.z-cw.z),new THREE.Vector3(0,-1,0));
    inset.mesh.updateMatrixWorld(true);const hits=ray.intersectObject(inset.mesh,false);assert(hits.length,'visible apron has collision-test ray hit');
    assert(Math.abs(hits[0].point.y+cw.y-t.heightAt(sample.lat,sample.lon))<0.001,'rendered apron/collision agree at sampled edge');
    return worst;
  };
  update();assert.equal(t.heightAt(sample.lat,sample.lon),100);verify();
  let geometry=inset.mesh.geometry,disposed=0;geometry.addEventListener('dispose',()=>disposed++);
  r.arrive(7,runway.lat,runway.lon,250);update();assert.notEqual(inset.mesh.geometry,geometry);assert.equal(disposed,1);verify();
  const before=t.heightAt(sample.lat,sample.lon);geometry=inset.mesh.geometry;
  r.arrive(15,runway.lat,runway.lon,430);update();assert.notEqual(inset.mesh.geometry,geometry,'first-arrival fine DEM invalidates apron without eviction or prior failure');verify();
  const fineHeight=t.heightAt(sample.lat,sample.lon);
  assert(fineHeight>before+5,'fixture exercises feather region, not just flattened runway');
  geometry=inset.mesh.geometry;r.arrive(15,0,0,900);update();assert.equal(inset.mesh.geometry,geometry,'unrelated arrivals do not refit apron');
  for(let i=0;i<20;i++){clock+=16;update();}assert.equal(inset.mesh.geometry,geometry,'no repeated refit for unchanged DEM');
  // Failed replies do not trigger refits; a later recovery while hidden does.
  const failed=t.demAt(14,runway.lat,runway.lon);t.startDem(failed);r.flush({status:503});
  update();assert.equal(inset.mesh.geometry,geometry,'failure alone is not a DEM arrival');
  inset.update(runway,cw,0);r.arrive(15,runway.lat,runway.lon,550);update();assert.notEqual(inset.mesh.geometry,geometry);verify();
  geometry=inset.mesh.geometry;r.geo.setOrigin(runway.lat+0.01,runway.lon+0.01);update();assert.notEqual(inset.mesh.geometry,geometry);verify();
  geometry=inset.mesh.geometry;t.demEpoch++;update();assert.notEqual(inset.mesh.geometry,geometry,'cache eviction remains an invalidation');
  console.log(`PASS F27 DEM transition: apron ${100} -> ${before.toFixed(3)} -> ${fineHeight.toFixed(3)} -> ${t.heightAt(sample.lat,sample.lon).toFixed(3)} m; mesh/collision error < 1 mm, immediate refits, unrelated arrivals ignored`);
}
{
  // Bicubic taps just across tile edges, including the antimeridian, must count.
  const r=rig(),t=r.terrain,L=15,n=2**L,x=100,y=100;
  const bounds={lon0:tx2lon(x+0.999,L),lon1:tx2lon(x+0.999,L),lat0:ty2lat(y+0.5,L),lat1:ty2lat(y+0.5,L)};
  r.arrive(L,ty2lat(y+0.5,L),tx2lon(x+1.5,L),120);assert.equal(t.elevationRevision(bounds),1);
  r.arrive(L,ty2lat(y+0.5,L),tx2lon(x+2.5,L),120);assert.equal(t.elevationRevision(bounds),1,'outside sample footprint ignored');
  const edge={...bounds,lon0:tx2lon(n-0.001,L),lon1:tx2lon(n+0.001,L)};
  r.arrive(L,ty2lat(y+0.5,L),-180,120);assert.equal(t.elevationRevision(edge),3,'wrapped neighbour included');
  const south={lon0:tx2lon(200.5,L),lon1:tx2lon(200.5,L),lat0:ty2lat(y+0.999,L),lat1:ty2lat(y+0.999,L)};
  r.arrive(L,ty2lat(y+1.5,L),tx2lon(200.5,L),120);assert.equal(t.elevationRevision(south),4,'south bicubic neighbour included');
  console.log('PASS regional elevation invalidation includes bicubic and antimeridian neighbours');
}
