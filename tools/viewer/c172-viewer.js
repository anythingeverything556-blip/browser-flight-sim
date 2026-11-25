// Stand-alone Cessna 172 viewer for model checks (dev server: /tools/viewer/c172-viewer.html). No terrain or sky: the C172Visual on a grey ground,
// sun + sky light + room environment. Model frame: +x nose, +y up, +z right wing, metres, wheels on y = 0.
// URL: cam=x,y,z  look=x,y,z  fov=deg  de,da,dr=-1..1  flaps=deg  rpm  night=1  hide=regex (mesh/part names)  w,h
// window.__view: { visual, set(params) -> Promise after 2 frames, parts() }
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { C172Visual } from '../../src/c172visual.js';
import { C172_CG } from '../../src/c172.js';

const q = new URLSearchParams(location.search), num = (k, d) => (q.has(k) ? +q.get(k) : d), vec = (k, d) => (q.has(k) ? new THREE.Vector3(...q.get(k).split(',').map(Number)) : d);
const W = num('w', innerWidth), H = num('h', innerHeight);
const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setSize(W, H); renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(num('fov', 40), W / H, 0.02, 500);
const pm = new THREE.PMREMGenerator(renderer), dayEnv = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environment = dayEnv;
const sun = new THREE.DirectionalLight(0xfff4e6, 3); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 60 }); sun.shadow.bias = -0.0004;
scene.add(sun, sun.target, new THREE.HemisphereLight(0xcfe3ff, 0x6b6b60, 0.9));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x7a7a74, roughness: 0.95 })); ground.receiveShadow = true; scene.add(ground);
// raw=1: the GLB as exported (no merging), so hide= can pick single parts by name
let visual;
if (q.get('raw') === '1') {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js'), { DRACOLoader } = await import('three/examples/jsm/loaders/DRACOLoader.js');
  const g = await new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath('/draco/')).loadAsync('/models/C172.glb');
  g.scene.rotation.y = Math.PI / 2; const model = new THREE.Group(); model.add(g.scene); scene.add(model); // raw: model frame = world
  model.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
  visual = { model, update() {}, stats: {} };
} else { visual = new C172Visual(scene); await visual.load('/models/C172.glb'); }
// the model is drawn at fdm.pos - C172_CG, so with pos = CG the world coordinates are the model frame
const fdm = { pos: C172_CG.clone(), quat: new THREE.Quaternion(), vel: new THREE.Vector3(), w: new THREE.Vector3(), surf: { de: 0, da: 0, dr: 0 }, ctrl: { de: 0, da: 0, dr: 0 }, trim: 0,
  flaps: 0, flapCmd: 0, rpm: 0, out: { V: 0, rho: 1.225 }, wheel: [0, 0, 0], compress: [0, 0, 0], contacts: [1, 1, 1], onGround: true, crashed: null, engines: [{ dry: 0 }, { dry: 0 }], throttle: 0 };
const state = { view: 'orbit', env: { daylight: 1, elev: 0.6, sunDir: new THREE.Vector3(-0.5, 0.75, 0.43).normalize() } };
function apply(p) {
  const g = (k, d) => (p[k] != null ? +p[k] : d);
  fdm.surf.de = g('de', 0); fdm.surf.da = g('da', 0); fdm.surf.dr = g('dr', 0); fdm.flaps = g('flaps', 0); fdm.rpm = g('rpm', 0);
  const night = !!+g('night', 0); state.env.daylight = night ? 0 : 1; sun.intensity = night ? 0.02 : 3; scene.environment = night ? null : dayEnv; // the aircraft materials take their envMap from scene.environment (C172Visual.update)
  renderer.setClearColor(night ? 0x05070c : 0x9fb7cc); scene.children.forEach((o) => { if (o.isHemisphereLight) o.intensity = night ? 0.02 : 0.9; });
  camera.position.copy(p.cam ? new THREE.Vector3(...String(p.cam).split(',').map(Number)) : new THREE.Vector3(-9, 4, 9));
  camera.lookAt(p.look ? new THREE.Vector3(...String(p.look).split(',').map(Number)) : new THREE.Vector3(-2, 1.2, 0)); camera.fov = g('fov', 40); camera.updateProjectionMatrix();
  state.view = p.view || (camera.position.distanceTo(new THREE.Vector3(-1.15, 1.58, -0.29)) < 0.4 ? 'cockpit' : 'orbit');
  // clipz: cut-away at that span station (keeps z >= clipz), for wing and flap sections seen from the left
  renderer.clippingPlanes = p.clipz != null ? [new THREE.Plane(new THREE.Vector3(0, 0, 1), -Number(p.clipz))] : [];
  const hide = p.hide ? new RegExp(p.hide, 'i') : null;
  visual.model.traverse((o) => { if (o.isMesh && o.userData._hid != null) { o.visible = o.userData._hid; delete o.userData._hid; } if (hide && o.isMesh && (hide.test(o.name) || hide.test(o.material.name))) { o.userData._hid = o.visible; o.visible = false; } });
  sun.position.copy(state.env.sunDir).multiplyScalar(30); for (let i = 0; i < 3; i++) visual.update(0.016, fdm, new THREE.Vector3(), state.view, state.env, 0);
}
apply(Object.fromEntries(q));
const frame = () => { renderer.render(scene, camera); };
window.__view = { visual, THREE, scene, camera, renderer, fdm,
  set: (p) => new Promise((res) => { apply(p); frame(); requestAnimationFrame(() => { frame(); requestAnimationFrame(() => { frame(); res(renderer.info.render.calls); }); }); }),
  // names of the meshes under a pixel, nearest first (raw=1 gives the exported part names)
  pick: (x, y) => { const r = new THREE.Raycaster(); r.setFromCamera(new THREE.Vector2(x / W * 2 - 1, -(y / H) * 2 + 1), camera);
    return r.intersectObject(visual.model, true).filter((h) => h.object.visible).slice(0, 4).map((h) => `${h.object.name} [${h.object.material.name}] ${h.distance.toFixed(2)} m @ ${h.point.toArray().map((v) => v.toFixed(2)).join(',')}`); },
  parts: () => { const out = []; visual.model.traverse((o) => { if (o.isMesh) out.push(o.name); }); return out; } };
frame(); window.__viewReady = true;
