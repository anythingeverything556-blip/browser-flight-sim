import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { C172_CG, C172_GEAR } from './c172.js';
import { C172Gauges } from './c172gauges.js';
import { attitude } from './autopilot.js';
import { buildOverhead, buildControls, buildTailWheel, cabinMaterials, patchSurface, surfaceKind, CABIN_FILL, TW_RETRACT, THROTTLE_TRAVEL } from './c172cabin.js';

// Cessna 172SP visual: the owner's Blender model (public/models/C172.glb, exported with hinge-origin control surfaces, a Prop group and wheel
// groups), animated from the flight model. glTF frame: +y up, nose +z, left wing +x; the model frame here is the flight model's (+x nose,
// +z right wing), so the scene turns 90 degrees about y. The ~320 static meshes are merged per material, plain colours per finish as vertex
// colours; each merged mesh keeps
// its parts in userData.mergedParts so the crash code still breaks the airframe up along its length.
const D2R = Math.PI / 180;
// ground shadow silhouette: render layer (unused elsewhere, see layers.js), target size, half-width of the box around the CG (span 11 m, CG to tail ~6 m),
// sun-camera distance, and the height where the shadow has faded out
const SIL_LAYER = 4, SIL_SIZE = 512, SIL_R = 7, SIL_D = 30, SHADOW_FADE_END = 1500;
// flap track at 30 deg (glTF frame, aft = -z): the nose runs a short straight line aft and down from under the shroud (see WELLS); at 30 deg it
// is still 5 cm under the shroud's lip with a slot of ~4 cm (2 cm at 10 deg), measured along the whole span
const FLAP_AFT = 0.06, FLAP_DROP = 0.04;
// the stowed flap's and aileron's nose lie under the shroud / lip (see WELLS) and would z-fight with it: the part under it is pulled this
// far inside, easing to nothing just aft of it
const FLAP_INSET = 0.004;
// The exported wing is closed over the flaps and ailerons: a deflected surface left that fixed copy behind and looked like it floated off
// the aircraft. Each surface's well is cut out of the thin shells it lies in (cutWells) and closed with a cove wall across its front and a rib at
// each end; the flaps keep a lip of upper skin over their nose (the shroud they slide out from under).
// [surface, span axis, thickness axis, shroud length] in the glTF scene frame (span x, up y, nose +z)
const FLAP_SHROUD = 0.08, WELL_WALL = 0.004;
// the ailerons keep a short lip of upper skin over their nose (the hinge cove of the real wing): an open slot in front of them showed the
// dark well from above
const AILERON_LIP = 0.02;
const WELLS = [['Flap_L', 0, 1, FLAP_SHROUD], ['Flap_R', 0, 1, FLAP_SHROUD], ['Aileron_L', 0, 1, AILERON_LIP], ['Aileron_R', 0, 1, AILERON_LIP]];
// The exported hinges of the other surfaces are off their hinge lines: the ailerons' sits 12 cm behind the nose, the elevators' at the front of
// the tip horn 50 cm ahead of the elevator's leading edge, the rudder's is upright while its leading edge sweeps back 30 cm. Each of these turns
// about its leading edge instead, fitted from the surface itself (the horns, which stand off that line, left out): [surface, span axis]
const HINGED = [['Aileron_L', 0], ['Aileron_R', 0], ['Elevator_L', 0], ['Elevator_R', 0], ['Rudder', 1]];
const DE_UP = 25 * D2R, DE_DN = 21 * D2R, DA_MAX = 18 * D2R, DR_MAX = 18 * D2R; // match c172.js
const MOVING = ['Elevator_L', 'Elevator_R', 'Rudder', 'Prop', 'Aileron_L', 'Aileron_R', 'Flap_L', 'Flap_R', 'Tire_Main_L', 'Tire_Main_R', 'Tire_Nose', 'Yoke_Pilot', 'Yoke_Copilot',
  'NavLight_L', 'NavLight_R', 'Strobe_L', 'Strobe_R', 'BeaconDome', 'TailNavLight'];
// hinge axes in glTF coordinates (from the Blender hinge curves), pointing outboard-to-+x so a positive angle raises the trailing edge
const AXIS = {
  Aileron_L: new THREE.Vector3(1.85, 0.081, 0.238).normalize(), Aileron_R: new THREE.Vector3(1.85, -0.082, -0.238).normalize(),
  Flap_L: new THREE.Vector3(2.1, 0.072, 0.035).normalize(), Flap_R: new THREE.Vector3(2.1, -0.072, -0.035).normalize(),
};
const INTERIOR = /^(Seat|Belt|Cabin_Liner|Carpet|Floor|Headliner|Panel|InstrumentPanel|SubPanel|Gauge|Compass|Yoke|Pedal|Pedestal|Glareshield|Fuel|Park|Trim|Sun_Visor|Baggage|Overhead|Ctl_|Dome|Courtesy|Heater|Firewall|ToeBoard|Engine|Cylinder|CylFin|Crank|Oil)/;

const q = (v, step) => Math.round((v || 0) / step) * step;
// grouping key for a material that can become a vertex colour, else null
function vcKey(m, withKind = true) {
  if (!m.isMeshStandardMaterial || m.userData.noMerge || m.transparent || m.vertexColors || m.alphaTest > 0 || (m.emissive && m.emissive.getHex() !== 0)) return null;
  for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'clearcoatNormalMap', 'clearcoatMap', 'clearcoatRoughnessMap', 'specularIntensityMap', 'specularColorMap']) if (m[k]) return null;
  // a physical material with no clearcoat, sheen, transmission or iridescence looks the same as a standard one
  const phys = plainPhysical(m) ? '' : m.isMeshPhysicalMaterial ? `|cc${q(m.clearcoat, 0.2).toFixed(1)}/${q(m.clearcoatRoughness, 0.1).toFixed(1)}|ior${q(m.ior, 0.1).toFixed(1)}` : '';
  return `vc|${withKind ? surfaceKind(m.name) || '-' : ''}|${phys ? 'phys' : 'std'}|r${q(m.roughness, 0.1).toFixed(1)}|m${q(m.metalness, 0.25).toFixed(2)}|s${m.side}|f${m.flatShading ? 1 : 0}${phys}`;
}
const plainPhysical = (m) => m.isMeshPhysicalMaterial && (m.clearcoat || 0) < 0.05 && !(m.sheen > 0) && !(m.transmission > 0) && !(m.iridescence > 0);
// the shared material for a vertex-colour group: white base colour, the group's finish
function vcMaterial(m, n) {
  const out = plainPhysical(m) || !m.isMeshPhysicalMaterial
    ? new THREE.MeshStandardMaterial({ roughness: q(m.roughness, 0.1), metalness: q(m.metalness, 0.25), side: m.side, flatShading: m.flatShading, envMapIntensity: m.envMapIntensity ?? 1 })
    : m.clone();
  if (out !== m && out.isMeshPhysicalMaterial) { out.roughness = q(m.roughness, 0.1); out.metalness = q(m.metalness, 0.25); }
  out.color.setRGB(1, 1, 1); out.vertexColors = true; out.name = `vc_${n}_${m.name || 'mat'}`;
  return out;
}

// one geometry from a group's parts (each moved by its matrix); vertex-colour groups drop uv / tangents and carry the part's colour
function mergeParts(G) {
  const geos = G.parts.map((p) => {
    const c = p.geometry.clone(); c.applyMatrix4(p.matrix);
    if (G.vc) {
      for (const k of Object.keys(c.attributes)) if (k !== 'position' && k !== 'normal') c.deleteAttribute(k);
      const n = c.attributes.position.count, col = new Float32Array(n * 3), cc = p.material.color;
      for (let i = 0; i < n; i++) { col[i * 3] = cc.r; col[i * 3 + 1] = cc.g; col[i * 3 + 2] = cc.b; }
      c.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    return c;
  });
  const merged = mergeGeometries(geos, false);
  for (const c of geos) c.dispose();
  if (merged) { merged.computeBoundingBox(); merged.computeBoundingSphere(); }
  return merged;
}

// ---------- corrections to the exported model, applied at load (the .blend is no longer available) ----------
// Measured with the stand-alone viewer (tools/viewer/c172-viewer.html) and a connected-piece audit of every mesh; frame: +x nose, +y up, +z right.
// Paint decals are separate shells laid on the skin; after decimation the skin pokes through them (white speckles on the stripe, the N-number
// and the blue wingtips). Each is lifted off the skin along its outward normal, in layer order.
const DECAL_LIFT = [[/^Livery_Gold/, 0.004], [/^Livery_Blue/, 0.008], [/^Reg_Outline/, 0.011], [/^Reg_/, 0.013], [/^Blue_Wingtip/, 0.006], [/^WheelFairing_Stripe/, 0.005]];
// tail colour split: blue aft of this line in the side view (y = TAIL_Y0 + TAIL_K (x + 6.5)), fitted to the exported blue/white faces (98 % of
// the area agrees); drawn per pixel, so the edge is straight instead of following the decimated triangles (the saw-tooth edge on the fin)
const TAIL_Y0 = 1.485, TAIL_K = 5.5, TAIL_GOLD = 0.014;
// parts that sit on a moving surface but were exported as static: they stayed behind (in the air) when the surface moved
const ATTACH = [['ElevTrimTab', 'Elevator_R'], ['Rudder_TrimTab', 'Rudder']];
// ADF cut-out centre (model frame y, z) and the face radius that fills it
const ADF_AT = new THREE.Vector3(-0.2996, 1.1537, -0.1225), ADF_R = 0.0392;
const _c = new THREE.Vector3(), _v = new THREE.Vector3(), _q = new THREE.Quaternion();

function modelMatrix(o, modelInv) { return new THREE.Matrix4().multiplyMatrices(modelInv, o.matrixWorld); }
// connected pieces of a mesh (vertices welded by position), each with its model-frame box; keep(box) false drops the piece's triangles
function dropPieces(o, modelInv, drop) {
  const g = o.geometry, pos = g.attributes.position, M = modelMatrix(o, modelInv), v = new THREE.Vector3(), n = pos.count;
  if (!g.index) return 0;
  const idx = g.index.array, wid = new Map(), id = new Int32Array(n);
  for (let i = 0; i < n; i++) { const k = `${Math.round(pos.getX(i) * 2000)},${Math.round(pos.getY(i) * 2000)},${Math.round(pos.getZ(i) * 2000)}`; if (!wid.has(k)) wid.set(k, wid.size); id[i] = wid.get(k); }
  const par = new Int32Array(wid.size).map((_, i) => i), find = (a) => { while (par[a] !== a) a = par[a] = par[par[a]]; return a; };
  for (let k = 0; k < idx.length; k += 3) { const a = find(id[idx[k]]); par[find(id[idx[k + 1]])] = a; par[find(id[idx[k + 2]])] = a; }
  const boxes = new Map();
  for (let i = 0; i < n; i++) { const r = find(id[i]); if (!boxes.has(r)) boxes.set(r, new THREE.Box3()); boxes.get(r).expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(M)); }
  const gone = new Set([...boxes].filter(([, b]) => drop(b)).map(([r]) => r));
  if (!gone.size) return 0;
  const keep = []; for (let k = 0; k < idx.length; k += 3) if (!gone.has(find(id[idx[k]]))) keep.push(idx[k], idx[k + 1], idx[k + 2]);
  g.setIndex(keep); return gone.size;
}
function liftDecal(o, modelInv, lift) {
  const g = o.geometry, pos = g.attributes.position, nrm = g.attributes.normal; if (!nrm) return;
  const M = modelMatrix(o, modelInv), Mi = M.clone().invert(), N = new THREE.Matrix3().getNormalMatrix(M), v = new THREE.Vector3(), n = new THREE.Vector3();
  // outward: up for the wingtip tops, away from the centre line for the fuselage and wheel-fairing sides (one fairing stripe has its normals flipped)
  const box = new THREE.Box3().setFromBufferAttribute(pos).applyMatrix4(M), out = /Wingtip/.test(o.name) ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, Math.sign(box.getCenter(v).z) || 1);
  for (let i = 0; i < pos.count; i++) {
    n.fromBufferAttribute(nrm, i).applyMatrix3(N).normalize(); if (n.dot(out) < 0) n.negate();
    v.fromBufferAttribute(pos, i).applyMatrix4(M).addScaledVector(n, lift).applyMatrix4(Mi); pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true; g.computeBoundingBox(); g.computeBoundingSphere();
}
function tailMaterial(white, blue, gold) {
  const m = white.clone(); m.name = 'Paint_Tail'; m.userData.noMerge = true;
  const c = (x) => `vec3(${x.r.toFixed(4)}, ${x.g.toFixed(4)}, ${x.b.toFixed(4)})`;
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 tailPos;\nvarying vec3 vTailPos;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvTailPos = tailPos;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vTailPos;').replace('#include <color_fragment>', `#include <color_fragment>
      float tailD = (vTailPos.y - ${TAIL_Y0.toFixed(4)} - ${TAIL_K.toFixed(4)} * (vTailPos.x + 6.5)) / ${Math.hypot(1, TAIL_K).toFixed(5)};
      float tailAA = max(fwidth(tailD), 1e-4);
      vec3 tailC = mix(${c(white.color)}, ${c(gold.color)}, smoothstep(-tailAA, tailAA, tailD + ${TAIL_GOLD.toFixed(4)}));
      diffuseColor.rgb = mix(tailC, ${c(blue.color)}, smoothstep(-tailAA, tailAA, tailD));`);
  };
  m.customProgramCacheKey = () => 'c172-tail';
  return m;
}
// all of the above on the loaded glTF scene (model frame = modelInv * world); returns what was changed, for the log and the tests
function fixModel(scene, modelInv) {
  const report = { dropped: [], lifted: [], attached: [], tail: 0 }, byName = (n) => scene.getObjectByName(n);
  scene.updateMatrixWorld(true);
  // a windscreen frame ring exported upright 0.2-0.5 m behind the raked windscreen: it crossed the pilot's view as a diagonal bar (the windscreen
  // has its own gasket, Gasket_WS)
  for (const n of ['Window_Frames_1', 'Window_Frames_2']) { const o = byName(n); if (o && o.isMesh) { const k = dropPieces(o, modelInv, (b) => b.min.x > -0.95 && b.max.x < -0.6 && b.max.z - b.min.z > 1.0); if (k) report.dropped.push(`${n} x${k}`); } }
  // ADF: its face sat 1.8 cm high and 2.5 mm right of the round cut-out (the grey cover disc Panel_Details_21) and 4 mm too small for it;
  // centred and scaled onto the cut-out (centres measured from the vertices)
  { const o = byName('Gauge_ADF'); if (o && o.isMesh) {
    const to = new THREE.Matrix4().copy(modelInv).multiply(o.matrixWorld), from = to.clone().invert();
    const k = ADF_R / 0.036, M = new THREE.Matrix4().makeTranslation(0, ADF_AT.y, ADF_AT.z).multiply(new THREE.Matrix4().makeScale(1, k, k)).multiply(new THREE.Matrix4().makeTranslation(0, -1.17, 0.12));
    o.geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(from, M).multiply(to)); o.geometry.computeBoundingSphere(); report.moved = ['Gauge_ADF'];
  } }
  // the throttle and mixture knobs are rebuilt as moving parts (c172cabin.js); the old overhead console (a flat black slab) is replaced
  { const near = (y, z) => (b) => Math.abs(b.getCenter(_c).y - y) < 0.01 && Math.abs(_c.z - z) < 0.01;
    const a = byName('Panel_Details_15'), r = byName('Panel_Details_16');
    if (a && a.isMesh && dropPieces(a, modelInv, near(1.057, 0.047))) report.dropped.push('throttle knob');
    if (r && r.isMesh && dropPieces(r, modelInv, near(1.030, 0.120))) report.dropped.push('mixture knob');
    for (let i = 1; i <= 4; i++) { const o = byName(`Overhead_Console_${i}`); if (o) { o.parent.remove(o); report.dropped.push(o.name); } }
    const oc = byName('Overhead_Console'); if (oc && !oc.children.length && oc.parent) oc.parent.remove(oc);
  }
  scene.traverse((o) => { if (!o.isMesh) return; const d = DECAL_LIFT.find(([re]) => re.test(o.name)); if (d) { liftDecal(o, modelInv, d[1]); report.lifted.push(o.name); } });
  for (const [c, p] of ATTACH) { const a = byName(c), b = byName(p); if (a && b) { b.attach(a); report.attached.push(`${c}>${p}`); } }
  // static wicks on the aileron trailing edges go with the ailerons
  for (const side of ['L', 'R']) for (let i = 0; i < 6; i++) {
    const w = byName(`Wick_${side}_${i}`), ail = byName(`Aileron_${side}`); if (!w || !ail) continue;
    const z = Math.abs(new THREE.Box3().setFromObject(w).getCenter(new THREE.Vector3()).applyMatrix4(modelInv).z);
    if (z > 3.15 && z < 5.0) { ail.attach(w); report.attached.push(`${w.name}>${ail.name}`); }
  }
  // tail: one material, colour split per pixel by the model-frame rest position of each vertex
  const parts = ['Fin_new', 'Fin_new_1', 'Rudder001', 'Rudder001_1'].map(byName).filter((o) => o && o.isMesh), mats = {};
  scene.traverse((o) => { if (o.isMesh && /^Paint_(White|Blue|Gold)$/.test(o.material.name)) mats[o.material.name] = o.material; });
  if (parts.length && mats.Paint_White && mats.Paint_Blue && mats.Paint_Gold) {
    const tm = tailMaterial(mats.Paint_White, mats.Paint_Blue, mats.Paint_Gold);
    for (const o of parts) {
      const g = o.geometry; for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
      const M = modelMatrix(o, modelInv), p = g.attributes.position, t = new Float32Array(p.count * 3), v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(M); t.set([v.x, v.y, v.z], i * 3); }
      g.setAttribute('tailPos', new THREE.BufferAttribute(t, 3)); o.material = tm; report.tail++;
    }
  }
  scene.updateMatrixWorld(true);
  return report;
}

// connected pieces of an indexed mesh: root(vertex) and the model-frame box of each root
function meshPieces(o, modelInv) {
  const g = o.geometry, pos = g.attributes.position, idx = g.index.array, n = pos.count, wid = new Map(), id = new Int32Array(n), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) { const k = `${Math.round(pos.getX(i) * 2000)},${Math.round(pos.getY(i) * 2000)},${Math.round(pos.getZ(i) * 2000)}`; if (!wid.has(k)) wid.set(k, wid.size); id[i] = wid.get(k); }
  const par = new Int32Array(wid.size).map((_, i) => i), find = (a) => { while (par[a] !== a) a = par[a] = par[par[a]]; return a; };
  for (let k = 0; k < idx.length; k += 3) { const a = find(id[idx[k]]); par[find(id[idx[k + 1]])] = a; par[find(id[idx[k + 2]])] = a; }
  const M = new THREE.Matrix4().multiplyMatrices(modelInv, o.matrixWorld), box = new Map();
  for (let i = 0; i < n; i++) { const r = find(id[i]); if (!box.has(r)) box.set(r, new THREE.Box3()); box.get(r).expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(M)); }
  return { root: (vi) => find(id[vi]), box };
}
// a flat bar of height h and thickness t along a path in the x-y plane at span z (model frame)
function ribbon(path, z, h, t) {
  const P = [], quad = (a, b, c, d) => P.push(...a, ...b, ...c, ...a, ...c, ...d);
  const off = path.map((p, i) => { const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)], tx = b.x - a.x, ty = b.y - a.y, l = Math.hypot(tx, ty) || 1; return [-ty / l, tx / l]; });
  for (let i = 0; i + 1 < path.length; i++) {
    const v = (j, s, w) => [path[j].x + off[j][0] * s * h / 2 - 0.004 * 0, path[j].y + off[j][1] * s * h / 2 - h * 0.35, z + w * t / 2];
    quad(v(i, 1, 1), v(i + 1, 1, 1), v(i + 1, -1, 1), v(i, -1, 1)); quad(v(i, -1, -1), v(i + 1, -1, -1), v(i + 1, 1, -1), v(i, 1, -1));
    quad(v(i, 1, -1), v(i + 1, 1, -1), v(i + 1, 1, 1), v(i, 1, 1)); quad(v(i, -1, 1), v(i + 1, -1, 1), v(i + 1, -1, -1), v(i, -1, -1));
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.computeVertexNormals(); return g;
}

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// a surface's leading edge as a hinge line: the forward-most point of each span slice (glTF scene frame: nose +z), the line through the most
// slices within 2 cm of it (a horn balance stands off it and is left out), refined by least squares; returned in the surface's own frame,
// the point mid-span at the nose's mid-thickness
function hingeOf(node, others, spanAx, scene) {
  node.updateMatrixWorld(true);
  const sInv = new THREE.Matrix4().copy(scene.matrixWorld).invert(), m = new THREE.Matrix4(), pts = [];
  const walk = (o) => { if (others.has(o)) return; if (o.isMesh && o.geometry.attributes.position) { m.multiplyMatrices(sInv, o.matrixWorld); const p = o.geometry.attributes.position; for (let i = 0; i < p.count; i++) pts.push(new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(m)); } for (const c of o.children) walk(c); };
  walk(node);
  if (pts.length < 8) return null;
  const thickAx = spanAx === 0 ? 1 : 0, sp = (p) => p.getComponent(spanAx), th = (p) => p.getComponent(thickAx);
  const S = pts.map(sp), s0 = Math.min(...S), s1 = Math.max(...S), K = 24, sl = [];
  // a coarse mesh has its vertices at a few span stations: a slice with only a stray interior point or two is not an edge sample
  for (let k = 0; k < K; k++) { const a = s0 + (s1 - s0) * k / K, b = s0 + (s1 - s0) * (k + 1) / K, q = pts.filter((p) => sp(p) >= a && sp(p) <= b);
    if (q.length >= 3) { const f = q.reduce((x, y) => (y.z > x.z ? y : x)).clone(); f.w = q.length; sl.push(f); } }
  if (sl.length < 3) return null;
  let best = null, bestW = 0;
  for (let i = 0; i < sl.length; i++) for (let j = i + 1; j < sl.length; j++) {
    const ds = sp(sl[j]) - sp(sl[i]); if (Math.abs(ds) < 1e-6) continue; const k = (sl[j].z - sl[i].z) / ds;
    // most slices on the line; their vertex count breaks ties
    const inl = sl.filter((p) => Math.abs(p.z - (sl[i].z + k * (sp(p) - sp(sl[i])))) < 0.02), w = inl.length * 1e6 + inl.reduce((a, p) => a + p.w, 0);
    if (w > bestW) { best = inl; bestW = w; } }
  const n = best.length, ms = best.reduce((a, p) => a + sp(p), 0) / n, mz = best.reduce((a, p) => a + p.z, 0) / n, mt = best.reduce((a, p) => a + th(p), 0) / n;
  let sss = 0, ssz = 0, sst = 0; for (const p of best) { const ds = sp(p) - ms; sss += ds * ds; ssz += ds * (p.z - mz); sst += ds * (th(p) - mt); }
  const axis = new THREE.Vector3(); axis.setComponent(spanAx, 1); axis.setComponent(thickAx, sss ? sst / sss : 0); axis.z = sss ? ssz / sss : 0; axis.normalize();
  const point = new THREE.Vector3(); point.setComponent(spanAx, ms); point.setComponent(thickAx, mt); point.z = mz;
  // into the surface's frame
  const toNode = new THREE.Matrix4().copy(node.matrixWorld).invert().multiply(scene.matrixWorld);
  return { axis: axis.transformDirection(toNode), point: point.applyMatrix4(toNode), slices: n };
}

// a moving surface's front edge as a function of span: the forward-most point of each span station (vertices within 5 mm of one span
// position) that covers most of the chord, joined by straight lines (stations with only a few trailing-edge vertices are skipped). Follows
// an aileron's horn balance, which stands well ahead of the rest of its front edge. pts: [span, nose-ward] pairs
function noseLine(pts) {
  const st = new Map(); for (const [s, z] of pts) { const k = Math.round(s / 0.005), e = st.get(k); if (!e) st.set(k, { s, lo: z, hi: z }); else { e.lo = Math.min(e.lo, z); e.hi = Math.max(e.hi, z); } }
  const all = [...st.values()], chord = Math.max(...all.map((e) => e.hi)) - Math.min(...all.map((e) => e.lo));
  const ok = all.filter((e) => e.hi - e.lo > 0.5 * chord).sort((a, b) => a.s - b.s);
  const use = ok.length ? ok : all.sort((a, b) => a.s - b.s);
  return (s) => { if (s <= use[0].s) return use[0].hi; for (let i = 1; i < use.length; i++) if (s <= use[i].s) { const a = use[i - 1], b = use[i]; return a.hi + (b.hi - a.hi) * (s - a.s) / Math.max(1e-6, b.s - a.s); } return use[use.length - 1].hi; };
}

// a surface's well in the scene frame: its span, thickness band and nose line (forward-most points near each end, joined)
function wellOf(node, others, sInv, spanAx, thickAx, shroud) {
  const pts = [], m = new THREE.Matrix4(), v = new THREE.Vector3();
  const walk = (o) => { if (others.has(o)) return; if (o.isMesh && o.geometry.attributes.position) { m.multiplyMatrices(sInv, o.matrixWorld); const p = o.geometry.attributes.position; for (let i = 0; i < p.count; i++) pts.push(v.fromBufferAttribute(p, i).applyMatrix4(m).toArray()); } for (const c of o.children) walk(c); };
  walk(node);
  if (pts.length < 8) return null;
  const S = pts.map((p) => p[spanAx]), T = pts.map((p) => p[thickAx]), s0 = Math.min(...S), s1 = Math.max(...S);
  // the nose line follows the surface's own front edge (a straight line between the two ends left open, dark wedges in the wing in front of
  // an aileron's horn)
  const le = noseLine(pts.map((p) => [p[spanAx], p[2]]));
  const w = { spanAx, thickAx, shroud, s0, s1, t0: Math.min(...T) - 0.03, t1: Math.max(...T) + 0.03, le };
  w.wall = (s) => w.le(s) + WELL_WALL;
  w.cut = (s, upper) => (upper && shroud > 0 ? w.le(s) - shroud : w.wall(s));
  w.cMax = Math.max(...pts.map((p) => p[2])) + WELL_WALL + 0.001;
  return w;
}
// removes the parts of a shell's triangles that lie in any of the wells (upper skin aft of the shroud, the rest aft of the cove wall);
// triangles are clipped exactly along the well's edges, every attribute interpolated
function cutShell(geo, toScene, wells) {
  const g = geo.index ? geo.toNonIndexed() : geo, names = Object.keys(g.attributes), attrs = names.map((n) => g.attributes[n]), P = g.attributes.position;
  const out = names.map(() => []), A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  const vert = (i) => ({ p: A.fromBufferAttribute(P, i).applyMatrix4(toScene).toArray(), a: attrs.map((at) => { const r = []; for (let k = 0; k < at.itemSize; k++) r.push(at.getComponent(i, k)); return r; }) });
  const lerp = (x, y, f) => ({ p: x.p.map((q, k) => q + (y.p[k] - q) * f), a: x.a.map((r, j) => r.map((q, k) => q + (y.a[j][k] - q) * f)) });
  const clip = (poly, fn, pos) => { const res = []; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length], da = fn(a), db = fn(b);
    if (pos ? da >= 0 : da <= 0) res.push(a); if ((da > 0 && db < 0) || (da < 0 && db > 0)) res.push(lerp(a, b, da / (da - db))); } return res; };
  const splitBy = (polys, fn) => polys.flatMap((pl) => { const d = pl.map(fn); if (d.every((x) => x >= 0) || d.every((x) => x <= 0)) return [pl]; return [clip(pl, fn, true), clip(pl, fn, false)].filter((q) => q.length >= 3); });
  let removed = 0;
  for (let i = 0; i < P.count; i += 3) {
    let polys = [[vert(i), vert(i + 1), vert(i + 2)]];
    const tri = polys[0];
    A.fromArray(tri[0].p); B.fromArray(tri[1].p).sub(A); C.fromArray(tri[2].p).sub(A); const nrm = B.cross(C);
    for (const w of wells) {
      const S = tri.map((q) => q.p[w.spanAx]), T = tri.map((q) => q.p[w.thickAx]), Z = tri.map((q) => q.p[2]);
      if (Math.max(...S) <= w.s0 || Math.min(...S) >= w.s1 || Math.max(...T) <= w.t0 || Math.min(...T) >= w.t1 || Math.min(...Z) >= w.cMax) continue;
      const upper = nrm.getComponent(w.thickAx) > 0;
      polys = splitBy(polys, (q) => q.p[w.spanAx] - w.s0); polys = splitBy(polys, (q) => q.p[w.spanAx] - w.s1);
      polys = splitBy(polys, (q) => q.p[2] - w.cut(q.p[w.spanAx], upper));
      polys = polys.filter((pl) => { const c = [0, 1, 2].map((k) => pl.reduce((a, q) => a + q.p[k], 0) / pl.length);
        const inside = c[w.spanAx] > w.s0 && c[w.spanAx] < w.s1 && c[w.thickAx] > w.t0 && c[w.thickAx] < w.t1 && c[2] < w.cut(c[w.spanAx], upper);
        if (inside) removed++; return !inside; });
    }
    for (const pl of polys) for (let k = 1; k + 1 < pl.length; k++) for (const q of [pl[0], pl[k], pl[k + 1]]) q.a.forEach((r, j) => out[j].push(...r));
  }
  if (!removed) return null;
  const res = new THREE.BufferGeometry();
  names.forEach((n, j) => res.setAttribute(n, new THREE.Float32BufferAttribute(out[j], attrs[j].itemSize)));
  return { geometry: res, removed };
}
// the closing pieces of a well (scene frame): cove wall across the front, the shroud's underside, a rib at each end; cast(s, c) gives the
// fixed shell's two skins there (thickness coordinates), before the cut
function wellCove(w, cast, attrNames) {
  const pos = [], nor = [], at = (s, t, c) => { const p = [0, 0, 0]; p[w.spanAx] = s; p[w.thickAx] = t; p[2] = c; return p; };
  const quad = (a, b, c, d, n) => { for (const tri of [[a, b, c], [a, c, d]]) {
    const u = new THREE.Vector3(...tri[1]).sub(new THREE.Vector3(...tri[0])), v = new THREE.Vector3(...tri[2]).sub(new THREE.Vector3(...tri[0]));
    const t = u.cross(v).dot(new THREE.Vector3(...n)) < 0 ? [tri[0], tri[2], tri[1]] : tri; for (const p of t) { pos.push(...p); nor.push(...n); } } };
  const sN = Math.max(2, Math.ceil((w.s1 - w.s0) / 0.04)), ss = Array.from({ length: sN + 1 }, (_, i) => w.s0 + (w.s1 - w.s0) * i / sN);
  const sp = [0, 0, 0], th = [0, 0, 0]; th[w.thickAx] = 1;
  // cove wall, facing aft
  const wall = ss.map((s) => ({ s, c: w.wall(s), h: cast(s, w.wall(s)) }));
  for (let i = 0; i < sN; i++) { const a = wall[i], b = wall[i + 1]; if (!a.h || !b.h) continue;
    quad(at(a.s, a.h[0], a.c), at(a.s, a.h[1], a.c), at(b.s, b.h[1], b.c), at(b.s, b.h[0], b.c), [0, 0, -1]); }
  // the shroud's underside, seen from below through the open cove
  if (w.shroud > 0) for (let i = 0; i < sN; i++) for (let k = 0; k < 3; k++) {
    const f0 = k / 3, f1 = (k + 1) / 3, c = (s, f) => w.wall(s) - (w.shroud + WELL_WALL) * f, s0 = ss[i], s1 = ss[i + 1];
    const h = [[s0, f0], [s0, f1], [s1, f1], [s1, f0]].map(([s, f]) => { const r = cast(s, c(s, f)); return r && at(s, r[1] - 0.002, c(s, f)); });
    if (h.every(Boolean)) quad(h[0], h[1], h[2], h[3], th.map((x) => -x));
  }
  // end ribs, facing into the well
  for (const [s, dir] of [[w.s0, 1], [w.s1, -1]]) {
    const n = [0, 0, 0]; n[w.spanAx] = dir; let prev = null;
    for (let c = w.wall(s); c > w.le(s) - 1.6; c -= 0.015) { const h = cast(s, c); if (!h || h[1] - h[0] < 0.002) break; const cur = { c, h };
      if (prev) quad(at(s, prev.h[0], prev.c), at(s, prev.h[1], prev.c), at(s, cur.h[1], cur.c), at(s, cur.h[0], cur.c), n); prev = cur; }
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  for (const [n, size] of attrNames) if (n !== 'position' && n !== 'normal') g.setAttribute(n, new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3 * size), size));
  return g;
}

// propeller: below this sweep per frame (rad, ~70 rpm at 60 fps) the modelled blades are drawn; above it the smeared-blade disc
const PROP_SMEAR_SOLID = 0.12, PROP_BINS = 24;
// The blur disc's blade shape is measured from the blade meshes (half-width in angle at each radius, in the disc plane), so the drawn blades
// match the modelled ones when it takes over from them, and the tip paint smears into a ring the width of the painted tips.
function buildPropDisc(prop, blades) {
  const parent = prop.parent; parent.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(parent.matrixWorld).invert(), m = new THREE.Matrix4(), v = new THREE.Vector3(), c = prop.position;
  const pts = []; let R = 0, theta0 = 0, tipR = Infinity, bladeCol = null, tipCol = null;
  for (const b of blades) {
    m.multiplyMatrices(inv, b.matrixWorld); const pos = b.geometry.attributes.position, tip = /PropTip/.test(b.name);
    const col = b.material && b.material.color && !b.material.vertexColors ? b.material.color : null;
    if (col && tip) tipCol = col.clone(); else if (col && /PropBlade/.test(b.name)) bladeCol = col.clone();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m).sub(c);
      const r = Math.hypot(v.x, v.y), th = Math.atan2(v.y, v.x); pts.push(r, th);
      if (r > R) { R = r; theta0 = th; }
      if (tip) tipR = Math.min(tipR, r);
    }
  }
  if (!R) R = 0.96;
  const hw = new Array(PROP_BINS).fill(-1);
  for (let i = 0; i < pts.length; i += 2) {
    let d = (pts[i + 1] - theta0) % Math.PI; if (d < -Math.PI / 2) d += Math.PI; else if (d >= Math.PI / 2) d -= Math.PI;
    const k = Math.min(PROP_BINS - 1, Math.floor(pts[i] / R * PROP_BINS)); hw[k] = Math.max(hw[k], Math.abs(d));
  }
  // bins the mesh's few radial rings skip are filled in between their neighbours; inside the root (hub, spinner) nothing is drawn
  // inside the spinner the shank and hub fittings spread round the whole hub: no blade is drawn there; elsewhere at most ~20 deg either side
  for (let i = 0; i < PROP_BINS; i++) hw[i] = (i + 1) / PROP_BINS < 0.2 ? 0 : Math.min(hw[i], 0.35);
  const known = hw.map((h, i) => (h >= 0 ? i : -1)).filter((i) => i >= 0);
  for (let i = 0; i < PROP_BINS; i++) if (hw[i] < 0) {
    const lo = known.filter((k) => k < i).pop(), hi = known.find((k) => k > i);
    hw[i] = lo == null || hi == null ? (lo == null ? 0 : hw[lo]) : hw[lo] + (hw[hi] - hw[lo]) * (i - lo) / (hi - lo);
  }
  const disc = new THREE.Mesh(new THREE.CircleGeometry(R * 1.01, 96), new THREE.ShaderMaterial({
    uniforms: {
      uAng: { value: theta0 }, uSmear: { value: 1e-3 }, uOpacity: { value: 0.95 }, uLight: { value: 1 }, uR: { value: R }, uTipR: { value: Number.isFinite(tipR) ? tipR : R * 0.93 },
      uHw: { value: hw }, uBlade: { value: bladeCol || new THREE.Color(0x1b1b1d) }, uTip: { value: tipCol || new THREE.Color(0x9c9c9c) },
    },
    vertexShader: `#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vP;
void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
#include <logdepthbuf_vertex>
}`,
    fragmentShader: `#include <common>
#include <logdepthbuf_pars_fragment>
uniform float uAng, uSmear, uOpacity, uLight, uR, uTipR; uniform float uHw[${PROP_BINS}]; uniform vec3 uBlade, uTip; varying vec2 vP;
float halfWidth(float r) {
  float f = clamp(r / uR, 0.0, 1.0) * float(${PROP_BINS}) - 0.5; int i = int(clamp(floor(f), 0.0, float(${PROP_BINS - 1}))); int j = min(i + 1, ${PROP_BINS - 1});
  return mix(uHw[i], uHw[j], clamp(f - float(i), 0.0, 1.0));
}
void main() {
#include <logdepthbuf_fragment>
  float r = length(vP); if (r > uR) discard;
  float hw = halfWidth(r); if (hw <= 0.0) discard;
  // each blade sat at uAng + x over the frame, x in [0, uSmear] (it turns towards smaller angles): the fraction of the frame this point was covered
  float d = mod(atan(vP.y, vP.x) - uAng, PI), s = uSmear, cov = 0.0;
  for (int k = -1; k <= 1; k++) { float x = d + float(k) * PI; cov += max(0.0, min(x + hw, s) - max(x - hw, 0.0)); }
  cov = clamp(cov / s, 0.0, 1.0);
  // fine radial streaks once the blades are a blur, and a soft rim
  cov *= mix(1.0, 0.9 + 0.1 * sin(atan(vP.y, vP.x) * 70.0 + r * 9.0), smoothstep(0.6, 2.0, s)) * smoothstep(uR, uR * 0.985, r);
  float a = cov * uOpacity; if (a < 0.003) discard;
  vec3 col = mix(uBlade, uTip, smoothstep(uTipR - 0.01, uTipR + 0.01, r)) * uLight;
  gl_FragColor = vec4(col, a);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  }));
  disc.userData.theta0 = theta0;
  disc.position.copy(prop.position).add(new THREE.Vector3(0, 0, -0.04)); disc.renderOrder = 3; disc.visible = false;
  parent.add(disc);
  return disc;
}

export class C172Visual {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group(); scene.add(this.root);
    this.time = 0; this.glassWater = null; this.real = null; this.cockpit = []; this.gearGroup = null; this.engines = undefined;
    this.lateReady = Promise.resolve([]); this.casters = []; this.castsWorldShadow = false; this.nodes = {}; // the ground shadow is its own silhouette (buildShadow), not a cascade caster
    this.rainEff = 0; this.rainGround = 0;
  }
  cockpitTextures() { return []; }
  registerOccluders() { return 0; }
  attachSelfShadow() { return false; }
  event() {}

  async load(url, onProgress) {
    const draco = new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
    let gltf;
    try { gltf = await new GLTFLoader().setDRACOLoader(draco).loadAsync(url, (e) => e.total && onProgress && onProgress(e.loaded / e.total)); } finally { draco.dispose(); }
    const scene = gltf.scene;
    scene.rotation.y = Math.PI / 2;
    const model = this.model = new THREE.Group(); model.name = 'C172'; model.add(scene);
    model.position.copy(C172_CG).negate();
    this.root.add(model);
    model.updateMatrixWorld(true);
    this.fixes = fixModel(scene, new THREE.Matrix4().copy(model.matrixWorld).invert());
    // instrument and flood-light lenses get their own glowing materials (kept out of the colour merge so nothing else glows with them)
    this.dialMats = new Set(); const lamp = new Map();
    scene.traverse((o) => {
      if (!o.isMesh) return; const m = o.material;
      if (/^Face_g_/.test(m.name) && m.map) { m.emissive = new THREE.Color(0xfff2e0); m.emissiveMap = m.map; m.emissiveIntensity = 0; this.dialMats.add(m); }
      if (/^(Overhead_Console_4|Dome_Lights_2)$/.test(o.name)) { if (!lamp.has(m)) { const c = m.clone(); c.emissive = new THREE.Color(0xfff0d8); c.emissiveIntensity = 0; c.userData.noMerge = true; lamp.set(m, c); } o.material = lamp.get(m); }
    });
    this.lampMats = [...lamp.values()];
    const casterMat = this.casterMat = new THREE.MeshBasicMaterial({ colorWrite: false });
    const fix = (m) => {
      // no transmission pass (a second full scene render), no sheen / anisotropy lobes: glass is plain transparency
      if (m.transmission > 0) { m.transmission = 0; m.transparent = true; m.opacity = Math.min(m.opacity, 0.3); m.depthWrite = false; m.roughness = 0.05; m.metalness = 0; }
      if ('sheen' in m) m.sheen = 0;
      if ('anisotropy' in m) m.anisotropy = 0;
      if (/glass/i.test(m.name) && !m.transparent) { m.transparent = true; m.opacity = 0.3; m.depthWrite = false; }
      return m;
    };
    for (const n of MOVING) { const o = scene.getObjectByName(n); if (o) this.nodes[n] = o; }
    this.addExtras(scene, new THREE.Matrix4().copy(model.matrixWorld).invert());
    this.lampMats.push(this.cabinMats.lens);
    const moving = new Set(); for (const o of Object.values(this.nodes)) o.traverse((c) => moving.add(c));
    this.wellStats = this.cutWells(scene, moving);
    // merge the static meshes per material and attribute layout
    const groups = new Map(), modelInv = new THREE.Matrix4().copy(model.matrixWorld).invert();
    scene.traverse((o) => {
      if (!o.isMesh || moving.has(o)) return;
      fix(o.material);
      const g = o.geometry, vc = vcKey(o.material), interior = INTERIOR.test(o.name);
      // plain opaque colours share one vertex-coloured material per finish (roughness / metalness / clearcoat); textured, transparent and
      // emissive materials keep their own
      const key = vc ? `${vc}|${interior ? 'in' : 'out'}|${g.index ? 'i' : 'n'}` : o.material.uuid + '|' + Object.keys(g.attributes).sort().join(',') + '|' + (g.index ? 'i' : 'n');
      const m = new THREE.Matrix4().multiplyMatrices(modelInv, o.matrixWorld);
      if (!groups.has(key)) groups.set(key, { material: o.material, parts: [], interior: true, vc: !!vc });
      const G = groups.get(key); G.parts.push({ geometry: g, matrix: m, name: o.name, material: o.material });
      if (!interior) G.interior = false;
    });
    for (const o of [...scene.children]) if (!moving.has(o) && !o.isMesh) { /* keep empties that hold moving parts */ }
    const remove = []; scene.traverse((o) => { if (o.isMesh && !moving.has(o)) remove.push(o); });
    for (const o of remove) o.parent.remove(o);
    for (const G of groups.values()) {
      const merged = mergeParts(G); if (!merged) continue;
      let mat = G.material;
      if (G.vc) mat = vcMaterial(G.material, G.parts.length);
      const mesh = new THREE.Mesh(merged, mat); mesh.name = 'merged_' + (mat.name || 'mat'); mesh.userData.interior = G.interior; mesh.userData.staticModel = true;
      mesh.userData.mergedParts = G.parts.map((p) => ({ geometry: p.geometry, material: p.material, matrix: p.matrix }));
      mesh.castShadow = !G.material.transparent; mesh.receiveShadow = true;
      if (!G.interior && !G.material.transparent) { mesh.userData.casterMat = casterMat; this.casters.push(mesh); }
      model.add(mesh);
    }
    this.mergeMoving(fix);
    const movingNow = new Set(); for (const o of Object.values(this.nodes)) o.traverse((c) => movingNow.add(c));
    for (const o of movingNow) if (o.isMesh) {
      fix(o.material); o.castShadow = !o.material.transparent; o.receiveShadow = true;
      if (!/Yoke/.test(o.name)) { o.userData.casterMat = casterMat; this.casters.push(o); }
    }
    this.setupMoving();
    this.buildFittings();
    // surface detail and the cabin fill on every opaque material (shared materials are patched once)
    model.traverse((o) => {
      if (!o.isMesh || !o.material || o.material.transparent || /Lamp|Lens|Face_g_|Gauge/.test(o.material.name)) return;
      const src = (o.userData.mergedParts && o.userData.mergedParts[0] && o.userData.mergedParts[0].material) || o.material;
      let interior = o.userData.interior; if (interior == null) { let p = o; while (p && interior == null) { if (p.userData.nodeName) interior = INTERIOR.test(p.userData.nodeName) || /^PedalSet/.test(p.userData.nodeName); p = p.parent; } }
      const kind = surfaceKind(src.name); if (kind === 'leather' || kind === 'carpet' || kind === 'fabric') interior = true; // no leather or carpet outside
      patchSurface(o.material, { kind, interior: !!interior, rivets: kind === 'paint' && !interior && !!o.userData.staticModel });
    });
    this.buildLights();
    this.buildShadow();
    this.gauges = new C172Gauges(); model.add(this.gauges.mesh);
    let draws = 0, tris = 0; model.traverse((o) => { if (o.isMesh && o.geometry.attributes.position.count) { draws++; tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; } });
    this.stats = { draws, tris: Math.round(tris), merged: groups.size };
    return this;
  }

  // each moving group (prop, wheels with hubs and bolts, yokes, pedals, levers, rudder) merged in the group's own frame: plain colours into one
  // metallic and one non-metallic vertex-colour mesh (the first part's finish), others per material; the propeller blades
  // stay a mesh of their own (hidden behind the blur disc at speed). Lights keep their single meshes (their materials glow).
  mergeMoving(fix) {
    for (const [name, node] of Object.entries(this.nodes)) {
      if (/Light|Strobe|Beacon/.test(name)) continue;
      node.userData.nodeName = name;
      const meshes = [], others = new Set(Object.values(this.nodes)); others.delete(node);
      const walk = (o) => { if (others.has(o)) return; if (o.isMesh) meshes.push(o); for (const c of o.children) walk(c); }; walk(node);
      if (meshes.length < 2) continue;
      node.updateMatrixWorld(true);
      const inv = new THREE.Matrix4().copy(node.matrixWorld).invert(), groups = new Map();
      for (const o of meshes) {
        fix(o.material);
        const g = o.geometry, vc = vcKey(o.material, false) && (o.material.metalness > 0.5 ? 'vc|metal' : 'vc|dielectric'), blade = name === 'Prop' && /PropBlade|PropTip|BladeShank/.test(o.name);
        const key = (blade ? 'blade|' : '') + (vc ? `${vc}|${g.index ? 'i' : 'n'}` : o.material.uuid + '|' + Object.keys(g.attributes).sort().join(',') + '|' + (g.index ? 'i' : 'n'));
        if (!groups.has(key)) groups.set(key, { material: o.material, parts: [], vc: !!vc, blade });
        groups.get(key).parts.push({ geometry: g, matrix: new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld), material: o.material });
      }
      for (const o of meshes) if (o === node) o.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([], 3)); else o.parent.remove(o);
      let i = 0;
      for (const G of groups.values()) {
        const merged = mergeParts(G); if (!merged) continue;
        const mesh = new THREE.Mesh(merged, G.vc ? vcMaterial(G.material, G.parts.length) : G.material);
        mesh.name = G.blade ? `${name}_PropBlade_merged` : `${name}_merged_${i++}`;
        mesh.userData.mergedParts = G.parts.map((p) => ({ geometry: p.geometry, material: p.material, matrix: p.matrix }));
        node.add(mesh);
      }
    }
  }

  // detail built in code (c172cabin.js) and parts split out of the static model so they can move; everything goes into the glTF scene before
  // the merge, through a group that undoes the scene's turn, so it is authored in the model frame and merged with the rest
  addExtras(scene, modelInv) {
    const M = this.cabinMats = cabinMaterials(), N = this.nodes;
    const wrap = new THREE.Group(); wrap.name = 'C172_Extras'; wrap.rotation.y = -Math.PI / 2; scene.add(wrap); scene.updateMatrixWorld(true);
    wrap.add(buildOverhead(M));
    const ctl = this.ctl = buildControls(M); wrap.add(ctl.throttle, ctl.mixture, ctl.plate, ctl.lever, ctl.pointer);
    Object.assign(N, { Ctl_Throttle: ctl.throttle, Ctl_Mixture: ctl.mixture, Ctl_FlapLever: ctl.lever, Ctl_FlapPointer: ctl.pointer });
    const tw = this.tailGearParts = buildTailWheel(M); wrap.add(tw.pivot);
    Object.assign(N, { TailGear: tw.pivot, TailGear_Wheel: tw.wheel });
    // short shafts under two knobs that floated 5-10 mm off the panel
    for (const [y, z, d] of [[1.050, -0.014, 0.011], [1.065, -0.407, 0.006]]) { const g = new THREE.CylinderGeometry(0.004, 0.004, d, 12); g.rotateZ(Math.PI / 2); g.translate(-0.2855 - d / 2, y, z); const o = new THREE.Mesh(g, M.chrome); o.name = 'Ctl_KnobShaft'; wrap.add(o); }
    wrap.updateMatrixWorld(true);
    const toModel = (o) => new THREE.Matrix4().multiplyMatrices(modelInv, o.matrixWorld);
    // rudder pedals: the four pedals (pilot and co-pilot, left and right) were one static mesh each per material; split by connected piece,
    // each pedal hinged at the bottom on the rudder bar (x -0.40, y 0.648)
    const PZ = [-0.405, -0.235, 0.235, 0.405];
    PZ.forEach((z, k) => { const g = new THREE.Group(); g.name = `PedalSet_${k}`; g.position.set(-0.40, 0.648, z); wrap.add(g); N[g.name] = g; });
    wrap.updateMatrixWorld(true);
    for (let i = 1; i <= 6; i++) {
      const o = scene.getObjectByName(`Pedals_${i}`); if (!o || !o.isMesh || !o.geometry.index) continue;
      const pieces = meshPieces(o, modelInv), keep = [], per = PZ.map(() => []), idx = o.geometry.index.array;
      for (let t = 0; t < idx.length; t += 3) {
        const pc = pieces.box.get(pieces.root(idx[t])), c = pc.getCenter(_c), wz = pc.max.z - pc.min.z;
        const k = wz < 0.15 ? PZ.findIndex((z) => Math.abs(c.z - z) < 0.06) : -1;
        (k >= 0 ? per[k] : keep).push(idx[t], idx[t + 1], idx[t + 2]);
      }
      per.forEach((list, k) => {
        if (!list.length) return; const node = N[`PedalSet_${k}`], g = o.geometry.clone(); g.setIndex(list);
        g.applyMatrix4(new THREE.Matrix4().copy(node.matrixWorld).invert().multiply(o.matrixWorld));
        const m = new THREE.Mesh(g, o.material); m.name = `PedalSet_${k}_${o.name}`; node.add(m);
      });
      o.geometry.setIndex(keep);
    }
    // elevator trim wheel and parking brake handle: moved onto pivots so they can turn / pull
    const pivotOf = (name, at, parts) => { const g = new THREE.Group(); g.name = name; g.position.copy(at); wrap.add(g); g.updateMatrixWorld(true);
      for (const n of parts) { const o = scene.getObjectByName(n); if (o) g.attach(o); } N[name] = g; };
    pivotOf('Ctl_TrimWheel', new THREE.Vector3(-0.47, 0.885, -0.095), ['TrimWheel', 'TrimWheel_1', 'TrimWheel_2', 'TrimWheel_3']);
    pivotOf('Ctl_ParkBrake', new THREE.Vector3(-0.31, 0.84, -0.42), ['ParkBrakeGrip', 'ParkBrakeShaft']);
    scene.updateMatrixWorld(true);
  }

  // see WELLS: cut every moving surface's well out of the fixed shells and close it
  cutWells(scene, moving) {
    scene.updateMatrixWorld(true);
    const sInv = new THREE.Matrix4().copy(scene.matrixWorld).invert(), N = this.nodes, others = new Set(Object.values(N));
    const wells = [];
    for (const [name, spanAx, thickAx, shroud] of WELLS) {
      const node = N[name]; if (!node) continue; others.delete(node);
      const w = wellOf(node, others, sInv, spanAx, thickAx, shroud); others.add(node);
      if (w) { w.name = name; wells.push(w); }
    }
    // the thin opaque shells (wing skin, panel lines) that reach into a well; the fuselage is far thicker and is left alone
    const shells = [];
    scene.traverse((o) => {
      if (!o.isMesh || moving.has(o) || !o.material || o.material.transparent) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const toScene = new THREE.Matrix4().multiplyMatrices(sInv, o.matrixWorld), box = o.geometry.boundingBox.clone().applyMatrix4(toScene);
      const hit = wells.filter((w) => { const lo = box.min.toArray(), hi = box.max.toArray();
        // a lifting surface: thin, and at least half as long in span as in chord (the fuselage's stripe panels are long and narrow)
        return hi[w.thickAx] - lo[w.thickAx] < 0.45 && hi[w.spanAx] - lo[w.spanAx] > 0.5 * (hi[2] - lo[2]) &&
          hi[w.spanAx] > w.s0 && lo[w.spanAx] < w.s1 && hi[w.thickAx] > w.t0 && lo[w.thickAx] < w.t1 && lo[2] < w.cMax; });
      if (hit.length) shells.push({ o, toScene, wells: hit });
    });
    // sample the skins before cutting (for the cove walls and ribs)
    const ray = new THREE.Raycaster(), objs = shells.map((x) => x.o);
    const castFor = (w) => (s, c) => {
      const o = [0, 0, 0]; o[w.spanAx] = s; o[w.thickAx] = w.t1 + 0.5; o[2] = c; const d = [0, 0, 0]; d[w.thickAx] = -1;
      ray.set(new THREE.Vector3(...o).applyMatrix4(scene.matrixWorld), new THREE.Vector3(...d).transformDirection(scene.matrixWorld)); ray.far = (w.t1 - w.t0) + 1;
      const t = ray.intersectObjects(objs, false).map((h) => h.point.applyMatrix4(sInv).getComponent(w.thickAx)).filter((x) => x > w.t0 && x < w.t1);
      return t.length >= 2 ? [Math.min(...t), Math.max(...t)] : null;
    };
    const samples = new Map(wells.map((w) => [w, wellCove(w, castFor(w), [['position', 3], ['normal', 3]])]));
    let removed = 0; const lost = new Map();
    for (const x of shells) {
      const r = cutShell(x.o.geometry, x.toScene, x.wells); if (!r) continue;
      removed += r.removed; x.o.geometry = r.geometry; r.geometry.computeBoundingBox(); r.geometry.computeBoundingSphere();
      if (/Panel_Line|Livery|Reg_|Decal/i.test(x.o.material.name)) continue;
      for (const w of x.wells) { const k = lost.get(w); if (!k || k.n < r.removed) lost.set(w, { o: x.o, n: r.removed }); }
    }
    // each well is closed in the material of the skin that lost most to it, with that skin's attribute layout (so the two merge)
    const covers = [];
    for (const w of wells) {
      const g = samples.get(w), main = lost.get(w); if (!g || !main) continue;
      for (const [n, at] of Object.entries(main.o.geometry.attributes)) if (!g.attributes[n]) g.setAttribute(n, new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * at.itemSize), at.itemSize));
      const m = new THREE.Mesh(g, main.o.material); m.name = `Well_${w.name}`; covers.push(m);
    }
    for (const m of covers) scene.add(m);
    scene.updateMatrixWorld(true);
    return { wells: wells.length, shells: shells.length, removed, covers: covers.length };
  }

  // flap pose for a flap angle (deg): turned about its nose, the nose carried along the track (most of the travel in the first notch)
  poseFlaps(deg) {
    const N = this.nodes, B = this.base, f = Math.max(0, Math.min(1, deg / 30)), tau = 1 - (1 - f) * (1 - f);
    const run = new THREE.Vector3(0, -(this.flapDrop ?? FLAP_DROP) * tau, -(this.flapAft ?? FLAP_AFT) * tau), q = new THREE.Quaternion(), c = new THREE.Vector3();
    for (const n of ['Flap_L', 'Flap_R']) {
      const o = N[n]; if (!o) continue; const nose = (this.flapNose && this.flapNose[n]) || new THREE.Vector3();
      q.setFromAxisAngle(AXIS[n], -deg * D2R);
      o.quaternion.copy(B[n].q).multiply(q);
      // p = base + Rbase (nose - R nose) + run: the nose stays put while the flap turns, then rides the track
      c.copy(nose).applyQuaternion(q).negate().add(nose).applyQuaternion(B[n].q);
      o.position.copy(B[n].p).add(c).add(run);
    }
  }

  // the flap's nose (middle of its leading edge, between the upper and lower skins) in the flap's own frame, and the inset described at
  // FLAP_INSET (vertices moved along the normals averaged per position, so the shared corners stay closed)
  prepareFlaps() {
    this.hinges = {};
    const others = new Set(Object.values(this.nodes));
    for (const [n, spanAx] of HINGED) {
      const node = this.nodes[n]; if (!node) continue; others.delete(node);
      const h = hingeOf(node, others, spanAx, this.model.children[0]); others.add(node); if (!h) continue;
      // keep the exported sense of rotation (the hinge axes in AXIS / update)
      const ref = AXIS[n] || new THREE.Vector3(spanAx === 0 ? 1 : 0, spanAx === 1 ? 1 : 0, 0);
      if (h.axis.dot(ref) < 0) h.axis.negate();
      this.hinges[n] = h;
    }
    this.flapNose = {};
    for (const [n, lip] of [['Flap_L', FLAP_SHROUD], ['Flap_R', FLAP_SHROUD], ['Aileron_L', AILERON_LIP], ['Aileron_R', AILERON_LIP]]) {
      const node = this.nodes[n]; if (!node) continue;
      const meshes = []; node.traverse((o) => { if (o.isMesh && o.geometry.attributes.position.count) meshes.push(o); });
      const pts = [], v = new THREE.Vector3(), inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
      for (const o of meshes) { const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld), p = o.geometry.attributes.position; for (let i = 0; i < p.count; i++) pts.push(v.fromBufferAttribute(p, i).applyMatrix4(m).clone()); }
      if (!pts.length) continue;
      const leZ = Math.max(...pts.map((p) => p.z)), le = pts.filter((p) => p.z > leZ - 0.02), ys = le.map((p) => p.y), xs = pts.map((p) => p.x);
      if (/^Flap/.test(n)) this.flapNose[n] = new THREE.Vector3((Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2, leZ);
      const centre = pts.reduce((a, q) => a.add(q), new THREE.Vector3()).divideScalar(pts.length);
      const noseAt = noseLine(pts.map((q) => [q.x, q.z])); // as for the well (wellOf)
      for (const o of meshes) {
        const g = o.geometry = o.geometry.clone(), p = g.attributes.position, m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld), mi = m.clone().invert();
        if (o === node || (o.parent === node && !this.flapSource?.[n])) (this.flapSource || (this.flapSource = {}))[n] = p.clone();
        const key = (i) => `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`, sum = new Map();
        const idx = g.index ? g.index.array : Array.from({ length: p.count }, (_, i) => i), a = new THREE.Vector3(), b = new THREE.Vector3(), cc = new THREE.Vector3();
        for (let t = 0; t < idx.length; t += 3) {
          a.fromBufferAttribute(p, idx[t]); b.fromBufferAttribute(p, idx[t + 1]); cc.fromBufferAttribute(p, idx[t + 2]);
          const nrm = b.clone().sub(a).cross(cc.clone().sub(a)); // area-weighted
          for (const i of [idx[t], idx[t + 1], idx[t + 2]]) { const k = key(i); sum.set(k, (sum.get(k) || new THREE.Vector3()).add(nrm)); }
        }
        const nl = new THREE.Matrix3().getNormalMatrix(m);
        for (let i = 0; i < p.count; i++) {
          const loc = v.fromBufferAttribute(p, i).applyMatrix4(m), back = noseAt(loc.x) - loc.z;
          const w = back <= lip + 0.01 ? 1 : Math.max(0, 1 - (back - lip - 0.01) / 0.04); if (!w) continue;
          // where the faces around a corner cancel out (thin end caps), move it toward the middle of the section instead
          const nm = sum.get(key(i)), dir = nm && nm.lengthSq() > 1e-12 ? nm.clone().applyMatrix3(nl).normalize().negate()
            : new THREE.Vector3(0, centre.y - loc.y, centre.z - loc.z).normalize();
          loc.addScaledVector(dir, FLAP_INSET * w).applyMatrix4(mi);
          p.setXYZ(i, loc.x, loc.y, loc.z);
        }
        p.needsUpdate = true; g.computeBoundingSphere(); g.computeBoundingBox();
      }
    }
  }

  // flap tracks (fixed to the wing, following the path of the flap's leading edge), the flap brackets riding in them, and hinge fittings on the
  // ailerons, elevators and rudder: before, the flaps hung in the air on nothing
  buildFittings() {
    const N = this.nodes, M = this.cabinMats, model = this.model, mInv = new THREE.Matrix4().copy(model.matrixWorld).invert();
    const tracks = [], fittings = [];
    for (const n of ['Flap_L', 'Flap_R']) {
      const node = N[n]; if (!node) continue;
      this.poseFlaps(0); model.updateMatrixWorld(true);
      // rest-pose vertices of the flap in the model frame
      const pts = []; node.traverse((o) => { if (!o.isMesh || !o.geometry.attributes.position.count) return; const p = o.geometry.attributes.position, mm = new THREE.Matrix4().multiplyMatrices(mInv, o.matrixWorld), v = new THREE.Vector3(); for (let i = 0; i < p.count; i += 2) pts.push(v.fromBufferAttribute(p, i).applyMatrix4(mm).clone()); });
      if (!pts.length) continue;
      const box = new THREE.Box3().setFromPoints(pts), span = [box.min.z, box.max.z], local = new THREE.Matrix4().copy(node.matrixWorld).invert().multiply(model.matrixWorld);
      const brackets = [];
      for (const f of [0.12, 0.5, 0.88]) {
        const z = span[0] + (span[1] - span[0]) * f, near = pts.filter((p) => Math.abs(p.z - z) < 0.04); if (!near.length) continue;
        const le = near.reduce((a, b) => (b.x > a.x ? b : a)), lowLE = new THREE.Vector3(le.x - 0.02, Math.min(...near.filter((p) => p.x > le.x - 0.06).map((p) => p.y)) + 0.004, z);
        const loc = lowLE.clone().applyMatrix4(local), path = [];
        for (let d = 0; d <= 30; d += 3) { this.poseFlaps(d); model.updateMatrixWorld(true); path.push(loc.clone().applyMatrix4(node.matrixWorld).applyMatrix4(mInv)); }
        // the track starts 6 cm inside the wing, ahead of the retracted flap
        const t0 = path[1].clone().sub(path[0]).normalize(); path.unshift(path[0].clone().addScaledVector(t0, -0.06));
        tracks.push(ribbon(path, z, 0.032, 0.007));
        // bracket on the flap: from its underside forward-down into the track
        const b = new THREE.BoxGeometry(0.06, 0.03, 0.005); b.translate(loc.x - 0.01, loc.y - 0.006, loc.z); brackets.push(b);
      }
      this.poseFlaps(0);
      if (brackets.length) { const g = mergeGeometries(brackets); const o = new THREE.Mesh(g, M.aluDark); o.name = `${n}_Brackets`; o.castShadow = true; node.add(o); }
    }
    // hinge fittings: plates across the hinge line, on the fixed surface (they sit on the axis, so they stay put as the surface turns)
    const fit = (node, axis, chord, ts) => { if (!node) return; for (const t of ts) {
      const a = axis.clone().normalize(), c = chord.clone().normalize(), b = new THREE.Vector3().crossVectors(c, a).normalize(); c.crossVectors(a, b);
      const g = new THREE.BoxGeometry(0.008, 0.03, 0.06); g.applyMatrix4(new THREE.Matrix4().makeBasis(a, b, c)); g.translate(...node.position.clone().addScaledVector(a, t).addScaledVector(c, 0.012).toArray());
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(mInv, node.parent.matrixWorld)); fittings.push(g); } };
    model.updateMatrixWorld(true);
    const fwd = new THREE.Vector3(0, 0, 1); // glTF +z is the nose
    fit(N.Aileron_L, AXIS.Aileron_L, fwd, [-0.6, 0, 0.6]); fit(N.Aileron_R, AXIS.Aileron_R, fwd, [-0.6, 0, 0.6]);
    fit(N.Elevator_L, new THREE.Vector3(1, 0, 0), fwd, [-0.55, 0, 0.55]); fit(N.Elevator_R, new THREE.Vector3(1, 0, 0), fwd, [-0.55, 0, 0.55]);
    fit(N.Rudder, new THREE.Vector3(0, 1, 0), fwd, [0.2, 0.75, 1.3]);
    const all = [...tracks, ...fittings].map((g) => (g.index ? g.toNonIndexed() : g));
    for (const g of all) { for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); }
    if (all.length) { const g = mergeGeometries(all); g.computeBoundingSphere(); const o = new THREE.Mesh(g, M.aluDark); o.name = 'Flap_Tracks_And_Hinges'; o.castShadow = o.receiveShadow = true; o.userData.interior = false; model.add(o); this.fittings = o; }
  }

  setupMoving() {
    const N = this.nodes;
    this.base = {};
    for (const [k, o] of Object.entries(N)) this.base[k] = { p: o.position.clone(), q: o.quaternion.clone() };
    this.model.updateMatrixWorld(true); this.prepareFlaps();
    const prop = N.Prop;
    if (prop) {
      this.blades = []; prop.traverse((o) => { if (o.isMesh && /PropBlade|PropTip|BladeShank/.test(o.name)) this.blades.push(o); });
      this.disc = buildPropDisc(prop, this.blades);
    }
  }

  buildLights() {
    const N = this.nodes, tex = glowTexture();
    this.lights = [];
    const glow = (node, color, size) => {
      if (!node) return null;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
      sp.position.copy(node.position); sp.scale.setScalar(size); sp.renderOrder = 5; node.parent.add(sp);
      if (node.isMesh) { const m = node.material.clone(); m.emissive = new THREE.Color(color); m.emissiveIntensity = 0; node.material = m; }
      const L = { sp, node, size }; this.lights.push(L); return L;
    };
    this.navL = glow(N.NavLight_L, 0xff2a1a, 0.5); this.navR = glow(N.NavLight_R, 0x30ff60, 0.5); this.tail = glow(N.TailNavLight, 0xffffff, 0.45);
    this.strL = glow(N.Strobe_L, 0xffffff, 0.9); this.strR = glow(N.Strobe_R, 0xffffff, 0.9); this.beacon = glow(N.BeaconDome, 0xff2010, 0.7);
    // landing light (left wing leading edge in the real aircraft): always in the scene, so switching it never changes the light count
    this.landLight = new THREE.SpotLight(0xfff1dd, 0, 900, 0.32, 0.5, 1.4);
    this.landLight.position.set(-0.7 - C172_CG.x, 1.9 - C172_CG.y, -2.7);
    this.landLight.target.position.set(60, -6, -2.7);
    this.root.add(this.landLight, this.landLight.target);
    // Cockpit lighting as in the 172S POH (7-37, 7-38): an LED strip in the underside of the glareshield floods the panel, every instrument has
    // its own lamp, flood lights in the overhead console. They come on with the dusk, like the landing light; the spot light is always in the
    // scene so switching it never changes the light count (no shader recompiles).
    const at = (x, y, z) => new THREE.Vector3(x - C172_CG.x, y - C172_CG.y, z - C172_CG.z);
    this.gsStrip = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.003, 0.9), new THREE.MeshStandardMaterial({ color: 0x3a3a3c, roughness: 0.4, emissive: 0xffe9cf, emissiveIntensity: 0 }));
    this.gsStrip.name = 'GlareshieldLED'; this.gsStrip.position.copy(at(-0.318, 1.446, 0)); this.root.add(this.gsStrip);
    // set well back under the glareshield and with a linear fall-off, so the top row is not blown out next to it (decay 2 lit the nearest dial white)
    this.panelLight = new THREE.SpotLight(0xffe4c4, 0, 1.0, 1.2, 0.9, 1);
    this.panelLight.position.copy(at(-0.50, 1.442, -0.2)); this.panelLight.target.position.copy(at(-0.28, 1.17, -0.18));
    this.root.add(this.panelLight, this.panelLight.target);
    this.cabinLit = -1;
  }
  // 0 = off, 1 = full: glareshield flood, instrument lamps, overhead lenses
  setCabinLights(k) {
    if (Math.abs(k - this.cabinLit) < 0.01) return; this.cabinLit = k;
    this.panelLight.intensity = 0.9 * k; this.gsStrip.material.emissiveIntensity = 1.6 * k;
    for (const m of this.dialMats) m.emissiveIntensity = 0.55 * k;
    for (const m of this.lampMats) m.emissiveIntensity = 1.2 * k;
    if (this.gauges) this.gauges.setLight(0.6 * k);
  }

  // Ground shadow: the airframe's own silhouette seen from the sun (drawn white into a small target, only when its shape changes), projected
  // onto the ground along the sun direction with a penumbra that widens with height. Replaces the round blob and the world-cascade shadow,
  // whose 0.25-0.5 m texels smeared a 1.5 m wing chord into a dark smudge (and Low, with no cascades, had no shadow on the ground at all).
  buildShadow() {
    this.sil = {
      rt: new THREE.WebGLRenderTarget(SIL_SIZE, SIL_SIZE, { depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter }),
      cam: new THREE.OrthographicCamera(-SIL_R, SIL_R, SIL_R, -SIL_R, 1, 2 * SIL_D),
      mat: new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, fog: false, toneMapped: false }),
      sig: new Float64Array(12), have: false, frames: 0, sd: new THREE.Vector3(0, 1, 0), vp: new THREE.Matrix4(),
    };
    this.sil.cam.layers.set(SIL_LAYER);
    for (const o of this.casters) o.layers.enable(SIL_LAYER);
    const sg = new THREE.PlaneGeometry(1, 1); sg.rotateX(-Math.PI / 2);
    this.shadow = new THREE.Mesh(sg, new THREE.ShaderMaterial({
      uniforms: { tSil: { value: this.sil.rt.texture }, uVP: { value: this.sil.vp }, uBlur: { value: 0.01 }, uLod: { value: 0 }, uOpacity: { value: 0 } },
      vertexShader: `#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 vW;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w;
#include <logdepthbuf_vertex>
}`,
      fragmentShader: `#include <common>
#include <logdepthbuf_pars_fragment>
uniform sampler2D tSil; uniform mat4 uVP; uniform float uBlur, uLod, uOpacity; varying vec3 vW;
float tap(vec2 uv) { return textureLod(tSil, uv, uLod).r; }
void main() {
#include <logdepthbuf_fragment>
  vec4 c = uVP * vec4(vW, 1.0); vec2 uv = c.xy * 0.5 + 0.5;
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) discard;
  float b = uBlur;
  float s = 0.36 * tap(uv) + 0.16 * (tap(uv + vec2(b, 0.3 * b)) + tap(uv - vec2(b, 0.3 * b)) + tap(uv + vec2(-0.3 * b, b)) + tap(uv - vec2(-0.3 * b, b)));
  float a = s * uOpacity; if (a < 0.004) discard;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}`,
      transparent: true, depthWrite: false, toneMapped: false, fog: false,
    }));
    this.shadow.renderOrder = 1; this.shadow.visible = false; this.shadow.frustumCulled = false; this.scene.add(this.shadow);
  }

  // Redraws the silhouette when the airframe's shape as seen from the sun changes, and points the projection at where the aircraft is now.
  // Called by main.js after update() and before the scene pass.
  renderShadowMap(renderer) {
    const S = this.sil; if (!S || !this.shadow.visible || !this.lastFdm) return;
    const f = this.lastFdm, q = f.quat, sd = this.lastSunDir, s = f.surf || {}, g = S.sig;
    const cur = [q.x, q.y, q.z, q.w, sd.x, sd.y, sd.z, (f.flaps || 0) / 30, s.da || 0, s.de || 0, s.dr || 0, this.bladeSil || 0];
    let dirty = !S.have || ++S.frames % 60 === 0;
    // 2.5e-3 in the quaternion is ~0.3 deg: about one silhouette texel at the wing tips
    for (let i = 0; i < cur.length && !dirty; i++) if (Math.abs(cur[i] - g[i]) > (i < 4 ? 2.5e-3 : 1e-3)) dirty = true;
    const cam = S.cam;
    if (dirty) { S.sd.copy(sd); g.set(cur); }
    cam.position.copy(this.root.position).addScaledVector(S.sd, SIL_D);
    cam.up.set(0, 1, 0); if (Math.abs(S.sd.y) > 0.98) cam.up.set(1, 0, 0);
    cam.lookAt(this.root.position); cam.updateMatrixWorld(true);
    S.vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    if (!dirty) return;
    S.have = true;
    const prevRT = renderer.getRenderTarget(), ac = renderer.autoClear, bg = this.scene.background, ov = this.scene.overrideMaterial;
    const au = renderer.shadowMap.autoUpdate, nu = renderer.shadowMap.needsUpdate, alpha = renderer.getClearAlpha(), col = renderer.getClearColor(new THREE.Color()).getHex();
    try {
      renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = false;
      this.scene.background = null; this.scene.overrideMaterial = S.mat; renderer.autoClear = false;
      renderer.setRenderTarget(S.rt); renderer.setClearColor(0x000000, 1); renderer.clear(true, false, false);
      renderer.render(this.scene, cam);
    } finally {
      this.scene.background = bg; this.scene.overrideMaterial = ov; renderer.autoClear = ac;
      renderer.setRenderTarget(prevRT); renderer.setClearColor(col, alpha);
      renderer.shadowMap.autoUpdate = au; renderer.shadowMap.needsUpdate = nu;
    }
  }

  update(dt, fdm, camWorld, view, env, groundY) {
    const envTex = this.scene.environment;
    if (envTex !== this.envTex && this.model) {
      this.envTex = envTex;
      this.model.traverse((o) => { const m = o.material; if (!o.isMesh || !m || !m.isMeshStandardMaterial) return; if (!m.envMap) m.needsUpdate = true; m.envMap = envTex; });
    }
    this.time += dt;
    this.root.position.copy(fdm.pos).sub(camWorld);
    this.root.quaternion.copy(fdm.quat);
    if (!this.model) return;
    if (this.gauges) {
      const o = fdm.out || {}, a = attitude(fdm.quat);
      this.gauges.update(dt, { ias: (o.V || 0) * Math.sqrt((o.rho || 1.225) / 1.225) * 1.943844, alt: fdm.pos.y * 3.28084, pitch: a.pitch, bank: a.bank, hdg: a.heading, vs: fdm.vel.y * 196.85, beta: o.beta || 0, rpm: fdm.rpm || 0 }, view);
    }
    const N = this.nodes, B = this.base, s = fdm.surf, t = this.time;
    const de = Math.max(-1, Math.min(1, s.de + fdm.trim * 0.6)), dE = de * (de > 0 ? DE_UP : DE_DN), dA = s.da * DA_MAX, dR = s.dr * DR_MAX;
    const rot = (n, axis, ang) => { const o = N[n]; if (!o) return; o.quaternion.copy(B[n].q).multiply(new THREE.Quaternion().setFromAxisAngle(axis, ang)); };
    const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);

    // control surfaces turn about their leading edges (see HINGED); the exported hinge is the fallback
    const hinge = (n, axis, ang) => { const o = N[n]; if (!o) return; const h = this.hinges && this.hinges[n];
      if (!h) { rot(n, axis, ang); return; }
      const q = new THREE.Quaternion().setFromAxisAngle(h.axis, ang);
      o.quaternion.copy(B[n].q).multiply(q); o.position.copy(B[n].p).add(h.point.clone().applyQuaternion(q).negate().add(h.point).applyQuaternion(B[n].q)); };
    hinge('Elevator_L', X, dE); hinge('Elevator_R', X, dE);
    hinge('Rudder', Y, dR);
    hinge('Aileron_L', AXIS.Aileron_L, -dA); hinge('Aileron_R', AXIS.Aileron_R, dA);
    // single-slot flaps run aft on their tracks (most of the travel in the first notches) and drop a little, the leading edge under the shroud
    this.poseFlaps(fdm.flaps || 0);
    // yokes: pulled back with up elevator, turned with the ailerons
    for (const y of ['Yoke_Pilot', 'Yoke_Copilot']) { const o = N[y]; if (!o) continue; o.position.copy(B[y].p).add(new THREE.Vector3(0, 0, -0.09 * Math.max(-1, Math.min(1, s.de)))); o.quaternion.copy(B[y].q).multiply(new THREE.Quaternion().setFromAxisAngle(Z, s.da * 0.8)); }
    // throttle (pulled out at idle), flap lever in its detents and the flap pointer, rudder pedals (and toe brakes), trim wheel, parking brake
    const at = (n, x, y, z) => { const o = N[n]; if (o) o.position.copy(B[n].p).add(_v.set(x, y, z)); };
    const turn = (n, axis, a) => { const o = N[n]; if (o) o.quaternion.copy(B[n].q).multiply(_q.setFromAxisAngle(axis, a)); };
    at('Ctl_Throttle', -THROTTLE_TRAVEL * (1 - Math.max(0, Math.min(1, fdm.throttle || 0))), 0, 0);
    if (this.ctl) { at('Ctl_FlapLever', 0, this.ctl.flapDy * (fdm.flapCmd || 0), 0); at('Ctl_FlapPointer', 0, this.ctl.flapDy * (fdm.flaps || 0) / 10, 0); }
    const dr = Math.max(-1, Math.min(1, s.dr)), toe = (fdm.brakes || 0) * 0.08;
    // right pedal forward with right rudder (top of the pedal toward the nose: negative turn about +z); toe brakes tip both pedals forward
    ['PedalSet_0', 'PedalSet_1', 'PedalSet_2', 'PedalSet_3'].forEach((n, k) => { const right = k === 1 || k === 3; turn(n, Z, (right ? -1 : 1) * 0.22 * dr - toe); });
    turn('Ctl_TrimWheel', Z, (fdm.trim || 0) * 4);
    at('Ctl_ParkBrake', fdm.parkingBrake ? -0.045 : 0, 0, 0);
    // tail wheel: the leg swings up into its well; the wheel turns while it rolls
    turn('TailGear', Z, TW_RETRACT * (1 - (fdm.tailGearPos ?? 1)));
    if (N.TailGear_Wheel) { this.tailSpin = (this.tailSpin || 0) - (fdm.tailContact > 0 ? (fdm.tailWheel || 0) : 0) * dt; N.TailGear_Wheel.rotation.z = this.tailSpin; }
    // cabin: daylight scattered in through the big side and rear windows (the cabin otherwise sees only the sky probe and the sun through glass)
    CABIN_FILL.value = 0.28 * Math.max(0, Math.min(1, env && env.daylight != null ? env.daylight : 1));
    // propeller: the modelled blades while it barely turns; above that the disc draws both blades smeared over the arc they sweep in this frame
    // (a camera's motion blur): two ghostly fans that flicker round at idle and merge into a faint disc with a light tip ring at cruise rpm
    const rpm = fdm.crashed ? 0 : (fdm.rpm || 0);
    if (N.Prop) {
      const step = rpm / 60 * 2 * Math.PI * dt;
      this.propAng = ((this.propAng || 0) + step) % (2 * Math.PI);
      N.Prop.quaternion.copy(B.Prop.q).multiply(new THREE.Quaternion().setFromAxisAngle(Z, -this.propAng));
      // the frame's sweep; while paused (dt 0) the last one is kept so the picture does not change
      if (dt > 0) this.propSmear = Math.min(Math.PI, step);
      const smear = rpm > 1 ? (this.propSmear || 0) : 0, solid = smear < PROP_SMEAR_SOLID;
      for (const b of this.blades || []) b.visible = solid;
      this.bladeSil = solid ? this.propAng : -1;
      if (this.disc) {
        const u = this.disc.material.uniforms, day = env && env.daylight != null ? env.daylight : 1;
        this.disc.visible = !solid;
        u.uAng.value = this.disc.userData.theta0 - this.propAng; u.uSmear.value = Math.max(smear, 1e-3);
        u.uOpacity.value = view === 'cockpit' ? 0.5 : 0.95; u.uLight.value = 0.22 + 0.78 * Math.min(1, day * 1.2);
      }
    }
    // wheels: spin from the flight model's wheel rates; the nose wheel turns with the pedals on the ground
    const W = ['Tire_Nose', 'Tire_Main_L', 'Tire_Main_R'];
    this.wheelAng = this.wheelAng || [0, 0, 0];
    W.forEach((n, i) => {
      const o = N[n]; if (!o) return;
      this.wheelAng[i] = (this.wheelAng[i] + (fdm.wheel[i] || 0) * dt) % (2 * Math.PI);
      const q = new THREE.Quaternion();
      if (i === 0) q.setFromAxisAngle(Y, -fdm.ctrl.dr * 10 * D2R);
      o.quaternion.copy(B[n].q).multiply(q).multiply(new THREE.Quaternion().setFromAxisAngle(X, this.wheelAng[i]));
      o.position.copy(B[n].p); o.position.y += Math.max(0, (fdm.compress[i] || 0) - (i === 0 ? 0.1 : 0.047)) * 0.6;
    });
    // lights: nav steady, two-flash strobes every 1.2 s, beacon 1 Hz; sprites keep a minimum size on screen at distance
    const dark = 1 - Math.min(1, (env && env.daylight != null ? env.daylight : 1) * 1.2);
    const camDist = this.root.position.length();
    const k = Math.max(1, camDist / 60), ph = t % 1.2, strobe = ph < 0.05 || (ph > 0.12 && ph < 0.17) ? 1 : 0, beacon = Math.max(0, Math.sin(t * Math.PI * 2)) ** 6;
    const on = fdm.crashed ? 0 : 1;
    const setL = (L, v, glowMul) => { if (!L) return; L.sp.material.opacity = Math.min(1, v * glowMul); L.sp.scale.setScalar(L.size * k * (0.6 + 0.4 * v)); L.sp.visible = v > 0.01; if (L.node.isMesh) L.node.material.emissiveIntensity = 3 * v; };
    const navGlow = 0.35 + 0.65 * dark;
    setL(this.navL, on, navGlow); setL(this.navR, on, navGlow); setL(this.tail, on, navGlow);
    setL(this.strL, on * strobe, 1); setL(this.strR, on * strobe, 1); setL(this.beacon, on * beacon, 0.5 + 0.5 * dark);
    const agl = fdm.pos.y - groundY - C172_CG.y;
    this.landLight.intensity = on && dark > 0.3 && agl < 600 ? 60 * dark : 0;
    this.setCabinLights(on ? Math.max(0, Math.min(1, (dark - 0.15) / 0.5)) : 0);
    // ground shadow (see buildShadow): the quad covers the silhouette box's footprint on the ground, stretched away from a low sun
    this.shadow.visible = !!(env && env.elev > 0.03 && env.sunDir.y > 0.05 && agl < SHADOW_FADE_END && this.sil);
    if (this.shadow.visible) {
      const sd = env.sunDir, sy = Math.max(0.12, sd.y), dist = Math.max(0, agl) / sd.y, kk = dist;
      this.lastFdm = fdm; this.lastSunDir = sd;
      this.shadow.position.set(fdm.pos.x - sd.x * kk - camWorld.x, groundY + 0.1 - camWorld.y, fdm.pos.z - sd.z * kk - camWorld.z);
      this.shadow.rotation.y = Math.atan2(-sd.z, sd.x);
      this.shadow.scale.set(2.2 * SIL_R / sy, 1, 2.2 * SIL_R);
      // penumbra: the sun's 0.53 deg disc over the distance from the airframe to the ground, plus a few centimetres of softness
      const blurM = 0.05 + 0.0093 * dist, blurUv = blurM / (2 * SIL_R), texels = blurUv * SIL_SIZE;
      const u = this.shadow.material.uniforms;
      u.uBlur.value = blurUv; u.uLod.value = Math.max(0, Math.log2(texels / 2));
      // a sharp shadow is as dark as the cascade shadows around it; spread over a wide penumbra it fades, and goes with height
      u.uOpacity.value = 0.62 * Math.min(1, env.daylight * 1.5) * Math.max(0, Math.min(1, (SHADOW_FADE_END - agl) / (SHADOW_FADE_END - 400)));
    }
  }
}
export const C172_GEAR_COUNT = C172_GEAR.length;
