// Weather presets and their screen-space effects: rain streaks that sweep past the camera at flight speed, a grey gloom that
// dims and desaturates the scene under cloud, a pale veil for fog, and lightning with thunder that arrives late.
export const WEATHER = {
  clear: { name: 'Clear', clouds: 0, wind: 4, turb: 0.04, vis: 1.8, rain: 0, gloom: 0, fog: 0, bolts: 0 },
  few: { name: 'Fair', clouds: 0.3, wind: 8, turb: 0.1, vis: 1.3, rain: 0, gloom: 0, fog: 0, bolts: 0 },
  scattered: { name: 'Scattered', clouds: 0.6, wind: 12, turb: 0.2, vis: 1.1, rain: 0, gloom: 0.12, fog: 0, bolts: 0 },
  overcast: { name: 'Overcast', clouds: 1, wind: 14, turb: 0.2, vis: 0.8, rain: 0, gloom: 0.42, fog: 0.1, bolts: 0 },
  rain: { name: 'Rain', clouds: 1, wind: 18, turb: 0.35, vis: 0.5, rain: 0.65, gloom: 0.55, fog: 0.2, bolts: 0 },
  storm: { name: 'Storm', clouds: 1, wind: 30, turb: 0.7, vis: 0.35, rain: 1, gloom: 0.72, fog: 0.25, bolts: 1 },
  fog: { name: 'Fog', clouds: 0.3, wind: 2, turb: 0.02, vis: 0.3, rain: 0, gloom: 0.2, fog: 0.85, bolts: 0 },
  windy: { name: 'Gusty', clouds: 0.3, wind: 26, turb: 0.5, vis: 1.2, rain: 0, gloom: 0, fog: 0, bolts: 0 },
};

export class Weather {
  constructor(rainCanvas, gloomEl, fogEl, boltEl) {
    this.cv = rainCanvas; this.x = rainCanvas.getContext('2d'); this.gloom = gloomEl; this.fog = fogEl; this.bolt = boltEl;
    this.rain = 0; this.rainTarget = 0; this.gloomTarget = 0; this.fogTarget = 0; this.bolts = 0; this.boltIn = 8; this.boltLevel = 0;
    this.gloomV = 0; this.fogV = 0; this.drops = []; this.thunder = []; this.w = 0; this.h = 0;
  }
  set(p) { this.rainTarget = p.rain; this.gloomTarget = p.gloom; this.fogTarget = p.fog; this.bolts = p.bolts; if (!p.bolts) this.boltIn = 8; }
  resize(w, h) { this.w = w; this.h = h; const r = Math.min(window.devicePixelRatio || 1, 1.5); this.cv.width = Math.round(w * r); this.cv.height = Math.round(h * r); this.cv.style.width = w + 'px'; this.cv.style.height = h + 'px'; this.r = r; }
  // speed: airspeed in m/s; cockpit: looking out through the canopy
  update(dt, speed, cockpit) {
    const k = 1 - Math.exp(-dt * 0.6);
    this.rain += (this.rainTarget - this.rain) * k; this.gloomV += (this.gloomTarget - this.gloomV) * k; this.fogV += (this.fogTarget - this.fogV) * k;
    if (this.gloom) this.gloom.style.opacity = this.gloomV.toFixed(3);
    if (this.fog) this.fog.style.opacity = this.fogV.toFixed(3);
    // lightning: a double flash, then thunder after the distance to the strike
    const events = [];
    if (this.bolts > 0 && this.rain > 0.5) {
      this.boltIn -= dt;
      if (this.boltIn <= 0) { this.boltIn = 5 + Math.random() * 11; this.boltLevel = 1; this.flash2 = 0.12 + Math.random() * 0.1; const d = 800 + Math.random() * 7000; events.push({ distance: d, level: 1 - d / 9000 }); }
    }
    if (this.bolt) {
      if (this.boltLevel > 0.02) { this.boltLevel *= Math.exp(-dt * 9); if (this.flash2 > 0) { this.flash2 -= dt; if (this.flash2 <= 0) this.boltLevel = Math.max(this.boltLevel, 0.9); } this.bolt.style.opacity = Math.min(0.85, this.boltLevel).toFixed(3); }
      else if (this.boltLevel) { this.boltLevel = 0; this.bolt.style.opacity = '0'; }
    }
    this.draw(dt, speed, cockpit);
    return events;
  }
  draw(dt, speed, cockpit) {
    const x = this.x, w = this.w, h = this.h;
    if (!w) return;
    x.setTransform(this.r, 0, 0, this.r, 0, 0); x.clearRect(0, 0, w, h);
    if (this.rain < 0.02) { this.drops.length = 0; return; }
    const target = Math.round(this.rain * (w * h) / 2600), cx = w * 0.5, cy = h * 0.46, diag = Math.hypot(w, h) * 0.55;
    // slow: rain falls straight down; fast: it streams out from the point we are flying toward, with the fall on top
    const radial = Math.min(1, speed / 200), fall = 820;
    const spawn = (d, anywhere) => {
      if (radial > 0.3 && !anywhere) { const a = Math.random() * 6.283, r = Math.random() * diag * 0.22; d.x = cx + Math.cos(a) * r; d.y = cy + Math.sin(a) * r; }
      else { d.x = Math.random() * w; d.y = anywhere ? Math.random() * h : -20 - Math.random() * 60; }
      d.s = 0.7 + Math.random() * 0.6; d.l = Math.random();
    };
    while (this.drops.length < target) { const d = {}; spawn(d, true); this.drops.push(d); }
    this.drops.length = Math.min(this.drops.length, target);
    x.lineCap = 'round';
    for (const d of this.drops) {
      const rx = d.x - cx, ry = d.y - cy, rl = Math.hypot(rx, ry) + 1, out = radial * (0.3 + 1.7 * rl / diag) * 1100 * d.s;
      const vx = rx / rl * out, vy = ry / rl * out + fall * d.s * (1 - 0.35 * radial);
      d.x += vx * dt; d.y += vy * dt;
      if (d.x < -60 || d.x > w + 60 || d.y > h + 60) { spawn(d, false); continue; }
      const sp = Math.hypot(vx, vy), len = Math.min(80, Math.max(5, sp * 0.034)) * (0.7 + 0.6 * d.l);
      x.strokeStyle = `rgba(210, 224, 238, ${((0.1 + 0.28 * d.l) * (0.4 + 0.6 * this.rain) * (cockpit ? 1.2 : 1)).toFixed(3)})`;
      x.lineWidth = 0.7 + d.l * 0.9;
      x.beginPath(); x.moveTo(d.x, d.y); x.lineTo(d.x - vx / sp * len, d.y - vy / sp * len); x.stroke();
    }
  }
}
