import * as THREE from 'three';
import {ivsiPose} from './sr71ivsi.js';
import {altimeterPose,SR71_ALTIMETER_CLIPS} from './sr71altimeter.js';
import {gateInactiveCockpitSpots} from './sr71cockpitlighting.js';

// Source: SR71_Interior.xml (original model behavior), common/config/systems.cfg,
// common/effects/LIGHT_SR71_*.fx. No WASM outputs or military systems are emulated.
const clamp=(n,min=0,max=1)=>Math.min(max,Math.max(min,Number.isFinite(n)?n:0));
const wrap=(n,max=360)=>((n%max)+max)%max;
const DEG=180/Math.PI, FT=1/.3048, KT=3600/1852;
export const SR71_COCKPIT_LIGHTS = Object.freeze([
  {id:'sr71Flood',label:'Flood lights',clip:'LH_PANEL_LIGHTS_FLOOD_KNOB',variable:'SRFB06E',effect:'Flood',range:.7,intensity:500,color:[255,180,100],inner:15,outer:50,fixtures:['FLOOD_LT_L','FLOOD_LT_R']},
  {id:'sr71Console',label:'Console lights',clip:'LH_PANEL_LIGHTS_CONSOLE_KNOB',variable:'SRFB06F',effect:'Console',range:.6,intensity:300,color:[255,180,100],inner:10,outer:50,fixtures:['CON_LT_L_R','CON_LT_L_M','CON_LT_L_F','CON_LT_L_U','CON_LT_R_R','CON_LT_R_M','CON_LT_R_F']},
  {id:'sr71Instruments',label:'Instrument backlighting',clip:'LH_PANEL_LIGHTS_INSTRMTS_KNOB',variable:'SRFB071',effect:'original emissive masks',fixtures:[]},
  {id:'sr71ADI',label:'ADI light',clip:'LH_PANEL_LIGHTS_ADI_KNOB',variable:'SRFB072',effect:'Inst_Ring',range:.05,intensity:100.5,color:[255,125,30],inner:34.9,outer:35.4,fixtures:['ADI'],helper:'ADI_LT_HELPER'},
  {id:'sr71SpotL',label:'Left lower spot light',clip:'SPOT_LT_L_DIMMER',variable:'SRSPOTL',effect:'Reading',range:2,intensity:500,color:[100,60,40],inner:10,outer:50,fixtures:['SPOT_LT_L_BULB']},
  {id:'sr71SpotR',label:'Right lower spot light',clip:'SPOT_LT_R_DIMMER',variable:'SRSPOTR',effect:'Reading',range:2,intensity:500,color:[100,60,40],inner:10,outer:50,fixtures:['SPOT_LT_R_BULB']},
  {id:'sr71SnakeL',label:'Left upper reading light',clip:'SNAKE_LT_L_DIMMER',variable:'SRSNAKEL',effect:'Reading',range:2,intensity:500,color:[100,60,40],inner:10,outer:50,fixtures:['SNAKE_LT_L_BULB']},
  {id:'sr71SnakeR',label:'Right upper reading light',clip:'SNAKE_LT_R_DIMMER',variable:'SRSNAKER',effect:'Reading',range:2,intensity:500,color:[100,60,40],inner:10,outer:50,fixtures:['SNAKE_LT_R_BULB']},
  {id:'sr71Thunder',label:'Thunderstorm lights',clip:'LH_PANEL_LIGHTS_THUNDER_SWITCH',variable:'SRFB070',inverted:true,effect:'Tstorm',range:2,intensity:400,color:[230,230,230],inner:10,outer:50,fixtures:['TSTORM_LT_L_BULB','TSTORM_LT_R_BULB']},
]);
export const SR71_COCKPIT_ACTIONS=SR71_COCKPIT_LIGHTS.map(({id,label})=>({id,label:'SR-71 '+label+' · toggle off / full',group:'SR-71 cockpit lighting',keys:id==='sr71Instruments'?['Shift+KeyL']:id==='sr71Flood'?['Shift+KeyH']:[]}));
const TDI_KEAS=['MAIN_INST_PANEL_TDI_KEAS__DRUM_1','MAIN_INST_PANEL_TDI_EAS__DRUM_10','MAIN_INST_PANEL_TDI_EAS__DRUM_100'];
const TDI_ALT=[1,10,100,1000,10000].map(n=>'MAIN_INST_PANEL_TDI_ALT__DRUM_'+n);
const TDI_MACH=[1,10,100].map(n=>'MAIN_INST_PANEL_TDI_MACH__DRUM_'+n);
const ADI=[1,2].flatMap(n=>['INSTRUMENT_AttitudeIndicator_Pitch_'+n,'INSTRUMENT_AttitudeIndicator_Bank_'+n]);
export const SR71_COCKPIT_CLIPS=new Set([...SR71_COCKPIT_LIGHTS.map(d=>d.clip),...TDI_KEAS,...TDI_ALT,...TDI_MACH,...ADI,...SR71_ALTIMETER_CLIPS,'MAIN_INST_PANEL_IVSI_NEEDLE','ADI_BANK_ANGLE','BACKUP_ADI_BANK_ANGLE','MAIN_INST_PANEL_FD_COMPASS_ROSE','canopy_compass']);
export const SR71_COCKPIT_UNSUPPORTED=Object.freeze([
  'Analog airspeed needle: SRFT11E calibration is inside the original compiled WASM.',
  'Analog Mach needle: SRFT11F calibration is inside the original compiled WASM.',
  'Original MSFS IVSI SRFT148 dynamics remain unavailable; connected needle uses a browser-only source-art calibration.',
  'Traditional altimeter shows Earthwing MSL on original three pointers; native SRFT143/143H/143T pressure/lag/electrical behavior and SRFT144 baro ring/knob are not recovered.',
  'Magnetic variation, gyro drift/failures, original electrical buses/circuit breakers, dimmer transfer curves, and annunciator logic are not simulated.',
  'Navigation/ILS/flight-director commands, radios, fuel/oxygen/temperature/pressure and military systems are not connected.',
]);

// Pure telemetry adapter. Earthwing uses metres/m/s, nose-up pitch, right-wing-down
// bank, and true heading. MSFS attitude pitch/bank have the opposite sign.
export function cockpitPose(fdm={}) {
  const pose=altimeterPose(fdm.pos?.y),out=fdm.out||{};
  const ivsi=ivsiPose(fdm.vel?.y);if(ivsi!==undefined)pose.MAIN_INST_PANEL_IVSI_NEEDLE=ivsi;
  const digits=(value,names)=>{if(!Number.isFinite(value))return;let n=Math.floor(Math.max(0,value)+1e-7);for(const name of names){pose[name]=(n%10)/10;n=Math.floor(n/10);}};
  // SRDM02/03/04 digit animation expressions are digit*10, length100. Exact
  // digit positions only: do not invent unavailable original rolling carry law.
  digits(out.eas*KT,TDI_KEAS);
  digits(fdm.pos?.y*FT,TDI_ALT);
  digits(out.M*100,TDI_MACH);
  if(fdm.quat){
    const q=fdm.quat;
    const fwd=new THREE.Vector3(1,0,0).applyQuaternion(q),up=new THREE.Vector3(0,1,0).applyQuaternion(q),right=new THREE.Vector3(0,0,1).applyQuaternion(q);
    const pitch=Math.asin(clamp(fwd.y,-1,1))*DEG,bank=Math.atan2(-right.y,up.y)*DEG,heading=wrap(Math.atan2(fwd.x,-fwd.z)*DEG);
    // SDK AttitudeIndicator_Simple_SubTemplate: REF20, neutral50;
    // original overrides +ref55/-ref45 -> limits +200/-200 degrees. Pitch simvar
    // is positive nose-down. Bank simvar is biased180 over length360.
    for(const n of [1,2]){pose['INSTRUMENT_AttitudeIndicator_Pitch_'+n]=clamp(.5-pitch/400);pose['INSTRUMENT_AttitudeIndicator_Bank_'+n]=wrap(180-bank)/360;}
    pose.ADI_BANK_ANGLE=pose.BACKUP_ADI_BANK_ANGLE=clamp(.5+bank*.006);
    // Original HSI INVERT_ANIM and length360. Heading is Earthwing TRUE,
    // not a claim to reproduce the original compiled magnetic/INS solution.
    pose.MAIN_INST_PANEL_FD_COMPASS_ROSE=1-heading/360;
    pose.canopy_compass=heading*.2777/100;
  }
  return pose;
}

export function bindCockpitClips(root,animations) {
  return new Map(animations.filter(c=>SR71_COCKPIT_CLIPS.has(c.name)).map(clip=>[clip.name,{
    clip,start:Math.min(...clip.tracks.map(t=>t.times[0])),end:Math.max(...clip.tracks.map(t=>t.times.at(-1))),
    tracks:clip.tracks.map(t=>{const binding=THREE.PropertyBinding.create(root,t.name);binding.bind();if(binding.node)binding.node.matrixAutoUpdate=true;return {binding,interpolant:t.createInterpolant()};})
  }]));
}

export class SR71Cockpit {
  constructor({root,clips,animations=[],hotspots=new Map(),lightIntensityScale=.002}={}) {
    if(!root)throw Error('Original SR-71 cockpit root required');
    this.root=root;this.clips=clips||bindCockpitClips(root,animations);this.hotspots=hotspots;this.ownedHotspots=new Map();this.originalMaterials=new Map();this.materialCloneCache=new Map();this.clonedMaterials=new Set();this.lamps=[];this.backlights=[];this.values=new Map();this.state=Object.fromEntries(SR71_COCKPIT_LIGHTS.map(d=>[d.id,0]));
    // Legacy FX intensity is not Three.js candela. This documented renderer-only
    // exposure adaptation keeps source lamps legible; it is not a claim of
    // original simulator photometric equivalence. Geometry and clip time stay exact.
    this.lightIntensityScale=Math.max(0,Number.isFinite(lightIntensityScale)?lightIntensityScale:.002);
    this.missing=[];this.disposed=false;this.lastPose={};
    for(const name of SR71_COCKPIT_CLIPS)if(!this.clips.has(name))this.missing.push('clip:'+name);
    for(const def of SR71_COCKPIT_LIGHTS){
      this.hotspot(root.getObjectByName(def.clip),def);
      for(const fixture of def.fixtures){
        const bulb=root.getObjectByName(fixture),helper=root.getObjectByName(def.helper||fixture.replace(/_BULB$/,'')+'_HELPER');
        if(bulb)this.hotspot(bulb,def); // convenient fixture click; original dimmer remains clickable
        if(!helper){this.missing.push('helper:'+(def.helper||fixture.replace(/_BULB$/,'')+'_HELPER'));continue;}
        // Original helper local +Z is the authored emitter direction. Three's
        // target is explicitly +Z; no new helper placement/geometry is invented.
        const color=new THREE.Color().setRGB(...def.color.map(c=>c/255),THREE.SRGBColorSpace);
        const light=new THREE.SpotLight(color,0,def.range,def.outer*Math.PI/180,1-def.inner/def.outer,2);
        // A stable light count avoids recompiling NUM_SPOT_LIGHTS on a switch.
        // Off lamps stay registered, with exactly zero radiance.
        light.name='SR71 '+def.id+' '+helper.name;light.castShadow=false;
        light.userData={sr71CockpitLight:true,sourceEffect:'LIGHT_SR71_'+def.effect+'.fx',sourceIntensity:def.intensity};
        const target=new THREE.Object3D();target.position.z=1;helper.add(light,target);light.target=target;
        const materials=[];
        bulb?.traverse(o=>{if(!o.isMesh)return;const clones=this.cloneMaterials(o,def.id);for(const m of clones){if(m.name==='LIGHTS'){m.emissive.copy(color);m.emissiveIntensity=0;materials.push(m);}}});
        this.lamps.push({id:def.id,def,light,target,materials,helper,bulb});
      }
    }
    // Actual source emissive masks are restored by the extraction tool. Clone
    // only materials that have them, excluding warnings/gear and lamp fixtures.
    root.traverse(o=>{
      if(!o.isMesh)return;
      const mats=Array.isArray(o.material)?o.material:[o.material];
      if(!mats.some(m=>m.userData?.sr71InstrumentBacklight))return;
      for(const m of this.cloneMaterials(o))if(m.userData?.sr71InstrumentBacklight){m.emissive.set(0xffffff);m.emissiveIntensity=0;if(!this.backlights.includes(m))this.backlights.push(m);}
    });
    // Scope the uniform zero-light branch to owned cockpit material clones;
    // no global ShaderChunk or renderer changes. Keep source material sharing.
    root.traverse(o=>{
      if(!o.isMesh)return;
      const mats=Array.isArray(o.material)?o.material:[o.material];
      if(!mats.some(m=>m.isMeshStandardMaterial||m.isMeshPhongMaterial||m.isMeshLambertMaterial||m.isMeshToonMaterial))return;
      for(const m of this.cloneMaterials(o))gateInactiveCockpitSpots(m);
    });
    this.applyLights();
  }
  cloneMaterials(mesh,group='instruments'){
    if(this.originalMaterials.has(mesh))return Array.isArray(mesh.material)?mesh.material:[mesh.material];
    this.originalMaterials.set(mesh,mesh.material);
    // Share a clone within one electrical/lighting group, never across groups.
    // This retains original material sharing instead of making hundreds of
    // separate mutable dial materials just to toggle the same mask intensity.
    const clones=(Array.isArray(mesh.material)?mesh.material:[mesh.material]).map(m=>{const key=group+':'+m.uuid;if(!this.materialCloneCache.has(key)){const clone=m.clone();clone.onBeforeCompile=m.onBeforeCompile;clone.customProgramCacheKey=m.customProgramCacheKey;this.materialCloneCache.set(key,clone);this.clonedMaterials.add(clone);}return this.materialCloneCache.get(key);});
    mesh.material=Array.isArray(mesh.material)?clones:clones[0];return clones;
  }
  hotspot(node,def){if(!node)return;this.ownedHotspots.set(node,this.hotspots.get(node));this.hotspots.set(node,{kind:'sr71',action:def.id,label:def.label+' · click to toggle off / full'});}
  setLight(id,value){if(!Object.hasOwn(this.state,id)||this.disposed)return false;this.state[id]=clamp(value);this.applyLights();return true;}
  event(id){if(!Object.hasOwn(this.state,id)||this.disposed)return false;return this.setLight(id,this.state[id]>0?0:1);}
  applyLights(){
    for(const def of SR71_COCKPIT_LIGHTS)this.scrub(def.clip,def.inverted?1-this.state[def.id]:this.state[def.id]);
    for(const lamp of this.lamps){const v=this.state[lamp.id];lamp.light.intensity=lamp.def.intensity*this.lightIntensityScale*v;for(const m of lamp.materials)m.emissiveIntensity=v;}
    for(const m of this.backlights)m.emissiveIntensity=this.state.sr71Instruments;
  }
  scrub(name,value){const c=this.clips.get(name);if(!c||!Number.isFinite(value))return false;const t=c.start+(c.end-c.start)*clamp(value);if(this.values.get(name)===t)return true;for(const track of c.tracks){track.binding.bind();if(track.binding.node)track.binding.node.matrixAutoUpdate=true;track.binding.setValue(track.interpolant.evaluate(t),0);}this.values.set(name,t);return true;}
  update(fdm,_dt){if(this.disposed)return;this.lastPose=cockpitPose(fdm);for(const [name,value] of Object.entries(this.lastPose))this.scrub(name,value);}
  snapshot(){return {lighting:{...this.state},lightIntensityScale:this.lightIntensityScale,lamps:this.lamps.map(l=>({id:l.id,helper:l.helper.name,visible:l.light.visible,intensity:l.light.intensity,emissive:l.materials.map(m=>m.emissiveIntensity)})),backlightMaterials:this.backlights.length,pose:{...this.lastPose},missing:[...this.missing],unsupported:[...SR71_COCKPIT_UNSUPPORTED],limitations:['IVSI is a browser implementation using Earthwing world vertical velocity, source-art tick calibration and original animation. Piecewise interpolation and ±6000 FPM clipping; not exact native MSFS SRFT148, IVSI dynamics, pressure or electrical behavior.','Traditional altimeter and TDI altitude use Earthwing MSL, not pressure altitude; analog three-pointer display is source-calibrated and limited to 0–99,999 ft; baro ring/knob and native pressure/lag/electrical law remain unsupported.','Heading uses Earthwing true heading without magnetic variation.','Digits snap to whole positions; original compiled rolling-carry behavior unavailable.','Light placement, direction, range, color and cone come from source; Legacy FX intensities are multiplied by renderer adaptation scale0.002 by default; MSFS-to-Three photometry is not certified equivalent. No volumetrics or lamp shadows.','Instrument knob controls authored emission masks only, not the full original per-instrument spot-light bank or electrical network.']};}
  dispose(){if(this.disposed)return;this.disposed=true;for(const l of this.lamps){l.light.removeFromParent();l.target.removeFromParent();l.light.dispose();}for(const [node,previous]of this.ownedHotspots){if(previous)this.hotspots.set(node,previous);else this.hotspots.delete(node);}for(const [mesh,original]of this.originalMaterials)mesh.material=original;for(const m of this.clonedMaterials)m.dispose();this.clonedMaterials.clear();this.materialCloneCache.clear();this.lamps.length=0;this.backlights.length=0;}
}
