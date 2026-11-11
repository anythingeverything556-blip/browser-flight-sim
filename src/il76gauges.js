import * as THREE from 'three';

// Live needles for the Il-76's analogue dials. The model paints each dial face without a needle and lists the live ones in its root
// extras (`gauges`: kind, centre c, facing n, up u in the glTF frame, radius r); a white needle is drawn 1.5 mm in front of each face
// and turned every frame the flight deck is on screen. A model without the list simply gets no needles.
// The painted scale is a 270 degree arc from lower left, clockwise, to lower right.
const ARC0 = 225, ARC = 270, D2R = Math.PI / 180;
const arc = (f) => (ARC0 - ARC * Math.max(0, Math.min(1, f))) * D2R;   // fraction of the scale -> needle angle (anticlockwise from 3 o'clock)
const turn = (f) => (90 - 360 * f) * D2R;                              // full-circle dials: 0 at 12 o'clock, clockwise
// kind -> needle angles from the feed s (src/il76feed.js: kt, ft, fpm, deg) ; a second value is a short second hand
export const GAUGE_ANGLES = {
  asi: (s) => [arc(s.ias * 1.852 / 800)],                               // airspeed, 0-800 km/h, 100 per mark
  alt: (s) => { const m = s.altFt / 3.28084; return [turn((m % 1000) / 1000), turn(m / 10000)]; }, // altimeter, metres: long hand 1000 m a turn, short hand 10,000 m
  vsi: (s) => [arc(0.5 + (s.vsFpm / 196.85) / 60)],                     // vertical speed, +-30 m/s, zero at the top
  hdg: (s) => [turn(s.hdg / 360)], rmi: (s) => [turn(s.hdg / 360)],     // compass: the needle shows the heading on the fixed card
  fuel: (s) => [arc(s.fuel / 80000)],                                   // fuel, 0-80 t, 10 t per mark
  flap: (s) => [arc(s.flaps / 80)],                                     // flap angle, 10 degrees per mark
  brake: (s) => [arc(s.brakes || 0)],                                   // brake pressure
  clock: (s) => { const d = s.now || new Date(), h = d.getHours() + d.getMinutes() / 60; return [turn(d.getMinutes() / 60 + d.getSeconds() / 3600), turn((h % 12) / 12)]; },
};

function needleGeometry(r, len, w) { // a tapered pointer along +x with a short tail, in the dial plane
  const g = new THREE.BufferGeometry(), t = -0.16 * r, L = len * r, h = w * r;
  g.setAttribute('position', new THREE.Float32BufferAttribute([t, -h, 0, L * 0.82, -h * 0.55, 0, L, 0, 0, L * 0.82, h * 0.55, 0, t, h, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3, 0, 3, 4]); g.computeVertexNormals(); return g;
}

export class IL76Gauges {
  // parent: the glTF root node (the list is in its frame); list: the parsed `gauges` extras
  constructor(parent, list) {
    this.group = new THREE.Group(); this.group.name = 'IL76_GaugeNeedles'; parent.add(this.group); this.items = []; this.t = 1;
    const mat = new THREE.MeshBasicMaterial({ color: 0xf2f2ea, side: THREE.DoubleSide, toneMapped: false }), mat2 = new THREE.MeshBasicMaterial({ color: 0xffb347, side: THREE.DoubleSide, toneMapped: false });
    for (const g of list || []) {
      const fn = GAUGE_ANGLES[g.kind]; if (!fn || !(g.r > 0)) continue;
      const n = new THREE.Vector3(...g.n).normalize(), u = new THREE.Vector3(...g.u).normalize(), x = new THREE.Vector3().crossVectors(u, n).normalize();
      const hub = new THREE.Group(); hub.position.set(...g.c).addScaledVector(n, 0.0015); hub.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, u, n));
      const hands = [new THREE.Mesh(needleGeometry(g.r, 0.8, 0.045), mat)];
      if (fn({ ias: 0, altFt: 0, vsFpm: 0, hdg: 0, fuel: 0, flaps: 0 }).length > 1) { const m = new THREE.Mesh(needleGeometry(g.r, 0.5, 0.07), mat2); m.position.z = 0.0004; hands.push(m); }
      for (const m of hands) { m.matrixAutoUpdate = true; m.frustumCulled = false; hub.add(m); }
      this.group.add(hub); this.items.push({ kind: g.kind, fn, hands });
    }
  }
  get count() { return this.items.length; }
  // s: the display feed; redrawn at most 20 times a second
  update(dt, s) {
    if (!s || (this.t += dt) < 0.05) return; this.t = 0;
    for (const it of this.items) { const a = it.fn(s); for (let i = 0; i < it.hands.length; i++) it.hands[i].rotation.z = a[i] ?? 0; }
  }
  set visible(v) { this.group.visible = v; }
}
