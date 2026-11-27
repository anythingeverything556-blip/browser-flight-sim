const R_EARTH = 63710088e-1,
  D2R = Math.PI / 180;
const wrapLon = (l) => ((((l + 180) % 360) + 360) % 360) - 180,
  dLon = (a, b) => ((((a - b + 180) % 360) + 360) % 360) - 180;
class Geo {
  constructor(t, e) {
    this.setOrigin(t, e);
  }
  setOrigin(t, e) {
    ((this.lat0 = t), (this.lon0 = wrapLon(e)), (this.cos0 = Math.cos(t * D2R)), (this.version = (this.version || 0) + 1));
  }
  toXZ(t, e) {
    return { x: dLon(e, this.lon0) * D2R * R_EARTH * this.cos0, z: -(t - this.lat0) * D2R * R_EARTH };
  }
  toLatLon(t, e) {
    return { lat: this.lat0 + -e / R_EARTH / D2R, lon: wrapLon(this.lon0 + t / (R_EARTH * this.cos0) / D2R) };
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

// Signed geometry on the directed great circle start -> end. Cross-track is
// positive to the right; along-track stays negative behind the leg origin.
// A local tangent is essential: the initial bearing is not constant worldwide.
function greatCircleLeg(start, end, position) {
  const vector = ({ lat, lon }) => {
    const phi = lat * D2R, lambda = lon * D2R;
    return [Math.cos(phi) * Math.cos(lambda), Math.cos(phi) * Math.sin(lambda), Math.sin(phi)];
  };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const a = vector(start), b = vector(end), p = vector(position);
  let normal = cross(a, b);
  const size = Math.hypot(...normal);
  const length = Math.atan2(size, dot(a, b)) * R_EARTH;
  if (size < 1e-12) {
    // Coincident/antipodal fixes have no unique great circle. Select the same
    // deterministic initial-bearing convention as bearing(), without NaNs.
    const heading = bearing(start.lat, start.lon, end.lat, end.lon) * D2R;
    const phi = start.lat * D2R, lambda = start.lon * D2R;
    const east = [-Math.sin(lambda), Math.cos(lambda), 0];
    const north = [-Math.sin(phi) * Math.cos(lambda), -Math.sin(phi) * Math.sin(lambda), Math.cos(phi)];
    const tangent = north.map((v, i) => v * Math.cos(heading) + east[i] * Math.sin(heading));
    normal = cross(a, tangent);
  } else normal = normal.map(v => v / size);
  const courseAt = (point, v) => {
    const lambda = point.lon * D2R;
    const east = [-Math.sin(lambda), Math.cos(lambda), 0];
    const north = cross(v, east), tangent = cross(normal, v);
    return (Math.atan2(dot(tangent, east), dot(tangent, north)) / D2R + 360) % 360;
  };
  const alongTrack = Math.atan2(dot(p, cross(normal, a)), dot(p, a)) * R_EARTH;
  return {
    length,
    alongTrack,
    remaining: length - alongTrack,
    crossTrack: -Math.asin(Math.max(-1, Math.min(1, dot(p, normal)))) * R_EARTH,
    course: courseAt(position, p),
    endCourse: courseAt(end, b),
  };
}

export { D2R, Geo, R_EARTH, bearing, dLon, destination, greatCircleLeg, haversine, lat2ty, lon2tx, tx2lon, ty2lat, wrapLon };
