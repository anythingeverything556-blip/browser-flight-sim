import * as THREE from 'three';
import { FX_LAYER } from './layers.js';

// Owned browser-native approximation, NOT the compiled MSFS visual-effect graph.
// Like aircraft.js's procedural plumes, this is additive geometry on Earthwing's
// existing cloud/depth-aware FX layer. No source textures, audio or native code.
const clamp01 = n => Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
export function sr71BurnerIntensity(engine, fdm = {}) {
  if (!engine || fdm.crashed || fdm.engineRunning === false || engine.abLit !== true ||
      engine.unstart > 0 || engine.fail || engine.lit === false ||
      engine.producing === false || engine.combustion === false) return 0;
  // The current J58 solver has no combustion boolean. Actual positive thrust is
  // its combustion evidence, not throttle, residual dry spool or residual ab.
  const producing = Number.isFinite(engine.thrust) ? engine.thrust > 0 :
    engine.lit === true || engine.producing === true || engine.combustion === true;
  return producing ? clamp01(engine.ab) : 0;
}
// Closed proxy volumes, not visible cone skins. Proxy radii stay within the
// nozzle silhouette, with density fading to zero before their outer boundary. Ten bounded samples integrate a
// soft radial density along the view ray; one front-face draw per volume avoids
// doubled transparent shells. All detail is owned, advected procedural noise.
function plumeMaterial(seed, core) {
  return new THREE.ShaderMaterial({
    defines: { PROXY_RADIUS: core ? '0.30' : '0.62' },
    uniforms: { uTime: {value: 0}, uIntensity: {value: 0}, uSeed: {value: seed},
      uCore: {value: core ? 1 : 0}, uEye: {value: new THREE.Vector3()} },
    vertexShader: `
      #include <common>
      #include <logdepthbuf_pars_vertex>
      varying vec3 vP;
      void main() {
        vP = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        #include <logdepthbuf_vertex>
      }`,
    fragmentShader: `
      #include <common>
      #include <logdepthbuf_pars_fragment>
      uniform float uTime, uIntensity, uSeed, uCore;
      uniform vec3 uEye;
      varying vec3 vP;
      float hash(vec3 p) {
        p = fract(p * 0.3183099 + vec3(0.17, 0.31, 0.73));
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }
      float noise(vec3 p) {
        vec3 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x),
                       mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x),
                       mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z);
      }
      void main() {
        #include <logdepthbuf_fragment>
        vec3 ray = normalize(vP - uEye);
        float a = dot(ray.xy, ray.xy), b = dot(vP.xy, ray.xy);
        float c = dot(vP.xy, vP.xy) - PROXY_RADIUS * PROXY_RADIUS;
        float radialExit = a < 0.00001 ? 10000.0 :
          (-b + sqrt(max(0.0, b*b-a*c))) / a;
        float axialExit = abs(ray.z) < 0.00001 ? 10000.0 :
          ((ray.z > 0.0 ? 0.0 : -1.0) - vP.z) / ray.z;
        float stepSize = max(0.0, min(radialExit, axialExit)) / 10.0;
        // Fixed screen dither prevents axial sampling bands, without temporal
        // sparkle. Animation comes from downstream advection, not strobing.
        float jitter = hash(vec3(floor(gl_FragCoord.xy), 0.0));
        vec3 energy = vec3(0.0);
        for (int i = 0; i < 10; i++) {
          vec3 p = vP + ray * ((float(i) + 0.3 + 0.4*jitter) * stepSize);
          float along = clamp(-p.z, 0.0, 1.0);
          float flow = along * 19.0 - uTime * 5.5;
          vec3 domain = vec3(p.xy * 7.0, flow) + uSeed * 11.0;
          float broad = noise(domain);
          float fine = noise(domain * 2.3 + vec3(3.1, 7.6, -uTime * 2.0));
          float turbulence = broad * 0.7 + fine * 0.3;
          vec2 wander = vec2(sin(along * 13.0 - uTime * 3.0 + uSeed),
                             sin(along * 17.0 - uTime * 2.4 + uSeed * 3.0));
          vec2 crossSection = p.xy - wander * (0.008 + 0.035 * along);
          float taper = pow(max(0.0, 1.0-along), 0.6);
          float radius = mix(0.54, 0.19, uCore) * taper;
          radius *= 0.70 + 0.42 * turbulence; // max outer radius .6048 < .62 proxy
          float r = length(crossSection) / max(0.005, radius);
          // Gaussian interior plus a broad zero-density edge: no hard tube,
          // cap, full-circumference bands, or texture seams at any azimuth.
          float radial = exp(-r*r * 2.8) * (1.0-smoothstep(0.65, 1.0, r));
          float endFade = (1.0-smoothstep(0.32, 1.0, along + (turbulence-0.5)*0.26)) *
            mix(1.0, exp(-along*5.0), uCore);
          float startFade = smoothstep(0.0, 0.022, along);
          float wisps = smoothstep(0.23, 0.80, turbulence + (1.0-r)*0.12);
          // Weak, distorted compression cells concentrate toward the axis,
          // rather than painting identical bright rings onto a cone surface.
          float cell = 0.5+0.5*cos(along*32.0 + broad*1.8 + r*2.8);
          float compression = pow(cell, 3.0) * exp(-r*r*5.0) * exp(-along*2.4);
          float density = radial * startFade * endFade *
            (0.18 + wisps * 1.5 + compression * 0.45);
          vec3 amber = mix(vec3(1.0, 0.27, 0.055), vec3(0.60, 0.18, 0.055), along);
          vec3 blue = vec3(0.20, 0.23, 0.90) * exp(-along*9.0);
          vec3 hot = mix(vec3(1.0, 0.77, 0.40), vec3(1.0, 0.42, 0.13), along);
          vec3 color = mix(amber + blue, hot, uCore * 0.72);
          energy += color * density;
        }
        // Cap integrated brightness for an end-on view. Additive blending uses
        // straight RGB; do not multiply the emissive energy by alpha twice.
        energy *= min(stepSize * 3.8, 0.35) * uIntensity * mix(1.3, 1.8, uCore);
        gl_FragColor = vec4(energy, 1.0);
      }`,
    transparent: true, depthTest: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.FrontSide,
  });
}
export class SR71AfterburnerFX {
  constructor(parent) {
    this.root = new THREE.Group(); this.root.name = 'SR-71 browser afterburner approximation';
    parent.add(this.root); this.time = 0;
    this.engines = ['left', 'right'].map((side, index) => {
      const group = new THREE.Group(); group.name = side + ' J58 browser plume';
      group.visible = false; this.root.add(group);
      const meshes = [false, true].map(core => {
        const geometry = new THREE.CylinderGeometry(core ? .30 : .62, core ? .30 : .62, 1, 24, 1, false);
        geometry.translate(0, .5, 0); geometry.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(geometry, plumeMaterial(index * 2.7, core));
        mesh.name = side + (core ? ' burner core' : ' burner plume');
        mesh.onBeforeRender = (_renderer, _scene, camera) => {
          // Inverse nonuniform model scale is required for long exhaust rays.
          // The uniform vector is reused; no frame allocations or scene nodes.
          mesh.worldToLocal(camera.getWorldPosition(mesh.material.uniforms.uEye.value));
        };
        mesh.layers.set(FX_LAYER); mesh.renderOrder = 7; group.add(mesh); return mesh;
      });
      return { group, meshes, bound: false, intensity: 0 };
    });
    this.point = new THREE.Vector3(); this.direction = new THREE.Vector3();
  }
  bind(sourceRoot, offset) {
    // Called once on the default exterior, while detached from aircraft/world.
    // Keep FX independent of cockpit visibility and flight/high-detail swapping.
    sourceRoot.updateWorldMatrix(true, true);
    for (const [i, side] of ['left', 'right'].entries()) {
      const anchor = sourceRoot.getObjectByName('FX_afterburner_' + side);
      if (!anchor) continue; // No invented aircraft-coordinate fallback.
      const fx = this.engines[i];
      anchor.getWorldPosition(fx.group.position).add(offset);
      anchor.getWorldQuaternion(fx.group.quaternion);
      fx.bound = true;
    }
  }
  update(dt, fdm, camWorld, groundY) {
    if (Number.isFinite(dt) && dt > 0) this.time += dt;
    const thin = 1 + .65 * (1 - clamp01((fdm.out?.rho ?? 1.225) / 1.225));
    for (let i = 0; i < this.engines.length; i++) {
      const fx = this.engines[i], intensity = sr71BurnerIntensity(fdm.engines?.[i], fdm);
      fx.intensity = intensity;
      fx.group.visible = fx.bound && intensity > .01;
      // Clear shader energy on shutdown, even while the entire group is hidden.
      for (const mesh of fx.meshes) {
        mesh.material.uniforms.uIntensity.value = fx.group.visible ? .45 + .55 * intensity : 0;
        mesh.material.uniforms.uTime.value = this.time;
      }
      if (!fx.group.visible) continue;
      let length = (8 + 9 * intensity) * thin;
      // Ground intersection limit in camera-relative world coordinates. The
      // actual source attachment orientation points +Z forward; plume is -Z.
      if (Number.isFinite(groundY) && camWorld) {
        this.point.copy(fx.group.position).applyQuaternion(this.root.parent.quaternion).add(this.root.parent.position);
        this.direction.set(0, 0, -1).applyQuaternion(fx.group.quaternion).applyQuaternion(fdm.quat);
        if (this.direction.y < -.02) length = Math.min(length,
          Math.max(0, (this.point.y - (groundY - camWorld.y) - .15) / -this.direction.y));
      }
      fx.group.visible = length > .01;
      fx.meshes[0].scale.set(1, 1, length);
      fx.meshes[1].scale.set(1, 1, length * .74);
    }
  }
}
