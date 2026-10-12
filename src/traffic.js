import * as THREE from 'three';

const AIRCRAFT_CLASSES = [
  { class: 'widebody', size: 1.65, test: /^(?:A33|A34|A35|A38|B74|B76|B77|B78|B79|B7X|MD1|MD1|DC10|A30)/ },
  { class: 'narrowbody', size: 1.15, test: /^(?:A31|A32|A20|B70|B71|B72|B73|B38|B39|B3M|B3X|C919)/ },
  { class: 'regional', size: 0.82, test: /^(?:E17|E18|E19|E75|E7W|CRJ|CR[2379]|BCS|ARJ)/ },
  { class: 'turboprop', size: 0.68, test: /^(?:AT7|AT4|AT5|AT6|AT7|DH[248]|Q4|SF34|BE20|C208)/ },
  { class: 'helicopter', size: 0.48, test: /^(?:H[1256][0-9A-Z]{2}|R22|R44|R66|EC[0-9A-Z]{2}|AS[0-9A-Z]{2}|B06|B07|S76|AW1)/ },
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

export function trafficBackoffSeconds(failures, status = 0) {
  if (status && status < 500 && status !== 403 && status !== 429) return 15;
  return Math.min(120, 15 * 2 ** Math.min(Math.max(1, failures), 3));
}

// Live air traffic from adsb.lol: aircraft within about 100 km are fetched every 15 s, dead-reckoned between updates, and drawn as
// small airliner silhouettes (fuselage, swept wing, tail) with position lights at night. Aircraft on the ground are not drawn.
export class Traffic {
  constructor(scene, geo, base = '/') {
    this.scene = scene; this.geo = geo; this.base = base; this.enabled = true; this.list = new Map(); this.t = 0; this.busy = false; this.last = { lat: 0, lon: 0 }; this.count = 0; this.err = null; this.fails = 0; this.warned = false; this.nextPollSeconds = 15;
    const mat = new THREE.MeshStandardMaterial({ color: 0xdfe3e8, roughness: 0.55, metalness: 0.2 });
    const parts = [new THREE.CylinderGeometry(1.9, 1.9, 36, 10).rotateZ(Math.PI / 2)];
    const nose = new THREE.SphereGeometry(1.9, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateZ(-Math.PI / 2); nose.translate(18, 0, 0); parts.push(nose);
    const wing = new THREE.BufferGeometry(); wing.setAttribute('position', new THREE.Float32BufferAttribute([4, -0.3, 0, -6, -0.3, -17, -9, -0.3, -17, -3, -0.3, 0, 4, -0.3, 0, -6, -0.3, 17, -9, -0.3, 17, -3, -0.3, 0], 3)); wing.setIndex([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6]); wing.computeVertexNormals();
    parts.push(wing);
    const fin = new THREE.BufferGeometry(); fin.setAttribute('position', new THREE.Float32BufferAttribute([-14, 1.2, 0, -19, 1.2, 0, -19, 8, 0, -16, 8, 0], 3)); fin.setIndex([0, 1, 2, 0, 2, 3]); fin.computeVertexNormals(); parts.push(fin);
    const tp = new THREE.BufferGeometry(); tp.setAttribute('position', new THREE.Float32BufferAttribute([-15.5, 1, 0, -19, 1, -6, -20, 1, -6, -19, 1, 0, -15.5, 1, 0, -19, 1, 6, -20, 1, 6, -19, 1, 0], 3)); tp.setIndex([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6]); tp.computeVertexNormals(); parts.push(tp);
    this.geoms = parts; this.mat = mat; this.mat.side = THREE.DoubleSide;
    this.group = new THREE.Group(); scene.add(this.group);
    this.lightMat = new THREE.SpriteMaterial({ color: 0xff3a2a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  }
  make() {
    const g = new THREE.Group();
    for (const p of this.geoms) { const m = new THREE.Mesh(p, this.mat); m.castShadow = false; g.add(m); }
    const l = new THREE.Sprite(this.lightMat); l.scale.setScalar(6); l.position.set(-1, 3, 0); g.add(l); g.userData.light = l;
    this.group.add(g); return g;
  }
  async poll(lat, lon) {
    this.busy = true;
    let lastStatus = 0, retryStatus = 0;
    try {
      const q = `lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}&dist=54`;
      const sources = [`${this.base}api/traffic?${q}`, `https://api.adsb.lol/v2/point/${lat.toFixed(2)}/${lon.toFixed(2)}/54`];
      let j = null, cacheSeconds = 15, errors = [];
      for (const url of sources) {
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 9000);
        try {
          const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
          lastStatus = response.status;
          if (response.status === 403 || response.status === 429 || response.status >= 500) retryStatus = response.status;
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
      this.err = null; this.fails = 0; this.nextPollSeconds = cacheSeconds;
    } catch (e) {
      this.err = e.message; this.fails++;
      this.nextPollSeconds = trafficBackoffSeconds(this.fails, retryStatus || lastStatus);
      if (!this.warned) { this.warned = true; this.onFail && this.onFail('Live traffic unavailable'); }
    }
    this.busy = false;
  }
  // camWorld: render origin; ownLatLon: the player's position; night 0..1
  update(dt, { camWorld, lat, lon, night, own }) {
    this.group.visible = this.enabled; if (!this.enabled) return;
    this.t += dt;
    if (!this.busy && this.t >= this.nextPollSeconds && (this.t > 3 || Math.abs(lat - this.last.lat) > 0.5 || Math.abs(lon - this.last.lon) > 0.7)) { this.t = 0; this.last = { lat, lon }; this.poll(lat, lon); }
    const now = performance.now() / 1000; let n = 0;
    for (const e of this.list.values()) {
      const dtp = Math.min(40, now - e.at), th = e.trk * Math.PI / 180, m = e.vel * dtp;
      const la = e.lat + (Math.cos(th) * m) / 111320, lo = e.lon + (Math.sin(th) * m) / (111320 * Math.max(0.2, Math.cos(e.lat * Math.PI / 180)));
      const p = this.geo.toXZ(la, lo), y = e.alt + e.vr * dtp;
      const dx = p.x - own.x, dz = p.z - own.z;
      if (dx * dx + dz * dz > 100e3 * 100e3) { if (e.mesh) e.mesh.visible = false; continue; }
      if (!e.mesh) e.mesh = this.make();
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
