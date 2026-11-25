// Stand-alone Vision Jet SF50 viewer for checking public/models/SF50.glb (dev server: /tools/viewer/sf50-viewer.html).
// Model frame: +x nose, +y up, +z right wing, metres, wheels on y = 0 (the GLB is rotated like C172.glb: glTF +Z nose -> +x).
// Moving nodes carry extras { hinge_axis (glTF frame), max_deg }: the pose parameters below are fractions of max_deg.
// URL / set(): cam=x,y,z look=x,y,z fov  flaps=0..1 ail=-1..1 pitch=-1..1 yaw=-1..1 gear=0 (down)..1 (up) door=0..1 bag=0..1 exit=0..1
//              hide=regex  night=1  w,h
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

const q = new URLSearchParams(location.search), num = (k, d) => (q.has(k) ? +q.get(k) : d);
const W = num('w', innerWidth), H = num('h', innerHeight);
const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setSize(W, H); renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(num('fov', 40), W / H, 0.02, 500);
const pm = new THREE.PMREMGenerator(renderer), dayEnv = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environment = dayEnv;
const sun = new THREE.DirectionalLight(0xfff4e6, 3); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 60 }); sun.shadow.bias = -0.0004;
scene.add(sun, sun.target, new THREE.HemisphereLight(0xcfe3ff, 0x6b6b60, 0.9));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x7a7a74, roughness: 0.95 }));
ground.receiveShadow = true; scene.add(ground);

const draco = new DRACOLoader().setDecoderPath('/draco/');
const gltf = await new GLTFLoader().setDRACOLoader(draco).loadAsync('/models/' + (q.get('model') || 'SF50') + '.glb');
gltf.scene.rotation.y = Math.PI / 2; // glTF +Z nose -> model +x
const model = new THREE.Group(); model.add(gltf.scene); scene.add(model);
const N = {};
gltf.scene.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; if (o.name) N[o.name] = N[o.name] || o; });
// glTF meshes with several materials load as a Group of Meshes: the named node is the Group, its extras are in userData
const movers = {};
for (const [name, o] of Object.entries(N)) {
  const ex = o.userData || {};
  if (Array.isArray(ex.hinge_axis)) movers[name] = { o, axis: new THREE.Vector3(...ex.hinge_axis).normalize(), max: ex.max_deg || 0, rest: o.quaternion.clone() };
}
const pose = (name, frac) => { const m = movers[name]; if (!m) return; m.o.quaternion.copy(m.rest).multiply(new THREE.Quaternion().setFromAxisAngle(m.axis, THREE.MathUtils.degToRad(m.max * frac))); };
const state = {};
function apply(p) {
  const g = (k, d) => (p[k] != null ? +p[k] : d);
  const fl = g('flaps', 0), ail = g('ail', 0), pitch = g('pitch', 0), yaw = g('yaw', 0), gear = g('gear', 0);
  pose('Ctrl_Flap_L', fl); pose('Ctrl_Flap_R', fl);
  pose('Ctrl_Aileron_L', -ail); pose('Ctrl_Aileron_R', ail); // ail > 0 = roll right: left aileron up, right aileron down
  // ruddervator mixing: pitch > 0 = nose up (both trailing edges up = negative); yaw > 0 = nose right (left TE up, right TE down: V-tail differential)
  pose('Ctrl_Ruddervator_L', THREE.MathUtils.clamp(-pitch - yaw, -1, 1)); pose('Ctrl_Ruddervator_R', THREE.MathUtils.clamp(-pitch + yaw, -1, 1));
  pose('Gear_Nose', gear); pose('Gear_Main_L', gear); pose('Gear_Main_R', gear);
  pose('GearDoor_Nose_L', 1 - gear); pose('GearDoor_Nose_R', 1 - gear);
  pose('Door_Main', g('door', 0)); pose('Door_Baggage', g('bag', 0)); pose('Door_Exit', g('exit', 0));
  const night = !!+g('night', 0); sun.intensity = night ? 0.02 : 3; scene.environment = night ? null : dayEnv; renderer.setClearColor(night ? 0x05070c : 0x9fb7cc);
  camera.position.copy(p.cam ? new THREE.Vector3(...String(p.cam).split(',').map(Number)) : new THREE.Vector3(-8, 3.5, 8));
  camera.lookAt(p.look ? new THREE.Vector3(...String(p.look).split(',').map(Number)) : new THREE.Vector3(0, 1.3, 0)); camera.fov = g('fov', 40); camera.updateProjectionMatrix();
  const hide = p.hide ? new RegExp(p.hide, 'i') : null;
  gltf.scene.traverse((o) => { if (o.isMesh) o.visible = !(hide && (hide.test(o.name) || hide.test(o.parent && o.parent.name) || hide.test(o.material.name))); });
  sun.position.set(-15, 22, 13); Object.assign(state, p);
}
apply(Object.fromEntries(q));
const frame = () => renderer.render(scene, camera);
const box = new THREE.Box3().setFromObject(model);
window.__view = { THREE, scene, camera, renderer, model, nodes: N, movers,
  set: (p) => new Promise((res) => { apply(p); frame(); requestAnimationFrame(() => { frame(); requestAnimationFrame(() => { frame(); res(renderer.info.render.calls); }); }); }),
  bounds: () => ({ min: box.min.toArray(), max: box.max.toArray() }),
  parts: () => Object.keys(N), moverInfo: () => Object.fromEntries(Object.entries(movers).map(([k, m]) => [k, { axis: m.axis.toArray(), max: m.max }])),
  stats: () => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }) };
frame(); window.__viewReady = true;
