// Live ADS-B on the flight map: real aircraft wherever the map looks, anywhere in the world, plus the providers' worldwide lists
// (military, emergency squawks). One canvas draws every aircraft (hundreds of DOM markers made the map stutter), dead-reckoned between polls.
// Data comes through the Pages function (functions/api/traffic.js): the providers do not allow browser calls (no CORS).
import L from 'leaflet';
import { esc } from './esc.js';
import { classifyAircraftType } from './traffic.js';

const NM = 1852, D2R = Math.PI / 180, MAX_NM = 250, MIN_NM = 20;
const POLL_S = 12, LIST_POLL_S = 30, KEEP_S = 90, TRAIL_MAX = 160;
// while the map is shut the area round the aircraft keeps loading at this pace, so opening the map shows traffic at once
const BG_POLL_S = 30, BG_NM = 150, MIN_GAP_S = 1;
export const MODES = { area: 'Map area', mil: 'Military', emergency: 'Emergency' };

// altitude colour scale (feet), low warm to high cool, the convention most live-traffic maps use
export const ALT_STOPS = [[0, [255, 112, 64]], [2000, [255, 170, 51]], [6000, [255, 222, 77]], [10000, [143, 227, 107]], [20000, [63, 217, 196]], [30000, [74, 168, 255]], [40000, [176, 124, 255]]];
export function altColor(ft) {
  if (ft == null) return 'rgb(150,156,166)';
  const s = ALT_STOPS; if (ft <= s[0][0]) return `rgb(${s[0][1]})`;
  for (let i = 1; i < s.length; i++) if (ft <= s[i][0]) {
    const k = (ft - s[i - 1][0]) / (s[i][0] - s[i - 1][0]), a = s[i - 1][1], b = s[i][1];
    return `rgb(${a.map((v, j) => Math.round(v + (b[j] - v) * k)).join(',')})`;
  }
  return `rgb(${s[s.length - 1][1]})`;
}

const EMERG = { 7500: 'Hijack', 7600: 'Radio failure', 7700: 'Emergency' };
export function emergencyOf(squawk, emergency) {
  if (EMERG[squawk]) return EMERG[squawk];
  if (emergency && emergency !== 'none') return String(emergency).replace(/^\w/, (c) => c.toUpperCase());
  return null;
}
const SOURCE = { adsb_icao: 'ADS-B', adsb_icao_nt: 'ADS-B', adsr_icao: 'ADS-R', tisb_icao: 'TIS-B', tisb_trackfile: 'TIS-B', mlat: 'MLAT', mode_s: 'Mode S', adsc: 'ADS-C', other: 'Other' };

// provider record (adsb.lol / adsb.fi shape, already slimmed by the proxy) -> map entry. Ground aircraft keep alt null.
export function normalize(a, nowS) {
  if (!a || !a.hex || a.lat == null || a.lon == null) return null;
  const ground = a.alt_baro === 'ground', alt = ground ? null : (a.alt_baro ?? a.alt_geom ?? null);
  const cls = classifyAircraftType(a.t || '');
  return {
    hex: String(a.hex).toLowerCase(), call: String(a.flight || '').trim(), reg: a.r || '', type: a.t || '', desc: a.desc || '', op: a.ownOp || '',
    cls: cls.class, lat: +a.lat, lon: +a.lon, alt: alt == null ? null : +alt, ground, gs: +(a.gs || 0), trk: +(a.track ?? a.true_heading ?? 0),
    vr: +(a.baro_rate ?? a.geom_rate ?? 0), squawk: a.squawk || '', emerg: emergencyOf(a.squawk, a.emergency), cat: a.category || '',
    src: SOURCE[a.type] || '', mil: !!(a.dbFlags & 1), selAlt: a.nav_altitude_mcp ?? null, mach: a.mach ?? null,
    at: nowS - Math.min(60, +(a.seen_pos ?? a.seen ?? 0)),
  };
}

// radius (NM) that covers the visible map from its centre, capped to what the providers answer
export function viewRadiusNm(map) {
  const c = map.getCenter(), b = map.getBounds();
  const r = Math.max(c.distanceTo(b.getNorthEast()), c.distanceTo(b.getSouthWest())) / NM;
  return Math.max(MIN_NM, Math.min(MAX_NM, Math.ceil(r)));
}

// dead reckoning from the report time, at most 60 s ahead
export function project(e, nowS) {
  const dt = Math.max(0, Math.min(60, nowS - e.at)), m = e.gs * 0.514444 * dt, th = e.trk * D2R;
  return [e.lat + (Math.cos(th) * m) / 111320, e.lon + (Math.sin(th) * m) / (111320 * Math.max(0.2, Math.cos(e.lat * D2R)))];
}

export function matches(e, q) {
  if (!q) return true;
  q = q.toLowerCase();
  return [e.call, e.reg, e.type, e.hex, e.squawk, e.op].some((v) => v && String(v).toLowerCase().includes(q));
}

// glyphs on a 32 x 32 grid, nose up
const GLYPH = {
  airliner: 'M16 1 L17.6 11 L30 19 L30 21.6 L17.6 17.6 L17.2 26 L21 29 L21 30.6 L16 29.6 L11 30.6 L11 29 L14.8 26 L14.4 17.6 L2 21.6 L2 19 L14.4 11 Z',
  small: 'M16 3 L17.4 12 L28 14 L28 16.4 L17.4 16 L17 26 L21 28 L21 29.6 L16 28.8 L11 29.6 L11 28 L15 26 L14.6 16 L4 16.4 L4 14 L14.6 12 Z',
  heli: 'M16 4 L18 10 L18 20 L17 27 L19 29 L13 29 L15 27 L14 20 L14 10 Z M3 15 L29 17 L29 18 L3 16 Z',
  jet: 'M16 2 L18 12 L27 25 L27 27 L18 24 L17 29 L16 30 L15 29 L14 24 L5 27 L5 25 L14 12 Z',
};
const glyphOf = (c) => (c === 'helicopter' ? 'heli' : c === 'ga' || c === 'turboprop' ? 'small' : c === 'fighter' || c === 'bizjet' ? 'jet' : 'airliner');
const sizeOf = (c) => (c === 'widebody' ? 1.25 : c === 'ga' || c === 'helicopter' ? 0.8 : 1);

const fmtAlt = (e) => (e.ground ? 'Ground' : e.alt == null ? '—' : e.alt >= 18000 ? `FL${Math.round(e.alt / 100)}` : `${Math.round(e.alt / 100) * 100} ft`);

// The canvas layer: sized to the map, redrawn on pan/zoom and a few times a second for the dead reckoning. Built on first use, not at import.
let AdsbCanvas = null;
const canvasLayer = () => (AdsbCanvas ||= L.Layer.extend({
  initialize(owner) { this.owner = owner; },
  onAdd(map) {
    this._map = map;
    if (!map.getPane('adsb')) { const p = map.createPane('adsb'); p.style.zIndex = 450; p.style.pointerEvents = 'none'; }
    this._c = L.DomUtil.create('canvas', 'adsb-canvas', map.getPane('adsb'));
    this._ev = { move: this._reset, resize: this._reset, zoomstart: this._hide, zoomend: this._reset, viewreset: this._reset };
    map.on(this._ev, this); this._reset();
  },
  onRemove(map) { map.off(this._ev, this); L.DomUtil.remove(this._c); this._c = null; },
  _hide() { if (this._c) this._c.style.visibility = 'hidden'; },
  _reset() {
    const m = this._map, c = this._c; if (!c) return;
    const size = m.getSize(), dpr = Math.min(2, window.devicePixelRatio || 1);
    L.DomUtil.setPosition(c, m.containerPointToLayerPoint([0, 0]));
    if (c.width !== Math.round(size.x * dpr) || c.height !== Math.round(size.y * dpr)) {
      c.width = Math.round(size.x * dpr); c.height = Math.round(size.y * dpr); c.style.width = size.x + 'px'; c.style.height = size.y + 'px';
    }
    c.style.visibility = ''; this.draw();
  },
  draw() { if (this._c) this.owner.draw(this._c, this._map); },
}));

export class LiveAdsb {
  // opts: { base, ownship: () => ({ lat, lon } | null), canFlyTo: () => bool, onFlyAlongside(entry), settings, save() }
  constructor(map, opts) {
    this.map = map; this.o = opts; this.list = new Map(); this.trails = new Map();
    const st = opts.settings || {};
    this.on = st.mapTraffic !== false; this.labels = st.mapLabels !== false; this.mode = MODES[st.mapTrafficMode] ? st.mapTrafficMode : 'area';
    this.query = ''; this.sel = null; this.followSel = false; this.active = false;
    this.next = 0; this.busy = false; this.fails = 0; this.status = { n: 0, src: '', at: 0, err: '' }; this.coverage = null;
    this.glyphs = Object.fromEntries(Object.entries(GLYPH).map(([k, d]) => [k, new Path2D(d)]));
    this.layer = new (canvasLayer())(this);
    this.cov = L.circle([0, 0], { radius: 1, color: '#5ee1ff', weight: 1, opacity: 0.35, dashArray: '4 6', fill: false, interactive: false });
    this.buildUi();
    map.on('moveend', () => this.moved());
    map.on('mousemove', (e) => this.hover(e));
    map.on('mouseout', () => { this.tip.hidden = true; this.cursor.textContent = ''; });
  }

  // ---------- data ----------
  // The map sheet opened or closed. The first fetch waits for viewReady(): before the sheet has laid out and moved to the aircraft the map
  // still shows the last place it was open (California on the first open), and the traffic came from there until the next 12 s poll.
  setActive(v) {
    if (v === this.active) return;
    this.active = v; this.viewOk = false;
    if (v && this.on) { this.layer.addTo(this.map); this.layer.draw(); this.renderUi(); this.loop(); } else { this.map.removeLayer(this.layer); this.map.removeLayer(this.cov); }
  }
  viewReady() { this.viewOk = true; if (this.active && this.on && !this.coversView()) this.next = 0; this.layer.draw(); }
  // does the last area fetched cover what the map shows now?
  coversView() {
    if (this.mode !== 'area') return !!this.status.at && performance.now() / 1000 < this.next;
    if (!this.coverage) return false;
    const c = this.map.getCenter(), d = c.distanceTo(this.coverage.c) / NM, r = viewRadiusNm(this.map);
    return d + r <= this.coverage.r * 1.05 && r <= this.coverage.r * 1.4;
  }
  url(at) {
    const b = this.o.base || '/';
    if (this.mode !== 'area') return { url: `${b}api/traffic?list=${this.mode}` };
    const c = at ? { lat: at.lat, lng: at.lon } : this.map.getCenter(), r = at ? at.r : viewRadiusNm(this.map), lon = ((((c.lng + 180) % 360) + 360) % 360) - 180;
    return { url: `${b}api/traffic?lat=${c.lat.toFixed(2)}&lon=${lon.toFixed(2)}&dist=${r}`, c: [c.lat, lon], r };
  }
  // map shut: keep the area round the aircraft (or the worldwide list) loaded, every BG_POLL_S
  background(own) {
    if (this.active || !this.on || this.busy) return;
    const now = performance.now() / 1000; if (now < (this.bgNext || 0)) return;
    this.bgNext = now + BG_POLL_S;
    if (this.mode !== 'area') { this.poll(); return; }
    if (own) this.poll({ lat: own.lat, lon: own.lon, r: Math.max(BG_NM, this.coverage ? Math.min(MAX_NM, this.coverage.r) : 0) });
  }
  async poll(at) {
    if (this.busy) return; this.busy = true; this.lastPoll = performance.now() / 1000;
    const q = this.url(at), ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 12000);
    try {
      const res = await fetch(q.url, { cache: 'no-store', signal: ctl.signal });
      if (!res.ok) throw new Error(res.status === 502 ? 'providers unavailable' : `error ${res.status}`);
      const j = await res.json(), arr = j.aircraft || j.ac;
      if (!Array.isArray(arr)) throw new Error('bad data');
      const now = performance.now() / 1000;
      if (this.mode !== 'area') this.list.clear(); // a worldwide list replaces the picture; the area view keeps what panning has shown for KEEP_S
      for (const a of arr) {
        const e = normalize(a, now); if (!e) continue;
        this.list.set(e.hex, e);
        let tr = this.trails.get(e.hex); if (!tr) this.trails.set(e.hex, (tr = []));
        const last = tr[tr.length - 1]; if (!last || last[0] !== e.lat || last[1] !== e.lon) { tr.push([e.lat, e.lon, e.alt]); if (tr.length > TRAIL_MAX) tr.shift(); }
      }
      this.coverage = q.c ? { c: q.c, r: q.r } : null;
      this.fails = 0; this.status = { n: arr.length, src: String(j.source || '').replace(/^api\./, ''), at: Date.now(), err: '', stale: !!j.stale };
      this.next = now + (this.mode === 'area' ? POLL_S : LIST_POLL_S);
    } catch (e) {
      // a first failure retries in 3 s, not 15: one slow answer should not leave the map empty
      this.fails++; this.status.err = e.name === 'AbortError' ? 'timed out' : e.message || 'unavailable';
      this.next = performance.now() / 1000 + Math.min(60, 3 * 2 ** (this.fails - 1));
    } finally {
      clearTimeout(timer); this.busy = false; this.prune(); this.renderUi(); this.layer.draw();
      // the view moved while that request was out: fetch the new area now instead of at the next poll
      if (this.active && this.viewOk && !this.fails && !this.coversView()) this.next = 0;
    }
  }
  prune() {
    const now = performance.now() / 1000;
    for (const [k, e] of this.list) if (now - e.at > KEEP_S + 60 || (this.mode === 'area' && now - e.at > KEEP_S)) { this.list.delete(k); this.trails.delete(k); }
    if (this.sel && !this.list.has(this.sel)) { this.sel = null; this.followSel = false; }
  }
  moved() {
    // the view left the area last fetched (or grew past it): fetch the new one right away (poll() re-checks when one is already out)
    if (!this.active || !this.on || !this.viewOk || this.mode !== 'area') return;
    if (!this.coversView()) this.next = Math.min(this.next, performance.now() / 1000 + 0.25);
  }
  loop() {
    if (!this.active || !this.on) { this.looping = false; return; }
    if (this.looping && !this._tick) return;
    this.looping = true; this._tick = false;
    const now = performance.now() / 1000;
    if (this.viewOk && now >= this.next && !this.busy && (this.lastPoll == null || now - this.lastPoll >= MIN_GAP_S)) this.poll();
    if (this.followSel && this.sel) { const e = this.list.get(this.sel); if (e) this.map.panTo(project(e, now), { animate: false }); }
    this.layer.draw();
    if (now - (this.uiAt || 0) > 1) { this.uiAt = now; this.renderUi(); }
    setTimeout(() => requestAnimationFrame(() => { this._tick = true; this.loop(); }), 150); // ~6 redraws a second is plenty for aircraft moving a few pixels
  }

  // ---------- drawing ----------
  draw(canvas, map) {
    const g = canvas.getContext('2d'), dpr = canvas.width / Math.max(1, canvas.clientWidth || canvas.width);
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height);
    const z = map.getZoom(), now = performance.now() / 1000, size = map.getSize(), q = this.query;
    const base = z < 4 ? 10 : z < 6 ? 11 : z < 8 ? 13 : z < 10 ? 16 : 19;
    const pts = []; let shown = 0;
    for (const e of this.list.values()) {
      if (e.ground && z < 10 && e.hex !== this.sel) continue;
      const ll = project(e, now), p = map.latLngToContainerPoint(ll);
      if (p.x < -30 || p.y < -30 || p.x > size.x + 30 || p.y > size.y + 30) continue;
      pts.push([e, p]); shown++;
    }
    this.drawn = pts; this.inView = shown;
    // selected aircraft's track history first, under the glyphs
    const se = this.sel && this.list.get(this.sel), tr = se && this.trails.get(se.hex);
    if (tr && tr.length) {
      g.lineWidth = 2.5; g.lineCap = 'round';
      let prev = map.latLngToContainerPoint([tr[0][0], tr[0][1]]);
      for (let i = 1; i <= tr.length; i++) {
        const pt = i < tr.length ? tr[i] : [...project(se, now), se.alt], cp = map.latLngToContainerPoint([pt[0], pt[1]]);
        g.strokeStyle = altColor(pt[2]); g.beginPath(); g.moveTo(prev.x, prev.y); g.lineTo(cp.x, cp.y); g.stroke(); prev = cp;
      }
    }
    // worldwide lists are short: label them at any zoom (the declutter below drops the overlaps)
    const labelAll = this.labels && ((z >= 8 && shown <= 250) || (this.mode !== 'area' && shown <= 150)), labels = [];
    g.font = '600 11px "Geist Mono", ui-monospace, monospace'; g.textBaseline = 'middle';
    for (const [e, p] of pts) {
      const hit = matches(e, q), sel = e.hex === this.sel, s = base * sizeOf(e.cls) * (sel ? 1.25 : 1);
      g.globalAlpha = q && !hit ? 0.22 : 1;
      if (e.emerg) { const pulse = 0.5 + 0.5 * Math.sin(now * 5); g.strokeStyle = `rgba(255,70,70,${0.5 + 0.5 * pulse})`; g.lineWidth = 2; g.beginPath(); g.arc(p.x, p.y, s * 0.9 + 3 * pulse, 0, 7); g.stroke(); }
      if (sel) { g.strokeStyle = '#ffffff'; g.lineWidth = 2; g.beginPath(); g.arc(p.x, p.y, s * 0.85, 0, 7); g.stroke(); }
      g.save(); g.translate(p.x, p.y); g.rotate(e.trk * D2R); g.scale(s / 32, s / 32); g.translate(-16, -16);
      g.fillStyle = altColor(e.ground ? null : e.alt); g.strokeStyle = 'rgba(8,12,18,0.9)'; g.lineWidth = 2.2; g.lineJoin = 'round';
      const path = this.glyphs[glyphOf(e.cls)]; g.stroke(path); g.fill(path); g.restore();
      if (sel || (labelAll && (!q || hit)) || (q && hit && shown <= 400)) labels.push([e, p, s, sel, !q || hit]);
    }
    g.globalAlpha = 1;
    // labels last, decluttered: the selected aircraft first, then each label only where it does not overlap one already placed
    labels.sort((a, b) => b[3] - a[3]);
    const boxes = [];
    for (const [e, p, s, sel] of labels) {
      const t1 = e.call || e.reg || e.hex.toUpperCase(), t2 = fmtAlt(e), x = p.x + s * 0.6 + 4;
      const w = Math.max(g.measureText(t1).width, g.measureText(t2).width) + 4, box = [x - 2, p.y - 13, x + w, p.y + 14];
      if (!sel && boxes.some((o) => box[0] < o[2] && box[2] > o[0] && box[1] < o[3] && box[3] > o[1])) continue;
      boxes.push(box);
      g.lineWidth = 3; g.strokeStyle = 'rgba(8,12,18,0.85)'; g.fillStyle = sel ? '#ffffff' : '#dfe8f1';
      g.strokeText(t1, x, p.y - 6); g.fillText(t1, x, p.y - 6);
      g.fillStyle = altColor(e.ground ? null : e.alt); g.strokeText(t2, x, p.y + 7); g.fillText(t2, x, p.y + 7);
    }
    // what the area view covers, when zoomed out further than the providers answer
    if (this.mode === 'area' && this.coverage && viewRadiusNm(map) >= MAX_NM) { this.cov.setLatLng(this.coverage.c).setRadius(this.coverage.r * NM); if (!map.hasLayer(this.cov)) this.cov.addTo(map); }
    else if (map.hasLayer(this.cov)) map.removeLayer(this.cov);
  }
  pick(cp) {
    let best = null, bd = 14;
    for (const [e, p] of this.drawn || []) { const d = Math.hypot(p.x - cp.x, p.y - cp.y); if (d < bd) { bd = d; best = e; } }
    return best;
  }
  // map click: an aircraft under the pointer is selected (returns true so the map's own click menu stays shut)
  click(cp) {
    if (!this.active || !this.on) return false;
    const e = this.pick(cp);
    if (!e) { if (this.sel) { this.select(null); return true; } return false; }
    this.select(e.hex); return true;
  }
  select(hex) { this.sel = hex; if (!hex) this.followSel = false; this.renderCard(); this.layer.draw(); }
  hover(ev) {
    const ll = ev.latlng, own = this.o.ownship && this.o.ownship();
    let t = `${Math.abs(ll.lat).toFixed(4)}° ${ll.lat >= 0 ? 'N' : 'S'}  ${Math.abs(ll.lng).toFixed(4)}° ${ll.lng >= 0 ? 'E' : 'W'}`;
    if (own) { const from = L.latLng(own.lat, own.lon), d = from.distanceTo(ll) / NM, brg = bearing(own.lat, own.lon, ll.lat, ll.lng); t += `  ·  ${d < 10 ? d.toFixed(1) : Math.round(d)} NM ${String(Math.round(brg) % 360).padStart(3, '0')}° from you`; }
    this.cursor.textContent = t;
    const e = this.active && this.on ? this.pick(ev.containerPoint) : null;
    this.map.getContainer().style.cursor = e ? 'pointer' : '';
    if (!e) { this.tip.hidden = true; return; }
    this.tip.hidden = false; this.tip.innerHTML = `<b>${esc(e.call || e.reg || e.hex.toUpperCase())}</b> ${esc(e.type)}<br>${fmtAlt(e)} · ${Math.round(e.gs)} kt`;
    this.tip.style.left = ev.containerPoint.x + 14 + 'px'; this.tip.style.top = ev.containerPoint.y - 10 + 'px';
  }

  // ---------- interface ----------
  buildUi() {
    const map = this.map, self = this, cont = map.getContainer();
    const Ctl = L.Control.extend({ onAdd: () => { const d = L.DomUtil.create('div', 'adsb-ctl'); L.DomEvent.disableClickPropagation(d); L.DomEvent.disableScrollPropagation(d); self.box = d; return d; } });
    new Ctl({ position: 'topleft' }).addTo(map);
    this.box.innerHTML = `
      <div class="adsb-head"><button type="button" class="adsb-on" aria-pressed="false"><i></i>Live traffic</button><span class="adsb-stat" aria-live="polite"></span><button type="button" class="adsb-more" aria-expanded="false" aria-label="Traffic options"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg></button></div>
      <div class="adsb-body">
        <div class="adsb-seg" role="group" aria-label="Traffic source">${Object.entries(MODES).map(([k, v]) => `<button type="button" data-m="${k}">${v}</button>`).join('')}</div>
        <div class="adsb-find"><input type="search" placeholder="Find callsign, reg, type, squawk" aria-label="Find aircraft" spellcheck="false" autocomplete="off"><span class="adsb-hits"></span></div>
        <label class="adsb-lbl"><input type="checkbox"> Labels</label>
      </div>`;
    const more = this.box.querySelector('.adsb-more'); // phones: the options fold away so the panel does not cover the map
    more.onclick = () => { const open = !this.box.classList.contains('open'); this.box.classList.toggle('open', open); more.setAttribute('aria-expanded', String(open)); };
    this.onBtn = this.box.querySelector('.adsb-on'); this.stat = this.box.querySelector('.adsb-stat'); this.hits = this.box.querySelector('.adsb-hits');
    this.onBtn.onclick = () => { this.on = !this.on; this.persist(); if (!this.on) { this.map.removeLayer(this.layer); this.map.removeLayer(this.cov); this.select(null); } else if (this.active) { this.layer.addTo(this.map); this.next = 0; this.viewOk = true; this.loop(); } this.renderUi(); };
    this.box.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => { if (this.mode === b.dataset.m) return; this.mode = b.dataset.m; this.list.clear(); this.trails.clear(); this.select(null); this.coverage = null; this.next = 0; this.persist(); this.renderUi(); }));
    const input = this.box.querySelector('input[type=search]');
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { const hit = [...this.list.values()].find((x) => matches(x, this.query)); if (hit) { this.select(hit.hex); this.map.panTo(project(hit, performance.now() / 1000)); } } });
    input.addEventListener('input', () => { this.query = input.value.trim(); this.renderUi(); this.layer.draw(); });
    const lbl = this.box.querySelector('.adsb-lbl input'); lbl.checked = this.labels; lbl.onchange = () => { this.labels = lbl.checked; this.persist(); this.layer.draw(); };
    // altitude legend and cursor readout share the bottom-left corner with the scale bar
    const Info = L.Control.extend({ onAdd: () => { const d = L.DomUtil.create('div', 'adsb-info'); L.DomEvent.disableClickPropagation(d); return d; } });
    const info = new Info({ position: 'bottomleft' }).addTo(map).getContainer();
    const stops = ALT_STOPS.map(([ft, c]) => `rgb(${c}) ${(ft / 40000) * 100}%`).join(',');
    info.innerHTML = `<div class="adsb-card" hidden></div><div class="adsb-legend"><div class="adsb-ramp" style="background:linear-gradient(90deg,${stops})"></div><div class="adsb-ticks"><span>0</span><span>10k</span><span>20k</span><span>30k</span><span>40k+ ft</span></div></div><div class="map-cursor" aria-live="off"></div>`;
    this.legend = info.querySelector('.adsb-legend'); this.cursor = info.querySelector('.map-cursor'); this.card = info.querySelector('.adsb-card');
    L.control.scale({ position: 'bottomright', imperial: false, maxWidth: 120 }).addTo(map);
    this.tip = L.DomUtil.create('div', 'adsb-tip', cont); this.tip.hidden = true;
    this.renderUi();
  }
  persist() { const st = this.o.settings; if (!st) return; st.mapTraffic = this.on; st.mapLabels = this.labels; st.mapTrafficMode = this.mode; if (this.o.save) this.o.save(); }
  renderUi() {
    if (!this.box) return;
    this.onBtn.classList.toggle('on', this.on); this.onBtn.setAttribute('aria-pressed', String(this.on));
    this.box.classList.toggle('off', !this.on); this.legend.hidden = !this.on;
    this.box.querySelectorAll('[data-m]').forEach((b) => b.classList.toggle('on', b.dataset.m === this.mode));
    const s = this.status, age = s.at ? Math.max(0, Math.round((Date.now() - s.at) / 1000)) : null;
    let t = '';
    if (!this.on) t = 'Off';
    else if (s.err && !this.list.size) t = `Unavailable · ${s.err}`;
    else if (!s.at) t = 'Loading…';
    else {
      const n = this.mode === 'area' ? this.inView ?? this.list.size : this.list.size;
      t = `${n.toLocaleString()} ${this.mode === 'area' ? 'in view' : this.mode === 'mil' ? 'military worldwide' : 'squawking'} · ${age}s ago${s.stale || s.err ? ' · stale' : ''}`;
      if (this.mode === 'emergency' && !n) t = 'No emergency squawks now';
    }
    this.stat.textContent = t; this.stat.title = s.src ? `Source: ${s.src}` : '';
    if (this.query) { let n = 0; for (const e of this.list.values()) if (matches(e, this.query)) n++; this.hits.textContent = `${n}`; } else this.hits.textContent = '';
    if (this.sel) this.renderCard(true);
  }
  renderCard(live) {
    const e = this.sel && this.list.get(this.sel), c = this.card;
    if (!e) { c.hidden = true; c.innerHTML = ''; return; }
    const now = performance.now() / 1000, own = this.o.ownship && this.o.ownship(), pos = project(e, now);
    const rel = own ? `${Math.round(L.latLng(own.lat, own.lon).distanceTo(pos) / NM).toLocaleString()} NM ${String(Math.round(bearing(own.lat, own.lon, pos[0], pos[1])) % 360).padStart(3, '0')}°` : '—';
    const vr = Math.round(e.vr / 50) * 50, vrs = Math.abs(vr) < 100 ? 'Level' : `${vr > 0 ? '↑' : '↓'} ${Math.abs(vr).toLocaleString()} fpm`;
    const age = Math.max(0, Math.round(now - e.at));
    const rows = [['Altitude', fmtAlt(e)], ['Vertical', vrs], ['Ground speed', `${Math.round(e.gs)} kt${e.mach ? ` · M${(+e.mach).toFixed(2)}` : ''}`], ['Track', `${String(Math.round(e.trk) % 360).padStart(3, '0')}°`],
      ['Squawk', e.squawk || '—'], ['From you', rel], ['ICAO', e.hex.toUpperCase()], ['Signal', `${e.src || '—'} · ${age}s ago`]];
    if (e.selAlt != null) rows.splice(2, 0, ['Selected alt', `${Math.round(e.selAlt / 100) * 100} ft`]);
    const html = `<div class="ac-head"><div><b>${esc(e.call || e.reg || e.hex.toUpperCase())}</b><span>${esc([e.reg && e.reg !== e.call ? e.reg : '', e.type].filter(Boolean).join(' · '))}</span></div>
      <button type="button" class="x" data-a="close" aria-label="Close aircraft details"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/></svg></button></div>
      ${e.desc || e.op ? `<div class="ac-desc">${esc([e.desc, e.op].filter(Boolean).join(' · '))}</div>` : ''}
      ${e.emerg ? `<div class="ac-emerg">${esc(e.emerg)}${e.squawk ? ` · squawk ${esc(e.squawk)}` : ''}</div>` : ''}
      <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(String(v))}</dd>`).join('')}</dl>
      <div class="ac-btns"><button type="button" data-a="follow" class="${this.followSel ? 'on' : ''}" aria-pressed="${this.followSel}">Follow</button>${this.o.canFlyTo && this.o.canFlyTo() && !e.ground ? '<button type="button" data-a="fly" class="primary">Fly alongside</button>' : ''}</div>`;
    if (live && c.dataset.hex === e.hex && c.dataset.html === html) return;
    c.dataset.hex = e.hex; c.dataset.html = html; c.innerHTML = html; c.hidden = false;
    c.querySelector('[data-a=close]').onclick = () => this.select(null);
    c.querySelector('[data-a=follow]').onclick = () => { this.followSel = !this.followSel; if (this.followSel && this.o.onFollowStop) this.o.onFollowStop(); this.renderCard(); };
    const fly = c.querySelector('[data-a=fly]'); if (fly) fly.onclick = () => this.o.onFlyAlongside && this.o.onFlyAlongside({ ...e, lat: pos[0], lon: pos[1] });
  }
}

export function bearing(la1, lo1, la2, lo2) {
  const p1 = la1 * D2R, p2 = la2 * D2R, dl = (lo2 - lo1) * D2R;
  const y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) / D2R) + 360) % 360;
}
