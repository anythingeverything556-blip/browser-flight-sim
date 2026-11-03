import { destination } from './geo.js';
import { esc } from './esc.js';

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const Ue = L,
  zl = (s) => `https://services.arcgisonline.com/ArcGIS/rest/services/${s}/MapServer/tile/{z}/{y}/{x}`,
  ru = (s) => `https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/${s}/MapServer/tile/{z}/{y}/{x}`;
class MapPanel {
  constructor(t, e, n, i) {
    ((this.db = e),
      (this.nav = n),
      (this.cb = i),
      (this.map = Ue.map(t, { zoomControl: !1, attributionControl: !1, preferCanvas: !0, worldCopyJump: !0 }).setView(
        [39.13, -121.44],
        8,
      )),
      Ue.control.zoom({ position: 'bottomright' }).addTo(this.map));
    const r = {
      Satellite: Ue.tileLayer(zl('World_Imagery'), { maxZoom: 19, attribution: 'Imagery © Esri, Maxar' }),
      'Dark (navigation)': Ue.tileLayer(zl('Canvas/World_Dark_Gray_Base'), {
        maxZoom: 19,
        maxNativeZoom: 16,
        attribution: '© Esri',
      }),
      Topographic: Ue.tileLayer(zl('World_Topo_Map'), { maxZoom: 19, attribution: '© Esri' }),
      Streets: Ue.tileLayer(zl('World_Street_Map'), { maxZoom: 19, attribution: '© Esri' }),
      'FAA VFR Sectional (US)': Ue.tileLayer(ru('VFR_Sectional'), {
        maxZoom: 19,
        maxNativeZoom: 12,
        attribution: 'FAA',
      }),
      'FAA IFR Low (US)': Ue.tileLayer(ru('IFR_AreaLow'), { maxZoom: 19, maxNativeZoom: 11, attribution: 'FAA' }),
      'FAA IFR High (US)': Ue.tileLayer(ru('IFR_High'), { maxZoom: 19, maxNativeZoom: 9, attribution: 'FAA' }),
    };
    (r['Dark (navigation)'].addTo(this.map),
      Ue.control.layers(r, null, { position: 'topright', collapsed: !0 }).addTo(this.map),
      (this.renderer = Ue.canvas({ padding: 0.3 })),
      (this.aptLayer = Ue.layerGroup().addTo(this.map)),
      (this.rings = Ue.layerGroup().addTo(this.map)),
      (this.routeLine = Ue.polyline([], { color: '#70d6f3', weight: 3, opacity: 0.9 }).addTo(this.map)),
      (this.toActive = Ue.polyline([], { color: '#f2c36f', weight: 2, dashArray: '6 6', opacity: 0.9 }).addTo(
        this.map,
      )),
      (this.wpLayer = Ue.layerGroup().addTo(this.map)),
      (this.trail = Ue.polyline([[]], { color: '#70d6f3', weight: 2, opacity: 0.85 }).addTo(this.map)),
      (this.track = Ue.polyline([], { color: '#70d6f3', weight: 2, dashArray: '2 6' }).addTo(this.map)),
      (this.segs = [[]]),
      (this.last = null),
      (this.icon = Ue.divIcon({
        className: 'ac-marker',
        iconSize: [36, 36],
        iconAnchor: [18, 18],
        html: '<div class="ac-rot"><svg viewBox="0 0 36 36" width="36" height="36"><path d="M18 2 L19.6 11 L21 11.5 L22 9 L23.5 9 L24 20 L33 27 L33 29 L24 27 L22 30 L20 30 L19 34 L17 34 L16 30 L14 30 L12 27 L3 29 L3 27 L12 20 L12.5 9 L14 9 L15 11.5 L16.4 11 Z" fill="#08141e" stroke="#70d6f3" stroke-width="1.4"/></svg></div>',
      })),
      (this.marker = Ue.marker([39.13, -121.44], { icon: this.icon, interactive: !1, zIndexOffset: 1e3 }).addTo(
        this.map,
      )),
      (this.follow = !0),
      this.map.on('dragstart', () => this.setFollow(!1)),
      this.map.on('moveend zoomend', () => this.drawAirports()),
      this.map.on('click', (l) => this.mapClick(l.latlng)));
    const a = Ue.Control.extend({
      onAdd: () => {
        const l = Ue.DomUtil.create('button', 'map-follow on');
        return (
          (l.type = 'button'),
          (l.setAttribute('aria-label', 'Follow aircraft')),
          (l.setAttribute('aria-pressed', 'true')),
          (l.title = 'Center map on the aircraft'),
          (l.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/></svg><span>Follow</span>'),
          (l.onclick = (h) => {
            (Ue.DomEvent.stop(h), this.setFollow(!this.follow));
          }),
          (this.followBtn = l),
          l
        );
      },
    });
    (new a({ position: 'topleft' }).addTo(this.map), n.onChange(() => this.drawRoute()));
  }
  setFollow(t) {
    ((this.follow = t),
      this.followBtn && this.followBtn.classList.toggle('on', t),
      this.followBtn && this.followBtn.setAttribute('aria-pressed', String(t)),
      t && this.pos && this.map.panTo(this.pos, { animate: !1 }));
  }
  drawAirports(t = !1) {
    if (!this.db.ready) return;
    const e = this.map.getZoom(),
      n = this.map.getBounds();
    if (!t && this.drawn && this.drawn.z === e && this.drawn.b.contains(n)) return;
    const i = n.pad(0.15);
    if (!this.aptMarks || this.drawn?.z !== e || this.aptCount !== this.db.list.length) { this.aptLayer.clearLayers(); this.aptMarks = new Map(); this.aptCount = this.db.list.length; } // markers depend on the zoom: rebuild only when it changes, otherwise add what scrolled in and drop what scrolled out
    this.drawn = { z: e, b: i };
    const want = new Set();
    let r = 0;
    for (const a of this.db.list) {
      if ((a.type === 2 && e < 8) || (a.type === 1 && e < 6) || !i.contains([a.lat, a.lon])) continue;
      if (++r > 900) break;
      want.add(a);
      if (this.aptMarks.has(a)) continue;
      const g = Ue.layerGroup(), l = a.mil ? '#ff8a3d' : a.type === 0 ? '#4fc3ff' : a.type === 1 ? '#8fd18f' : '#c9c9c9';
      if (e >= 10)
        for (const u of a.rawRunways)
          Ue.polyline(
            [
              [u[2], u[3]],
              [u[4], u[5]],
            ],
            {
              renderer: this.renderer,
              color: l,
              weight: Math.max(3, Math.min(10, (e - 9) * 2.5)),
              opacity: 0.95,
              interactive: !1,
            },
          ).addTo(g);
      const h = Ue.circleMarker([a.lat, a.lon], {
        renderer: this.renderer,
        radius: a.type === 0 ? 6 : a.type === 1 ? 4.5 : 3.5,
        color: l,
        weight: 2,
        fillColor: '#0b0f14',
        fillOpacity: e >= 10 ? 0 : 0.9,
      });
      (h.on('click', (u) => {
        (Ue.DomEvent.stop(u), this.cb.onAirport(a));
      }),
        h.bindTooltip(esc(`${a.ident} ${a.name}`), { direction: 'top', offset: [0, -4] }),
        h.addTo(g),
        e >= 8 &&
          (a.type === 0 || e >= 9) &&
          Ue.marker([a.lat, a.lon], {
            icon: Ue.divIcon({ className: 'apt-label', html: esc(a.ident), iconSize: [40, 14], iconAnchor: [-6, 7] }),
            interactive: !1,
          }).addTo(g));
      g.addTo(this.aptLayer);
      this.aptMarks.set(a, g);
    }
    for (const [a, g] of this.aptMarks) if (!want.has(a)) { this.aptLayer.removeLayer(g); this.aptMarks.delete(a); }
  }
  mapClick(t) {
    const e = document.createElement('div');
    ((e.className = 'map-pop'),
      (e.setAttribute('role', 'group'), e.setAttribute('aria-label', 'Map location options')), (e.innerHTML = `<div class="mp-coord">${t.lat.toFixed(4)}, ${t.lng.toFixed(4)}</div>`));
    const n = (i, r, a = '') => {
      const l = document.createElement('button');
      ((l.type = 'button'),
        (l.textContent = i),
        (l.className = a),
        (l.onclick = () => {
          (this.map.closePopup(), r());
        }),
        e.appendChild(l));
    };
    (n('Add waypoint', () => this.cb.addWaypoint(t.lat, t.lng)),
      n('Direct to here', () => this.cb.directTo(t.lat, t.lng)),
      n('Teleport here', () => this.cb.teleport(t.lat, t.lng), 'primary'),
      Ue.popup({ closeButton: !1 }).setLatLng(t).setContent(e).openOn(this.map));
  }
  drawRoute() {
    const t = this.nav.wps;
    (this.routeLine.setLatLngs(t.map((e) => [e.lat, e.lon])),
      this.wpLayer.clearLayers(),
      t.forEach((e, n) => {
        const i = Ue.marker([e.lat, e.lon], {
          draggable: !0,
          icon: Ue.divIcon({
            className: 'wp-marker' + (n === this.nav.active ? ' active' : ''),
            html: `<span>${n + 1}</span><b>${esc(e.name)}</b>`,
            iconSize: [20, 20],
            iconAnchor: [10, 10],
          }),
        });
        (i.on('dragend', () => {
          const r = i.getLatLng();
          ((e.lat = r.lat), (e.lon = r.lng), (e.name = e.apt ? e.name : `WP${n + 1}`), this.nav.changed());
        }),
          i.addTo(this.wpLayer));
      }));
  }
  // Live ADS-B traffic on the map: one marker per aircraft, rotated to its track, shaped by its type class, dead-reckoned between polls.
  setTraffic(list, show) {
    if (!this.trafficLayer) { this.trafficLayer = Ue.layerGroup(); this.trafficMarks = new Map(); }
    if (!show) { if (this.map.hasLayer(this.trafficLayer)) this.map.removeLayer(this.trafficLayer); return; }
    if (!this.map.hasLayer(this.trafficLayer)) this.trafficLayer.addTo(this.map);
    const SHAPES = {
      airliner: 'M16 1 L17.6 11 L30 19 L30 21.6 L17.6 17.6 L17.2 26 L21 29 L21 30.6 L16 29.6 L11 30.6 L11 29 L14.8 26 L14.4 17.6 L2 21.6 L2 19 L14.4 11 Z',
      small: 'M16 3 L17.4 12 L28 14 L28 16.4 L17.4 16 L17 26 L21 28 L21 29.6 L16 28.8 L11 29.6 L11 28 L15 26 L14.6 16 L4 16.4 L4 14 L14.6 12 Z',
      heli: 'M16 4 L18 10 L18 20 L17 27 L19 29 L13 29 L15 27 L14 20 L14 10 Z M3 15 L29 17 L29 18 L3 16 Z',
      jet: 'M16 2 L18 12 L27 25 L27 27 L18 24 L17 29 L16 30 L15 29 L14 24 L5 27 L5 25 L14 12 Z',
    };
    const shapeOf = (c) => (c === 'helicopter' ? 'heli' : c === 'ga' || c === 'turboprop' ? 'small' : c === 'fighter' || c === 'bizjet' ? 'jet' : 'airliner');
    const now = performance.now() / 1000, seen = new Set();
    for (const [id, e] of list) {
      if (e.lat == null) continue;
      seen.add(id);
      const dtp = Math.min(40, now - e.at), th = (e.trk * Math.PI) / 180, m = e.vel * dtp;
      const la = e.lat + (Math.cos(th) * m) / 111320, lo = e.lon + (Math.sin(th) * m) / (111320 * Math.max(0.2, Math.cos((e.lat * Math.PI) / 180)));
      let mk = this.trafficMarks.get(id);
      const label = `${esc(e.call || String(id).toUpperCase())}${e.type ? ' · ' + esc(e.type) : ''}<br>${Math.round((+e.alt * 3.28084) / 100) * 100} ft · ${Math.round(+e.vel * 1.94384)} kt`; // escaped: the fields come from third-party ADS-B JSON
      if (!mk) {
        const size = e.typeClass === 'widebody' ? 26 : e.typeClass === 'ga' || e.typeClass === 'helicopter' ? 16 : 20;
        mk = Ue.marker([la, lo], { interactive: true, keyboard: false, zIndexOffset: 400, icon: Ue.divIcon({ className: 'tr-marker', iconSize: [size, size], iconAnchor: [size / 2, size / 2],
          html: `<div class="tr-rot"><svg viewBox="0 0 32 32" width="${size}" height="${size}"><path d="${SHAPES[shapeOf(e.typeClass)]}"/></svg></div>` }) });
        mk.bindTooltip(label, { direction: 'top', offset: [0, -8], className: 'tr-tip' }); mk.addTo(this.trafficLayer); this.trafficMarks.set(id, mk);
      } else { mk.setLatLng([la, lo]); if (mk.getTooltip()) mk.setTooltipContent(label); }
      const el = mk.getElement && mk.getElement(), rot = el && el.querySelector('.tr-rot'); if (rot) rot.style.transform = `rotate(${e.trk}deg)`;
    }
    for (const [id, mk] of this.trafficMarks) if (!seen.has(id)) { this.trafficLayer.removeLayer(mk); this.trafficMarks.delete(id); }
  }
  applyMarker() {
    this.marker.setLatLng(this.pos);
    const a = this.marker.getElement && this.marker.getElement(), l = a && a.querySelector('.ac-rot');
    if (l) l.style.transform = `rotate(${this.heading || 0}deg)`;
  }
  update(t, e, n, i, r) {
    this.pos = [t, e]; this.heading = n;
    if (!this.last || Math.abs(this.last[0] - t) + Math.abs(this.last[1] - e) > 0.003) {
      if (this.last && Ue.latLng(this.last).distanceTo(this.pos) > 4e3) this.segs.push([]);
      const seg = this.segs[this.segs.length - 1];
      seg.push(this.pos);
      if (seg.length > 3e3) seg.shift();
      this.last = this.pos; this.trailDirty = true;
    }
    if (!r) return; // map closed: keep recording the trail but skip every Leaflet projection and DOM write until it is shown
    this.applyMarker();
    if (this.trailDirty) { this.trail.setLatLngs(this.segs); this.trailDirty = false; }
    const h = Math.hypot(i.x, i.z),
      u = ((Math.atan2(i.x, -i.z) * 180) / Math.PI + 360) % 360;
    if (h > 5) {
      const d = destination(t, e, u, h * 120);
      this.track.setLatLngs([this.pos, [d.lat, d.lon]]);
    } else this.track.setLatLngs([]);
    this.ringCircles
      ? this.ringCircles.forEach((d) => d.setLatLng(this.pos))
      : (this.ringCircles = [25, 50, 100].map((d) =>
          Ue.circle(this.pos, {
            radius: d * 1852,
            renderer: this.renderer,
            color: '#5ee1ff',
            weight: 1,
            opacity: 0.35,
            fill: !1,
            interactive: !1,
          }).addTo(this.rings),
        ));
    const f = this.nav.wps[this.nav.active];
    (this.toActive.setLatLngs(f ? [this.pos, [f.lat, f.lon]] : []),
      this.follow &&
        this.map.latLngToLayerPoint(this.pos).distanceTo(this.map.latLngToLayerPoint(this.map.getCenter())) > 2 &&
        this.map.panTo(this.pos, { animate: !1 }));
  }
  focus(t, e, n = 12) {
    (this.setFollow(!1), this.map.setView([t, e], n));
  }
  clearTrail() {
    ((this.segs = [[]]), this.trail.setLatLngs(this.segs), (this.last = null), (this.trailDirty = !1));
  }
  shown() {
    setTimeout(() => {
      (this.map.invalidateSize(),
        this.pos && this.applyMarker(),
        this.trailDirty && (this.trail.setLatLngs(this.segs), (this.trailDirty = !1)),
        this.follow && this.pos && this.map.setView(this.pos, this.map.getZoom(), { animate: !1 }),
        this.drawAirports(!0),
        this.drawRoute());
    }, 60);
  }
}

export { MapPanel };
