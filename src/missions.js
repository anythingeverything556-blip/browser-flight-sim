import { bearing, destination, haversine } from './geo.js';

const FT = 3.28084, NM = 1852, wrap180 = (a) => ((a + 540) % 360) - 180;
export const MISSIONS = {
  free: { name: 'Free flight', blurb: 'No objectives.' },
  tutorial: { name: 'Tutorial', blurb: 'Learn the take-off, climb and autopilot. You fly, it tells you what to do next.' },
  landassist: { name: 'Landing 1', blurb: 'Start on a 10 NM final. The autopilot flies the ILS to 150 ft, then you flare and land it.' },
  landhand: { name: 'Landing 2', blurb: 'Hand-fly the ILS from a 5 NM final and land, with step-by-step coaching. Scored on sink rate, speed and position.' },
  highfast: { name: 'High & Fast', blurb: 'Climb above 70,000 ft and reach Mach 3.0. Hold both for 20 seconds.' },
  recon: { name: 'Recon run', blurb: 'Fly over five targets in order. Closer passes score more.' },
  tour: { name: 'Watch demo', blurb: 'The jet flies a take-off, climb and autopilot sequence by itself, then hands over.' },
};

// High & Fast: sustain M >= 3.0 above 70,000 ft for 20 s.
class HighFast {
  constructor() { this.hold = 0; this.best = 0; this.done = false; this.t = 0; }
  update(dt, s) {
    this.t += dt;
    const ok = s.M >= 3.0 && s.alt * FT >= 70000;
    this.hold = ok ? this.hold + dt : Math.max(0, this.hold - dt * 2);
    this.best = Math.max(this.best, this.hold);
    if (this.hold >= 20 && !this.done) { this.done = true; return { event: 'done', text: `Mission complete in ${fmtTime(this.t)}` }; }
    return null;
  }
  hud() {
    return { title: 'HIGH & FAST', lines: [
      row('Mach', s3(this.s?.M), '3.0', (this.s?.M || 0) >= 3.0),
      row('Altitude', Math.round((this.s?.alt || 0) * FT / 100) * 100 + ' ft', '70,000 ft', (this.s?.alt || 0) * FT >= 70000),
      row('Hold', this.hold.toFixed(0) + ' s', '20 s', this.done)], done: this.done };
  }
}

// Recon run: five targets ahead of the start along its heading. A pass is scored at the point of closest approach.
class Recon {
  constructor(lat, lon, hdg) {
    const legs = [[22, 0], [50, 6], [82, -8], [118, 5], [158, -3]];
    this.targets = legs.map(([km, off], i) => {
      const p = destination(lat, lon, hdg, km * 1000), q = destination(p.lat, p.lon, hdg + 90, off * 1000);
      return { ...q, name: `T${i + 1}`, score: null, dist: null };
    });
    this.i = 0; this.t = 0; this.min = Infinity; this.done = false;
  }
  get total() { return this.targets.reduce((a, t) => a + (t.score || 0), 0); }
  update(dt, s) {
    this.t += dt; this.s = s;
    const tg = this.targets[this.i]; if (!tg || this.done) return null;
    const d = haversine(s.lat, s.lon, tg.lat, tg.lon);
    this.min = Math.min(this.min, d);
    // the pass ends once we are climbing away from the closest point
    if (d < 6000 && d > this.min + 400 || (d < 300)) {
      tg.dist = this.min; tg.score = this.min <= 2500 ? Math.max(10, Math.round(100 * (1 - this.min / 2500))) : 0;
      const msg = tg.score ? `${tg.name} photographed — ${tg.score} pts (${Math.round(this.min)} m)` : `${tg.name} missed by ${(this.min / NM).toFixed(1)} nm`;
      this.i++; this.min = Infinity;
      if (this.i >= this.targets.length) { this.done = true; return { event: 'done', text: `Run complete — ${this.total}/500 in ${fmtTime(this.t)}`, toast: msg }; }
      return { event: 'target', text: msg };
    }
    if (d > 15000 && this.min < Infinity && this.min > 2500 && d > this.min + 3000) {
      // flew past without a close pass
      tg.dist = this.min; tg.score = 0; const msg = `${tg.name} missed by ${(this.min / NM).toFixed(1)} nm`;
      this.i++; this.min = Infinity;
      if (this.i >= this.targets.length) { this.done = true; return { event: 'done', text: `Run complete — ${this.total}/500 in ${fmtTime(this.t)}`, toast: msg }; }
      return { event: 'target', text: msg };
    }
    return null;
  }
  hud() {
    const s = this.s, tg = this.targets[this.i], lines = [];
    if (tg && s) {
      const d = haversine(s.lat, s.lon, tg.lat, tg.lon), b = bearing(s.lat, s.lon, tg.lat, tg.lon), turn = wrap180(b - s.hdg);
      lines.push(row('Next', tg.name, `${(d / NM).toFixed(1)} nm`, false));
      lines.push(row('Bearing', Math.round(b) + '°', Math.abs(turn) < 3 ? 'on track' : (turn > 0 ? `turn right ${Math.round(turn)}°` : `turn left ${Math.round(-turn)}°`), Math.abs(turn) < 3));
    }
    lines.push(row('Score', String(this.total), '/ 500', this.done));
    lines.push(`<div class="mrow dots">${this.targets.map((t) => `<i class="${t.score == null ? '' : t.score ? 'hit' : 'miss'}"></i>`).join('')}</div>`);
    return { title: 'RECON RUN', lines, done: this.done };
  }
}
const row = (k, v, goal, ok) => `<div class="mrow${ok ? ' ok' : ''}"><span>${k}</span><b>${v}</b><em>${goal}</em></div>`;
const s3 = (v) => (v || 0).toFixed(2);
const fmtTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;


// Landing scorecard: 100 points over sink rate, touchdown speed, centre line and touchdown point.
const band = (v, bands) => { for (const [lim, pts] of bands) if (v <= lim) return pts; return 0; };
export function scoreLanding(td) {
  const sink = band(td.sink, [[1.2, 40], [2, 32], [3, 22], [4.5, 10]]);
  const spd = band(td.kt, [[160, 20], [170, 14], [180, 8]]);
  const off = band(td.off, [[4, 20], [8, 14], [15, 8]]);
  const d = td.dist;
  const dist = d == null ? 10 : d < 100 ? 0 : d <= 700 ? 20 : d <= 1200 ? 12 : d <= 2000 ? 6 : 0;
  const total = td.belly ? 0 : sink + spd + off + dist;
  const grade = total >= 90 ? 'A' : total >= 75 ? 'B' : total >= 55 ? 'C' : total >= 35 ? 'D' : 'F';
  const tips = [];
  if (td.belly) tips.push('Gear was not down. Press G well before the runway.');
  if (sink < 32) tips.push(`Sink rate ${td.sink.toFixed(1)} m/s. Flare earlier and hold the nose up, aim for under 2.`);
  if (spd < 14) tips.push(`Touched down at ${Math.round(td.kt)} kt. Bleed speed on final and idle the throttle in the flare, aim for under 160.`);
  if (off < 14) tips.push(`${Math.round(td.off)} m off the centre line. Small corrections with A and D, early.`);
  if (d != null && dist < 12) tips.push(d < 100 ? 'You landed short of the runway markings. Keep the glideslope.' : `Touched down ${Math.round(d)} m down the runway. Do not float, ease the throttle at the threshold.`);
  return { sink, spd, off, dist, total, grade, tips };
}

// Landing 1 (autopilot to minimums) and Landing 2 (hand-flown). s: { agl, vy, onGround, iasKt, gs, throttle, crashed, gearDown, chute,
// ilsValid, gsDev (deg, + above), locXtk (m, + right of centre line), thrDist (m, negative past the threshold), apOn }
class Landing {
  constructor(kind) { this.kind = kind; this.phase = 'final'; this.t = 0; this.done = false; this.td = null; this.score = null; this.airborne = false; this.lastVy = 0; this.s = null; }
  update(dt, s) {
    this.s = s; this.t += dt;
    if (this.done) return null;
    if (s.crashed) { this.done = true; this.phase = 'crashed'; this.crashWhy = s.crashed; return { event: 'done', text: `Crashed: ${s.crashed}` }; }
    if (!s.onGround) { this.lastVy = s.vy; if (s.agl > 6) this.airborne = true; }
    if (this.phase === 'final' && s.agl < 60) this.phase = 'flare';
    if (s.onGround && this.airborne && !this.td) {
      this.td = { sink: Math.max(0, -this.lastVy), kt: s.iasKt, off: Math.abs(s.locXtk || 0), dist: s.ilsValid ? -s.thrDist : null, belly: !s.gearDown };
      this.score = scoreLanding(this.td); this.phase = 'rollout';
      return { event: 'touchdown', text: `Touchdown: ${this.td.sink.toFixed(1)} m/s down at ${Math.round(this.td.kt)} kt` };
    }
    if (this.phase === 'rollout' && s.gs < 3) {
      this.done = true; this.phase = 'done';
      return { event: 'done', text: `Landing score ${this.score.total}/100, grade ${this.score.grade}` };
    }
    return null;
  }
  // what the coach card says right now
  coach() {
    const s = this.s; if (!s) return null;
    const assisted = this.kind === 'landassist', tick = (ok) => (ok ? '✓' : '✗');
    if (this.phase === 'final') {
      const spdOk = s.iasKt >= 170 && s.iasKt <= 190, gsOk = s.ilsValid && Math.abs(s.gsDev) <= 0.8, locOk = s.ilsValid && Math.abs(s.locXtk) <= 15;
      const check = [`${tick(s.gearDown)} Gear down`, `${tick(spdOk)} Speed 170-190 kt (${Math.round(s.iasKt)})`,
        `${tick(gsOk)} On the glideslope (${s.ilsValid ? (s.gsDev >= 0 ? '+' : '') + s.gsDev.toFixed(1) + '°' : 'no signal'})`,
        `${tick(locOk)} On the centre line (${s.ilsValid ? Math.round(Math.abs(s.locXtk)) + ' m ' + (s.locXtk > 3 ? 'right' : s.locXtk < -3 ? 'left' : 'centred') : 'no signal'})`].join('\n');
      const hints = [];
      if (!s.gearDown) hints.push('Gear is up. Press G now.');
      if (s.iasKt && s.iasKt < 165) hints.push('Speed is low. Add throttle with E, and hold the nose level until it recovers.');
      else if (s.iasKt > 200) hints.push('Too fast. Ease the throttle with Q.');
      if (!assisted && s.ilsValid) {
        if (s.gsDev > 0.8) hints.push('Above the glideslope. Lower the nose a little with W and ease the throttle with Q.');
        else if (s.gsDev < -0.8) hints.push('Below the glideslope. Add throttle with E first, then raise the nose a little with S.');
        if (s.locXtk > 25) hints.push('Right of the centre line. Tap A to bank left, then tap D to level out.');
        else if (s.locXtk < -25) hints.push('Left of the centre line. Tap D to bank right, then tap A to level out.');
      }
      const text = assisted
        ? 'The autopilot is flying the approach (the A/P light is on). It follows the glideslope and the centre line and holds 180 kt, then disconnects at 46 m (150 ft) with a warning. '
          + 'Your job until then is to watch, check the list below, and get ready: when it disconnects you are flying. '
          + 'At the flare, raise the nose a few degrees with S, throttle to idle with 0 or Q, and let it settle. After touchdown deploy the chute with C and brake with B.'
        : 'You are on a 5 NM final. Plan: 1. Hold about 180 kt, with E for more throttle and Q for less. '
          + '2. Keep the glideslope on 3°: if you are high, lower the nose with W and ease the throttle; if low, add throttle first and then raise the nose with S. '
          + '3. Stay on the centre line: a short tap of A or D banks the jet, tap the other key to level. Small, early corrections work best. '
          + '4. At 60 m height the flare begins and this card tells you what to do. The runway threshold is where the glideslope ends, aim just past it.';
      return { label: assisted ? 'Landing 1 of 2' : 'Landing 2 of 2', title: assisted ? 'Autopilot flying the ILS' : 'Fly the ILS', text,
        live: `${check}\nHeight ${Math.round(s.agl)} m   Pitch ${Math.round(s.pitchDeg || 0)}°`, hint: hints.join(' ') };
    }
    if (this.phase === 'flare') {
      const sink = -s.vy, pitch = Math.round(s.pitchDeg || 0);
      const hint = s.agl < 30 && sink > 3.2 ? 'Sinking fast. Pull back with S now.'
        : s.agl < 25 && sink < 1 && s.throttle > 0.2 ? 'Throttle to idle with 0, and keep the nose where it is.'
        : pitch > 14 ? 'Nose too high. Ease forward with W, or the tail will strike the runway.' : '';
      return { label: 'Flare', title: 'Flare and touch down',
        text: 'Now: 1. Raise the nose gently with S to about 10-12° and hold it there. 2. Throttle to idle with 0 as the runway arrives. '
          + '3. Let the jet settle on its own: do not keep pulling, and do not push the nose down. Aim to touch down under 160 kt and under 2 m/s sink.',
        live: `Sink ${sink.toFixed(1)} m/s (aim < 2)\nSpeed ${Math.round(s.iasKt)} kt (aim < 160)\nPitch ${pitch}°   Height ${Math.round(s.agl)} m`, hint };
    }
    if (this.phase === 'rollout') {
      const hint = s.chute < 0.1 && s.gs * 1.944 > 60 && s.gs * 1.944 < 200 ? 'Deploy the drag chute with C now.' : s.gs * 1.944 < 60 && s.throttle > 0.05 ? 'Throttle to idle with 0.' : '';
      return { label: 'Rollout', title: 'Slow down and stay straight',
        text: 'Hold the centre line with A and D (they steer the nose wheel now). 1. Chute with C below 200 kt. 2. Throttle to idle with 0. 3. Once the nose wheel is down, brake with B or Space. 4. Stop on the runway.',
        live: `Ground speed ${Math.round(s.gs * 1.944)} kt`, hint };
    }
    if (this.phase === 'done' && this.score) {
      return { label: 'Result', title: `Score ${this.score.total}/100, grade ${this.score.grade}`, text: this.score.tips.length ? this.score.tips.join(' ') : 'A clean landing. Press R to fly it again.', live: '', hint: '', ok: this.score.total >= 75 };
    }
    if (this.phase === 'crashed') return { label: 'Result', title: 'Crashed', text: `${this.crashWhy}. Press R to try again. A softer touchdown needs an earlier flare and less speed.`, live: '', hint: '' };
    return null;
  }
  hud() {
    const s = this.s, lines = [];
    if (s && !this.td) {
      lines.push(row('Glideslope', s.ilsValid ? `${s.gsDev >= 0 ? '+' : ''}${s.gsDev.toFixed(1)}°` : '-', s.gsDev > 0.8 ? 'high' : s.gsDev < -0.8 ? 'low' : 'on path', s.ilsValid && Math.abs(s.gsDev) <= 0.8));
      lines.push(row('Course', s.ilsValid ? `${Math.round(Math.abs(s.locXtk))} m` : '-', s.locXtk > 5 ? 'right' : s.locXtk < -5 ? 'left' : 'centred', s.ilsValid && Math.abs(s.locXtk) <= 5));
      lines.push(row('Speed', `${Math.round(s.iasKt)} kt`, '175-185', s.iasKt >= 165 && s.iasKt <= 195));
      if (this.phase === 'flare') lines.push(row('Sink', `${(-s.vy).toFixed(1)} m/s`, '< 2', -s.vy <= 2));
    }
    if (this.score) {
      const c = this.score, t = this.td;
      lines.push(row('Sink', `${t.sink.toFixed(1)} m/s`, `${c.sink}/40`, c.sink >= 32));
      lines.push(row('Speed', `${Math.round(t.kt)} kt`, `${c.spd}/20`, c.spd >= 14));
      lines.push(row('Course', `${Math.round(t.off)} m`, `${c.off}/20`, c.off >= 14));
      lines.push(row('Point', t.dist == null ? '-' : `${Math.round(t.dist)} m`, `${c.dist}/20`, c.dist >= 12));
      lines.push(row('Total', `${c.total}`, `grade ${c.grade}`, c.total >= 75));
    }
    return { title: this.kind === 'landassist' ? 'LANDING 1' : 'LANDING 2', lines, done: this.done && !!this.score && this.score.total >= 55 };
  }
}

export function createMission(kind, start) {
  if (kind === 'landassist' || kind === 'landhand') return new Landing(kind);
  if (kind === 'highfast') { const m = new HighFast(); const u = m.update.bind(m); m.update = (dt, s) => { m.s = s; return u(dt, s); }; return m; }
  if (kind === 'recon') return new Recon(start.lat, start.lon, start.hdg);
  return null;
}
