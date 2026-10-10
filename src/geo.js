const R_EARTH = 63710088e-1,
  D2R = Math.PI / 180;
class Geo {
  constructor(t, e) {
    this.setOrigin(t, e);
  }
  setOrigin(t, e) {
    ((this.lat0 = t), (this.lon0 = e), (this.cos0 = Math.cos(t * D2R)), (this.version = (this.version || 0) + 1));
  }
  toXZ(t, e) {
    return { x: (e - this.lon0) * D2R * R_EARTH * this.cos0, z: -(t - this.lat0) * D2R * R_EARTH };
  }
  toLatLon(t, e) {
    return { lat: this.lat0 + -e / R_EARTH / D2R, lon: this.lon0 + t / (R_EARTH * this.cos0) / D2R };
  }
}
const lon2tx = (s, t) => ((s + 180) / 360) * (1 << t),
  lat2ty = (s, t) => {
    const e = Math.sin(s * D2R);
    return (0.5 - Math.log((1 + e) / (1 - e)) / (4 * Math.PI)) * (1 << t);
  },
  tx2lon = (s, t) => (s / (1 << t)) * 360 - 180,
  ty2lat = (s, t) => {
    const e = Math.PI - (2 * Math.PI * s) / (1 << t);
    return Math.atan(Math.sinh(e)) / D2R;
  };
function haversine(s, t, e, n) {
  const i =
    Math.sin(((e - s) * D2R) / 2) ** 2 + Math.cos(s * D2R) * Math.cos(e * D2R) * Math.sin(((n - t) * D2R) / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(i)));
}
function bearing(s, t, e, n) {
  const i = Math.sin((n - t) * D2R) * Math.cos(e * D2R),
    r = Math.cos(s * D2R) * Math.sin(e * D2R) - Math.sin(s * D2R) * Math.cos(e * D2R) * Math.cos((n - t) * D2R);
  return (Math.atan2(i, r) / D2R + 360) % 360;
}
function destination(s, t, e, n) {
  const i = n / R_EARTH,
    r = e * D2R,
    a = s * D2R,
    l = t * D2R,
    h = Math.asin(Math.sin(a) * Math.cos(i) + Math.cos(a) * Math.sin(i) * Math.cos(r)),
    u = l + Math.atan2(Math.sin(r) * Math.sin(i) * Math.cos(a), Math.cos(i) - Math.sin(a) * Math.sin(h));
  return { lat: h / D2R, lon: ((u / D2R + 540) % 360) - 180 };
}

export { D2R, Geo, R_EARTH, bearing, destination, haversine, lat2ty, lon2tx, tx2lon, ty2lat };
