import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createFokkerAdapter } from '../src/f27adapter.js';
import { createF27LightRig, F27_LIGHT_BUDGET, prepareF27Part } from '../src/f27lights.js';
import fs from 'node:fs';
const lighting = JSON.parse(fs.readFileSync(new URL('../src/f27lighting.json', import.meta.url)));
const scene = new THREE.Scene(), rig = createF27LightRig(scene);
function part(kind) {
  const root = new THREE.Group(); root.position.set(12, 3, -6); root.rotation.y = 0.6; scene.add(root);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({name:'int_test',emissiveMap:new THREE.Texture()})); root.add(mesh);
  const adapter = createFokkerAdapter(THREE, {scene:root,animations:[]}, {lighting,model:kind,wingSpots:kind==='exterior',instrumentMaterials:['int_test']});
  const result = {root,adapter}; rig.attach(result); return result;
}
const exterior = part('exterior'), cockpit = part('cockpit');
const count = () => { const result={spots:0,points:0}; scene.traverseVisible(o=>{if(o.layers.test(new THREE.Layers())) {if(o.isSpotLight) result.spots++;if(o.isPointLight)result.points++;}});return result; };
for (const p of [exterior,cockpit]) for (const value of [0,0.4,1,0]) {
  exterior.root.visible = p===exterior; cockpit.root.visible=p===cockpit;
  p.adapter.setLights(Object.fromEntries(['landing','taxi','wingInspection','cockpitDome','cockpitDomeRed','instruments','beacon'].map(k=>[k,value])));
  p.adapter.update(0.05); rig.update(p);
  assert.deepEqual(count(),F27_LIGHT_BUDGET,'fixed renderer budget for every switch/view');
  assert.ok(p.adapter.lights.every(l=>l.layers.mask===0));
  for(const source of p.adapter.lights) {
    const pool = source.isSpotLight?rig.spots:rig.points;
    const index = p.adapter.lights.filter(l=>source.isSpotLight?l.isSpotLight:l.isPointLight).indexOf(source);
    assert.equal(pool[index].intensity,source.visible?source.intensity:0);
    assert.ok(pool[index].position.distanceTo(source.getWorldPosition(new THREE.Vector3()))<1e-9);
    if(source.isSpotLight)assert.ok(pool[index].target.position.distanceTo(source.target.getWorldPosition(new THREE.Vector3()))<1e-9);
  }
}
exterior.adapter.setLights({beacon:1}); exterior.adapter.update(0.05); assert.ok(exterior.root.getObjectByName('FokkerMarker:beacon').visible);
exterior.adapter.update(0.3); assert.ok(!exterior.root.getObjectByName('FokkerMarker:beacon').visible);
rig.update(null); assert.ok([...rig.spots,...rig.points].every(l=>l.visible&&l.intensity===0)); assert.deepEqual(count(),F27_LIGHT_BUDGET);
const instrument=cockpit.root.children[0].material;let repaints=0;const set=instrument.emissive.set.bind(instrument.emissive);instrument.emissive.set=(...args)=>{repaints++;return set(...args);};
cockpit.adapter.setLights({instruments:0.6});for(let t=1;t<3;t+=0.05)cockpit.adapter.update(t);assert.equal(repaints,1,'steady instrument dimmer does not repaint every frame');
cockpit.adapter.setLights({instruments:0.2});assert.equal(repaints,2);assert.equal(instrument.emissiveIntensity,0.2);
scene.environment=new THREE.Texture();let compiled=false,uploads=0;const visible=cockpit.root.visible;
await prepareF27Part({initTexture(){uploads++;},async compileAsync(root,camera,target){assert.equal(target,scene);assert.equal(root,cockpit.root);assert.equal(root.visible,visible);compiled=true;}},cockpit,scene,new THREE.PerspectiveCamera());
assert.ok(compiled&&uploads>0);assert.equal(cockpit.root.children[0].material.envMap,scene.environment);
rig.dispose();assert.ok(exterior.adapter.lights.every(l=>l.layers.mask===1));assert.equal(rig.root.parent,null);
console.log('F27 fixed budget, fractional dimmer, view swap, anchors, beacon and preparation passed.');
