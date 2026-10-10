import * as THREE from 'three';

const kl = 2048,
  ea = 1152,
  ki = Math.PI / 180,
  Ki = 'Arial Narrow, Arial, Helvetica, sans-serif',
  Us = (s, t, e) => Math.min(e, Math.max(t, s)),
  It = {
    kias: {
      x: 195,
      y: 300,
      r: 150,
      min: 0,
      max: 600,
      a0: -150,
      a1: 150,
      major: 50,
      minor: 10,
      labelEvery: 100,
      title: 'KEAS',
      arcs: [[450, 600, '#d22']],
    },
    g: {
      x: 150,
      y: 630,
      r: 108,
      min: -2,
      max: 6,
      a0: -135,
      a1: 135,
      major: 1,
      minor: 0.5,
      labelEvery: 1,
      title: 'G',
      arcs: [[3.5, 6, '#d22']],
    },
    aoa: {
      x: 415,
      y: 630,
      r: 108,
      min: 0,
      max: 25,
      a0: -135,
      a1: 135,
      major: 5,
      minor: 1,
      labelEvery: 5,
      title: 'AOA',
      unit: 'DEG',
      arcs: [
        [14, 18, '#e9a01c'],
        [18, 25, '#d22'],
      ],
    },
    clock: {
      x: 150,
      y: 905,
      r: 96,
      min: 0,
      max: 12,
      a0: 0,
      a1: 360,
      major: 1,
      minor: 0.2,
      labelEvery: 1,
      title: '',
      skipMax: !0,
    },
    fuel: {
      x: 415,
      y: 905,
      r: 96,
      min: 0,
      max: 80,
      a0: -135,
      a1: 135,
      major: 10,
      minor: 5,
      labelEvery: 20,
      title: 'FUEL',
      unit: 'LB x1000',
      arcs: [[0, 5.5, '#d22']],
    },
    alt: {
      x: 1415,
      y: 270,
      r: 135,
      min: 0,
      max: 10,
      a0: 0,
      a1: 360,
      major: 1,
      minor: 0.2,
      labelEvery: 1,
      title: 'ALT',
      skipMax: !0,
    },
    vvi: { x: 1415, y: 565, r: 118 },
    rpmL: {
      x: 1690,
      y: 235,
      r: 88,
      min: 0,
      max: 110,
      a0: -135,
      a1: 135,
      major: 10,
      minor: 5,
      labelEvery: 20,
      title: 'RPM',
      unit: '%',
      arcs: [[100, 110, '#d22']],
    },
    rpmR: {
      x: 1920,
      y: 235,
      r: 88,
      min: 0,
      max: 110,
      a0: -135,
      a1: 135,
      major: 10,
      minor: 5,
      labelEvery: 20,
      title: 'RPM',
      unit: '%',
      arcs: [[100, 110, '#d22']],
    },
    egtL: {
      x: 1690,
      y: 440,
      r: 88,
      min: 0,
      max: 1e3,
      a0: -135,
      a1: 135,
      major: 100,
      minor: 50,
      labelEvery: 200,
      title: 'EGT',
      unit: '°C',
      arcs: [[860, 1e3, '#d22']],
    },
    egtR: {
      x: 1920,
      y: 440,
      r: 88,
      min: 0,
      max: 1e3,
      a0: -135,
      a1: 135,
      major: 100,
      minor: 50,
      labelEvery: 200,
      title: 'EGT',
      unit: '°C',
      arcs: [[860, 1e3, '#d22']],
    },
    nozL: {
      x: 1690,
      y: 628,
      r: 72,
      min: 0,
      max: 100,
      a0: -120,
      a1: 120,
      major: 25,
      minor: 12.5,
      labelEvery: 50,
      title: 'NOZ',
      unit: '% OPEN',
    },
    nozR: {
      x: 1920,
      y: 628,
      r: 72,
      min: 0,
      max: 100,
      a0: -120,
      a1: 120,
      major: 25,
      minor: 12.5,
      labelEvery: 50,
      title: 'NOZ',
      unit: '% OPEN',
    },
    cit: {
      x: 1805,
      y: 1048,
      r: 82,
      min: -50,
      max: 450,
      a0: -135,
      a1: 135,
      major: 50,
      minor: 25,
      labelEvery: 100,
      title: 'CIT',
      unit: '°C',
      arcs: [[427, 450, '#d22']],
    },
  },
  li = (s, t) => (s.a0 + ((Us(t, s.min, s.max) - s.min) / (s.max - s.min)) * (s.a1 - s.a0)) * ki,
  vm = (s) => (-90 + Math.sign(s) * 165 * Math.sqrt(Math.min(1, Math.abs(s) / 6e3))) * ki;
class CockpitPanel {
  constructor() {
    ((this.canvas = document.createElement('canvas')),
      (this.canvas.width = kl),
      (this.canvas.height = ea),
      (this.ctx = this.canvas.getContext('2d')),
      (this.texture = new THREE.CanvasTexture(this.canvas)),
      (this.texture.colorSpace = THREE.SRGBColorSpace),
      (this.texture.anisotropy = 8),
      (this.sm = {}),
      (this.gMax = 1),
      (this.gMin = 1),
      (this.t = 0),
      (this.bg = document.createElement('canvas')),
      (this.bg.width = kl),
      (this.bg.height = ea),
      this.drawStatic(this.bg.getContext('2d')));
  }
  ease(t, e, n, i, r) {
    (this.sm[t] === void 0 || !isFinite(this.sm[t])) && (this.sm[t] = e);
    let a = e - this.sm[t];
    return (
      r && (a = ((a + r * 1.5) % r) - r / 2),
      (this.sm[t] += a * Math.min(1, n * i)),
      r && (this.sm[t] = ((this.sm[t] % r) + r) % r),
      this.sm[t]
    );
  }
  bezel(t, e, n, i) {
    const r = t.createRadialGradient(e - i * 0.3, n - i * 0.3, i * 0.2, e, n, i * 1.18);
    (r.addColorStop(0, '#5b5f63'),
      r.addColorStop(1, '#232527'),
      (t.fillStyle = r),
      t.beginPath(),
      t.arc(e, n, i * 1.16, 0, Math.PI * 2),
      t.fill(),
      (t.fillStyle = '#0b0b0c'),
      t.beginPath(),
      t.arc(e, n, i * 1.02, 0, Math.PI * 2),
      t.fill(),
      (t.fillStyle = '#121314'),
      t.beginPath(),
      t.arc(e, n, i, 0, Math.PI * 2),
      t.fill(),
      (t.fillStyle = '#7d8185'));
    for (const a of [45, 135, 225, 315]) {
      const l = i * 1.09;
      (t.beginPath(), t.arc(e + Math.cos(a * ki) * l, n + Math.sin(a * ki) * l, i * 0.045, 0, Math.PI * 2), t.fill());
    }
  }
  scale(t, e) {
    (t.save(), t.translate(e.x, e.y));
    for (const [i, r, a] of e.arcs || [])
      ((t.strokeStyle = a),
        (t.lineWidth = e.r * 0.07),
        t.beginPath(),
        t.arc(0, 0, e.r * 0.9, li(e, i) - Math.PI / 2, li(e, r) - Math.PI / 2),
        t.stroke());
    ((t.strokeStyle = '#eee'), (t.fillStyle = '#eee'), (t.textAlign = 'center'), (t.textBaseline = 'middle'));
    const n = Math.round((e.max - e.min) / e.minor);
    for (let i = 0; i <= n; i++) {
      const r = e.min + i * e.minor;
      if (e.skipMax && i === n) continue;
      const a = li(e, r),
        l = Math.abs(r / e.major - Math.round(r / e.major)) < 1e-6,
        h = e.r * (l ? 0.78 : 0.86);
      if (
        ((t.lineWidth = l ? e.r * 0.03 : e.r * 0.015),
        t.beginPath(),
        t.moveTo(Math.sin(a) * h, -Math.cos(a) * h),
        t.lineTo(Math.sin(a) * e.r * 0.95, -Math.cos(a) * e.r * 0.95),
        t.stroke(),
        Math.abs(r / e.labelEvery - Math.round(r / e.labelEvery)) < 1e-6)
      ) {
        t.font = `bold ${Math.round(e.r * 0.17)}px ${Ki}`;
        const u = e.r * 0.62,
          f = e.id === 'clock' && r === 0 ? '12' : String(Math.round(r * 10) / 10);
        t.fillText(f, Math.sin(a) * u, -Math.cos(a) * u);
      }
    }
    ((t.font = `${Math.round(e.r * 0.15)}px ${Ki}`),
      (t.fillStyle = '#cfd3d6'),
      e.title && t.fillText(e.title, 0, -e.r * 0.3),
      e.unit && ((t.font = `${Math.round(e.r * 0.1)}px ${Ki}`), t.fillText(e.unit, 0, e.r * 0.32)),
      t.restore());
  }
  label(t, e, n, i, r = 22, a = '#d8dcdf') {
    ((t.fillStyle = a),
      (t.font = `bold ${r}px ${Ki}`),
      (t.textAlign = 'center'),
      (t.textBaseline = 'middle'),
      t.fillText(e, n, i));
  }
  drawStatic(t) {
    const e = t.createLinearGradient(0, 0, 0, ea);
    (e.addColorStop(0, '#26282b'),
      e.addColorStop(1, '#1b1c1e'),
      (t.fillStyle = e),
      t.fillRect(0, 0, kl, ea),
      (t.globalAlpha = 0.05));
    for (let i = 0; i < 2500; i++)
      ((t.fillStyle = Math.random() < 0.5 ? '#fff' : '#000'),
        t.fillRect(Math.random() * kl, Math.random() * ea, 1 + Math.random() * 3, 1));
    ((t.globalAlpha = 1), (t.strokeStyle = '#3b3e42'), (t.lineWidth = 4));
    for (const [i, r, a, l] of [
      [20, 110, 560, 1030],
      [575, 110, 680, 1030],
      [1265, 110, 300, 1030],
      [1575, 110, 455, 1030],
    ])
      t.strokeRect(i, r, a, l);
    for (const i of Object.keys(It)) {
      const r = It[i];
      ((r.id = i), this.bezel(t, r.x, r.y, r.r), r.min !== void 0 && this.scale(t, r));
    }
    const n = It.vvi;
    (t.save(),
      t.translate(n.x, n.y),
      (t.strokeStyle = '#eee'),
      (t.fillStyle = '#eee'),
      (t.textAlign = 'center'),
      (t.textBaseline = 'middle'));
    for (const i of [-6e3, -4e3, -2e3, -1e3, -500, 0, 500, 1e3, 2e3, 4e3, 6e3]) {
      const r = vm(i);
      ((t.lineWidth = 3),
        t.beginPath(),
        t.moveTo(Math.sin(r) * n.r * 0.78, -Math.cos(r) * n.r * 0.78),
        t.lineTo(Math.sin(r) * n.r * 0.95, -Math.cos(r) * n.r * 0.95),
        t.stroke(),
        (t.font = `bold ${Math.round(n.r * 0.15)}px ${Ki}`));
      const a = Math.abs(i) >= 1e3 ? String(Math.abs(i) / 1e3) : i === 0 ? '0' : '.5';
      t.fillText(a, Math.sin(r) * n.r * 0.6, -Math.cos(r) * n.r * 0.6);
    }
    ((t.font = `${Math.round(n.r * 0.12)}px ${Ki}`),
      (t.fillStyle = '#cfd3d6'),
      t.fillText('UP', -n.r * 0.25, -n.r * 0.32),
      t.fillText('DN', -n.r * 0.25, n.r * 0.32),
      t.fillText('VERT SPEED', n.r * 0.2, 0),
      t.fillText('FT/MIN x1000', n.r * 0.2, n.r * 0.16),
      t.restore(),
      this.bezel(t, 920, 335, 228),
      this.bezel(t, 920, 815, 200),
      (t.fillStyle = '#0a0a0b'),
      t.fillRect(372, 160, 180, 290),
      (t.strokeStyle = '#5b5f63'),
      (t.lineWidth = 6),
      t.strokeRect(372, 160, 180, 290),
      this.label(t, 'TRIPLE DISPLAY', 462, 140, 18),
      this.label(t, 'KEAS', 462, 182, 18),
      this.label(t, 'MACH', 462, 278, 18),
      this.label(t, 'ALT FT', 462, 374, 18),
      this.label(t, 'L', 1690, 128, 30),
      this.label(t, 'ENGINES', 1805, 128, 24),
      this.label(t, 'R', 1920, 128, 30),
      this.label(t, 'FUEL FLOW  PPH', 1805, 728, 18),
      this.label(t, 'INLET SPIKE', 1805, 812, 18),
      this.label(t, 'FWD BYPASS', 1805, 905, 18),
      this.label(t, 'NAV / AUTOPILOT', 1415, 728, 18),
      this.label(t, 'GEAR', 340, 1040, 18),
      this.label(t, 'BRAKES · CHUTE', 1415, 960, 18));
  }
  needle(t, e, n, i, r, a, l = '#f4f4f4', h = 0.2) {
    (t.save(),
      t.translate(e, n),
      t.rotate(i),
      (t.fillStyle = l),
      t.beginPath(),
      t.moveTo(-a, r * h),
      t.lineTo(-a * 0.55, -r * 0.9),
      t.lineTo(0, -r),
      t.lineTo(a * 0.55, -r * 0.9),
      t.lineTo(a, r * h),
      t.closePath(),
      t.fill(),
      (t.fillStyle = '#2c2e30'),
      t.beginPath(),
      t.arc(0, 0, a * 1.6, 0, Math.PI * 2),
      t.fill(),
      t.restore());
  }
  digits(t, e, n, i, r, a, l = '#f2f2f2', h) {
    ((t.fillStyle = '#050505'),
      t.fillRect(n - r / 2, i - a / 2, r, a),
      (t.strokeStyle = '#444'),
      (t.lineWidth = 2),
      t.strokeRect(n - r / 2, i - a / 2, r, a),
      (t.fillStyle = l),
      (t.font = `bold ${h || Math.round(a * 0.72)}px Consolas, 'Courier New', monospace`),
      (t.textAlign = 'center'),
      (t.textBaseline = 'middle'),
      t.fillText(e, n, i + 1));
  }
  lamp(t, e, n, i, r, a, l, h) {
    ((t.fillStyle = l ? h : '#1d1f21'),
      t.fillRect(n - r / 2, i - a / 2, r, a),
      (t.strokeStyle = '#000'),
      (t.lineWidth = 3),
      t.strokeRect(n - r / 2, i - a / 2, r, a),
      (t.fillStyle = l ? '#111' : '#4a4d50'),
      (t.font = `bold ${Math.round(a * 0.38)}px ${Ki}`),
      (t.textAlign = 'center'),
      (t.textBaseline = 'middle'));
    const u = e.split(`
`);
    u.forEach((f, d) => t.fillText(f, n, i + (d - (u.length - 1) / 2) * a * 0.4));
  }
  adi(t, e, n) {
    const l = this.ease('pitch', e.pitch / ki, 12, n),
      h = this.ease('bank', e.bank, 12, n),
      u = 210 / 38;
    (t.save(),
      t.beginPath(),
      t.arc(920, 335, 210, 0, Math.PI * 2),
      t.clip(),
      t.translate(920, 335),
      t.rotate(-h),
      t.translate(0, l * u),
      (t.fillStyle = '#a7b0b8'),
      t.fillRect(-420, -840, 840, 840),
      (t.fillStyle = '#121212'),
      t.fillRect(-420, 0, 840, 840),
      (t.strokeStyle = '#fff'),
      (t.lineWidth = 4),
      t.beginPath(),
      t.moveTo(-420, 0),
      t.lineTo(420, 0),
      t.stroke(),
      (t.font = `bold 22px ${Ki}`),
      (t.textAlign = 'center'),
      (t.textBaseline = 'middle'));
    for (let d = -90; d <= 90; d += 5) {
      if (d === 0) continue;
      const p = -d * u;
      if (Math.abs(p + l * u) > 210 * 1.1) continue;
      const v = d % 10 === 0 ? 70 : 34;
      ((t.strokeStyle = d > 0 ? '#202020' : '#f0f0f0'),
        (t.fillStyle = t.strokeStyle),
        (t.lineWidth = 3),
        t.beginPath(),
        t.moveTo(-v, p),
        t.lineTo(v, p),
        t.stroke(),
        d % 10 === 0 && (t.fillText(String(Math.abs(d)), -v - 24, p), t.fillText(String(Math.abs(d)), v + 24, p)));
    }
    (t.restore(), t.save(), t.translate(920, 335), (t.strokeStyle = '#f0f0f0'));
    for (const d of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
      const p = d * ki,
        v = d % 30 === 0 ? 26 : 14;
      ((t.lineWidth = 4),
        t.beginPath(),
        t.moveTo(Math.sin(p) * 212, -Math.cos(p) * 212),
        t.lineTo(Math.sin(p) * (212 + v), -Math.cos(p) * (212 + v)),
        t.stroke());
    }
    if (
      (t.rotate(-h),
      (t.fillStyle = '#ff9b1c'),
      t.beginPath(),
      t.moveTo(0, -206),
      t.lineTo(-14, -180),
      t.lineTo(14, -180),
      t.closePath(),
      t.fill(),
      t.restore(),
      e.apOn)
    ) {
      (t.save(), t.translate(920, 335), (t.strokeStyle = '#e050e0'), (t.lineWidth = 6));
      const d = Us(-e.fdPitch * u, -210 * 0.7, 210 * 0.7),
        p = Us(e.fdRoll * 3, -210 * 0.7, 210 * 0.7);
      (t.beginPath(),
        t.moveTo(-210 * 0.6, d),
        t.lineTo(210 * 0.6, d),
        t.moveTo(p, -210 * 0.6),
        t.lineTo(p, 210 * 0.6),
        t.stroke(),
        t.restore());
    }
    if (e.nav.ilsValid) {
      const d = 335 + Us(e.nav.gsDev / 0.7, -1, 1) * 210 * 0.6;
      ((t.fillStyle = '#3ef06a'),
        t.beginPath(),
        t.moveTo(1124, d),
        t.lineTo(1100, d - 12),
        t.lineTo(1100, d + 12),
        t.closePath(),
        t.fill(),
        (t.strokeStyle = '#ddd'),
        (t.lineWidth = 2));
      for (let p = -2; p <= 2; p++) (t.beginPath(), t.arc(1112, 335 + p * 210 * 0.3, 5, 0, Math.PI * 2), t.stroke());
    }
    ((t.strokeStyle = '#ff9b1c'),
      (t.lineWidth = 9),
      (t.lineCap = 'round'),
      t.beginPath(),
      t.moveTo(800, 335),
      t.lineTo(880, 335),
      t.lineTo(900, 355),
      t.moveTo(1040, 335),
      t.lineTo(960, 335),
      t.lineTo(940, 355),
      t.stroke(),
      (t.fillStyle = '#ff9b1c'),
      t.beginPath(),
      t.arc(920, 335, 8, 0, Math.PI * 2),
      t.fill(),
      (t.lineCap = 'butt'),
      (t.fillStyle = '#050505'),
      t.fillRect(840, 575, 160, 34),
      (t.strokeStyle = '#ddd'),
      (t.lineWidth = 2),
      t.beginPath(),
      t.moveTo(900, 575),
      t.lineTo(900, 609),
      t.moveTo(940, 575),
      t.lineTo(940, 609),
      t.stroke());
    const f = this.ease('slip', Us(e.slip * 600, -62, 62), 6, n);
    ((t.fillStyle = '#eee'), t.beginPath(), t.arc(920 + f, 592, 15, 0, Math.PI * 2), t.fill());
  }
  hsi(t, e, n) {
    const l = this.ease('hdg', e.hdg, 8, n, 360);
    (t.save(),
      t.translate(920, 815),
      t.save(),
      t.rotate(-l * ki),
      (t.strokeStyle = '#eee'),
      (t.fillStyle = '#eee'),
      (t.textAlign = 'center'),
      (t.textBaseline = 'middle'));
    for (let u = 0; u < 360; u += 5) {
      const f = u % 10 === 0 ? 20 : 11;
      ((t.lineWidth = u % 10 === 0 ? 3 : 2),
        t.save(),
        t.rotate(u * ki),
        t.beginPath(),
        t.moveTo(0, -182),
        t.lineTo(0, -182 + f),
        t.stroke(),
        u % 30 === 0 &&
          ((t.font = `bold 30px ${Ki}`),
          t.fillText({ 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[u] || String(u / 10), 0, -138)),
        t.restore());
    }
    (e.apOn &&
      e.apHdgOn &&
      (t.save(), t.rotate(e.apHdg * ki), (t.fillStyle = '#ff9b1c'), t.fillRect(-16, -186, 32, 14), t.restore()),
      e.nav.valid &&
        (t.save(),
        t.rotate(e.nav.brgDeg * ki),
        (t.strokeStyle = '#3ef06a'),
        (t.fillStyle = '#3ef06a'),
        (t.lineWidth = 6),
        t.beginPath(),
        t.moveTo(0, 152),
        t.lineTo(0, -112),
        t.stroke(),
        t.beginPath(),
        t.moveTo(0, -124),
        t.lineTo(-14, -98),
        t.lineTo(14, -98),
        t.closePath(),
        t.fill(),
        t.restore()),
      t.save(),
      t.rotate(e.nav.course * ki),
      (t.strokeStyle = '#ffd34d'),
      (t.fillStyle = '#ffd34d'),
      (t.lineWidth = 7),
      t.beginPath(),
      t.moveTo(0, -122),
      t.lineTo(0, -182 * 0.42),
      t.moveTo(0, 182 * 0.42),
      t.lineTo(0, 142),
      t.stroke(),
      t.beginPath(),
      t.moveTo(0, -126),
      t.lineTo(-15, -98),
      t.lineTo(15, -98),
      t.closePath(),
      t.fill(),
      (t.strokeStyle = '#ccc'),
      (t.lineWidth = 2));
    for (let u = -2; u <= 2; u++) u && (t.beginPath(), t.arc(u * 182 * 0.17, 0, 6, 0, Math.PI * 2), t.stroke());
    const h = e.nav.ilsValid ? Us(e.nav.locDev / 1.25, -2.2, 2.2) : Us(-e.nav.xtkNm / 2, -2.2, 2.2);
    ((t.strokeStyle = '#ffd34d'),
      (t.lineWidth = 7),
      t.beginPath(),
      t.moveTo(h * 182 * 0.17, -182 * 0.38),
      t.lineTo(h * 182 * 0.17, 182 * 0.38),
      t.stroke(),
      t.restore(),
      t.restore(),
      (t.fillStyle = '#ff9b1c'),
      t.beginPath(),
      t.moveTo(0, -188),
      t.lineTo(-12, -208),
      t.lineTo(12, -208),
      t.closePath(),
      t.fill(),
      t.restore(),
      t.save(),
      t.translate(920, 815),
      (t.fillStyle = '#ff9b1c'),
      t.beginPath(),
      t.moveTo(0, -188),
      t.lineTo(-12, -208),
      t.lineTo(12, -208),
      t.closePath(),
      t.fill(),
      (t.strokeStyle = '#ff9b1c'),
      (t.lineWidth = 6),
      t.beginPath(),
      t.moveTo(0, -26),
      t.lineTo(0, 30),
      t.moveTo(-34, 0),
      t.lineTo(34, 0),
      t.moveTo(-14, 26),
      t.lineTo(14, 26),
      t.stroke(),
      t.restore(),
      this.digits(
        t,
        e.nav.valid ? e.nav.distNm.toFixed(e.nav.distNm < 100 ? 1 : 0) : '---',
        770,
        1058,
        140,
        52,
        '#f6f6f6',
      ),
      this.label(t, 'DME NM', 770, 1100, 16),
      this.digits(t, String(Math.round(e.nav.course) % 360).padStart(3, '0'), 1070, 1058, 110, 52, '#ffd34d'),
      this.label(t, 'CRS', 1070, 1100, 16),
      this.label(
        t,
        e.nav.valid ? e.nav.ident + (e.nav.ilsValid ? '  ILS' : '  TACAN') : 'NO NAV',
        920,
        1062,
        24,
        e.nav.ilsValid ? '#3ef06a' : '#d8dcdf',
      ));
  }
  draw(t, e) {
    const n = this.ctx;
    ((this.t += e), n.drawImage(this.bg, 0, 0));
    const i = Math.floor(this.t * 2.5) % 2 === 0,
      r = t.warn.stall || t.warn.overG || t.warn.pullUp || t.unstart[0] || t.unstart[1],
      a = t.warn.lowFuel || t.warn.overspeed || t.warn.gearUnsafe;
    [
      [
        `MASTER
WARN`,
        r && i,
        '#ff3a2e',
      ],
      [
        `MASTER
CAUTION`,
        a && i,
        '#ffb21e',
      ],
      [
        `L INLET
UNSTART`,
        t.unstart[0],
        '#ff3a2e',
      ],
      [
        `R INLET
UNSTART`,
        t.unstart[1],
        '#ff3a2e',
      ],
      ['L A/B', t.ab[0], '#58e070'],
      ['R A/B', t.ab[1], '#58e070'],
      [
        `FUEL
LOW`,
        t.warn.lowFuel,
        '#ffb21e',
      ],
      ['OVER G', t.warn.overG, '#ff3a2e'],
      [
        `AOA
HIGH`,
        t.warn.stall,
        '#ff3a2e',
      ],
      [
        `KEAS
LIMIT`,
        t.warn.overspeed,
        '#ffb21e',
      ],
      ['PULL UP', t.warn.pullUp && i, '#ff3a2e'],
      [
        `A/P
ENGAGED`,
        t.apOn,
        '#58e070',
      ],
      ['SAS', !0, '#58e070'],
      [
        `GEAR
UNSAFE`,
        t.warn.gearUnsafe,
        '#ff3a2e',
      ],
    ].forEach(([x, g, _], w) => this.lamp(n, x, 90 + w * 142, 58, 128, 66, !!g, _));
    const h = this.ease('kias', t.kias, 6, e);
    (this.needle(n, It.kias.x, It.kias.y, li(It.kias, h), It.kias.r * 0.86, 9),
      this.digits(n, t.mach.toFixed(2), It.kias.x, It.kias.y + It.kias.r * 0.55, 110, 44),
      this.digits(n, String(Math.round(t.kias)).padStart(3, ' '), 462, 220, 150, 52),
      this.digits(n, t.mach.toFixed(2), 462, 316, 150, 52),
      this.digits(n, String(Math.round(t.altFt)).padStart(5, ' '), 462, 412, 150, 52, '#f2f2f2', 32),
      (this.gMax = Math.max(this.gMax, t.g)),
      (this.gMin = Math.min(this.gMin, t.g)),
      this.needle(n, It.g.x, It.g.y, li(It.g, this.gMax), It.g.r * 0.8, 4, '#9a9a9a'),
      this.needle(n, It.g.x, It.g.y, li(It.g, this.gMin), It.g.r * 0.8, 4, '#9a9a9a'),
      this.needle(n, It.g.x, It.g.y, li(It.g, this.ease('g', t.g, 8, e)), It.g.r * 0.86, 7),
      this.needle(n, It.aoa.x, It.aoa.y, li(It.aoa, this.ease('aoa', t.aoaDeg, 6, e)), It.aoa.r * 0.86, 7));
    const u = t.hour % 12,
      f = (t.hour * 60) % 60,
      d = (t.hour * 3600) % 60;
    (this.needle(n, It.clock.x, It.clock.y, (u / 12) * Math.PI * 2, It.clock.r * 0.55, 7),
      this.needle(n, It.clock.x, It.clock.y, (f / 60) * Math.PI * 2, It.clock.r * 0.82, 5),
      this.needle(n, It.clock.x, It.clock.y, (d / 60) * Math.PI * 2, It.clock.r * 0.88, 2, '#ff9b1c'),
      this.needle(n, It.fuel.x, It.fuel.y, li(It.fuel, t.fuelLb / 1e3), It.fuel.r * 0.86, 7),
      this.digits(n, String(Math.round(t.fuelLb)).padStart(6, ' '), It.fuel.x, It.fuel.y + It.fuel.r * 0.5, 120, 34));
    const p = t.gearPos > 0.02 && t.gearPos < 0.98;
    (['NOSE', 'LEFT', 'RIGHT'].forEach((x, g) =>
      this.lamp(n, x, 120 + g * 105, 1095, 95, 50, t.gearPos > 0.98 || p, p ? '#ff3a2e' : '#58e070'),
    ),
      (n.fillStyle = '#ddd'),
      n.fillRect(460, 1030 + (t.gearDown ? 40 : 0), 26, 50),
      n.beginPath(),
      n.arc(473, 1030 + (t.gearDown ? 90 : 10), 22, 0, Math.PI * 2),
      n.fill(),
      this.label(n, t.gearDown ? 'DN' : 'UP', 520, 1075, 22),
      this.adi(n, t, e),
      this.hsi(n, t, e));
    const v = this.ease('alt', t.altFt, 8, e);
    (this.digits(
      n,
      String(Math.round(v)).padStart(6, ' '),
      It.alt.x,
      It.alt.y + It.alt.r * 0.42,
      150,
      46,
      '#f2f2f2',
      34,
    ),
      this.needle(n, It.alt.x, It.alt.y, ((v % 1e3) / 1e3) * Math.PI * 2, It.alt.r * 0.86, 9),
      this.needle(n, It.alt.x, It.alt.y, ((v % 1e4) / 1e4) * Math.PI * 2, It.alt.r * 0.55, 12, '#c8c8c8'),
      this.needle(n, It.vvi.x, It.vvi.y, vm(this.ease('vvi', t.vsFpm, 5, e)), It.vvi.r * 0.86, 8),
      (n.fillStyle = '#060606'),
      n.fillRect(1285, 750, 260, 190),
      (n.font = 'bold 24px Consolas, monospace'),
      (n.textAlign = 'left'),
      (n.textBaseline = 'middle'));
    const y = (x, g, _) => {
      ((n.fillStyle = _ ? '#58e070' : '#5d6266'), n.fillText(x, 1298, g));
    };
    (y(`ALT ${t.apAltOn ? Math.round(t.apAltFt) : '-----'}`, 778, t.apOn && t.apAltOn),
      y(`HDG ${t.apHdgOn ? String(Math.round(t.apHdg)).padStart(3, '0') : '---'}`, 812, t.apOn && t.apHdgOn),
      y(
        t.apMachOn ? `MACH ${t.apMach.toFixed(2)}` : `SPD ${t.apSpdOn ? Math.round(t.apSpd) : '---'}`,
        846,
        t.apOn && (t.apMachOn || t.apSpdOn),
      ),
      y(
        `${t.nav.ident || '----'} ${t.nav.valid ? String(Math.round(t.nav.brgDeg) % 360).padStart(3, '0') + '°' : ''}`,
        880,
        t.nav.valid,
      ),
      y(t.nav.ilsValid ? `LOC ${t.nav.locDev.toFixed(1)} GS ${t.nav.gsDev.toFixed(1)}` : 'ILS --', 914, t.nav.ilsValid),
      this.lamp(n, 'BRAKE', 1335, 1010, 92, 50, t.brakes, '#ffb21e'),
      this.lamp(
        n,
        `PARK
BRAKE`,
        1440,
        1010,
        92,
        50,
        t.park,
        '#ffb21e',
      ),
      this.lamp(n, 'CHUTE', 1335, 1072, 92, 50, t.chute === 'deployed', '#58e070'),
      this.lamp(n, 'NWS', 1440, 1072, 92, 50, t.onGround, '#58e070'));
    for (const x of [0, 1]) {
      const g = x ? 'R' : 'L',
        _ = x ? 1920 : 1690;
      (this.needle(n, _, It.rpmL.y, li(It.rpmL, this.ease('rpm' + g, t.rpm[x], 4, e)), It.rpmL.r * 0.86, 6),
        this.digits(n, String(Math.round(t.rpm[x])), _, It.rpmL.y + It.rpmL.r * 0.55, 70, 30),
        this.needle(n, _, It.egtL.y, li(It.egtL, this.ease('egt' + g, t.egt[x], 2, e)), It.egtL.r * 0.86, 6),
        this.digits(n, String(Math.round(t.egt[x])), _, It.egtL.y + It.egtL.r * 0.55, 70, 30),
        this.needle(n, _, It.nozL.y, li(It.nozL, this.ease('noz' + g, t.noz[x], 3, e)), It.nozL.r * 0.86, 5),
        this.digits(n, String(Math.round(t.ff[x])).padStart(5, ' '), _, 765, 150, 42));
      const w = (b, S, E) => {
        ((n.fillStyle = '#060606'),
          n.fillRect(_ - 90, b - 18, 180, 36),
          (n.fillStyle = '#ddd'),
          n.fillRect(_ - 86, b - 14, 172 * Us(S, 0, 1), 28),
          (n.fillStyle = S > 0.55 ? '#111' : '#ddd'),
          (n.font = `bold 20px ${Ki}`),
          (n.textAlign = 'center'),
          (n.textBaseline = 'middle'),
          n.fillText(E, _, b));
      };
      (w(850, t.spikeIn / 26, `${t.spikeIn.toFixed(0)} IN AFT`),
        w(943, t.bypass[x] / 100, `${Math.round(t.bypass[x])} %`),
        this.lamp(n, 'UNSTART', _, 1e3, 120, 40, t.unstart[x] && i, '#ff3a2e'));
    }
    (this.needle(n, It.cit.x, It.cit.y, li(It.cit, this.ease('cit', t.cit, 2, e)), It.cit.r * 0.86, 6),
      this.digits(n, String(Math.round(t.cit)), It.cit.x, It.cit.y + It.cit.r * 0.55, 80, 30),
      (this.texture.needsUpdate = !0));
  }
}

export { CockpitPanel };
