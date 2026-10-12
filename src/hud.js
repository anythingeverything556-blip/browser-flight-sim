import { Redraw } from './workstats.js';

const DEG = Math.PI / 180;
const DASH = [4, 4];
const SOLID = [];

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
function wrap360(v) {
  return ((v % 360) + 360) % 360;
}
function angleDiff(a, b) {
  return ((a - b + 540) % 360) - 180;
}
function format(v, digits) {
  if (!Number.isFinite(v)) return "0";
  return String(Math.round(v)).padStart(digits || 1, "0");
}

class HUD {
  constructor(canvas) {
    this.c = canvas;
    this.x = canvas.getContext("2d", { alpha: true });
    this.sched = new Redraw('hud', 30); // dynamic layer at 30 Hz; nothing at all while hidden or outside the cockpit
    this.staticCanvas = document.createElement("canvas");
    this.static = this.staticCanvas.getContext("2d", { alpha: true });
    this.visible = true;
    this.w = 0;
    this.h = 0;
    this.dpr = 1;
    this.scale = 1;
    this.lastTime = 0;
    this.lastIas = null;
    this.iasTrend = 0;
    this.onResize = this.resize.bind(this);
    addEventListener("resize", this.onResize, { passive: true });
    this.resize();
  }

  resize() {
    const w = Math.max(1, innerWidth || this.c.clientWidth || 1);
    const h = Math.max(1, innerHeight || this.c.clientHeight || 1);
    const dpr = Math.max(1, Math.min(3, devicePixelRatio || 1));
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.scale = clamp(h / 720, 0.72, 1.5);
    this.c.width = Math.round(w * dpr);
    this.c.height = Math.round(h * dpr);
    this.staticCanvas.width = this.c.width;
    this.staticCanvas.height = this.c.height;
    this.x.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.static.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawStatic();
  }

  drawStatic() {
    const x = this.static;
    const w = this.w;
    const h = this.h;
    const k = this.scale;
    const cx = w * 0.5;
    const cy = h * 0.47;
    const halfW = 198 * k;
    const halfH = 164 * k;
    x.clearRect(0, 0, w, h);
    x.save();
    x.strokeStyle = "rgba(158, 226, 190, 0.34)";
    x.lineWidth = 1 * k;
    x.lineCap = "square";
    x.beginPath();
    x.moveTo(cx - halfW, cy - halfH + 13 * k);
    x.lineTo(cx - halfW, cy - halfH);
    x.lineTo(cx - halfW + 18 * k, cy - halfH);
    x.moveTo(cx + halfW - 18 * k, cy - halfH);
    x.lineTo(cx + halfW, cy - halfH);
    x.lineTo(cx + halfW, cy - halfH + 13 * k);
    x.moveTo(cx - halfW, cy + halfH - 13 * k);
    x.lineTo(cx - halfW, cy + halfH);
    x.lineTo(cx - halfW + 18 * k, cy + halfH);
    x.moveTo(cx + halfW - 18 * k, cy + halfH);
    x.lineTo(cx + halfW, cy + halfH);
    x.lineTo(cx + halfW, cy + halfH - 13 * k);
    x.stroke();
    x.strokeStyle = "rgba(174, 239, 197, 0.7)";
    x.lineWidth = 1.3 * k;
    x.beginPath();
    x.moveTo(cx - 32 * k, cy);
    x.lineTo(cx - 10 * k, cy);
    x.moveTo(cx + 10 * k, cy);
    x.lineTo(cx + 32 * k, cy);
    x.moveTo(cx, cy - 3 * k);
    x.lineTo(cx, cy + 7 * k);
    x.stroke();
    x.strokeStyle = "rgba(158, 226, 190, 0.34)";
    x.lineWidth = 1 * k;
    x.strokeRect(cx - 178 * k, 32 * k, 356 * k, 36 * k);
    x.restore();
  }

  draw(state) {
    if (!this.x || !this.static) return;
    const x = this.x;
    const w = this.w;
    const h = this.h;
    const k = this.scale;
    const cx = w * 0.5;
    const cy = h * 0.47;
    const act = this.sched.next(performance.now(), this.visible && state.cockpit);
    if (act === 'skip') return;
    x.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    x.clearRect(0, 0, w, h);
    if (act === 'clear') return;

    const tone = state.night > 0.5 ? "rgba(190, 255, 205, 0.97)" : "rgba(165, 239, 192, 0.95)";
    const soft = state.night > 0.5 ? "rgba(190, 255, 205, 0.65)" : "rgba(165, 239, 192, 0.6)";
    x.drawImage(this.staticCanvas, 0, 0, w, h);
    x.save();
    x.lineCap = "round";
    x.lineJoin = "round";
    x.strokeStyle = tone;
    x.fillStyle = tone;
    x.lineWidth = 1.15 * k;
    x.font = (11 * k) + "px " + '"SFMono-Regular", Consolas, monospace';
    x.textBaseline = "middle";
    x.shadowColor = "rgba(0, 0, 0, 0.7)";
    // a blurred canvas shadow re-rasterises a blur for every stroke and glyph each frame; a hard offset shadow reads the same and is ~500x cheaper
    x.shadowBlur = 0;
    x.shadowOffsetX = x.shadowOffsetY = Math.max(1, k);

    this.updateTrend(state.ias);
    this.drawHeading(x, state, cx, k, tone, soft);
    this.drawBank(x, state.bank || 0, cx, cy, k, soft);
    const ppd = clamp((h * 0.5 / Math.tan(clamp(state.fov || 65, 30, 100) * DEG * 0.5)) * DEG, 5, 22);
    this.drawPitch(x, state, cx, cy, ppd, k, tone, soft);
    this.drawTape(x, "left", state.ias, state.metric ? 20 : 10, state.metric ? "KM/H" : "IAS · KT", this.iasTrend, cx, cy, k, tone, soft);
    this.drawTape(x, "right", state.alt, state.metric ? 100 : state.alt > 20000 ? 500 : 100, state.metric ? "ALT · M" : "ALT · FT", state.vs, cx, cy, k, tone, soft);
    this.drawFlightPath(x, state, cx, cy, ppd, k, tone);
    this.drawAp(x, state.ap, state.apHdg, cx, k, tone, soft);
    this.drawNavCue(x, state.navCue || state.nav, cx, cy, k, tone, soft);
    this.drawReadouts(x, state, cx, cy, k, tone, soft);
    this.drawWarning(x, state, cx, cy, k);
    x.restore();
  }

  updateTrend(ias) {
    const now = performance.now();
    if (this.lastIas !== null && this.lastTime > 0) {
      const dt = Math.max(0.001, (now - this.lastTime) / 1000);
      const rate = clamp((ias - this.lastIas) / dt, -90, 90);
      this.iasTrend += (rate - this.iasTrend) * Math.min(1, dt * 2.5);
    } else this.iasTrend = 0;
    this.lastIas = ias;
    this.lastTime = now;
  }

  drawHeading(x, state, cx, k, tone, soft) {
    const y = 50 * k;
    const heading = wrap360(state.heading || 0);
    const base = Math.round(heading / 5) * 5;
    x.save();
    x.textAlign = "center";
    x.font = (9 * k) + "px " + '"SFMono-Regular", Consolas, monospace';
    for (let i = -6; i <= 6; i++) {
      const value = wrap360(base + i * 5);
      const px = cx + angleDiff(value, heading) * 4.7 * k;
      if (Math.abs(px - cx) > 168 * k) continue;
      const major = Math.round(value) % 10 === 0;
      x.strokeStyle = major ? tone : soft;
      x.beginPath();
      x.moveTo(px, y - 10 * k);
      x.lineTo(px, y - (major ? 1 : 4) * k);
      x.stroke();
      if (major) {
        x.fillStyle = soft;
        x.fillText(String(Math.round(value / 10) % 36).padStart(2, "0"), px, y - 17 * k);
      }
    }
    x.fillStyle = "rgba(5, 13, 17, 0.9)";
    x.fillRect(cx - 30 * k, y - 13 * k, 60 * k, 25 * k);
    x.strokeStyle = tone;
    x.lineWidth = 1 * k;
    x.strokeRect(cx - 30 * k, y - 13 * k, 60 * k, 25 * k);
    x.fillStyle = tone;
    x.font = "bold " + (13 * k) + "px " + '"SFMono-Regular", Consolas, monospace';
    x.fillText(format(heading, 3), cx, y);
    if (Number.isFinite(state.apHdg)) {
      const bx = cx + angleDiff(state.apHdg, heading) * 4.7 * k;
      x.fillStyle = "#f2c36f";
      x.beginPath();
      x.moveTo(bx, y - 13 * k);
      x.lineTo(bx - 5 * k, y - 7 * k);
      x.lineTo(bx + 5 * k, y - 7 * k);
      x.closePath();
      x.fill();
      x.fillStyle = tone;
    }
    x.restore();
  }

  drawBank(x, bank, cx, cy, k, soft) {
    const y = cy - 140 * k;
    const radius = 46 * k;
    const r = 103 * k;
    x.save();
    x.translate(cx, y);
    x.rotate(-bank);
    x.strokeStyle = soft;
    x.lineWidth = 1 * k;
    for (let deg = -60; deg <= 60; deg += 10) {
      const a = deg * DEG;
      const len = deg % 30 === 0 ? 10 * k : 6 * k;
      x.beginPath();
      x.moveTo(Math.sin(a) * r, -Math.cos(a) * r);
      x.lineTo(Math.sin(a) * (r + len), -Math.cos(a) * (r + len));
      x.stroke();
    }
    x.restore();
    x.save();
    x.translate(cx, y);
    x.rotate(-bank);
    x.fillStyle = "#f2c36f";
    x.beginPath();
    x.moveTo(0, -r + 2 * k);
    x.lineTo(-5 * k, -r - 7 * k);
    x.lineTo(5 * k, -r - 7 * k);
    x.closePath();
    x.fill();
    x.restore();
  }

  drawPitch(x, state, cx, cy, ppd, k, tone, soft) {
    const pitch = (state.pitch || 0) / DEG;
    x.save();
    x.translate(cx, cy);
    x.rotate(-(state.bank || 0));
    x.beginPath();
    x.rect(-205 * k, -172 * k, 410 * k, 344 * k);
    x.clip();
    x.lineWidth = 1.05 * k;
    for (let deg = -90; deg <= 90; deg += 5) {
      const y = (pitch - deg) * ppd;
      if (Math.abs(y) > 170 * k) continue;
      const major = deg % 10 === 0;
      const half = deg === 0 ? 115 * k : major ? 42 * k : 25 * k;
      x.strokeStyle = deg === 0 ? tone : soft;
      x.setLineDash(deg < 0 ? DASH : SOLID);
      x.beginPath();
      x.moveTo(-half - 22 * k, y);
      x.lineTo(-22 * k, y);
      x.moveTo(22 * k, y);
      x.lineTo(half + 22 * k, y);
      x.stroke();
      if (major && deg !== 0) {
        x.setLineDash(SOLID);
        x.fillStyle = soft;
        x.font = (9 * k) + "px " + '"SFMono-Regular", Consolas, monospace';
        x.textAlign = "right";
        x.fillText(String(Math.abs(deg)), -half - 29 * k, y);
        x.textAlign = "left";
        x.fillText(String(Math.abs(deg)), half + 29 * k, y);
      }
    }
    x.setLineDash(SOLID);
    x.restore();
  }

  drawFlightPath(x, state, cx, cy, ppd, k, tone) {
    if (!(state.speed > 15)) return;
    const px = cx + clamp((state.beta || 0) / DEG * ppd, -150 * k, 150 * k);
    const py = cy + clamp((state.alpha || 0) / DEG * ppd, -130 * k, 130 * k);
    x.save();
    x.strokeStyle = tone;
    x.lineWidth = 1.35 * k;
    x.beginPath();
    x.arc(px, py, 7 * k, 0, Math.PI * 2);
    x.moveTo(px - 20 * k, py);
    x.lineTo(px - 7 * k, py);
    x.moveTo(px + 7 * k, py);
    x.lineTo(px + 20 * k, py);
    x.moveTo(px, py - 7 * k);
    x.lineTo(px, py - 15 * k);
    x.stroke();
    x.restore();
  }

  drawTape(x, side, value, step, label, trend, cx, cy, k, tone, soft) {
    const panelW = 72 * k;
    const panelH = 292 * k;
    const left = Math.max(84, 90 * k);
    const panelX = side === "left" ? left : this.w - left - panelW;
    const top = cy - panelH * 0.5;
    const spacing = 20 * k;
    const base = Math.round(value / step) * step;
    const isLeft = side === "left";
    x.save();
    x.fillStyle = "rgba(3, 11, 16, 0.44)";
    x.fillRect(panelX, top, panelW, panelH);
    x.strokeStyle = "rgba(165, 239, 192, 0.42)";
    x.lineWidth = 1 * k;
    x.strokeRect(panelX, top, panelW, panelH);
    x.fillStyle = soft;
    x.font = "bold " + (8 * k) + "px " + '"SFMono-Regular", Consolas, monospace';
    x.textAlign = "center";
    x.fillText(label, panelX + panelW * 0.5, top - 11 * k);
    for (let i = -6; i <= 6; i++) {
      const tick = base + i * step;
      const py = cy - ((tick - value) / step) * spacing;
      if (py < top + 4 * k || py > top + panelH - 4 * k) continue;
      const major = Math.round(tick / step) % 2 === 0;
      x.strokeStyle = major ? tone : soft;
      x.beginPath();
      if (isLeft) {
        x.moveTo(panelX + panelW - 1 * k, py);
        x.lineTo(panelX + panelW - (major ? 12 : 7) * k, py);
      } else {
        x.moveTo(panelX + 1 * k, py);
        x.lineTo(panelX + (major ? 12 : 7) * k, py);
      }
      x.stroke();
      if (major) {
        x.fillStyle = soft;
        x.font = (8 * k) + "px " + '"SFMono-Regular", Consolas, monospace';
        x.textAlign = isLeft ? "left" : "right";
        x.fillText(String(Math.round(tick)), isLeft ? panelX + 5 * k : panelX + panelW - 5 * k, py);
      }
    }
    const boxY = cy - 15 * k;
    x.fillStyle = "rgba(5, 17, 20, 0.96)";
    x.fillRect(panelX - (isLeft ? 0 : 2 * k), boxY, panelW + 2 * k, 30 * k);
    x.strokeStyle = tone;
    x.lineWidth = 1.2 * k;
    x.strokeRect(panelX - (isLeft ? 0 : 2 * k), boxY, panelW + 2 * k, 30 * k);
    x.fillStyle = tone;
    x.font = "bold " + (value > 9999 ? 10 : 13) * k + "px " + '"SFMono-Regular", Consolas, monospace';
    x.textAlign = "center";
    x.fillText(String(Math.round(value)), panelX + panelW * 0.5, cy);
    if (Math.abs(trend) > (isLeft ? 1.8 : 80)) {
      const direction = trend > 0 ? -1 : 1;
      const tx = isLeft ? panelX + panelW - 4 * k : panelX + 4 * k;
      x.fillStyle = "#f2c36f";
      x.beginPath();
      if (isLeft) {
        x.moveTo(tx, cy + direction * 11 * k);
        x.lineTo(tx - 6 * k, cy + direction * 4 * k);
        x.lineTo(tx - 6 * k, cy + direction * 18 * k);
      } else {
        x.moveTo(tx, cy + direction * 11 * k);
        x.lineTo(tx + 6 * k, cy + direction * 4 * k);
        x.lineTo(tx + 6 * k, cy + direction * 18 * k);
      }
      x.closePath();
      x.fill();
    }
    x.restore();
  }

  drawAp(x, text, heading, cx, k, tone, soft) {
    const label = text ? text.toUpperCase() : "A/P OFF";
    const px = Math.max(84, 90 * k) + 85 * k;
    const py = 91 * k;
    x.save();
    x.textAlign = "left";
    x.textBaseline = "middle";
    x.font = "bold " + (8 * k) + "px " + '"SFMono-Regular", Consolas, monospace';
    const width = Math.min(230 * k, Math.max(88 * k, label.length * 6.2 * k + 16 * k));
    x.fillStyle = text ? "rgba(16, 41, 31, 0.78)" : "rgba(6, 14, 19, 0.7)";
    x.fillRect(px, py - 10 * k, width, 20 * k);
    x.strokeStyle = text ? "rgba(116, 213, 161, 0.48)" : "rgba(165, 239, 192, 0.24)";
    x.lineWidth = 1 * k;
    x.strokeRect(px, py - 10 * k, width, 20 * k);
    x.fillStyle = text ? "#9de9bb" : soft;
    x.fillText(label.slice(0, 36), px + 8 * k, py);
    if (Number.isFinite(heading)) {
      x.textAlign = "right";
      x.fillStyle = "#f2c36f";
      x.fillText("BUG " + format(heading, 3), px + width - 7 * k, py);
    }
    x.restore();
  }

  drawNavCue(x, cue, cx, cy, k, tone, soft) {
    if (!cue) return;
    const lateral = Number.isFinite(cue.lateral) ? cue.lateral : cue.loc;
    const vertical = Number.isFinite(cue.vertical) ? cue.vertical : cue.gs;
    if (!Number.isFinite(lateral) && !Number.isFinite(vertical)) return;
    const y = cy + 150 * k;
    const half = 48 * k;
    const dx = clamp(Number.isFinite(lateral) ? lateral : 0, -1, 1) * half;
    const dy = clamp(Number.isFinite(vertical) ? vertical : 0, -1, 1) * 16 * k;
    x.save();
    x.strokeStyle = soft;
    x.fillStyle = tone;
    x.lineWidth = 1 * k;
    x.beginPath();
    x.moveTo(cx - half, y);
    x.lineTo(cx + half, y);
    x.moveTo(cx, y - 19 * k);
    x.lineTo(cx, y + 19 * k);
    x.stroke();
    for (let i = -2; i <= 2; i++) {
      x.beginPath();
      x.arc(cx + i * half * 0.5, y, 2.2 * k, 0, Math.PI * 2);
      x.fill();
      x.beginPath();
      x.arc(cx, y + i * 8 * k, 2 * k, 0, Math.PI * 2);
      x.fill();
    }
    x.fillStyle = "#f2c36f";
    x.beginPath();
    x.arc(cx + dx, y + dy, 4 * k, 0, Math.PI * 2);
    x.fill();
    x.textAlign = "center";
    x.font = "bold " + (7 * k) + "px " + '"SFMono-Regular", Consolas, monospace';
    x.fillStyle = soft;
    x.fillText(String(cue.mode || "NAV").toUpperCase(), cx, y + 27 * k);
    x.restore();
  }

  drawReadouts(x, state, cx, cy, k, tone, soft) {
    const y = Math.min(this.h - 62 * k, cy + 183 * k);
    const boxW = 58 * k;
    const gap = 5 * k;
    const total = boxW * 6 + gap * 5;
    const start = cx - total * 0.5;
    const mach = Number.isFinite(state.mach) ? state.mach.toFixed(2) : "0.00";
    const aoa = ((state.alpha || 0) / DEG).toFixed(1) + "°";
    const gs = (state.vs > 0 ? "+" : "") + format(state.vs, 1);
    const agl = format(state.agl, 1);
    const throttle = Math.round((state.thr || 0) * 100) + "%" + (state.thr > 0.75 ? " AB" : "");
    this.drawMini(x, start, y, boxW, k, "MACH", mach, tone, soft);
    this.drawMini(x, start + (boxW + gap), y, boxW, k, "G", (state.g || 0).toFixed(1), tone, soft);
    this.drawMini(x, start + (boxW + gap) * 2, y, boxW, k, "AOA", aoa, tone, soft);
    this.drawMini(x, start + (boxW + gap) * 3, y, boxW, k, "V/S", gs, tone, soft);
    this.drawMini(x, start + (boxW + gap) * 4, y, boxW, k, "AGL", agl, tone, soft);
    this.drawMini(x, start + (boxW + gap) * 5, y, boxW, k, "THR", throttle, tone, soft);
  }

  drawMini(x, left, top, width, k, label, value, tone, soft) {
    x.save();
    x.fillStyle = "rgba(4, 13, 18, 0.66)";
    x.fillRect(left, top, width, 37 * k);
    x.strokeStyle = "rgba(165, 239, 192, 0.28)";
    x.lineWidth = 1 * k;
    x.strokeRect(left, top, width, 37 * k);
    x.textAlign = "center";
    x.fillStyle = soft;
    x.font = "bold " + (6.5 * k) + "px " + '"SFMono-Regular", Consolas, monospace';
    x.fillText(label, left + width * 0.5, top + 9 * k);
    x.fillStyle = tone;
    x.font = "bold " + (9 * k) + "px " + '"SFMono-Regular", Consolas, monospace';
    x.fillText(value, left + width * 0.5, top + 25 * k);
    x.restore();
  }

  drawWarning(x, state, cx, cy, k) {
    let label = "";
    let color = "#ff7973";
    if (state.pullUp) label = "PULL UP";
    else if (state.stall) label = "STALL";
    else if (state.overspeed) label = "OVERSPEED";
    else if (state.overG) label = "OVER G";
    else if (state.gearWarn) {
      label = "GEAR";
      color = "#f2c36f";
    } else if (state.lowFuel) {
      label = "LOW FUEL";
      color = "#f2c36f";
    }
    if (!label) return;
    const y = cy + 117 * k;
    const width = Math.max(112 * k, label.length * 8 * k + 24 * k);
    x.save();
    x.fillStyle = "rgba(23, 8, 8, 0.9)";
    x.fillRect(cx - width * 0.5, y - 13 * k, width, 26 * k);
    x.strokeStyle = color;
    x.lineWidth = 1.3 * k;
    x.strokeRect(cx - width * 0.5, y - 13 * k, width, 26 * k);
    x.fillStyle = color;
    x.font = "bold " + (10 * k) + "px " + '"SFMono-Regular", Consolas, monospace';
    x.textAlign = "center";
    x.fillText(label, cx, y);
    x.restore();
  }
}

export { HUD };
