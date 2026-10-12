import * as THREE from 'three';
import { R_EARTH, D2R, destination, haversine } from './geo.js';

// Worldwide airports and runways from OurAirports (public domain), compacted by tools_build_airports.py.
// Record: [ident, iata, name, city, country, flags, lat, lon, elevM, runways]
// Runway: [leIdent, heIdent, leLat, leLon, heLat, heLon, leElevM, heElevM, widthM, paved, lighted]
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const CURVE = (0.5 / R_EARTH).toExponential(8);
const TYPE_NAMES = ['Large', 'Medium', 'Small'];

export class Runway {
  constructor(ap, r) {
    this.ap = ap;
    [this.leIdent, this.heIdent] = r;
    this.a = { lat: r[2], lon: r[3] }; this.b = { lat: r[4], lon: r[5] };
    this.ea = r[6]; this.eb = r[7]; this.width = Math.max(18, r[8]); this.paved = !!r[9]; this.lighted = !!r[10];
    this.lat = (this.a.lat + this.b.lat) / 2; this.lon = (this.a.lon + this.b.lon) / 2;
    this.cos = Math.cos(this.lat * D2R);
    const dx = (this.b.lon - this.a.lon) * D2R * R_EARTH * this.cos, dy = (this.b.lat - this.a.lat) * D2R * R_EARTH;
    this.len = Math.hypot(dx, dy);
    this.hdg = (Math.atan2(dx, dy) / D2R + 360) % 360;
    this.sinH = Math.sin(this.hdg * D2R); this.cosH = Math.cos(this.hdg * D2R);
    this.elev = (this.ea + this.eb) / 2;
    this.ends = [
      { ident: this.leIdent, start: this.a, hdg: this.hdg, elev: this.ea, rwy: this, idx: 0 },
      { ident: this.heIdent, start: this.b, hdg: (this.hdg + 180) % 360, elev: this.eb, rwy: this, idx: 1 },
    ];
    this.group = null;
  }
  get name() { return `${this.leIdent}/${this.heIdent}`; }
  local(lat, lon) {
    const e = (((lon - this.lon + 540) % 360) - 180) * D2R * R_EARTH * this.cos, n = (lat - this.lat) * D2R * R_EARTH;
    return { s: e * this.sinH + n * this.cosH, t: e * this.cosH - n * this.sinH };
  }
  pointAlong(s, t = 0) {
    const e = s * this.sinH + t * this.cosH, n = s * this.cosH - t * this.sinH;
    return { lat: this.lat + n / R_EARTH / D2R, lon: this.lon + e / (R_EARTH * this.cos) / D2R };
  }
  // surface height along the runway (published end elevations, linear slope)
  surfaceAt(s) { const k = Math.min(1, Math.max(0, s / this.len + 0.5)); return this.ea + (this.eb - this.ea) * k; }
  // returns { f, h }: f = 0 on the levelled strip, 1 where natural terrain resumes; null when far
  flatten(lat, lon) {
    const { s, t } = this.local(lat, lon);
    const ds = Math.max(0, Math.abs(s) - (this.len / 2 + 300)), dt = Math.max(0, Math.abs(t) - (this.width / 2 + 120));
    const d = Math.hypot(ds, dt);
    if (d > 450) return null;
    return { f: smooth(0, 450, d), h: this.surfaceAt(s) };
  }
  spawn(endIdx, mode) {
    const end = this.ends[endIdx];
    if (mode === 'runway') {
      const p = destination(end.start.lat, end.start.lon, end.hdg, 90);
      return { ...p, alt: end.elev, hdg: end.hdg, speed: 0, ground: true };
    }
    if (mode === 'approach' || mode === 'final') {
      const d = mode === 'final' ? 9260 : 18520, p = destination(end.start.lat, end.start.lon, (end.hdg + 180) % 360, d);
      return { ...p, alt: end.elev + 4 + (d + 300) * Math.tan(3 * D2R), hdg: end.hdg, speed: 92, ground: false, gamma: -3 };
    }
    const p = destination(end.start.lat, end.start.lon, end.hdg, 30000);
    return { ...p, alt: 24384, hdg: end.hdg, speed: 3.2 * 295.07, ground: false };
  }
  ils(endIdx) { return this.paved && this.len >= 1500 ? `I-${this.ap.ident.slice(-3)} ${(108.1 + ((this.ap.ident.charCodeAt(1) + endIdx * 7 + this.leIdent.charCodeAt(0)) % 39) * 0.05).toFixed(2)}` : null; }

  // edge, centreline, threshold/end, touchdown-zone, approach lights and PAPI (colour computed per pixel from the viewer's angle)
  buildLights(geo) {
    const pos = [], col = [], papi = [];
    const c = geo.toXZ(this.lat, this.lon);
    this.wx = c.x; this.wz = c.z;
    const add = (s, t, color, p = 0, lift = 0.4) => {
      const ll = this.pointAlong(s, t), q = geo.toXZ(ll.lat, ll.lon);
      pos.push(q.x - this.wx, this.surfaceAt(s) + lift, q.z - this.wz); col.push(...color); papi.push(p);
    };
    const L = this.len / 2, W = this.width / 2;
    const white = [1, 0.93, 0.78], green = [0.25, 1, 0.35], red = [1, 0.15, 0.1], amber = [1, 0.7, 0.25];
    for (let s = -L; s <= L + 0.1; s += 60) { const caution = Math.abs(s) > L - 600; add(s, -W - 1.5, caution ? amber : white); add(s, W + 1.5, caution ? amber : white); }
    if (this.len > 1800) for (let s = -L + 15; s < L; s += 15) { const r = L - Math.abs(s); add(s, 0, r < 300 ? red : (r < 900 && Math.floor(s / 15) % 2 ? red : white)); }
    for (let t = -W; t <= W + 0.1; t += 3) { add(-L - 2, t, green); add(L + 2, t, green); add(-L + 2, t, red); add(L - 2, t, red); }
    for (const sg of [-1, 1]) {
      // touchdown zone barrettes
      if (this.len > 2400) for (let d = 60; d <= 900; d += 60) for (const tt of [-11, -9, -7, 7, 9, 11]) add(sg * (L - d), tt, white, 0, 0.15);
      // approach lighting system with sequenced flasher line
      if (this.lighted || this.len > 2400) for (let d = 30; d <= 900; d += 30) {
        add(sg * (L + d), 0, white, 0, 0.6 + d * 0.004);
        if (d % 60 === 0) for (let t = -6; t <= 6; t += 1.5) add(sg * (L + d), t, white, 0, 0.6 + d * 0.004);
        if (d === 300) for (let t = -15; t <= 15; t += 1.5) add(sg * (L + d), t, white, 0, 1.8);
      }
      // PAPI: four boxes left of the runway as the landing pilot sees it, 300 m past the threshold; the box nearest the runway has the highest setting (3.5°), the outermost the lowest (2.5°)
      const ths = [3.5, 3.17, 2.83, 2.5];
      ths.forEach((th, i) => add(sg * (L - 300), sg * (W + 15 + i * 9), [1, 1, 1], th, 1.0));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('papi', new THREE.Float32BufferAttribute(papi, 1));
    const pts = new THREE.Points(g, LIGHT_MAT);
    pts.frustumCulled = false;
    this.group = new THREE.Group(); this.group.add(pts);
    return this.group;
  }
  disposeLights() { if (this.group) { this.group.removeFromParent(); this.group.children[0].geometry.dispose(); this.group = null; } }
}

export const LIGHT_MAT = new THREE.ShaderMaterial({
  uniforms: { uNight: { value: 1 } },
  vertexShader: `#include <common>
    #include <logdepthbuf_pars_vertex>
    attribute vec3 color; attribute float papi; varying vec3 vC; varying float vVis; uniform float uNight;
    void main(){
      vec4 w = modelMatrix * vec4(position, 1.0);
      float hd = length(w.xz);
      w.y -= hd * hd * ${CURVE};
      vC = color; vVis = uNight;
      if (papi > 0.0) {
        // camera sits at the world origin: elevation angle of the viewer seen from the light box
        float ang = degrees(atan(-w.y, hd));
        vC = ang > papi ? vec3(1.0, 0.95, 0.9) : vec3(1.0, 0.12, 0.08);
        vVis = max(uNight, 0.55);
      }
      vec4 mv = viewMatrix * w; gl_Position = projectionMatrix * mv;
      #include <logdepthbuf_vertex>
      gl_PointSize = clamp(1500.0 / -mv.z, 1.6 + 2.4 * vVis, papi > 0.0 ? 14.0 : 10.0) * step(0.05, vVis);
    }`,
  fragmentShader: `#include <common>
    #include <logdepthbuf_pars_fragment>
    varying vec3 vC; varying float vVis;
    void main(){
      #include <logdepthbuf_fragment>
      if (vVis < 0.05) discard;
      float a = 1.0 - smoothstep(0.0, 0.5, length(gl_PointCoord - 0.5));
      gl_FragColor = vec4(vC * (0.6 + 1.6 * vVis), a * vVis);
    }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
});

export class Airport {
  constructor(rec) {
    [this.ident, this.iata, this.name, this.city, this.country] = rec;
    const flags = rec[5];
    this.type = flags & 3; this.mil = !!(flags & 4);
    this.lat = rec[6]; this.lon = rec[7]; this.elev = rec[8];
    this.rawRunways = rec[9];
    this._runways = null;
  }
  get runways() { return this._runways || (this._runways = this.rawRunways.map((r) => new Runway(this, r))); }
  get typeName() { return (this.mil ? 'Military · ' : '') + TYPE_NAMES[this.type]; }
  get longest() { return this.runways[0]; }
  // tower camera: beside the middle of the longest runway, on the side away from the other runways
  towerLatLon() { const r = this.longest; return r.pointAlong(-r.len * 0.12, r.width / 2 + 280); }
  label() { return `${this.ident}${this.iata ? ' / ' + this.iata : ''} — ${this.name}`; }
}

export class AirportDB {
  constructor() { this.list = []; this.grid = new Map(); this.byIdent = new Map(); this.active = []; this.activeKey = ''; this.ready = false; }
  async load(url, onProgress) {
    const res = await fetch(url);
    const data = await res.json();
    this.list = data.map((r) => new Airport(r));
    for (const a of this.list) {
      // a runway whose ends are far from its airport is a data error: drop it rather than draw it across a continent
      a.rawRunways = a.rawRunways.filter((r) => haversine(a.lat, a.lon, r[2], r[3]) < 25000);
      if (!this.byIdent.has(a.ident.toUpperCase())) this.byIdent.set(a.ident.toUpperCase(), a);
      if (a.iata && !this.byIdent.has(a.iata)) this.byIdent.set(a.iata.toUpperCase(), a);
      const k = `${Math.floor(a.lat)},${Math.floor(a.lon)}`;
      if (!this.grid.has(k)) this.grid.set(k, []);
      this.grid.get(k).push(a);
    }
    this.ready = true; onProgress && onProgress(1);
    return this;
  }
  get(ident) { return this.byIdent.get(String(ident).toUpperCase()); }
  near(lat, lon, km) {
    const out = [], seen = new Set(), dl = Math.ceil(km / 111) + 1, dlo = Math.min(180, Math.ceil(km / (111 * Math.max(0.1, Math.cos(lat * D2R)))) + 1);
    for (let i = -dl; i <= dl; i++) for (let j = -dlo; j <= dlo; j++) {
      const key = `${Math.floor(lat) + i},${(((Math.floor(lon) + j + 180) % 360) + 360) % 360 - 180}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const cell = this.grid.get(key);
      if (!cell) continue;
      for (const a of cell) { const d = haversine(lat, lon, a.lat, a.lon); if (d < km * 1000) out.push({ a, d }); }
    }
    return out.sort((x, y) => x.d - y.d);
  }
  nearest(lat, lon, filter) {
    for (const km of [50, 200, 800, 3000]) { const n = this.near(lat, lon, km).filter((x) => !filter || filter(x.a)); if (n.length) return n[0]; }
    return null;
  }
  search(q, filter = 'all', limit = 60) {
    q = q.trim().toUpperCase();
    const pass = (a) => filter === 'all' || (filter === 'mil' && a.mil) || (filter === 'large' && a.type === 0) || (filter === 'long' && a.rawRunways.some((r) => haversine(r[2], r[3], r[4], r[5]) > 3000));
    if (!q) return this.list.filter(pass).slice(0, limit);
    const exact = this.get(q);
    const scored = [];
    for (const a of this.list) {
      if (!pass(a)) continue;
      let s = 0;
      if (a.ident.toUpperCase().startsWith(q) || a.iata.toUpperCase() === q) s = 3;
      else if (a.name.toUpperCase().includes(q)) s = 2;
      else if (a.city.toUpperCase().includes(q)) s = 1;
      if (s) scored.push([s - a.type * 0.3, a]);
    }
    scored.sort((x, y) => y[0] - x[0]);
    const out = scored.slice(0, limit).map((x) => x[1]);
    if (exact && pass(exact) && !out.includes(exact)) out.unshift(exact);
    return out;
  }
  // airports near the camera get levelled runways and lights
  updateActive(lat, lon, scene, geo, force) {
    const near = this.near(lat, lon, 45).slice(0, 24).map((x) => x.a);
    const key = near.map((a) => a.ident).join(',') + '|' + geo.version;
    if (key === this.activeKey && !force) return false;
    for (const a of this.active) if (!near.includes(a) || force || geo.version !== this.geoVersion) a.runways.forEach((r) => r.disposeLights());
    for (const a of near) for (const r of a.runways) if (!r.group) scene.add(r.buildLights(geo));
    this.active = near; this.activeKey = key; this.geoVersion = geo.version;
    this.activeRunways = near.flatMap((a) => a.runways);
    return true;
  }
  flatten(lat, lon, h) {
    let best = null;
    for (const r of this.activeRunways || []) {
      const f = r.flatten(lat, lon);
      if (f && (!best || f.f < best.f)) best = f;
    }
    if (!best) return h;
    return h === null ? best.h : best.h * (1 - best.f) + h * best.f;
  }
  positionLights(cw, night) {
    LIGHT_MAT.uniforms.uNight.value = night;
    for (const r of this.activeRunways || []) if (r.group) r.group.position.set(r.wx - cw.x, -cw.y, r.wz - cw.z);
  }
}
