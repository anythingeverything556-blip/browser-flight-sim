import { R_EARTH, D2R, haversine } from './geo.js';
import './cockpitmap.css';

// Compact moving map for the cockpit: a canvas MFD (no tiles, no Leaflet). Flat projection around the aircraft, heading-up or north-up.
export const RANGES = [5, 10, 20, 40, 80, 160, 320];
export const NM_PER_DEG = (R_EARTH * D2R) / 1852;
const REDRAW_MS = 100, APPROACH_NM = 10, MONO = '"Geist Mono", ui-monospace, Menlo, Consolas, monospace';
const C = { ring: 'rgba(108,196,228,0.28)', ringTxt: 'rgba(169,180,192,0.9)', apt: '#8fc4da', mil: '#f2b84b', txt: '#c9d3dc', route: '#e35bd8', routeOld: 'rgba(227,91,216,0.35)', arr: '#5fd49a', own: '#f2f5f8', trk: 'rgba(242,245,248,0.55)', traffic: '#f2b84b', north: '#6cc4e4' };

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const dLonWrap = (a, b) => ((((a - b + 180) % 360) + 360) % 360) - 180;
const pad3 = (n) => String(((Math.round(n) % 360) + 360) % 360).padStart(3, '0');

// px relative to the aircraft symbol; x right, y down, so ahead is negative y. hdgUp = true heading at the top (deg), pxPerNm = scale
export function project(lat, lon, centre, hdgUp, pxPerNm) {
  const dN = (lat - centre.lat) * NM_PER_DEG, dE = dLonWrap(lon, centre.lon) * NM_PER_DEG * Math.cos(centre.lat * D2R);
  const h = (hdgUp || 0) * D2R, c = Math.cos(h), s = Math.sin(h);
  return { x: (dE * c - dN * s) * pxPerNm, y: -(dE * s + dN * c) * pxPerNm };
}
// point at distance nm along bearing (deg true) from lat/lon (flat, matches project)
export function offset(lat, lon, brgDeg, nm) {
  const b = brgDeg * D2R, cl = Math.max(0.01, Math.cos(lat * D2R));
  const la = lat + (nm * Math.cos(b)) / NM_PER_DEG, lo = lon + (nm * Math.sin(b)) / (NM_PER_DEG * cl);
  return { lat: la, lon: ((lo + 540) % 360) - 180 };
}
export const distNm = (a, b) => haversine(a.lat, a.lon, b.lat, b.lon) / 1852;
export const fmtDist = (nm, metric) => { const v = metric ? nm * 1.852 : nm; return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${metric ? 'KM' : 'NM'}`; };

// Liang-Barsky: the part of a segment inside the rect, or null (keeps dashed lines to far waypoints cheap and exact)
export function clipSeg(x0, y0, x1, y1, xmin, ymin, xmax, ymax) {
  let t0 = 0, t1 = 1; const dx = x1 - x0, dy = y1 - y0;
  for (const [p, q] of [[-dx, x0 - xmin], [dx, xmax - x0], [-dy, y0 - ymin], [dy, ymax - y0]]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [x0 + t0 * dx, y0 + t0 * dy, x0 + t1 * dx, y0 + t1 * dy];
}

// airports (db.near items {a, d} or airports) within rangeNm * reach of the centre, nearest first; small fields drop out at long range
export function pickVisibleAirports(list, centre, rangeNm, { max = 40, reach = 1, keep = null } = {}) {
  const cl = Math.cos(centre.lat * D2R), rows = [];
  for (const it of list || []) {
    const a = it && it.a ? it.a : it;
    if (!a || !finite(a.lat) || !finite(a.lon)) continue;
    const d = Math.hypot((a.lat - centre.lat) * NM_PER_DEG, dLonWrap(a.lon, centre.lon) * NM_PER_DEG * cl);
    if (d <= rangeNm * reach) rows.push({ apt: a, dNm: d });
  }
  rows.sort((p, q) => p.dNm - q.dNm);
  let lim = rangeNm <= 10 ? 2 : rangeNm <= 40 ? 1 : 0, out;
  for (;; lim++) { out = rows.filter((r) => r.apt.type <= lim || r.apt === keep).slice(0, max); if (out.length >= 3 || lim >= 2) break; }
  if (keep && !out.some((r) => r.apt === keep)) { const k = rows.find((r) => r.apt === keep); if (k) out.push(k); }
  return out;
}

// header strings: ground speed, track, and the target (ILS, else the active waypoint, else the arrival runway)
export function headerInfo(s) {
  const metric = !!s.metric, gs = finite(s.gsKt) ? s.gsKt : 0, trk = gs >= 20 && finite(s.trackDeg) ? s.trackDeg : finite(s.hdg) ? s.hdg : 0;
  const out = { gs: metric ? `GS ${Math.round(gs * 1.852)} KM/H` : `GS ${Math.round(gs)} KT`, trk: `TRK ${pad3(trk)}°`, tgt: '—', kind: 'none', distNm: null };
  const me = { lat: s.lat, lon: s.lon }, wp = s.route && s.route[Math.min(Math.max(0, s.activeIdx | 0), s.route.length - 1)];
  if (s.ils && s.ils.valid) { out.kind = 'ils'; out.distNm = finite(s.ils.distNm) ? s.ils.distNm : null; out.tgt = `ILS ${s.ils.ident || ''} ${out.distNm == null ? '' : fmtDist(out.distNm, metric)}`.trim(); }
  else if (wp && finite(wp.lat) && finite(wp.lon)) { out.kind = 'wpt'; out.distNm = distNm(me, wp); out.tgt = `${String(wp.name || 'WPT').slice(0, 10)} ${fmtDist(out.distNm, metric)}`; }
  else if (s.arrival && s.arrival.rwy) { const e = arrivalEnd(s.arrival); out.kind = 'arr'; out.distNm = distNm(me, e.start); out.tgt = `${s.arrival.rwy.ap.ident} ${e.ident} ${fmtDist(out.distNm, metric)}`; }
  return out;
}
export const arrivalEnd = (arr) => (arr && arr.rwy ? (typeof arr.end === 'object' ? arr.end : arr.rwy.ends[arr.end | 0]) : null);

const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

export class CockpitMap {
  constructor(parentEl, db, { onPickAirport = null, onClose = null } = {}) {
    this.db = db; this.onPickAirport = onPickAirport; this.onClose = onClose;
    this.rangeIdx = 2; this.headingUp = true; this.large = false; this._on = false; this.s = null; this.hits = [];
    this._last = -1e9; this._dirty = true; this._sel = null; this.w = 320; this.h = 284; this.dpr = 1;
    const root = this.el = el('div', 'cockpitmap'); root.hidden = true;
    root.setAttribute('role', 'region'); root.setAttribute('aria-label', 'Moving map');
    const head = el('div', 'cm-head');
    this.hGs = el('span', 'cm-gs', 'GS —'); this.hTrk = el('span', 'cm-trk', 'TRK —'); this.hTgt = el('span', 'cm-tgt', '—');
    head.append(this.hGs, this.hTrk, this.hTgt);
    const body = el('div', 'cm-body'); this.canvas = el('canvas', 'cm-canvas'); this.canvas.setAttribute('aria-hidden', 'true');
    this.ctx = this.canvas.getContext('2d');
    const bar = el('div', 'cm-btns');
    this.bOut = this._btn('−', 'Zoom out (longer range)', () => this.zoom(1));
    this.hRange = el('span', 'cm-rng', '');
    this.bIn = this._btn('+', 'Zoom in (shorter range)', () => this.zoom(-1));
    this.bMode = this._btn('HDG', 'Heading up / north up', () => this.setHeadingUp(!this.headingUp));
    this.bSize = this._btn('⤢', 'Bigger / smaller map', () => this.setLarge(!this.large));
    this.bClose = this._btn('✕', 'Hide the map', () => { this.toggle(false); this.onClose && this.onClose(); });
    bar.append(this.bOut, this.hRange, this.bIn, this.bMode, this.bSize, this.bClose);
    body.append(this.canvas, bar); root.append(head, body); parentEl.appendChild(root);
    this.canvas.addEventListener('click', (e) => this._click(e));
    this.canvas.addEventListener('pointermove', (e) => { this.canvas.style.cursor = this._hit(e) ? 'pointer' : ''; });
    this.canvas.addEventListener('wheel', (e) => { e.preventDefault && e.preventDefault(); this.zoom(e.deltaY > 0 ? 1 : -1); }, { passive: false });
    if (typeof ResizeObserver !== 'undefined') { this._ro = new ResizeObserver(() => this._resize()); this._ro.observe(this.canvas); }
    this._syncUi();
  }
  _btn(txt, title, fn) {
    const b = el('button', 'cm-btn', txt); b.type = 'button'; b.title = title; b.setAttribute('aria-label', title);
    b.addEventListener('click', (e) => { fn(); b.blur && b.blur(); e.stopPropagation && e.stopPropagation(); });
    return b;
  }
  get visible() { return this._on; }
  get range() { return RANGES[this.rangeIdx]; }
  toggle(on) {
    this._on = on === undefined ? !this._on : !!on; this.el.hidden = !this._on; this._dirty = true;
    if (this._on) { this._resize(); if (this.s) this._draw(); }
    return this._on;
  }
  setRange(nm) {
    let best = 0;
    RANGES.forEach((r, i) => { if (Math.abs(Math.log(r / nm)) < Math.abs(Math.log(RANGES[best] / nm))) best = i; });
    this.rangeIdx = best; this._sel = null; this._dirty = true; this._syncUi(); this._redrawNow();
  }
  zoom(dir) { this.setRange(RANGES[Math.min(RANGES.length - 1, Math.max(0, this.rangeIdx + dir))]); }
  setHeadingUp(on) { this.headingUp = !!on; this._dirty = true; this._syncUi(); this._redrawNow(); }
  setLarge(on) { this.large = !!on; this.el.classList.toggle('cm-large', this.large); this._dirty = true; this._syncUi(); this._resize(); this._redrawNow(); }
  _syncUi() {
    const rt = fmtDist(this.range, this.s ? this.s.metric : false).replace(/\.0 /, ' '), mt = this.headingUp ? 'HDG' : 'N';
    if (this.hRange.textContent !== rt) this.hRange.textContent = rt;
    if (this.bMode.textContent !== mt) this.bMode.textContent = mt;
    this.bOut.disabled = this.rangeIdx >= RANGES.length - 1; this.bIn.disabled = this.rangeIdx <= 0;
  }
  _redrawNow() { if (this._on && this.s) this._draw(); }
  _resize() {
    const w = this.canvas.clientWidth || (this.large ? 520 : 320), h = this.canvas.clientHeight || (this.large ? 492 : 284);
    const dpr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
    if (w === this.w && h === this.h && dpr === this.dpr && this.canvas.width) return;
    this.w = w; this.h = h; this.dpr = dpr; this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr); this._dirty = true;
    this._redrawNow();
  }
  update(s, now = typeof performance !== 'undefined' ? performance.now() : Date.now()) {
    this.s = s;
    if (!this._on || !s || (!this._dirty && now - this._last < REDRAW_MS)) return;
    this._last = now; this._dirty = false; this._draw();
  }
  _hit(e) {
    const r = this.canvas.getBoundingClientRect ? this.canvas.getBoundingClientRect() : { left: 0, top: 0 }, x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, bd = 14 * 14;
    for (const h of this.hits) { const d = (h.x - x) ** 2 + (h.y - y) ** 2; if (d <= bd) { bd = d; best = h.apt; } }
    return best;
  }
  _click(e) { const a = this._hit(e); if (a && this.onPickAirport) this.onPickAirport(a); }
  destroy() { this._ro && this._ro.disconnect(); this.el.remove && this.el.remove(); }

  _airports(s, rng) {
    const sel = this._sel, move = sel ? distNm(sel.c, s) : 1e9;
    if (!sel || move > rng * 0.1 || sel.r !== rng) {
      const items = this.db && this.db.near ? this.db.near(s.lat, s.lon, rng * 1.5 * 1.852) : [];
      this._sel = { c: { lat: s.lat, lon: s.lon }, r: rng, items };
    }
    const arr = s.arrival && s.arrival.rwy ? s.arrival.rwy.ap : null;
    return pickVisibleAirports(this._sel.items, s, rng, { max: 40, reach: 1.4, keep: arr });
  }

  _draw() {
    const s = this.s, g = this.ctx, W = this.w, H = this.h, rng = this.range, up = this.headingUp;
    const hdg = finite(s.hdg) ? s.hdg : 0, rot = up ? hdg : 0, ox = W / 2, oy = up ? H * 0.72 : H * 0.5;
    const R = Math.max(40, Math.min(W / 2, up ? oy : H / 2) - 6), ppn = R / rng, me = { lat: s.lat, lon: s.lon };
    const P = (la, lo) => { const p = project(la, lo, me, rot, ppn); return { x: ox + p.x, y: oy + p.y }; };
    const info = headerInfo(s), metric = !!s.metric;
    this._head(info);
    this.hits = [];
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); g.clearRect(0, 0, W, H);
    g.font = `10px ${MONO}`; g.textBaseline = 'middle'; g.lineJoin = 'round';
    const rects = [], free = (x, y, w) => !rects.some((r) => x < r[2] && x + w > r[0] && y - 6 < r[3] && y + 6 > r[1]);
    const label = (txt, x, y, col, force) => {
      const w = g.measureText(txt).width;
      if (!force && !free(x, y, w)) return;
      rects.push([x, y - 6, x + w, y + 6]); g.fillStyle = col; g.textAlign = 'left'; g.fillText(txt, x, y);
    };
    this._rings(g, ox, oy, R, rot, rng, metric);

    // arrival: highlighted runway, 10 NM extended centreline with a +-5 deg cone and 2 NM ticks
    const arr = s.arrival && s.arrival.rwy ? s.arrival : null, ae = arr ? arrivalEnd(arr) : null;
    if (ae) this._approach(g, P, ae, arr.rwy, s, ppn, label);

    // airports
    const aptArr = arr ? arr.rwy.ap : null, list = this._airports(s, rng), clip = [-20, -20, W + 20, H + 20];
    for (const { apt } of list) {
      const p = P(apt.lat, apt.lon);
      if (p.x < clip[0] || p.x > clip[2] || p.y < clip[1] || p.y > clip[3]) continue;
      const col = apt === aptArr ? C.arr : apt.mil ? C.mil : C.apt, long = apt.longest ? (apt.longest.len / 1852) * ppn : 0, runways = long >= 10;
      if (runways) {
        g.strokeStyle = col; g.lineCap = 'butt';
        for (const rw of apt.runways) { const a = P(rw.a.lat, rw.a.lon), b = P(rw.b.lat, rw.b.lon); g.lineWidth = Math.min(4, Math.max(1.4, (rw.width / 1852) * ppn)); g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }
      } else {
        const r = apt.type === 0 ? 4.5 : apt.type === 1 ? 3.5 : 2.6;
        g.fillStyle = col; g.strokeStyle = 'rgba(7,10,14,0.8)'; g.lineWidth = 1; g.beginPath(); g.arc(p.x, p.y, r, 0, 6.2832); g.fill(); g.stroke();
      }
      label(apt.ident, p.x + (runways ? Math.min(30, long / 2 + 4) : 7), p.y - (runways ? 8 : 0), apt === aptArr ? C.arr : C.txt, apt === aptArr);
      this.hits.push({ apt, x: p.x, y: p.y });
    }

    // route: past legs dim, the active leg and the rest magenta, the active waypoint ringed and named
    const route = (s.route || []).filter((w) => w && finite(w.lat) && finite(w.lon));
    if (route.length) {
      const act = Math.min(Math.max(0, s.activeIdx | 0), route.length - 1), pts = route.map((w) => P(w.lat, w.lon));
      g.lineWidth = 1.8; g.lineCap = 'round';
      const seg = (a, b, col) => { const c = clipSeg(a.x, a.y, b.x, b.y, -10, -10, W + 10, H + 10); if (!c) return; g.strokeStyle = col; g.beginPath(); g.moveTo(c[0], c[1]); g.lineTo(c[2], c[3]); g.stroke(); };
      for (let i = 1; i < pts.length; i++) seg(pts[i - 1], pts[i], i <= act ? C.routeOld : C.route);
      seg({ x: ox, y: oy }, pts[act], C.route);
      route.forEach((w, i) => {
        const p = pts[i]; if (p.x < -10 || p.x > W + 10 || p.y < -10 || p.y > H + 10) return;
        g.strokeStyle = g.fillStyle = i === act ? C.route : i < act ? C.routeOld : C.route;
        g.lineWidth = i === act ? 2 : 1.4; g.beginPath(); g.moveTo(p.x, p.y - 5); g.lineTo(p.x + 5, p.y); g.lineTo(p.x, p.y + 5); g.lineTo(p.x - 5, p.y); g.closePath();
        if (i === act) g.fill(); else g.stroke();
        if (w.name && (i === act || i === act + 1)) label(String(w.name).slice(0, 10), p.x + 8, p.y + 1, C.route, i === act);
      });
    }

    // traffic: dot with relative altitude in hundreds of feet
    for (const t of s.traffic || []) {
      if (!t || !finite(t.lat) || !finite(t.lon)) continue;
      const p = P(t.lat, t.lon); if (p.x < 4 || p.x > W - 4 || p.y < 4 || p.y > H - 4) continue;
      g.fillStyle = C.traffic; g.beginPath(); g.moveTo(p.x, p.y - 4); g.lineTo(p.x + 3, p.y + 3); g.lineTo(p.x - 3, p.y + 3); g.closePath(); g.fill();
      if (finite(t.alt) && finite(s.altFt)) { const d = Math.round((t.alt - s.altFt) / 100); label(`${d >= 0 ? '+' : '-'}${String(Math.abs(d)).padStart(2, '0')}`, p.x + 6, p.y, C.traffic); }
    }

    // track line and own symbol (symbol points along heading; track line along the ground track)
    const tk = finite(s.trackDeg) && (s.gsKt || 0) >= 20 ? s.trackDeg : hdg, ta = (tk - rot) * D2R, tc = clipSeg(ox, oy, ox + Math.sin(ta) * R, oy - Math.cos(ta) * R, 0, 0, W, H);
    if (tc) { g.strokeStyle = C.trk; g.lineWidth = 1; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(tc[0], tc[1]); g.lineTo(tc[2], tc[3]); g.stroke(); g.setLineDash([]); }
    g.save(); g.translate(ox, oy); g.rotate((hdg - rot) * D2R);
    g.fillStyle = C.own; g.strokeStyle = 'rgba(7,10,14,0.9)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, -9); g.lineTo(6, 7); g.lineTo(0, 3.5); g.lineTo(-6, 7); g.closePath(); g.fill(); g.stroke(); g.restore();
  }

  _head(info) {
    if (this.hGs.textContent !== info.gs) this.hGs.textContent = info.gs;
    if (this.hTrk.textContent !== info.trk) this.hTrk.textContent = info.trk;
    if (this.hTgt.textContent !== info.tgt) { this.hTgt.textContent = info.tgt; this.hTgt.dataset && (this.hTgt.dataset.kind = info.kind); }
    this._syncUi();
  }

  _rings(g, ox, oy, R, rot, rng, metric) {
    g.lineWidth = 1; g.strokeStyle = C.ring; g.fillStyle = C.ringTxt; g.textAlign = 'left';
    for (const k of [0.5, 1]) { g.beginPath(); g.arc(ox, oy, R * k, 0, 6.2832); g.stroke(); }
    const lab = (nm) => fmtDist(nm, metric).replace(/\.0 /, ' ');
    g.fillText(lab(rng / 2), ox + 4, oy - R / 2 + 8); g.fillText(lab(rng), ox + 4, oy - R + 8);
    for (let d = 0; d < 360; d += 10) {
      const a = (d - rot) * D2R, sn = Math.sin(a), cs = Math.cos(a), len = d % 30 === 0 ? 7 : 3.5;
      g.beginPath(); g.moveTo(ox + sn * R, oy - cs * R); g.lineTo(ox + sn * (R - len), oy - cs * (R - len)); g.stroke();
      const ci = d % 90 === 0 ? 'N E S W'.split(' ')[d / 90] : null;
      if (ci) { g.fillStyle = ci === 'N' ? C.north : C.ringTxt; g.textAlign = 'center'; g.fillText(ci, ox + sn * (R - 14), oy - cs * (R - 14)); g.textAlign = 'left'; g.fillStyle = C.ringTxt; }
    }
  }

  _approach(g, P, e, rwy, s, ppn, label) {
    const back = (e.hdg + 180) % 360, thr = e.start, far = offset(thr.lat, thr.lon, back, APPROACH_NM), live = !!(s.ils && s.ils.valid);
    const t = P(thr.lat, thr.lon), f = P(far.lat, far.lon);
    const edge = (da) => { const o = offset(thr.lat, thr.lon, back + da, APPROACH_NM / Math.cos(5 * D2R)); return P(o.lat, o.lon); }, l = edge(5), r = edge(-5);
    g.fillStyle = 'rgba(95,212,154,0.09)'; g.beginPath(); g.moveTo(t.x, t.y); g.lineTo(l.x, l.y); g.lineTo(r.x, r.y); g.closePath(); g.fill();
    g.strokeStyle = C.arr; g.lineWidth = live ? 1.8 : 1.2; g.setLineDash(live ? [] : [6, 4]); g.beginPath(); g.moveTo(t.x, t.y); g.lineTo(f.x, f.y); g.stroke(); g.setLineDash([]);
    const ux = (f.x - t.x) / (APPROACH_NM * ppn || 1), uy = (f.y - t.y) / (APPROACH_NM * ppn || 1);
    g.lineWidth = 1; g.beginPath();
    for (let n = 2; n <= APPROACH_NM; n += 2) { const cx = t.x + ux * n * ppn, cy = t.y + uy * n * ppn; g.moveTo(cx - uy * 4, cy + ux * 4); g.lineTo(cx + uy * 4, cy - ux * 4); }
    g.stroke();
    const a = P(rwy.a.lat, rwy.a.lon), b = P(rwy.b.lat, rwy.b.lon);
    g.lineWidth = Math.min(5, Math.max(2.5, (rwy.width / 1852) * ppn)); g.lineCap = 'butt'; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    label(`${e.ident}${live && s.ils.ident ? ' ' + s.ils.ident : ''}`, f.x + 6, f.y, C.arr, true);
  }
}
