// Live flight-deck screens for the Il-76: a primary flight display, a navigation display and an engine/status display, drawn on small 2D canvases
// from the flight state and used as the emissive maps of the model's Display_* quads. Original generic symbology (no manufacturer artwork).
// state (all optional): pitch bank hdg (deg), ias (kt), mach, altFt, vsFpm, gs (kt), selHdg (deg), n1[4] n2[4] egt[4] (%, %, deg C), flaps slats (deg),
//   gear (0 up..1 down), spoilers (0..1), rev[4] (0..1), fuel (kg), ff (kg/h), enginesOut, alerts [{text, level}]
export const IL76_DISPLAY = { w: 384, h: 512 };
const GRN = '#33fa55', CYN = '#29dcff', MAG = '#ff47fa', WHT = '#ffffff', YEL = '#ffdb14', AMB = '#ffb300', RED = '#ff2a20', GRY = '#8b93a0';
const FONT = "'Arial Narrow', 'Roboto Condensed', 'Helvetica Neue', Arial, sans-serif";
const D2R = Math.PI / 180, clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined' && typeof document === 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}
function txt(g, s, x, y, size, col, anchor = 'l') {
  g.font = `bold ${size}px ${FONT}`; g.fillStyle = col; g.textAlign = anchor === 'c' ? 'center' : anchor === 'r' ? 'right' : 'left'; g.textBaseline = 'middle'; g.fillText(s, x, y);
}
function line(g, pts, w, col) {
  g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.lineWidth = w; g.strokeStyle = col; g.lineJoin = 'round'; g.lineCap = 'round'; g.stroke();
}
const rect = (g, x0, y0, x1, y1, col) => { g.fillStyle = col; g.fillRect(x0, y0, x1 - x0, y1 - y0); };
const arr = (v, n = 4) => (Array.isArray(v) ? v : new Array(n).fill(num(v)));

export class IL76Displays {
  constructor({ scale = 1 } = {}) {
    const w = Math.round(IL76_DISPLAY.w * scale), h = Math.round(IL76_DISPLAY.h * scale);
    this.k = scale; this.pfd = makeCanvas(w, h); this.nd = makeCanvas(w, h); this.eicas = makeCanvas(w, h);
  }

  drawPFD(s = {}) {
    const g = this.pfd.getContext('2d'), { w, h } = IL76_DISPLAY; g.setTransform(this.k, 0, 0, this.k, 0, 0);
    const pitch = num(s.pitch), bank = num(s.bank), cx = w / 2, cy = h * 0.44, ppd = 5.2; // pixels per degree of pitch
    g.save(); g.beginPath(); g.rect(0, 40, w, h * 0.78); g.clip();
    g.translate(cx, cy); g.rotate(bank * D2R); g.translate(0, pitch * ppd);
    rect(g, -400, -600, 400, 0, '#2a74d8'); rect(g, -400, 0, 400, 600, '#7a4a22'); line(g, [[-400, 0], [400, 0]], 2, WHT);
    for (let p = -30; p <= 30; p += 2.5) {
      if (!p) continue; const big = p % 10 === 0, half = p % 5 === 0, hw = big ? 56 : half ? 34 : 18;
      line(g, [[-hw, -p * ppd], [hw, -p * ppd]], 2, WHT); if (big) { txt(g, String(Math.abs(p)), -hw - 14, -p * ppd, 16, WHT, 'r'); txt(g, String(Math.abs(p)), hw + 14, -p * ppd, 16, WHT, 'l'); }
    }
    g.restore();
    rect(g, 0, 0, w, 40, '#101014'); rect(g, 0, h * 0.78 + 40 > h ? h : h * 0.78 + 40, w, h, '#101014');
    line(g, [[cx - 70, cy], [cx - 24, cy], [cx - 24, cy + 10]], 4, YEL); line(g, [[cx + 70, cy], [cx + 24, cy], [cx + 24, cy + 10]], 4, YEL); rect(g, cx - 3, cy - 3, cx + 3, cy + 3, YEL);
    // speed tape (left) and altitude (right)
    const ias = num(s.ias), alt = num(s.altFt);
    rect(g, 4, 60, 78, h * 0.78 - 20, 'rgba(18,18,23,0.78)'); rect(g, 306, 60, 380, h * 0.78 - 20, 'rgba(18,18,23,0.78)');
    for (let v = Math.floor(ias / 10) * 10 - 60; v <= ias + 60; v += 10) { if (v < 0) continue; const y = cy - (v - ias) * 2.6; if (y < 70 || y > h * 0.78 - 30) continue; line(g, [[66, y], [78, y]], 2, WHT); if (v % 20 === 0) txt(g, String(v), 60, y, 15, WHT, 'r'); }
    for (let a = Math.floor(alt / 100) * 100 - 400; a <= alt + 400; a += 100) { const y = cy - (a - alt) * 0.26; if (y < 70 || y > h * 0.78 - 30) continue; line(g, [[306, y], [318, y]], 2, WHT); if (a % 200 === 0) txt(g, String(Math.round(a / 100) * 100), 372, y, 14, WHT, 'r'); }
    rect(g, 4, cy - 15, 78, cy + 15, '#000'); txt(g, String(Math.round(ias)), 70, cy, 24, GRN, 'r');
    rect(g, 296, cy - 15, 380, cy + 15, '#000'); txt(g, String(Math.round(alt)), 376, cy, 22, GRN, 'r');
    txt(g, `M ${num(s.mach).toFixed(2)}`, 6, 22, 18, WHT); txt(g, `V/S ${Math.round(num(s.vsFpm) / 50) * 50}`, w - 6, 22, 16, num(s.vsFpm) < -1500 ? AMB : WHT, 'r');
    // heading strip
    const hdg = ((num(s.hdg) % 360) + 360) % 360, hy = h * 0.78 + 36;
    rect(g, 0, hy - 14, w, h, 'rgba(18,18,23,0.9)');
    const base = Math.round(hdg / 5) * 5;
    for (let d = -40; d <= 40; d += 5) {
      const hh = (base + d + 360) % 360, x = cx + (base + d - hdg) * 4.2;
      line(g, [[x, hy - 10], [x, hy - (hh % 10 === 0 ? 0 : 5)]], 2, WHT);
      if (hh % 10 === 0) txt(g, String(hh === 0 ? 36 : hh / 10).padStart(2, '0'), x, hy + 12, 14, WHT, 'c');
    }
    line(g, [[cx, hy - 14], [cx - 6, hy - 22], [cx + 6, hy - 22], [cx, hy - 14]], 2, YEL);
    txt(g, `HDG ${String(Math.round(hdg)).padStart(3, '0')}`, cx, h - 14, 20, GRN, 'c');
    this.alerts(g, s, 44);
  }

  drawND(s = {}) {
    const g = this.nd.getContext('2d'), { w, h } = IL76_DISPLAY; g.setTransform(this.k, 0, 0, this.k, 0, 0);
    rect(g, 0, 0, w, h, '#05070b');
    const hdg = ((num(s.hdg) % 360) + 360) % 360, cx = w / 2, cy = h * 0.66, R = 190;
    g.save(); g.translate(cx, cy); g.rotate(-hdg * D2R);
    g.beginPath(); g.arc(0, 0, R, 0, 2 * Math.PI); g.lineWidth = 2; g.strokeStyle = GRY; g.stroke();
    for (let a = 0; a < 360; a += 10) {
      const r0 = a % 30 === 0 ? R - 16 : R - 8; line(g, [[Math.sin(a * D2R) * r0, -Math.cos(a * D2R) * r0], [Math.sin(a * D2R) * R, -Math.cos(a * D2R) * R]], 2, WHT);
      if (a % 30 === 0) { g.save(); g.translate(Math.sin(a * D2R) * (R - 30), -Math.cos(a * D2R) * (R - 30)); g.rotate(a * D2R + hdg * D2R - hdg * D2R); txt(g, a % 90 === 0 ? 'NESW'[a / 90] : String(a / 10), 0, 0, 17, a % 90 === 0 ? CYN : WHT, 'c'); g.restore(); }
    }
    if (Number.isFinite(s.selHdg)) { const a = s.selHdg * D2R; line(g, [[Math.sin(a) * (R - 40), -Math.cos(a) * (R - 40)], [Math.sin(a) * R, -Math.cos(a) * R]], 4, MAG); }
    g.restore();
    line(g, [[cx, cy - 16], [cx - 12, cy + 12], [cx, cy + 6], [cx + 12, cy + 12], [cx, cy - 16]], 2, YEL);
    line(g, [[cx, cy - R - 6], [cx, cy - R + 8]], 3, YEL);
    txt(g, `HDG ${String(Math.round(hdg)).padStart(3, '0')}`, 12, 22, 20, GRN); txt(g, `GS ${Math.round(num(s.gs))}`, 12, 50, 20, WHT); txt(g, `TAS ${Math.round(num(s.tas, num(s.ias)))}`, 12, 76, 16, GRY);
    txt(g, `M ${num(s.mach).toFixed(2)}`, w - 12, 22, 20, WHT, 'r');
    this.alerts(g, s, h - 24);
  }

  drawEICAS(s = {}) {
    const g = this.eicas.getContext('2d'), { w, h } = IL76_DISPLAY; g.setTransform(this.k, 0, 0, this.k, 0, 0);
    rect(g, 0, 0, w, h, '#05070b');
    const n1 = arr(s.n1), egt = arr(s.egt), rev = arr(s.rev), colW = w / 4;
    txt(g, 'N1 %', 8, 16, 14, GRY);
    for (let i = 0; i < 4; i++) {
      const x = colW * i + colW / 2, top = 40, hgt = 150, v = clamp(num(n1[i]) / 110, 0, 1), red = n1[i] > 100.5, off = !(n1[i] > 5);
      rect(g, x - 14, top, x + 14, top + hgt, '#1a1d24'); rect(g, x - 14, top + hgt * (1 - v), x + 14, top + hgt, off ? '#333' : red ? RED : rev[i] > 0.5 ? AMB : GRN);
      line(g, [[x - 18, top + hgt * (1 - 100 / 110)], [x + 18, top + hgt * (1 - 100 / 110)]], 2, WHT);
      txt(g, n1[i].toFixed(1), x, top + hgt + 16, 18, off ? GRY : GRN, 'c'); txt(g, String(i + 1), x, top - 12, 14, WHT, 'c');
      txt(g, `${Math.round(num(egt[i]))}`, x, top + hgt + 42, 16, num(egt[i]) > 640 ? AMB : CYN, 'c');
      if (rev[i] > 0.02) txt(g, rev[i] > 0.9 ? 'REV' : 'REV', x, top + hgt + 64, 14, rev[i] > 0.9 ? GRN : AMB, 'c');
    }
    txt(g, 'EGT °C', 8, 232, 14, GRY);
    const row = (y, label, value, col) => { txt(g, label, 14, y, 16, GRY); txt(g, value, w - 14, y, 20, col, 'r'); };
    row(282, 'SLATS', `${Math.round(num(s.slats))}°`, num(s.slats) > 1 ? GRN : WHT); row(310, 'FLAPS', `${Math.round(num(s.flaps))}°`, num(s.flaps) > 1 ? GRN : WHT);
    const gear = num(s.gear, 1); row(338, 'GEAR', gear > 0.98 ? 'DOWN' : gear < 0.02 ? 'UP' : 'TRANSIT', gear > 0.98 ? GRN : gear < 0.02 ? WHT : AMB);
    const sp = num(s.spoilers); row(366, 'SPOILERS', sp > 0.05 ? `${Math.round(sp * 100)}%` : 'RET', sp > 0.05 ? AMB : WHT);
    row(394, 'FUEL kg', String(Math.round(num(s.fuel) / 10) * 10), num(s.fuel) < 8000 ? AMB : GRN); row(422, 'FF kg/h', String(Math.round(num(s.ff) / 10) * 10), WHT);
    this.alerts(g, s, h - 24);
  }

  alerts(g, s, y) {
    const list = (s.alerts || []).slice(0, 2); list.forEach((a, i) => txt(g, a.text, IL76_DISPLAY.w / 2, y + i * 22, 18, a.level === 'warning' ? RED : AMB, 'c'));
  }
}
