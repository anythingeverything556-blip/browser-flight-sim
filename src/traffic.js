import * as THREE from 'three';
import { trafficGeometry } from './trafficmodels.js';

const AIRCRAFT_CLASSES = [
  { class: 'widebody', size: 1.65, test: /^(?:A33|A34|A35|A38|B74|B76|B77|B78|B79|B7X|MD1|MD1|DC10|A30)/ },
  { class: 'narrowbody', size: 1.15, test: /^(?:A31|A32|A20|B70|B71|B72|B73|B38|B39|B3M|B3X|C919)/ },
  { class: 'regional', size: 0.82, test: /^(?:E17|E18|E19|E75|E7W|CRJ|CR[2379]|BCS|ARJ)/ },
  { class: 'turboprop', size: 0.68, test: /^(?:AT7|AT4|AT5|AT6|AT7|DH[248]|Q4|SF34|BE20|C208)/ },
  { class: 'helicopter', size: 0.48, test: /^(?:H[1256][0-9A-Z]{2}|R22|R44|R66|EC[0-9A-Z]{2}|AS[0-9A-Z]{2}|B06|B07|S76|AW1)/ },
  { class: 'bizjet', size: 0.6, test: /^(?:GL[0-9A-Z]{2}|G[2-7][0-9]{2}|C5[0-9]{2}|C25[A-Z]|C68A|C700|C750|LJ[0-9]{2}|E50P|E55P|FA[0-9]X|F2TH|F900|CL[36][0-9]|BE4[0-9]|H25|PRM1|HDJT|SF50)/ },
  { class: 'fighter', size: 0.5, test: /^(?:F1[0-9]|F2[0-9]|F35|FA18|EUFI|RFAL|TORN|T38|A10|HAWK|GRIF|M346|JAS[0-9])/ },
  { class: 'ga', size: 0.42, test: /^(?:C1[0-9]{2}|C2[0-9]{2}|PA[0-9]{2}|BE[0-9]{2}|SR2[02])/ },
];

/** ICAO aircraft type designator to a display class and relative size. */
export function classifyAircraftType(typeCode) {
  const type = String(typeCode || '').trim().toUpperCase();
  const match = AIRCRAFT_CLASSES.find((entry) => entry.test.test(type));
  return { class: match?.class || 'unknown', size: match?.size || 1 };
}

export function trafficCacheSeconds(cacheControl, fallback = 15) {
  const match = String(cacheControl || '').match(/(?:^|,)\s*max-age=(\d+)/i);
  const seconds = match ? Number(match[1]) : fallback;
  return Math.max(15, Math.min(120, Number.isFinite(seconds) ? seconds : fallback));
}

export const TRAFFIC_BACKOFF_CAP = 300, TRAFFIC_STALE_SECONDS = 90;
// every failure (403/429/5xx, 404, an HTML page, a timeout) doubles the wait: 30, 60, 120, 240, then 300 s; the status no longer shortens it
export function trafficBackoffSeconds(failures) {
  return Math.min(TRAFFIC_BACKOFF_CAP, 15 * 2 ** Math.min(Math.max(1, failures), 5));
}

// Live air traffic from adsb.lol: aircraft within about 100 km are fetched every 15 s, dead-reckoned between updates, and drawn as
// small airliner silhouettes (fuselage, swept wing, tail) with position lights at night. Aircraft on the ground are not drawn.
export class Traffic {
  constructor(scene, geo, base = '/') {
    this.scene = scene; this.geo = geo; this.base = base; this.enabled = true; this.list = new Map(); this.t = 0; this.busy = false; this.last = { lat: 0, lon: 0 }; this.count = 0; this.err = null; this.fails = 0; this.warned = false; this.nextPollSeconds = 15; this.lastOk = 0;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.15, side: THREE.DoubleSide });
    this.mat = mat;
    this.group = new THREE.Group(); scene.add(this.group);
    this.lightMat = new THREE.SpriteMaterial({ color: 0xff3a2a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  }
  make(cls = 'unknown', type = '') {
    const g = new THREE.Group(), geom = trafficGeometry(cls, type);
    const m = new THREE.Mesh(geom, this.mat); m.castShadow = false; g.add(m);
    geom.computeBoundingSphere(); const r = geom.boundingSphere.radius;
    const l = new THREE.Sprite(this.lightMat); l.scale.setScalar(Math.max(4, r * 0.18)); l.position.set(-r * 0.2, r * 0.12, 0); g.add(l); g.userData.light = l;
    this.group.add(g); return g;
  }
  async poll(lat, lon) {
    this.busy = true;
    try {
      const q = `lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}&dist=54`;
      const sources = [`${this.base}api/traffic?${q}`]; // the Pages function tries every provider; a direct call from the browser is blocked by CORS
      let j = null, cacheSeconds = 15, errors = [];
      for (const url of sources) {
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 9000);
        try {
          const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
          if (!response.ok) throw Object.assign(new Error(`traffic source answered ${response.status}`), { status: response.status });
          const data = await response.json();
          if (!data || !(Array.isArray(data.ac) || Array.isArray(data.aircraft))) throw new Error('traffic source returned invalid data');
          j = data; cacheSeconds = trafficCacheSeconds(response.headers?.get?.('cache-control'), 15); break;
        } catch (error) { errors.push(error.message || 'traffic source unavailable'); }
        finally { clearTimeout(timer); }
      }
      if (!j) throw new Error(errors.join('; ') || 'traffic sources unavailable');
      const now = performance.now() / 1000, seen = new Set();
      for (const a of (j.ac || j.aircraft || []).slice(0, 60)) {
        const alt = a.alt_geom ?? a.alt_baro;
        if (!a.hex || a.lat == null || a.lon == null || alt == null || alt === 'ground' || a.alt_baro === 'ground') continue;
        seen.add(a.hex);
        const e = this.list.get(a.hex) || { icao: a.hex, mesh: null };
        const aircraftClass = classifyAircraftType(a.t || a.type);
        Object.assign(e, { call: (a.flight || '').trim(), type: a.t || a.type || '', typeClass: aircraftClass.class, typeSize: aircraftClass.size, lat: a.lat, lon: a.lon, alt: alt * 0.3048, vel: (a.gs || 0) * 0.514444, trk: a.track || 0, vr: (a.baro_rate ?? a.geom_rate ?? 0) * 0.00508, at: now - Math.min(40, a.seen_pos || 0) });
        this.list.set(a.hex, e);
      }
      for (const [k, e] of this.list) if (!seen.has(k)) { if (e.mesh) this.group.remove(e.mesh); this.list.delete(k); }
      this.err = null; this.fails = 0; this.warned = false; this.nextPollSeconds = cacheSeconds; this.lastOk = now;
    } catch (e) {
      this.err = e.message; this.fails++;
      this.nextPollSeconds = trafficBackoffSeconds(this.fails);
      if (this.fails >= 3) this.clear();
      if (!this.warned) { this.warned = true; console.warn(`Live traffic unavailable (${this.err}); retrying with backoff`); this.onFail && this.onFail('Live traffic unavailable'); } // once per failure streak, not per retry
    }
    this.busy = false;
  }
  clear() { for (const e of this.list.values()) if (e.mesh) this.group.remove(e.mesh); this.list.clear(); this.count = 0; }
  // camWorld: render origin; ownLatLon: the player's position; night 0..1
  update(dt, { camWorld, lat, lon, night, own }) {
    this.group.visible = this.enabled; if (!this.enabled) return;
    this.t += dt;
    if (!this.busy && this.t >= this.nextPollSeconds && (this.t > 3 || Math.abs(lat - this.last.lat) > 0.5 || Math.abs(lon - this.last.lon) > 0.7)) { this.t = 0; this.last = { lat, lon }; this.poll(lat, lon); }
    const now = performance.now() / 1000; let n = 0;
    if (this.list.size && now - this.lastOk > TRAFFIC_STALE_SECONDS) this.clear(); // no good answer for 90 s: the dead-reckoned aircraft would only hang frozen on the map
    for (const e of this.list.values()) {
      const dtp = Math.min(40, now - e.at), th = e.trk * Math.PI / 180, m = e.vel * dtp;
      const la = e.lat + (Math.cos(th) * m) / 111320, lo = e.lon + (Math.sin(th) * m) / (111320 * Math.max(0.2, Math.cos(e.lat * Math.PI / 180)));
      const p = this.geo.toXZ(la, lo), y = e.alt + e.vr * dtp;
      const dx = p.x - own.x, dz = p.z - own.z;
      if (dx * dx + dz * dz > 100e3 * 100e3) { if (e.mesh) e.mesh.visible = false; continue; }
      if (!e.mesh) e.mesh = this.make(e.typeClass, e.type);
      e.mesh.visible = true; n++;
      e.mesh.position.set(p.x - camWorld.x, y - camWorld.y, p.z - camWorld.z);
      // the model's nose is +x; heading is clockwise from north, with east = +x and north = -z
      e.mesh.rotation.order = 'YZX'; e.mesh.rotation.y = Math.PI / 2 - th; e.mesh.rotation.z = Math.atan2(e.vr, Math.max(60, e.vel));
      const far = Math.hypot(dx, dz, y - own.y);
      e.mesh.scale.setScalar(far > 20000 ? Math.min(6, far / 20000 * 1.4) : 1);
      e.mesh.userData.light.visible = night > 0.1 || far > 15000; e.mesh.userData.light.material.opacity = 0.4 + 0.6 * night;
    }
    this.count = n;
  }
}
