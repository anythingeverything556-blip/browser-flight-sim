import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {decompress} from '../src/vendor/fzstd.mjs';
import {SR71_ALTIMETER_CLIPS} from '../src/sr71altimeter.js';
import {SR71Cockpit,SR71_COCKPIT_CLIPS,SR71_COCKPIT_LIGHTS,cockpitPose} from '../src/sr71cockpit.js';
const dir=new URL('../public/models/sr71/cockpit/',import.meta.url),full=JSON.parse(fs.readFileSync(new URL('cockpit.gltf',dir))),d=JSON.parse(fs.readFileSync(new URL('cockpit-flight.gltf',dir)));
let tests=0;const check=(name,f)=>{f();tests++;console.log('PASS',name);};
const binary=decompress(fs.readFileSync(new URL('cockpit-flight.bin.zst.part00',dir)));
const loader=new GLTFLoader();loader.register(parser=>{parser.loadBuffer=async()=>binary.buffer.slice(binary.byteOffset,binary.byteOffset+binary.byteLength);parser.loadTextureImage=async()=>new THREE.Texture();return {name:'LOCAL_EXACT_TEST_BUFFERS'};});
const gltf=await loader.parseAsync(JSON.stringify(d),'');const root=gltf.scene,hotspots=new Map(),cockpit=new SR71Cockpit({root,animations:gltf.animations,hotspots});
const quat=(pitch=0,bank=0,heading=0)=>new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),(90-heading)*Math.PI/180).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),pitch*Math.PI/180)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),bank*Math.PI/180));
const fdm={out:{eas:321/1.9438444924406046,M:3.21},pos:{y:85432*.3048},vel:{y:0},quat:quat()};
check('all 32 functional clips exist; only 44 active controls/instruments shipped from original 558',()=>{assert.equal(SR71_COCKPIT_CLIPS.size,32);assert.equal(d.animations.length,44);for(const n of SR71_COCKPIT_CLIPS)assert(d.animations.some(a=>a.name===n),n);assert.equal(full.animations.length,558);assert.equal(cockpit.missing.length,0,cockpit.missing.join('\n'));});
check('source node transforms and hierarchy preserved',()=>{assert.equal(d.nodes.length,full.nodes.length);for(let i=0;i<d.nodes.length;i++)for(const k of ['name','translation','rotation','scale','matrix','children'])assert.deepEqual(d.nodes[i][k],full.nodes[i][k]);});
check('telemetry maps exact integer positions in original KEAS/feet/Mach drums',()=>{const p=cockpitPose(fdm);assert.equal(p.MAIN_INST_PANEL_TDI_KEAS__DRUM_1,.1);assert.equal(p.MAIN_INST_PANEL_TDI_EAS__DRUM_10,.2);assert.equal(p.MAIN_INST_PANEL_TDI_EAS__DRUM_100,.3);for(const [power,want]of [[1,.2],[10,.3],[100,.4],[1000,.5],[10000,.8]])assert.equal(p['MAIN_INST_PANEL_TDI_ALT__DRUM_'+power],want);for(const [power,want]of [[1,.1],[10,.2],[100,.3]])assert.equal(p['MAIN_INST_PANEL_TDI_MACH__DRUM_'+power],want);});
check('ADI SDK mapping matches original55/45 pitch reference overrides and bank bias',()=>{const p=cockpitPose({...fdm,quat:quat(20,30,90)});assert(Math.abs(p.INSTRUMENT_AttitudeIndicator_Pitch_1-.45)<1e-8);assert(Math.abs(p.INSTRUMENT_AttitudeIndicator_Bank_1-150/360)<1e-8);assert(Math.abs(p.ADI_BANK_ANGLE-.68)<1e-8);assert(Math.abs(p.MAIN_INST_PANEL_FD_COMPASS_ROSE-.75)<1e-8);});
check('invalid telemetry does not manufacture zero values; negative digits clamp to zero',()=>{assert.equal(Object.keys(cockpitPose({})).length,0);const p=cockpitPose({out:{eas:-1,M:-1},pos:{y:-10}});assert(Object.values(p).every(x=>Math.abs(x)<1e-10));});
check('real altimeter pointers track hundreds, thousands and tens of thousands of feet MSL',()=>{
  const names=SR71_ALTIMETER_CLIPS, periods=[10000,1000,100000];
  const datum=new THREE.Vector3(0,0,-1), right=new THREE.Vector3(1,0,0);
  const quats=()=>names.map(n=>root.getObjectByName(n).quaternion.clone());
  cockpit.update({pos:{y:0}});const zero=quats();
  for(const feet of [-500,0,100,999,1000,1001,4321,9999,10000,10001,80000,85432,99999,120000]){
    const expected=Math.max(0,Math.min(feet,99999));cockpit.update({pos:{y:feet*.3048}});
    const actual=quats();
    for(let j=0;j<periods.length;j++){
      const arrow=datum.clone().applyQuaternion(actual[j]), up=datum.clone().applyQuaternion(zero[j]), side=right.clone().applyQuaternion(zero[j]);
      const got=Math.atan2(arrow.dot(side),arrow.dot(up))/(2*Math.PI), fraction=(expected%periods[j])/periods[j];
      const error=Math.abs(((got-fraction+1.5)%1)-.5);
      assert(error<2e-6,`${names[j]} at ${feet} ft differs by ${error} turns`);
    }
  }
  assert(!Object.keys(cockpitPose({pos:{y:NaN}})).some(n=>names.includes(n)));
});
const measure=name=>{root.updateMatrixWorld(true);const c=cockpit.clips.get(name);return c.tracks.map(t=>{t.binding.bind();const node=t.binding.node;let mesh;node.traverse(o=>{if(!mesh&&o.geometry?.attributes.position)mesh=o;});return {q:node.quaternion.toArray(),vertex:mesh?new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position,0).applyMatrix4(mesh.matrixWorld).toArray():null};});};
check('actual source instrument mesh vertices move with new Earthwing state',()=>{cockpit.update(fdm);const before=Object.fromEntries([...SR71_COCKPIT_CLIPS].map(n=>[n,measure(n)]));cockpit.update({out:{eas:456/1.9438444924406046,M:2.46},pos:{y:12345*.3048},vel:{y:1000*.3048/60},quat:quat(20,30,90)});for(const n of SR71_COCKPIT_CLIPS){if(SR71_COCKPIT_LIGHTS.some(d=>d.clip===n))continue;const after=measure(n);assert(after.some((a,i)=>a.vertex&&a.vertex.some((v,j)=>Math.abs(v-before[n][i].vertex[j])>1e-7)),n+' moves original vertex');}});
check('all nine original dimmers/switches are registered on real mesh nodes',()=>{for(const def of SR71_COCKPIT_LIGHTS){const node=root.getObjectByName(def.clip);assert.equal(hotspots.get(node)?.action,def.id);assert(node.isMesh||node.children.some(c=>c.isMesh),def.clip);}});
check('on/off toggle changes original control mesh AND stable light intensity/emission',()=>{for(const def of SR71_COCKPIT_LIGHTS){const before=measure(def.clip);assert(cockpit.event(def.id));const after=measure(def.clip);const endpointMoves=after.some((a,i)=>a.vertex&&a.vertex.some((v,j)=>Math.abs(v-before[i].vertex[j])>1e-7));if(!endpointMoves){cockpit.setLight(def.id,.5);const middle=measure(def.clip);assert(middle.some((a,i)=>a.vertex&&a.vertex.some((v,j)=>Math.abs(v-before[i].vertex[j])>1e-7)),def.id+' original full-turn dimmer midpoint moves');cockpit.setLight(def.id,1);}for(const lamp of cockpit.lamps.filter(l=>l.id===def.id)){assert(lamp.light.visible);assert.equal(lamp.light.intensity,def.intensity*cockpit.lightIntensityScale);assert.equal(lamp.light.userData.sourceIntensity,def.intensity);assert(lamp.materials.every(m=>m.emissiveIntensity===1));}if(def.id==='sr71Instruments'){assert(cockpit.backlights.length>0);assert(cockpit.backlights.every(m=>m.emissiveIntensity===1));}assert(cockpit.event(def.id));for(const lamp of cockpit.lamps.filter(l=>l.id===def.id)){assert(lamp.light.visible,'off emitter stays registered; zero intensity gates contribution');assert.equal(lamp.light.intensity,0);assert(lamp.materials.every(m=>m.emissiveIntensity===0));}assert.deepEqual(measure(def.clip),before);}});
check('groups are independent and dimming state preserves source endpoints',()=>{cockpit.setLight('sr71SnakeL',.35);assert.equal(cockpit.state.sr71SnakeR,0);assert(Math.abs(cockpit.lamps.find(l=>l.id==='sr71SnakeL').light.intensity-175*cockpit.lightIntensityScale)<1e-12);assert.equal(cockpit.event('not-a-system'),false);cockpit.setLight('sr71SnakeL',0);assert.equal(cockpit.snapshot().lamps.length,16);});
check('raycast intersects original clickable dimmer geometry',()=>{const node=root.getObjectByName('LH_PANEL_LIGHTS_FLOOD_KNOB');root.updateMatrixWorld(true);const center=new THREE.Box3().setFromObject(node).getCenter(new THREE.Vector3());let found=false;for(const dir of [new THREE.Vector3(0,1,0),new THREE.Vector3(1,0,0),new THREE.Vector3(0,0,1)]){const ray=new THREE.Raycaster(center.clone().addScaledVector(dir,.2),dir.clone().negate(),0,1);if(ray.intersectObject(node,true).length)found=true;}assert(found);});
check('unsupported analog/military systems explicitly reported, never given fabricated tracks',()=>{const snap=cockpit.snapshot();assert(snap.unsupported.some(s=>s.includes('IVSI')));assert(SR71_COCKPIT_CLIPS.has('MAIN_INST_PANEL_IVSI_NEEDLE'));assert(snap.limitations.some(s=>s.includes('browser implementation')));assert(!SR71_COCKPIT_CLIPS.has('MAIN_INST_PANEL_MACH_GAUGE_NEEDLE'));});
check('dispose restores original materials and hotspots without affecting source geometry',()=>{const originals=[...cockpit.originalMaterials];cockpit.dispose();assert.equal(hotspots.size,0);assert.equal(cockpit.lamps.length,0);for(const [mesh,mat]of originals)assert.equal(mesh.material,mat);assert.equal(cockpit.event('sr71Flood'),false);});
console.log(`${tests} cockpit functional tests passed`);
