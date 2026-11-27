import * as THREE from 'three';

// systems.cfg lightdef.0–9: fixtures, not legacy procedural-aircraft positions.
// Original bulb names T1/B1 are sanitized differently by GLTFLoader; include aliases.
export const SR71_EXTERIOR_ACTIONS = [
  {id:'sr71LandingLight', label:'SR-71 landing light · nose gear down only', group:'SR-71 exterior lights', keys:['Shift+Digit7'], key:'landing'},
  {id:'sr71TaxiLight', label:'SR-71 taxi light · nose gear down only', group:'SR-71 exterior lights', keys:['Shift+Digit8'], key:'taxi'},
  {id:'sr71NavLight', label:'SR-71 white tail / position lights', group:'SR-71 exterior lights', keys:['Shift+Digit9'], key:'navigation'},
  {id:'sr71BeaconLight', label:'SR-71 red anticollision beacons', group:'SR-71 exterior lights', keys:['Shift+Digit5'], key:'beacon'},
  {id:'sr71StrobeLight', label:'SR-71 white anticollision strobes', group:'SR-71 exterior lights', keys:['Shift+Digit6'], key:'strobe'},
];
export const SR71_EXTERIOR_DEFAULTS = Object.freeze({landing:true,taxi:false,navigation:true,beacon:true,strobe:false});
export const SR71_EXTERIOR_FIXTURES = [
  {key:'landing', helper:'LANDING_LIGHT_HELPER', bulbs:['LANDING_LIGHT_BULB'], color:0xfff0d4, size:.45, beam:0, angle:.15, intensity:24000, range:350},
  {key:'taxi', helper:'TAXI_LIGHT_HELPER', bulbs:['TAXI_LIGHT_BULB'], color:0xffe9bf, size:.35, beam:1, angle:.3, intensity:7000, range:140},
  ...['T','B'].flatMap(side=>[
    {key:'navigation',helper:`TAIL_LT_${side}_HELPER`,bulbs:[`TAIL_LT_${side}`],color:0xfff3df,size:.22},
    {key:'beacon',helper:`ANTI_COL_RED_${side}_HELPER`,bulbs:[`BEACON_LT_${side}`],color:0xff1608,size:.32},
    {key:'beacon',helper:`ANTI_COL_RED_${side}1_HELPER`,bulbs:[`BEACON_LT_${side}1`,`BEACON_LT_${side}_1`],color:0xff1608,size:.32},
    {key:'strobe',helper:`ANTI_COL_WHITE_${side}_HELPER`,bulbs:[`ANTI_COL_WHITE_${side}`],color:0xffffff,size:.38},
  ]),
];
export function sr71ExteriorLevel(key, state, gearPos, time, enabled=true) {
  if(!enabled||!state[key])return 0;
  if(key==='landing'||key==='taxi')return gearPos>=.98?1:0;
  const phase=((time%1.2)+1.2)%1.2;
  if(key==='beacon')return phase<.16?1:0;
  if(key==='strobe')return phase<.07||(phase>.15&&phase<.22)?1:0;
  return 1;
}
function coronaTexture() {
  const size=32,data=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const r=Math.hypot((x+.5-size/2)/(size/2),(y+.5-size/2)/(size/2)),i=(y*size+x)*4;
    data[i]=data[i+1]=data[i+2]=255;data[i+3]=Math.round(255*Math.pow(Math.max(0,1-r),3));
  }
  const texture=new THREE.DataTexture(data,size,size);texture.needsUpdate=true;return texture;
}
export class SR71ExteriorLights {
  constructor(scene) {
    this.state={...SR71_EXTERIOR_DEFAULTS};this.time=0;this.parts=new Map();this.texture=coronaTexture();
    // Permanent scene lights: do not change visible, layers or count on toggles,
    // detail switches, gear retraction, cockpit entry or crashes (shader defines).
    this.root=new THREE.Group();this.root.name='SR71 fixed exterior light budget';scene.add(this.root);
    this.spots=SR71_EXTERIOR_FIXTURES.filter(d=>d.beam!==undefined).map(d=>{
      const light=new THREE.SpotLight(d.color,0,d.range,d.angle,.6,2);light.name='SR71 '+d.key;light.castShadow=false;
      this.root.add(light,light.target);return light;
    });
    this.beams=this.spots.map((_,i)=>({from:new THREE.Vector3(),direction:new THREE.Vector3(1,0,0),strength:0,angle:SR71_EXTERIOR_FIXTURES[i].angle}));
    this.direction=new THREE.Vector3();this.reset();
  }
  reset(){Object.assign(this.state,SR71_EXTERIOR_DEFAULTS);this.time=0;}
  toggle(key){if(!Object.hasOwn(this.state,key))return false;this.state[key]=!this.state[key];return this.state[key];}
  attach(part) {
    if(this.parts.has(part)||part.kind!=='exterior')return;
    const fixtures=[],originals=[],materials=[];
    for(const def of SR71_EXTERIOR_FIXTURES){
      const helper=part.root.getObjectByName(def.helper);if(!helper)continue;
      const emission=[];
      for(const name of def.bulbs){const bulb=part.root.getObjectByName(name);bulb?.traverse(o=>{
        if(!o.isMesh)return;const old=o.material;
        const clone=m=>{if(m.name!=='LIGHTS'||!m.emissive)return m;const c=m.clone();c.emissive.set(def.color);c.emissiveMap=c.map;c.emissiveIntensity=0;emission.push(c);materials.push(c);return c;};
        o.material=Array.isArray(old)?old.map(clone):clone(old);originals.push([o,old]);
      });}
      const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:this.texture,color:def.color,transparent:true,opacity:0,depthTest:true,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false}));
      sprite.name='SR71 corona '+def.helper;sprite.scale.setScalar(def.size);sprite.frustumCulled=false;helper.add(sprite);
      // Offset just in front of the authored lens, never disable depth testing.
      sprite.position.z=.025;materials.push(sprite.material);fixtures.push({def,helper,sprite,emission,level:0});
    }
    this.parts.set(part,{fixtures,originals,materials});
  }
  update(dt, visual, fdm, enabled=true) {
    this.time+=Number.isFinite(dt)?Math.max(0,dt):0;
    for(const beam of this.beams)beam.strength=0;
    for(const light of this.spots)light.intensity=0;
    for(const part of visual.parts){
      this.attach(part);const entry=this.parts.get(part);if(!entry)continue;
      const active=enabled&&part.root.visible&&!!part.root.parent;
      for(const fixture of entry.fixtures){
        const {def,helper,sprite,emission}=fixture;
        const level=sr71ExteriorLevel(def.key,this.state,fdm.gearPos,this.time,active);
        fixture.level=level;sprite.material.opacity=level;for(const m of emission)m.emissiveIntensity=level*4;
        if(def.beam===undefined||!level)continue;
        helper.updateWorldMatrix(true,false);
        const beam=this.beams[def.beam],light=this.spots[def.beam];
        beam.from.setFromMatrixPosition(helper.matrixWorld);beam.direction.set(0,0,1).transformDirection(helper.matrixWorld);
        beam.strength=1;light.position.copy(beam.from);light.target.position.copy(beam.from).add(beam.direction);light.intensity=def.intensity;
      }
    }
    this.root.updateMatrixWorld(true);
  }
  // Uses the already-allocated terrain cone uniforms; no terrain shader edits.
  // Positions are camera-relative, same as SR71Visual.root and the terrain shader.
  updateTerrain(uniforms, daylight=1) {
    uniforms.uF27Beam.value.forEach(b=>{b.w=0;});uniforms.uF27Contact.value.w=0;
    this.beams.forEach((beam,i)=>{
      uniforms.uF27Beam.value[i].set(beam.from.x,beam.from.y,beam.from.z,beam.strength*(i?2.15:2.65)*(1-.72*daylight));
      uniforms.uF27Aim.value[i].set(beam.direction.x,beam.direction.y,beam.direction.z,Math.cos(beam.angle));
    });
  }
  snapshot(){return {state:{...this.state},time:this.time,spots:this.spots.map(l=>({name:l.name,visible:l.visible,intensity:l.intensity})),fixtures:[...this.parts].flatMap(([part,e])=>e.fixtures.map(f=>({path:part.path,helper:f.def.helper,key:f.def.key,level:f.level,emissive:f.emission.length}))),beams:this.beams.map(b=>({from:b.from.toArray(),direction:b.direction.toArray(),strength:b.strength}))};}
  dispose(){for(const e of this.parts.values()){for(const f of e.fixtures)f.sprite.removeFromParent();for(const [o,m]of e.originals)o.material=m;for(const m of e.materials)m.dispose();}this.parts.clear();this.spots.forEach(l=>l.dispose());this.root.removeFromParent();this.texture.dispose();}
}
