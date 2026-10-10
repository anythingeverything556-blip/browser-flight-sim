import { D2R, bearing, haversine } from './geo.js';

const gT = (s) => ((s + 540) % 360) - 180,
  cm = (s, t, e) => Math.min(e, Math.max(t, s));
class Navigation {
  constructor() {
    ((this.wps = []),
      (this.active = 0),
      (this.legStart = null),
      (this.arrival = null),
      (this.locCap = !1),
      (this.gsCap = !1),
      (this.listeners = []));
  }
  onChange(t) {
    this.listeners.push(t);
  }
  changed() {
    this.listeners.forEach((t) => t());
  }
  add(t, e) {
    if ((this.wps.length || (this.legStart = null), e === void 0 || e >= this.wps.length)) this.wps.push(t);
    else {
      const n = Math.max(0, e);
      (this.wps.splice(n, 0, t), n <= this.active && this.active++);
    }
    this.changed();
  }
  remove(t) {
    if (t < 0 || t >= this.wps.length) return;
    const [e] = this.wps.splice(t, 1);
    (t < this.active
      ? (this.active--, this.active === 0 && (this.legStart = { lat: e.lat, lon: e.lon }))
      : t === this.active && (this.legStart = null),
      this.active >= this.wps.length && (this.active = Math.max(0, this.wps.length - 1)),
      this.changed());
  }
  move(t, e) {
    const n = t + e;
    n < 0 ||
      n >= this.wps.length ||
      (([this.wps[t], this.wps[n]] = [this.wps[n], this.wps[t]]),
      this.active === t ? (this.active = n) : this.active === n && (this.active = t),
      this.changed());
  }
  clear() {
    ((this.wps = []), (this.active = 0), (this.legStart = null), this.changed());
  }
  directTo(t, e) {
    ((this.wps = [t]), (this.active = 0), (this.legStart = { ...e }), this.changed());
  }
  setArrival(t, e) {
    ((this.arrival = t ? { rwy: t, end: e } : null), (this.locCap = this.gsCap = !1), this.changed());
  }
  activate(t, e) {
    ((this.active = cm(t, 0, this.wps.length - 1)), (this.legStart = { ...e }), this.changed());
  }
  totalNm(t) {
    let e = 0,
      n = t;
    for (let i = this.active; i < this.wps.length; i++)
      ((e += haversine(n.lat, n.lon, this.wps[i].lat, this.wps[i].lon)), (n = this.wps[i]));
    return e / 1852;
  }
  update(t, e, n) {
    const i = {
      valid: !1,
      ident: '',
      brgDeg: 0,
      distNm: 0,
      course: 0,
      xtkNm: 0,
      ilsValid: !1,
      locDev: 0,
      gsDev: 0,
      lnavHdg: null,
      locHdg: null,
      gsVs: null,
    };
    if (this.wps.length) {
      !this.legStart && this.active === 0 && (this.legStart = { lat: t.lat, lon: t.lon });
      const r = this.wps[this.active],
        a = this.active > 0 ? this.wps[this.active - 1] : this.legStart || t,
        l = bearing(a.lat, a.lon, r.lat, r.lon),
        h = haversine(t.lat, t.lon, r.lat, r.lon),
        u = bearing(t.lat, t.lon, r.lat, r.lon),
        f = haversine(a.lat, a.lon, t.lat, t.lon),
        d = bearing(a.lat, a.lon, t.lat, t.lon),
        p = f * Math.sin((d - l) * D2R),
        v = haversine(a.lat, a.lon, r.lat, r.lon) - f * Math.cos((d - l) * D2R),
        y = (n * n) / (9.80665 * Math.tan((n > 340 ? 35 : 25) * D2R)),
        x = this.wps[this.active + 1],
        g = x ? Math.abs(gT(bearing(r.lat, r.lon, x.lat, x.lon) - l)) : 0,
        _ = x ? Math.max(1e3, y * Math.tan((Math.min(150, g) * D2R) / 2)) : 300;
      h < _ || v < 0
        ? x
          ? (this.active++, (this.legStart = { lat: r.lat, lon: r.lon }), this.changed(), (this.sequenced = r.name))
          : !this.done && h < 2e3 && ((this.done = !0), (this.sequenced = r.name + ' (end of route)'))
        : (this.done = !1);
      const w = Math.max(25, (y / Math.max(n, 1)) * 0.6);
      ((i.lnavHdg = (l - Math.atan2(p, n * w) / D2R + 360) % 360),
        Object.assign(i, { valid: !0, ident: r.name, brgDeg: u, distNm: h / 1852, course: l, xtkNm: p / 1852 }));
    }
    if (this.arrival) {
      const { rwy: r, end: a } = this.arrival,
        l = r.ends[a],
        h = l.start,
        u = l.hdg,
        f = haversine(t.lat, t.lon, h.lat, h.lon),
        d = bearing(h.lat, h.lon, t.lat, t.lon) * D2R,
        p = u * D2R,
        v = f * Math.cos(d - p),
        y = f * Math.sin(d - p),
        x = r.len + 300 - v,
        g = 300 - v,
        _ = -Math.atan2(y, x) / D2R,
        w = Math.atan2(e - l.elev - 4, Math.max(1, g)) / D2R - 3;
      if (x > 0 && f < 46e3 && Math.abs(_) < 18 && v < r.len) {
        ((i.ilsValid = !0),
          (i.locDev = _),
          (i.gsDev = g > 0 ? w : 0),
          (i.ilsIdent = r.ap.ident + ' ' + l.ident),
          (i.locHdg = (u + cm(-Math.atan2(y, n * 45) / D2R, -25, 25) + 360) % 360));
        const S = l.elev + 4 + Math.max(0, g) * Math.tan(3 * D2R);
        ((i.gsVs = -n * Math.tan(3 * D2R) + (S - e) * 0.06),
          (i.thrDist = -v),
          (i.agl = e - l.elev),
          (i.locXtk = y),
          i.valid ||
            Object.assign(i, {
              valid: !0,
              ident: i.ilsIdent,
              brgDeg: bearing(t.lat, t.lon, h.lat, h.lon),
              distNm: f / 1852,
              course: u,
              xtkNm: y / 1852,
            }));
      }
    }
    return i;
  }
}

export { Navigation };
