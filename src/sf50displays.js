// Live Perspective Touch+ style displays for the Vision Jet SF50: PFD and MFD drawn on 2D canvases every few frames from the flight state,
// used as the emissive maps of the Display_PFD / Display_MFD screens of SF50.glb. Layout follows the Garmin SF50 pilot's guide (figs. 2-1, 3-2)
// and G3 cockpit photos; every graphic is procedural (no Garmin artwork). Design coordinates are 2560 x 1600 (the Blender textures), scaled.
// state (all optional, display units): ias tas gs (kt) mach alt (ft) vs (fpm) hdg trk crs (deg) pitch bank fpa (deg) slip (-1..1) aoa (0..1 of stall)
//   selIas selAlt selHdg, thrust (%) n1 n2 (%) itt oilT (°C) oilP (psi) ff (gph) fuelL fuelR (gal) gear (0 up..1 down) gearTransit (bool) flaps (0..1)
//   trim (deg nose up) cabAlt (ft) cabDiff (psi) cabRate (fpm) oat (°C) windFrom windKt, ap {ap, yd, at, lat, vert, armed}, com1 com1Name flt utc wpt dis ete dest
//   alerts [{text, level: 'warning'|'caution'|'advisory'}]
export const SF50_DISPLAY_DESIGN = { w: 2560, h: 1600 };
const GRN = '#33fa55', CYN = '#29dcff', MAG = '#ff47fa', WHT = '#ffffff', YEL = '#ffdb14', AMB = '#ffb300', RED = '#ff2a20', GRY = '#b3b8c2';
const TAPE = 'rgba(31,31,36,0.70)', BOX = 'rgba(18,18,23,0.90)';
const FONT = "'Arial Narrow', 'Roboto Condensed', 'Helvetica Neue', Arial, sans-serif";
const D2R = Math.PI / 180, clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v, d) => (Number.isFinite(v) ? v : d);

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined' && typeof document === 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}

// ---- drawing helpers on a 2D context in design units
function txt(g, s, x, y, size, col, anchor = 'l', base = 'middle', weight = 'bold') {
  g.font = `${weight} ${size}px ${FONT}`; g.fillStyle = col; g.textAlign = anchor === 'c' ? 'center' : anchor === 'r' ? 'right' : 'left'; g.textBaseline = base;
  g.fillText(s, x, y); return g.measureText(s).width;
}
function txts(g, parts, x, y, anchor = 'l', base = 'middle') { // [[text, size, colour], ...]
  let w = 0; for (const [s, sz] of parts) { g.font = `bold ${sz}px ${FONT}`; w += g.measureText(s).width; }
  let x0 = anchor === 'r' ? x - w : anchor === 'c' ? x - w / 2 : x;
  for (const [s, sz, c] of parts) x0 += txt(g, s, x0, y, sz, c, 'l', base);
  return w;
}
function line(g, pts, w, col, closed = false) {
  g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); if (closed) g.closePath();
  g.lineWidth = w; g.strokeStyle = col; g.lineJoin = 'round'; g.lineCap = 'round'; g.stroke();
}
function seg(g, x0, y0, x1, y1, w, col, outline = null) { if (outline) line(g, [[x0, y0], [x1, y1]], w + 3, outline); line(g, [[x0, y0], [x1, y1]], w, col); }
function poly(g, pts, col, stroke = null, sw = 2) {
  g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath();
  g.fillStyle = col; g.fill(); if (stroke) { g.lineWidth = sw; g.strokeStyle = stroke; g.lineJoin = 'round'; g.stroke(); }
}
function rect(g, x0, y0, x1, y1, col) { g.fillStyle = col; g.fillRect(x0, y0, x1 - x0, y1 - y0); }
function rrect(g, x0, y0, x1, y1, r, fill, stroke = null, sw = 2) {
  g.beginPath(); g.roundRect(x0, y0, x1 - x0, y1 - y0, r); if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.lineWidth = sw; g.strokeStyle = stroke; g.stroke(); }
}
// angle 0 = up (12 o'clock), clockwise, degrees
const arcPt = (cx, cy, r, a) => [cx + r * Math.sin(a * D2R), cy - r * Math.cos(a * D2R)];
function arc(g, cx, cy, r, a0, a1, w, col) { g.beginPath(); g.arc(cx, cy, r, (a0 - 90) * D2R, (a1 - 90) * D2R); g.lineWidth = w; g.strokeStyle = col; g.lineCap = 'butt'; g.stroke(); }
function ring(g, cx, cy, r0, r1, a0, a1, col) { g.beginPath(); g.arc(cx, cy, r1, (a0 - 90) * D2R, (a1 - 90) * D2R); g.arc(cx, cy, r0, (a1 - 90) * D2R, (a0 - 90) * D2R, true); g.closePath(); g.fillStyle = col; g.fill(); }
function disc(g, cx, cy, r, col) { g.beginPath(); g.arc(cx, cy, r, 0, 2 * Math.PI); g.fillStyle = col; g.fill(); }
function clip(g, x0, y0, x1, y1) { g.save(); g.beginPath(); g.rect(x0, y0, x1 - x0, y1 - y0); g.clip(); }

// ---- PFD
function drawAttitude(g, s, cx, cy, k) {
  const pitch = num(s.pitch, 0), bank = num(s.bank, 0);
  g.save(); g.translate(cx, cy); g.rotate(-bank * D2R);
  const off = pitch * k, big = 2600;
  const sky = g.createLinearGradient(0, off - 900, 0, off); sky.addColorStop(0, '#1d4fa6'); sky.addColorStop(1, '#6fa6e8');
  g.fillStyle = sky; g.fillRect(-big, off - big, 2 * big, big);
  const gnd = g.createLinearGradient(0, off, 0, off + 900); gnd.addColorStop(0, '#8a5a24'); gnd.addColorStop(1, '#4a2e10');
  g.fillStyle = gnd; g.fillRect(-big, off, 2 * big, big);
  seg(g, -big, off, big, off, 3.5, WHT);
  // horizon heading scale
  const hdg = num(s.hdg, 0);
  for (let d = Math.ceil((hdg - 45) / 10) * 10; d <= hdg + 45; d += 10) {
    const x = (d - hdg) * k; seg(g, x, off - 12, x, off, 3, WHT); txt(g, String(((d % 360) + 360) % 360 / 10 | 0).padStart(2, '0'), x, off - 30, 24, WHT, 'c');
  }
  // pitch ladder (clipped to the attitude window)
  g.save(); g.beginPath(); g.arc(0, 0, 410, 0, 2 * Math.PI); g.clip();
  for (let deg = -25; deg <= 25; deg += 2.5) {
    if (!deg) continue;
    const y = (pitch - deg) * k, half = deg % 10 === 0 ? 115 : deg % 5 === 0 ? 70 : 34;
    seg(g, -half, y, half, y, 2.6, WHT, 'rgba(0,0,0,0.55)');
    if (deg % 10 === 0) { txt(g, String(Math.abs(deg)), -half - 38, y, 32, WHT, 'c'); txt(g, String(Math.abs(deg)), half + 38, y, 32, WHT, 'c'); }
  }
  g.restore();
  g.restore();
  // bank scale (fixed) and roll pointer (rotates)
  const R = 420; arc(g, cx, cy, R, -60, 60, 6, 'rgba(0,0,0,0.5)'); arc(g, cx, cy, R, -60, 60, 3, WHT);
  for (const [a, L] of [[-60, 34], [-45, 20], [-30, 34], [-20, 20], [-10, 20], [10, 20], [20, 20], [30, 34], [45, 20], [60, 34]]) { const p0 = arcPt(cx, cy, R, a), p1 = arcPt(cx, cy, R + L, a); seg(g, p0[0], p0[1], p1[0], p1[1], 3, WHT, 'rgba(0,0,0,0.5)'); }
  poly(g, [[cx, cy - R], [cx - 18, cy - R - 30], [cx + 18, cy - R - 30]], WHT);
  g.save(); g.translate(cx, cy); g.rotate(-bank * D2R);
  poly(g, [[0, -R + 4], [-20, -R + 34], [20, -R + 34]], WHT, '#000', 2);
  const sl = clamp(num(s.slip, 0), -1, 1) * 30;
  poly(g, [[-24 + sl, -R + 40], [24 + sl, -R + 40], [29 + sl, -R + 53], [-29 + sl, -R + 53]], WHT, '#000', 2);
  g.restore();
  // flight-path marker
  const fx = cx + (num(s.trk, hdg) - hdg) * k * Math.cos(bank * D2R), fy = cy + (pitch - num(s.fpa, pitch)) * k;
  for (const [w, c] of [[9, 'rgba(0,0,0,0.7)'], [4.5, GRN]]) {
    g.beginPath(); g.arc(fx, fy, 15, 0, 2 * Math.PI); g.lineWidth = w; g.strokeStyle = c; g.stroke();
    seg(g, fx - 15, fy, fx - 46, fy, w, c); seg(g, fx + 15, fy, fx + 46, fy, w, c); seg(g, fx, fy - 15, fx, fy - 34, w, c);
  }
  // flight director (magenta single cue), aircraft symbol, wing bars
  const fdp = clamp(num(s.fdPitch, 0) - pitch, -12, 12) * k, fdb = (num(s.fdBank, bank) - bank) * D2R;
  if (s.ap && s.ap.fd !== false) {
    g.save(); g.translate(cx, cy + fdp * 0); g.rotate(-fdb);
    for (const sg of [-1, 1]) poly(g, [[0, -10 - fdp], [sg * 178, 57 - fdp], [sg * 178, 40 - fdp], [0, -27 - fdp]], MAG, '#000', 2.5);
    g.restore();
  }
  poly(g, [[cx, cy], [cx + 156, cy + 58], [cx + 62, cy + 58], [cx, cy + 31], [cx - 62, cy + 58], [cx - 156, cy + 58]], YEL, '#000', 3);
  for (const sg of [-1, 1]) poly(g, [[cx + sg * 238, cy - 8], [cx + sg * 340, cy - 8], [cx + sg * 340, cy + 8], [cx + sg * 238, cy + 8]], YEL, '#000', 3);
}

function drawSpeedTape(g, s, cy) {
  const x0 = 600, x1 = 790, y0 = 190, y1 = 1000, kv = 11.5, ias = Math.max(0, num(s.ias, 0));
  rect(g, x0, y0, x1, y1, TAPE); clip(g, x0, y0, x1, y1);
  const vmo = num(s.vmo, 250), vso = num(s.vso, 67);
  // speed bands: red barber pole above VMO, white/green arcs
  const yv = (v) => cy - (v - ias) * kv;
  rect(g, x1 - 10, yv(vmo), x1 - 2, yv(Math.max(vso, ias - 80)), 'rgba(40,215,65,0.95)');
  for (let v = vmo; v < vmo + 80; v += 4) rect(g, x1 - 12, yv(v + 2), x1, yv(v), (v / 4) % 2 ? RED : WHT);
  rect(g, x1 - 12, yv(vso), x1, yv(Math.max(0, ias - 80)), RED);
  for (let v = Math.floor((ias - 45) / 5) * 5; v <= ias + 45; v += 5) {
    if (v < 20) continue; const y = yv(v), L = v % 10 === 0 ? 30 : 17;
    seg(g, x1 - 12 - L, y, x1 - 12, y, 3, WHT);
    if (v % 10 === 0 && Math.abs(y - cy) > 72) txt(g, String(v), x1 - 54, y, 44, WHT, 'r');
  }
  if (Number.isFinite(s.iasTrend)) { const yt = yv(ias + s.iasTrend); seg(g, x1 - 6, cy, x1 - 6, yt, 6, MAG); }
  g.restore();
  // rolling-digit readout
  const bx0 = x0 + 4, bx1 = x1 - 44, wy0 = cy - 78, wy1 = cy + 78;
  poly(g, [[bx0, cy - 46], [bx1 - 54, cy - 46], [bx1 - 54, wy0], [bx1, wy0], [bx1, cy - 22], [x1 - 13, cy], [bx1, cy + 22], [bx1, wy1], [bx1 - 54, wy1], [bx1 - 54, cy + 46], [bx0, cy + 46]], '#000', WHT, 3);
  const iv = Math.floor(ias), frac = ias - iv;
  if (iv >= 20) txt(g, String(Math.floor(iv / 10)), bx1 - 51, cy, 70, WHT, 'r'); else txt(g, ias < 20 ? '---' : '', bx1 - 51, cy, 60, WHT, 'r');
  if (ias >= 20) { clip(g, bx1 - 54, wy0 + 3, bx1, wy1 - 3); for (let dd = -2; dd <= 2; dd++) txt(g, String(((iv % 10) + dd + 10) % 10), bx1 - 27, cy - dd * 66 + frac * 66, 70, WHT, 'c'); g.restore(); }
  rect(g, x0, 125, x1, 182, BOX); txts(g, [[String(Math.round(num(s.selIas, ias))), 46, CYN], ['KT', 30, CYN]], x1 - 14, 154, 'r');
  poly(g, [[x0 + 14, 136], [x0 + 44, 136], [x0 + 44, 172], [x0 + 14, 172], [x0 + 14, 160], [x0 + 26, 154], [x0 + 14, 148]], CYN);
  rect(g, x0, 1004, x1, 1058, BOX); txts(g, [['M ', 34, WHT], ['.' + String(Math.round(num(s.mach, 0) * 1000)).padStart(3, '0'), 44, WHT]], (x0 + x1) / 2, 1031, 'c');
}

function drawAltTape(g, s, cy) {
  const x0 = 1770, x1 = 1960, y0 = 190, y1 = 1000, ka = 1.15, alt = num(s.alt, 0);
  rect(g, x0, y0, x1, y1, TAPE); clip(g, x0, y0, x1, y1);
  for (let a = Math.floor((alt - 400) / 20) * 20; a <= alt + 420; a += 20) {
    const y = cy - (a - alt) * ka;
    if (a % 100 === 0) { seg(g, x0, y, x0 + 30, y, 3, WHT); txts(g, [[String(Math.trunc(a / 100)), 44, WHT], ['00', 32, WHT]], x1 - 14, y + 16, 'r', 'alphabetic'); }
    else seg(g, x0, y, x0 + 15, y, 2.5, WHT);
  }
  const yb = cy - (num(s.selAlt, alt) - alt) * ka;
  poly(g, [[x0, yb - 26], [x0 + 14, yb - 26], [x0 + 14, yb - 10], [x0 + 6, yb], [x0 + 14, yb + 10], [x0 + 14, yb + 26], [x0, yb + 26]], CYN);
  g.restore();
  const bx0 = x0 + 30, bx1 = x1 - 4, wy0 = cy - 82, wy1 = cy + 82;
  poly(g, [[bx0, cy - 22], [bx0, cy - 46], [bx1 - 74, cy - 46], [bx1 - 74, wy0], [bx1, wy0], [bx1, wy1], [bx1 - 74, wy1], [bx1 - 74, cy + 46], [bx0, cy + 46], [bx0, cy + 22], [x0 + 6, cy]], '#000', WHT, 3);
  const hund = Math.floor(alt / 100); txt(g, String(hund), bx1 - 78, cy, 64, WHT, 'r');
  const rem = alt - hund * 100, base = Math.floor(rem / 20) * 20, fr = (rem - base) / 20;
  clip(g, bx1 - 74, wy0 + 3, bx1, wy1 - 3);
  for (let dd = -2; dd <= 2; dd++) txt(g, String(((base + 20 * dd) % 100 + 100) % 100).padStart(2, '0'), bx1 - 37, cy - dd * 54 + fr * 54, 46, WHT, 'c');
  g.restore();
  rect(g, x0, 125, x1, 182, BOX);
  poly(g, [[x0 + 12, 136], [x0 + 40, 136], [x0 + 40, 172], [x0 + 12, 172], [x0 + 12, 160], [x0 + 22, 154], [x0 + 12, 148]], CYN);
  const sa = Math.round(num(s.selAlt, alt) / 100) * 100; txts(g, [[String(Math.floor(sa / 1000)), 46, CYN], [String(sa % 1000).padStart(3, '0'), 34, CYN]], x1 - 14, 168, 'r', 'alphabetic');
  rect(g, x0, 1004, x1, 1058, BOX); txt(g, s.baro || (alt > 18000 ? 'STD BARO' : '29.92IN'), (x0 + x1) / 2, 1031, 32, CYN, 'c');
  // VSI
  const vx0 = 1966, vx1 = 2052; poly(g, [[vx0, 300], [vx1 - 30, 300], [vx1, 330], [vx1, 870], [vx1 - 30, 900], [vx0, 900]], TAPE);
  const f = (v) => Math.sign(v) * (150 * Math.min(Math.abs(v), 1000) / 1000 + 100 * Math.max(0, Math.min(Math.abs(v), 2000) - 1000) / 1000 + 50 * Math.max(0, Math.min(Math.abs(v), 4000) - 2000) / 2000);
  for (const v of [-4000, -2000, -1500, -1000, -500, 500, 1000, 1500, 2000, 4000]) {
    const y = cy - f(v), majr = [1000, 2000, 4000].includes(Math.abs(v)); seg(g, vx0, y, vx0 + (majr ? 26 : 14), y, 3, WHT);
    if (majr) txt(g, String(Math.abs(v) / 1000), vx0 + 46, y, 32, WHT, 'c');
  }
  seg(g, vx0, cy, vx0 + 18, cy, 3, WHT);
  const vs = num(s.vs, 0), yv = cy - f(clamp(vs, -4400, 4400));
  poly(g, [[vx0 + 6, yv], [vx0 + 34, yv - 20], [vx1 + 2, yv - 20], [vx1 + 2, yv + 20], [vx0 + 34, yv + 20]], WHT, '#000', 2);
  if (Math.abs(vs) >= 100) txt(g, String(Math.round(vs / 50) * 50), vx1 - 4, yv, 22, '#000', 'r');
}

function drawTopBar(g, s) {
  rect(g, 0, 0, 250, 58, BOX); txts(g, [[String(Math.round(num(s.thrust, 0))), 44, WHT], ['% Thrust', 28, WHT]], 18, 30);
  const x0 = 760, x1 = 1800; rect(g, x0, 0, x1, 116, BOX); line(g, [[x0, 116], [x1, 116]], 2, GRY);
  const ap = s.ap || {}; const cols = [[x0, 960], [960, 1210], [1210, 1560], [1560, x1]];
  for (const [a] of cols.slice(1)) seg(g, a, 6, a, 110, 2, GRY);
  if (ap.at) txt(g, typeof ap.at === 'string' ? ap.at : 'SPD', 860, 36, 46, GRN, 'c'); else txt(g, 'A/T', 860, 86, 30, GRY, 'c');
  txt(g, ap.lat || 'ROL', 1085, 36, 46, GRN, 'c'); if (ap.latArmed) txt(g, ap.latArmed, 1085, 86, 38, WHT, 'c');
  if (ap.ap) txt(g, 'AP', 1330, 36, 46, GRN, 'c'); if (ap.yd !== false) txt(g, 'YD', 1440, 36, 46, GRN, 'c');
  txt(g, ap.vert || 'PIT', 1680, 36, 46, GRN, 'c'); if (ap.armed) txt(g, ap.armed, 1680, 86, 38, WHT, 'c');
  const X = 2150; rect(g, X, 0, 2560, 112, BOX);
  txts(g, [['COM1 ', 28, WHT], [s.com1 || '118.300', 40, GRN]], 2544, 30, 'r'); txt(g, s.com1Name || '', 2544, 66, 26, WHT, 'r');
  txts(g, [['FLT ID ', 24, GRY], [s.callsign || 'N963SF', 26, WHT]], 2544, 96, 'r');
  // crew alerting (top-left under thrust)
  let y = 90; for (const a of (s.alerts || []).slice(0, 4)) { const c = a.level === 'warning' ? RED : a.level === 'caution' ? AMB : WHT; rect(g, 0, y - 24, 250, y + 22, c === RED ? '#5a0000' : BOX); txt(g, a.text, 125, y, 32, c, 'c'); y += 52; }
}

function drawHSI(g, s) {
  const hx = 1280, hy = 1228, R = 252, hdg = num(s.hdg, 0);
  disc(g, hx, hy, R, 'rgba(26,26,31,0.74)');
  for (let d = 0; d < 360; d += 5) {
    const rel = (d - hdg) * D2R, sn = Math.sin(rel), cs = Math.cos(rel), L = d % 10 === 0 ? 24 : 14;
    seg(g, hx + (R - L) * sn, hy - (R - L) * cs, hx + R * sn, hy - R * cs, 3, WHT);
    if (d % 30 === 0) {
      const lab = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[d] || String(d / 10);
      g.save(); g.translate(hx + (R - 52) * sn, hy - (R - 52) * cs); g.rotate(rel); txt(g, lab, 0, 0, d % 90 ? 36 : 44, WHT, 'c'); g.restore();
    }
  }
  for (const sg of [-1, 1]) arc(g, hx, hy, R + 18, Math.min(sg * 3, sg * 18), Math.max(sg * 3, sg * 18), 3, WHT);
  for (const a of [-18, -9, 9, 18]) { const p0 = arcPt(hx, hy, R + 10, a), p1 = arcPt(hx, hy, R + 30, a); seg(g, p0[0], p0[1], p1[0], p1[1], 3, WHT); }
  // turn-rate trend (magenta arc along the top of the rose)
  if (Number.isFinite(s.turnRate)) { const tr = clamp(s.turnRate * 6, -60, 60); if (Math.abs(tr) > 0.5) arc(g, hx, hy, R + 6, Math.min(0, tr), Math.max(0, tr), 6, MAG); }
  // heading bug
  g.save(); g.translate(hx, hy); g.rotate((num(s.selHdg, hdg) - hdg) * D2R);
  poly(g, [[-20, -R], [20, -R], [20, -R + 22], [8, -R + 22], [0, -R + 10], [-8, -R + 22], [-20, -R + 22]], CYN); g.restore();
  // course pointer + CDI
  g.save(); g.translate(hx, hy); g.rotate((num(s.crs, hdg) - hdg) * D2R);
  for (const k of [-2, -1, 1, 2]) { g.beginPath(); g.arc(k * 52, 0, 9, 0, 2 * Math.PI); g.lineWidth = 3; g.strokeStyle = WHT; g.stroke(); }
  const dev = clamp(num(s.xtk, 0), -2.5, 2.5) * 52;
  for (const [w, c] of [[13, '#000'], [8, MAG]]) { line(g, [[0, -70], [0, -158]], w, c); line(g, [[0, 70], [0, 205]], w, c); line(g, [[dev, -60], [dev, 60]], w, c); }
  poly(g, [[0, -205], [-24, -150], [24, -150]], MAG, '#000', 2.5); g.restore();
  txt(g, s.navSource || 'GPS', hx - 118, hy - 74, 32, MAG, 'c'); txt(g, s.navPhase || 'ENR', hx + 118, hy - 74, 32, MAG, 'c');
  poly(g, [[hx, hy - 34], [hx + 5, hy - 10], [hx + 34, hy + 4], [hx + 34, hy + 11], [hx + 5, hy + 6], [hx + 4, hy + 24], [hx + 14, hy + 32], [hx + 14, hy + 36], [hx, hy + 33],
    [hx - 14, hy + 36], [hx - 14, hy + 32], [hx - 4, hy + 24], [hx - 5, hy + 6], [hx - 34, hy + 11], [hx - 34, hy + 4], [hx - 5, hy - 10]], WHT, '#000', 2);
  poly(g, [[hx - 70, 902], [hx + 70, 902], [hx + 70, 956], [hx + 12, 956], [hx, 972], [hx - 12, 956], [hx - 70, 956]], '#000', WHT, 3);
  txt(g, String(Math.round(((hdg % 360) + 360) % 360) || 360).padStart(3, '0') + '°', hx + 4, 929, 46, WHT, 'c');
  txts(g, [['HDG ', 28, WHT], [String(Math.round(num(s.selHdg, hdg)) % 360 || 360).padStart(3, '0') + '°', 36, CYN]], hx - 270, 952);
  txts(g, [['CRS ', 28, WHT], [String(Math.round(num(s.crs, hdg)) % 360 || 360).padStart(3, '0') + '°', 36, MAG]], hx + 270, 952, 'r');
  // wind box
  const wx0 = 838, wy0 = 1010, wx1 = 1000, wy1 = 1112; rect(g, wx0, wy0, wx1, wy1, BOX);
  if (Number.isFinite(s.windKt) && s.windKt >= 1) {
    const wr = ((num(s.windFrom, 0) + 180) - hdg) * D2R, ax = wx0 + 40, ay = (wy0 + wy1) / 2, dx = Math.sin(wr), dy = -Math.cos(wr);
    line(g, [[ax - dx * 30, ay - dy * 30], [ax + dx * 24, ay + dy * 24]], 5, WHT);
    poly(g, [[ax + dx * 34, ay + dy * 34], [ax + dx * 14 - dy * 12, ay + dy * 14 + dx * 12], [ax + dx * 14 + dy * 12, ay + dy * 14 - dx * 12]], WHT);
    txt(g, String(Math.round(s.windFrom) % 360 || 360).padStart(3, '0') + '°', wx1 - 10, wy0 + 32, 32, WHT, 'r'); txt(g, Math.round(s.windKt) + 'KT', wx1 - 10, wy0 + 74, 32, WHT, 'r');
  } else txt(g, 'NO WIND', (wx0 + wx1) / 2, (wy0 + wy1) / 2, 28, WHT, 'c');
  // AOA gauge
  const ox = 722, oy = 1190, r = 64, aoa = clamp(num(s.aoa, 0), 0, 1.05);
  arc(g, ox, oy, r, -90, 18, 6, WHT); arc(g, ox, oy, r, 18, 54, 6, AMB); arc(g, ox, oy, r, 54, 90, 7, RED);
  for (const v of [0.2, 0.4, 0.6, 0.8, 1.0]) { const a = -90 + 180 * v, p0 = arcPt(ox, oy, r - 14, a), p1 = arcPt(ox, oy, r + 6, a); seg(g, p0[0], p0[1], p1[0], p1[1], 3, WHT); }
  for (const [v, lab] of [[0.6, '.6'], [1.0, '1.0']]) { const p = arcPt(ox, oy, r + 30, -90 + 180 * v); txt(g, lab, p[0], p[1], 24, WHT, 'c'); }
  const pa = arcPt(ox, oy, r - 6, -90 + 180 * aoa); seg(g, ox, oy, pa[0], pa[1], 5, aoa > 0.9 ? RED : WHT, '#000'); disc(g, ox, oy, 7, WHT);
  txt(g, 'AOA', ox - 96, oy - 30, 26, WHT, 'c');
  rrect(g, ox - 92, oy + 12, ox - 20, oy + 52, 4, '#000', WHT, 2); txt(g, '.' + String(Math.round(aoa * 100)).padStart(2, '0'), ox - 56, oy + 32, 30, WHT, 'c');
}

function drawInset(g, s, mapCanvas) {
  const x0 = 4, y0 = 1074, x1 = 560, y1 = 1494; rect(g, x0, y0, x1, y1, 'rgba(0,0,5,0.95)'); rrect(g, x0, y0, x1, y1, 4, null, GRY, 2);
  const ox = (x0 + x1) / 2, oy = y1 - 120, R = 230;
  clip(g, x0 + 2, y0 + 2, x1 - 2, y1 - 2);
  if (mapCanvas) { g.save(); g.translate(ox, oy); g.rotate(-num(s.hdg, 0) * D2R); g.globalAlpha = 0.55; g.drawImage(mapCanvas, -mapCanvas.width / 2 + num(s.mapX, 0) * 0.4, -mapCanvas.height / 2 + num(s.mapY, 0) * 0.4); g.globalAlpha = 1; g.restore(); }
  g.setLineDash([16, 14]); for (const rr of [R, R / 2]) { g.beginPath(); g.arc(ox, oy, rr, 0, 2 * Math.PI); g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,255,0.7)'; g.stroke(); } g.setLineDash([]);
  txt(g, '20NM', ox + R * 0.766 + 14, oy - R * 0.643 - 16, 22, WHT, 'c');
  const rel = (num(s.crs, 0) - num(s.hdg, 0)) * D2R, dx = Math.sin(rel), dy = -Math.cos(rel);
  line(g, [[ox - dx * 400, oy - dy * 400], [ox + dx * 420, oy + dy * 420]], 6, MAG);
  for (const t of s.traffic || []) {
    const tx = ox + t.x * R / 20, ty = oy + t.y * R / 20, c = t.alert ? AMB : CYN;
    poly(g, [[tx, ty - 13], [tx + 13, ty], [tx, ty + 13], [tx - 13, ty]], c); txt(g, (t.rel >= 0 ? '+' : '-') + String(Math.abs(t.rel)).padStart(2, '0'), tx + 18, ty - 18, 22, c);
  }
  poly(g, [[ox, oy - 22], [ox + 4, oy - 6], [ox + 22, oy + 4], [ox + 4, oy + 4], [ox + 3, oy + 16], [ox + 10, oy + 22], [ox - 10, oy + 22], [ox - 3, oy + 16], [ox - 4, oy + 4], [ox - 22, oy + 4], [ox - 4, oy - 6]], WHT);
  g.restore();
  rect(g, x0 + 2, y0 + 2, x0 + 120, y0 + 36, '#1a1a1f'); txt(g, 'HDG UP', x0 + 61, y0 + 19, 22, WHT, 'c');
  rect(g, x1 - 150, y0 + 2, x1 - 2, y0 + 36, '#1a1a1f'); txt(g, 'TCAS: TA/RA', x1 - 76, y0 + 19, 20, WHT, 'c'); txt(g, 'ADS-B: ON', x0 + 12, y1 - 18, 20, WHT);
}

function drawBottomBar(g, s) {
  rect(g, 0, 1500, 2560, 1600, '#000'); seg(g, 0, 1500, 2560, 1500, 2, GRY);
  const isa = num(s.isa, 0);
  for (const [lab, val, x, y] of [['OAT', Math.round(num(s.oat, 15)) + '°C', 24, 1530], ['ISA', (isa >= 0 ? '+' : '') + Math.round(isa) + '°C', 24, 1574],
    ['TAS', Math.round(num(s.tas, 0)) + 'KT', 300, 1530], ['GS', Math.round(num(s.gs, 0)) + 'KT', 300, 1574]]) { txt(g, lab, x, y, 24, GRY); txt(g, val, x + 200, y, 32, WHT, 'r'); }
  rrect(g, 980, 1506, 1580, 1594, 4, '#0f0f14', GRY, 2);
  txts(g, [['→ ', 34, MAG], [s.wpt || '----', 38, MAG]], 1280, 1530, 'c');
  txts(g, [['DIS ', 24, GRY], [Number.isFinite(s.dis) ? s.dis.toFixed(1) : '__._', 32, WHT], ['NM', 22, WHT], ['     ETE ', 24, GRY], [s.ete || '__:__', 32, WHT]], 1280, 1574, 'c');
  for (const [lab, val, y] of [['FLT', s.flt || '0:00:00', 1530], ['UTC', s.utc || '00:00:00', 1574]]) { txt(g, lab, 2330, y, 24, GRY, 'r'); txt(g, val, 2540, y, 32, WHT, 'r'); }
}

// ---- MFD: engine indication strip (per Garmin fig. 3-2) + map
const EGRN = '#1acc38', EIS_W = 560;
function vbar(g, x, y0, y1, fg, fa, fv, val, lab, w = 26, red = 0.07) {
  const H = y1 - y0; rect(g, x - w / 2, y0, x + w / 2, y1, '#121214');
  rect(g, x - w / 2 + 4, y1 - fg * H, x + w / 2 - 4, y1, EGRN);
  if (fa > fg) rect(g, x - w / 2 + 4, y1 - fa * H, x + w / 2 - 4, y1 - fg * H, AMB);
  if (red > 0) rect(g, x - w / 2 + 4, y0, x + w / 2 - 4, y0 + red * H, RED);
  rrect(g, x - w / 2, y0, x + w / 2, y1, 3, null, GRY, 2);
  const yv = y1 - clamp(fv, 0, 1.02) * H; poly(g, [[x - w / 2 + 2, yv], [x - w / 2 - 24, yv - 15], [x - w / 2 - 24, yv + 15]], WHT, '#000', 2); seg(g, x - w / 2, yv, x + w / 2 + 6, yv, 3, WHT);
  if (val) txt(g, val, x, y1 + 30, 34, fv > 1 ? RED : fv > fa ? AMB : WHT, 'c'); if (lab) txt(g, lab, x, y1 + 64, 24, GRY, 'c');
}
function section(g, y, title, x0 = 8, x1 = 552) { seg(g, x0, y, x1, y, 2, '#5a5c66'); if (title) txt(g, title, (x0 + x1) / 2, y + 24, 26, GRY, 'c'); }

function drawEIS(g, s) {
  rect(g, 0, 0, EIS_W, 1600, '#000');
  const cx = 290, cy = 236, R = 150, a0 = -125, a1 = 85, th = clamp(num(s.thrust, 0), 0, 105);
  ring(g, cx, cy, R - 14, R, a0, a1, EGRN); ring(g, cx, cy, R - 20, R + 6, a1, a1 + 5, RED);
  for (let v = 0; v <= 100; v += 10) { const a = a0 + (a1 - a0) * v / 100, L = v % 50 ? 12 : 22, p0 = arcPt(cx, cy, R + 2, a), p1 = arcPt(cx, cy, R + 2 + L, a); seg(g, p0[0], p0[1], p1[0], p1[1], 3, WHT); }
  const a = a0 + (a1 - a0) * th / 100; g.save(); g.translate(cx, cy); g.rotate(a * D2R); poly(g, [[0, -R - 10], [14, -R + 40], [-14, -R + 40]], WHT, '#000', 2); g.restore();
  if (Number.isFinite(s.thrustCmd)) { const ac = a0 + (a1 - a0) * clamp(s.thrustCmd, 0, 100) / 100, p = arcPt(cx, cy, R + 14, ac); disc(g, p[0], p[1], 9, CYN); }
  txt(g, String(Math.round(th)), cx, cy - 40, 84, WHT, 'c'); txt(g, '% Thrust', cx, cy + 22, 30, WHT, 'c'); txt(g, s.fadec || 'FADEC CH A', cx, cy + 62, 30, WHT, 'c');
  section(g, 330, '');
  for (const [x, fg, fa, fv, val, lab] of [[60, 0.92, 0.92, num(s.n1, 0) / 104, num(s.n1, 0).toFixed(1), 'N1%'], [165, 0.92, 0.92, num(s.n2, 0) / 104, String(Math.round(num(s.n2, 0))), 'N2%'],
    [275, 0.80, 0.90, num(s.itt, 0) / 900, String(Math.round(num(s.itt, 0))), 'ITT°C'], [385, 0.75, 0.88, num(s.oilT, 0) / 150, String(Math.round(num(s.oilT, 0))), 'Oil°C'],
    [495, 0.80, 0.86, num(s.oilP, 0) / 100, String(Math.round(num(s.oilP, 0))), 'Oil PSI']]) vbar(g, x, 360, 520, fg, fa, fv, val, lab);
  section(g, 612, '');
  txt(g, 'L', 140, 640, 26, WHT, 'c'); txt(g, 'R', 190, 640, 26, WHT, 'c');
  vbar(g, 60, 660, 800, 0.85, 0.85, num(s.ff, 0) / 120, String(Math.round(num(s.ff, 0))), '', 26, 0);
  vbar(g, 140, 660, 800, 0.9, 0.9, num(s.fuelL, 0) / 150, '', '', 22, 0);
  vbar(g, 190, 660, 800, 0.9, 0.9, num(s.fuelR, 0) / 150, '', '', 22, 0);
  txt(g, String(Math.round(num(s.fuelL, 0))), 132, 830, 28, WHT, 'c'); txt(g, String(Math.round(num(s.fuelR, 0))), 198, 830, 28, WHT, 'c');
  txt(g, 'GPH', 60, 864, 24, GRY, 'c'); txt(g, String(Math.round(num(s.fuelL, 0) + num(s.fuelR, 0))), 165, 866, 32, WHT, 'c'); txt(g, 'Fuel GAL', 165, 898, 24, GRY, 'c');
  seg(g, 250, 625, 250, 915, 2, '#5a5c66');
  txts(g, [['Emr Bus V  ', 26, GRY], [num(s.emrV, 28.1).toFixed(1), 32, WHT]], 405, 642, 'c');
  for (const [x, fv] of [[315, 0.54], [360, 0.52], [455, 0.62], [500, 0.58]]) vbar(g, x, 680, 800, 0.85, 0.85, fv, '', '', 20, 0);
  txt(g, '3   2', 338, 830, 30, WHT, 'c'); txt(g, '61   57', 478, 830, 30, WHT, 'c'); txt(g, '1 Bat 2', 338, 866, 24, GRY, 'c'); txt(g, '1 Gen 2', 478, 866, 24, GRY, 'c');
  section(g, 925, ''); seg(g, 300, 925, 300, 1385, 2, '#5a5c66');
  txt(g, 'Landing Gear', 150, 952, 28, GRY, 'c');
  const gear = num(s.gear, 1), gs = s.gearTransit ? 'TRNS' : gear > 0.99 ? 'DN' : gear < 0.01 ? 'UP' : 'TRNS', gc = gs === 'DN' ? GRN : gs === 'UP' ? WHT : AMB;
  for (const [x, y] of [[150, 1000], [80, 1068], [220, 1068]]) { if (gs !== 'UP') rrect(g, x - 40, y - 24, x + 40, y + 24, 6, gs === 'DN' ? '#0c4a18' : '#4a3600'); txt(g, gs, x, y, 32, gc, 'c'); }
  txt(g, 'Vlo extend: 210', 150, 1128, 26, GRY, 'c');
  txt(g, 'Pitch Trim', 430, 952, 28, GRY, 'c'); txt(g, 'UP', 470, 990, 24, GRY, 'c'); txt(g, 'DN', 470, 1150, 24, GRY, 'c');
  seg(g, 430, 980, 430, 1160, 3, WHT); seg(g, 418, 980, 442, 980, 3, WHT); seg(g, 418, 1160, 442, 1160, 3, WHT); rect(g, 424, 1040, 436, 1090, EGRN);
  const yt = 1070 - clamp(num(s.trim, 0), -8, 8) * 10; poly(g, [[424, yt], [400, yt - 14], [400, yt + 14]], CYN); txt(g, Math.round(num(s.trim, 0)) + '°', 375, yt, 30, CYN, 'r');
  section(g, 1170, '', 8, 296); seg(g, 304, 1170, 552, 1170, 2, '#5a5c66');
  txt(g, 'Flaps', 150, 1196, 28, GRY, 'c');
  poly(g, [[40, 1250], [120, 1236], [175, 1240], [185, 1250], [120, 1260]], GRY);
  const fl = clamp(num(s.flaps, 0), 0, 1); line(g, [[185, 1250], [185 + 65 * Math.cos(fl * 35 * D2R), 1250 + 65 * Math.sin(fl * 35 * D2R)]], 6, CYN);
  const fsel = fl < 0.25 ? 0 : fl < 0.75 ? 1 : 2;
  [['Up', 1240], ['50%', 1282], ['100%', 1322]].forEach(([lab, y], i) => { if (i === fsel) { rect(g, 222, y - 18, 290, y + 18, EGRN); txt(g, lab, 256, y, 26, '#000', 'c'); } else txt(g, lab, 256, y, 26, WHT, 'c'); });
  txt(g, 'Roll Trim', 430, 1196, 28, GRY, 'c'); arc(g, 430, 1420, 150, -40, 40, 3, WHT); txt(g, 'L', 345, 1300, 24, GRY, 'c'); txt(g, 'R', 515, 1300, 24, GRY, 'c');
  poly(g, [[430, 1272], [418, 1250], [442, 1250]], CYN);
  section(g, 1385, 'Cabin Press');
  vbar(g, 60, 1420, 1500, 0.8, 0.86, num(s.cabDiff, 0) / 7.5, num(s.cabDiff, 0).toFixed(1), 'Diff PSI', 22, 0.1);
  vbar(g, 500, 1420, 1500, 0.7, 0.8, num(s.cabAlt, 0) / 12000, String(Math.round(num(s.cabAlt, 0) / 10) * 10), 'Alt Ft', 22, 0.12);
  txts(g, [['Rate FPM  ', 26, GRY], [String(Math.round(num(s.cabRate, 0) / 10) * 10), 32, WHT]], 280, 1446, 'c');
  txts(g, [['Dest Elev  ', 26, GRY], [String(Math.round(num(s.destElev, 0))), 32, MAG]], 280, 1500, 'c');
}

function makeMapCanvas(size = 1400) { // fictional shaded relief used under the MFD map and the PFD inset
  const c = makeCanvas(size, size), g = c.getContext('2d'), img = g.createImageData(size, size), d = img.data;
  const h = (x, y) => 330 + 140 * Math.sin(x / 520 + 0.3) * Math.cos(y / 410) + 120 * Math.sin(x / 91 + 1.3) * Math.sin(y / 127 + 0.4) + 60 * Math.sin(x / 43 - y / 61)
    + 260 * Math.pow(1 - Math.abs(Math.sin((x * 0.82 + y * 0.57) / 42 + 0.8 * Math.sin((-x * 0.57 + y * 0.82) / 230))), 3);
  const stops = [180, 320, 460, 640, 900], cols = [[51, 107, 38], [82, 125, 46], [120, 130, 64], [143, 120, 79], [163, 143, 110]];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const z = h(x, y), hx = h(x + 1, y) - z, hy = h(x, y + 1) - z, sh = 0.55 + 0.6 * clamp((-hx * -0.55 - hy * 0.45 + 0.7) / Math.sqrt(hx * hx + hy * hy + 1), 0, 1);
    let i = 0; while (i < stops.length - 2 && z > stops[i + 1]) i++;
    const t = clamp((z - stops[i]) / (stops[i + 1] - stops[i]), 0, 1), o = (y * size + x) * 4;
    const lake = Math.sin((x + 52 * Math.sin(y / 83)) / 61 + 2) * Math.sin((y + 47 * Math.sin(x / 77)) / 73 - 1) + 0.6 * Math.sin((x + y) / 39) > 1.22 && Math.sin(x / 310) * Math.cos(y / 270) > 0.3;
    if (lake) { d[o] = 31; d[o + 1] = 77; d[o + 2] = 140; } else for (let k = 0; k < 3; k++) d[o + k] = clamp((cols[i][k] + (cols[i + 1][k] - cols[i][k]) * t) * sh * 0.82, 0, 255);
    d[o + 3] = 255;
  }
  g.putImageData(img, 0, 0); return c;
}

function drawMap(g, s, mapCanvas) {
  const x0 = EIS_W + 12, W = 2560, H = 1600, ox = x0 + (W - x0) / 2, oy = 1310, pxPerNm = 640 / 50;
  rect(g, x0, 0, W, H, '#0a1208'); clip(g, x0, 0, W, H);
  if (mapCanvas) { g.save(); g.translate(ox, oy); g.rotate(-num(s.hdg, 0) * D2R); const sc = 5.0; g.drawImage(mapCanvas, -mapCanvas.width * sc / 2 + num(s.mapX, 0), -mapCanvas.height * sc / 2 + num(s.mapY, 0), mapCanvas.width * sc, mapCanvas.height * sc); g.restore(); }
  g.setLineDash([22, 18]); g.beginPath(); g.arc(ox, oy, 640, 0, 2 * Math.PI); g.lineWidth = 2.5; g.strokeStyle = 'rgba(255,255,255,0.75)'; g.stroke(); g.setLineDash([]);
  txt(g, '50NM', ox + 640 * 0.70 + 30, oy - 640 * 0.71, 30, WHT);
  const rel = (num(s.crs, 0) - num(s.hdg, 0)) * D2R, dx = Math.sin(rel), dy = -Math.cos(rel), dis = num(s.dis, 40);
  const wp = [ox + dx * dis * pxPerNm, oy + dy * dis * pxPerNm];
  line(g, [[ox - dx * 900, oy - dy * 900], [ox, oy]], 6, MAG); line(g, [[ox, oy], wp], 6, MAG);
  const r2 = rel + 18 * D2R; line(g, [wp, [wp[0] + Math.sin(r2) * 900, wp[1] - Math.cos(r2) * 900]], 5, WHT);
  const hex = []; for (let k = 0; k < 6; k++) hex.push([wp[0] + 20 * Math.cos(k * Math.PI / 3), wp[1] + 20 * Math.sin(k * Math.PI / 3)]); line(g, hex, 4, CYN, true);
  rect(g, wp[0] + 30, wp[1] - 52, wp[0] + 104 + 20, wp[1] - 14, 'rgba(0,0,0,0.75)'); txt(g, s.wpt || 'WPT', wp[0] + 77, wp[1] - 33, 30, MAG, 'c');
  for (const a of s.airports || []) { const p = [ox + a.x * pxPerNm, oy + a.y * pxPerNm]; g.beginPath(); g.arc(p[0], p[1], 16, 0, 2 * Math.PI); g.lineWidth = 4; g.strokeStyle = CYN; g.stroke(); seg(g, p[0] - 10, p[1] + 9, p[0] + 10, p[1] - 9, 4, CYN); txt(g, a.id, p[0] + 24, p[1], 28, WHT); }
  for (const t of s.traffic || []) { const p = [ox + t.x * pxPerNm / 2.5, oy + t.y * pxPerNm / 2.5]; poly(g, [[p[0], p[1] - 16], [p[0] + 16, p[1]], [p[0], p[1] + 16], [p[0] - 16, p[1]]], t.alert ? AMB : CYN); }
  poly(g, [[ox, oy - 34], [ox + 6, oy - 8], [ox + 34, oy + 6], [ox + 6, oy + 6], [ox + 4, oy + 24], [ox + 14, oy + 32], [ox - 14, oy + 32], [ox - 4, oy + 24], [ox - 6, oy + 6], [ox - 34, oy + 6], [ox - 6, oy - 8]], WHT, '#000', 2);
  g.restore();
  rect(g, x0, 0, W, 64, 'rgba(15,15,20,0.92)'); seg(g, x0, 64, W, 64, 2, GRY); txt(g, 'Navigation Map', (x0 + W) / 2, 32, 32, WHT, 'c');
  txts(g, [['GS ', 24, GRY], [Math.round(num(s.gs, 0)) + 'KT', 30, WHT], ['   DTK ', 24, GRY], [String(Math.round(num(s.crs, 0)) % 360 || 360).padStart(3, '0') + '°', 30, MAG], ['   TRK ', 24, GRY], [String(Math.round(num(s.trk, 0)) % 360 || 360).padStart(3, '0') + '°', 30, WHT]], x0 + 20, 32);
  txts(g, [['FOB ', 24, GRY], [Math.round(num(s.fobLb, 0)) + 'LB', 30, WHT], ['   ESA ', 24, GRY], [(s.esa || 4300) + 'FT', 30, WHT], ['   END ', 24, GRY], [s.endurance || '-:--', 30, WHT]], W - 20, 32, 'r');
  for (const [k, lab] of ['HDG UP', 'NEXRAD', 'TFC'].entries()) { const bx = x0 + 16 + k * 160; rrect(g, bx, H - 64, bx + 148, H - 16, 4, 'rgba(13,13,18,0.9)', GRY, 2); txt(g, lab, bx + 74, H - 40, 26, k ? GRN : WHT, 'c'); }
}

export class SF50Displays {
  // scale: canvas pixels per design pixel (0.5 -> 1280 x 800 canvases)
  constructor({ scale = 0.5 } = {}) {
    this.scale = scale; this.w = Math.round(2560 * scale); this.h = Math.round(1600 * scale);
    this.pfd = makeCanvas(this.w, this.h); this.mfd = makeCanvas(this.w, this.h); this.map = null; this.frames = 0;
  }
  ensureMap() { if (!this.map) this.map = makeMapCanvas(700); return this.map; }
  drawPFD(s = {}) {
    const g = this.pfd.getContext('2d'); g.setTransform(this.scale, 0, 0, this.scale, 0, 0); g.clearRect(0, 0, 2560, 1600);
    const cx = 1280, cy = 600, k = 20; drawAttitude(g, s, cx, cy, k); drawSpeedTape(g, s, cy); drawAltTape(g, s, cy); drawTopBar(g, s); drawHSI(g, s);
    drawInset(g, s, this.ensureMap()); drawBottomBar(g, s); this.frames++; return this.pfd;
  }
  drawMFD(s = {}) {
    const g = this.mfd.getContext('2d'); g.setTransform(this.scale, 0, 0, this.scale, 0, 0); g.clearRect(0, 0, 2560, 1600);
    drawMap(g, s, this.ensureMap()); drawEIS(g, s); seg(g, EIS_W + 6, 0, EIS_W + 6, 1600, 4, '#5a5c66'); return this.mfd;
  }
}
