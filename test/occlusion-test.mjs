// Cockpit hidden-surface culling: the shader patch must fit every three.js template it is applied to, and only genuine occluders may enter the mask.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { occlusionSource, cullHidden, isOccluder, CockpitOcclusion, OCC_LAYER, OCC_TEST, OCC_DECL, OCC_UNIFORMS } from '../src/occlusion.js';

const ok = (name, c, info = '') => { assert.ok(c, `${name} ${info}`); console.log(`PASS  ${name} ${info}`); };

// expand #include <chunk> the way three.js does, with log depth on, to check what the compiler would really see
const expand = (src) => { let s = `#define USE_LOGARITHMIC_DEPTH_BUFFER\n${src}`; for (let i = 0; i < 12 && /#include <(\w+)>/.test(s); i++) s = s.replace(/#include <(\w+)>/g, (_, n) => THREE.ShaderChunk[n] ?? ''); return s; };

// every built-in template we patch accepts the test, and the test sits after the log-depth declarations it uses
for (const name of ['basic', 'lambert', 'standard', 'physical']) {
  const src = THREE.ShaderLib[name].fragmentShader, out = occlusionSource(src);
  ok(`patch fits the ${name} template`, !!out && out !== src);
  const full = expand(out), declAt = full.indexOf('varying float vFragDepth'), useAt = full.indexOf('float occD = log2(vFragDepth) * logDepthBufFC * 0.5;');
  ok(`${name}: vFragDepth and logDepthBufFC are declared before the test uses them`, declAt > 0 && useAt > declAt && full.indexOf('uniform float logDepthBufFC') < useAt);
  ok(`${name}: mask uniforms are declared before the test`, full.indexOf('uniform highp sampler2D tOcc') > 0 && full.indexOf('uniform highp sampler2D tOcc') < useAt);
  ok(`${name}: the test is the first thing in main, before any colour or lighting work`, out.indexOf(OCC_TEST) > out.indexOf('void main()') && out.indexOf(OCC_TEST) < out.indexOf('#include <color_fragment>'));
  ok(`${name}: patching twice changes nothing more`, occlusionSource(out) === out);
}
ok('a template without the insertion points is left alone', occlusionSource('void main() { gl_FragColor = vec4(1.0); }') === null);
ok('a skipped fragment still writes its depth and returns before any shading', OCC_TEST.includes('gl_FragDepth = occD;') && OCC_TEST.includes('return;') && !OCC_TEST.includes('discard'));
ok('the test only exists where log depth does', OCC_TEST.startsWith('#ifdef USE_LOGARITHMIC_DEPTH_BUFFER') && OCC_TEST.trimEnd().endsWith('#endif'));
ok('the declaration names match the uniforms', ['uOccOn', 'tOcc', 'uOccInv'].every((n) => OCC_DECL.includes(n) && n in OCC_UNIFORMS));

// cullHidden chains onto the material's own hook and keeps program keys distinct
{
  const hook = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n/*own*/'); };
  const m = new THREE.MeshStandardMaterial(); m.onBeforeCompile = hook; m.customProgramCacheKey = () => 'mine';
  cullHidden(m);
  const sh = { fragmentShader: THREE.ShaderLib.standard.fragmentShader, uniforms: {} }; m.onBeforeCompile(sh, null);
  ok('cullHidden keeps the material\'s own patch', sh.fragmentShader.includes('/*own*/'));
  ok('cullHidden adds the mask test and uniforms', sh.fragmentShader.includes('tOcc') && sh.uniforms.tOcc === OCC_UNIFORMS.tOcc && sh.uniforms.uOccOn === OCC_UNIFORMS.uOccOn);
  ok('cullHidden extends the program key', m.customProgramCacheKey() === 'mine|occ');
  cullHidden(m); ok('cullHidden twice does not stack', m.customProgramCacheKey() === 'mine|occ');
  const a = cullHidden(new THREE.MeshStandardMaterial()), b = cullHidden(new THREE.MeshPhysicalMaterial({ clearcoat: 1 }));
  ok('materials without their own hook still get a key', a.customProgramCacheKey().endsWith('|occ') && typeof b.customProgramCacheKey() === 'string');
  const sm = new THREE.ShaderMaterial(); cullHidden(sm); ok('custom shaders are left to their own source', !sm.userData.occCull);
}

// only meshes the main pass certainly draws wherever the mask says so may enter it
{
  const geo = new THREE.BoxGeometry(0.3, 0.3, 0.3), mk = (o = {}, g = geo) => new THREE.Mesh(g, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, ...o }));
  ok('an opaque double-sided mesh is an occluder', isOccluder(mk()));
  ok('single-sided meshes are not (the mask draws both sides)', !isOccluder(mk({ side: THREE.FrontSide })) && !isOccluder(mk({ side: THREE.BackSide })));
  ok('transparent, alpha-tested and depth-less meshes are not', !isOccluder(mk({ transparent: true })) && !isOccluder(mk({ opacity: 0.5 })) && !isOccluder(mk({ alphaTest: 0.5 })) && !isOccluder(mk({ depthWrite: false })) && !isOccluder(mk({ depthTest: false })));
  const dropLayer = mk(); dropLayer.layers.set(5); ok('a mesh the main camera does not draw is not', !isOccluder(dropLayer));
  ok('tiny parts are not worth a draw call', !isOccluder(mk({}, new THREE.BoxGeometry(0.01, 0.01, 0.01))));
  ok('instanced meshes and custom shaders are not', !isOccluder(new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ side: THREE.DoubleSide }), 2)) && !isOccluder(new THREE.Mesh(geo, new THREE.ShaderMaterial({ side: THREE.DoubleSide }))));
  const occ = new CockpitOcclusion(), root = new THREE.Group(), a = mk(), b = mk({ transparent: true }); root.add(a, b);
  ok('the mask registers the occluders and moves them onto its layer', occ.addAll(root) === 1 && a.layers.test(Object.assign(new THREE.Layers(), { mask: 1 << OCC_LAYER })) && !b.layers.test(Object.assign(new THREE.Layers(), { mask: 1 << OCC_LAYER })) && occ.count === 1);
  ok('the layer is not one the game already uses', ![0, 2, 5].includes(OCC_LAYER));
}
console.log('all occlusion tests passed');
