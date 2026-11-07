// Regression tests for the audit's P0 items that do not need a browser: crash-off absorb, full reset, landing-aid latch, throttle keys,
// METAR without a temperature, and escaping of live-traffic text. The autopilot write-back is checked in game (sr71-tools/verify/p0-ingame.mjs).
const listeners = {};
globalThis.window = { addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); } };
globalThis.innerWidth = 1000; globalThis.innerHeight = 800;
const THREE = await import('three');
const { FlightModel } = await import('../src/flight.js');
const { landingAidOn, AID_AGL } = await import('../src/autopilot.js');
const { Controls } = await import('../src/controls.js');
const { parseMetar, interpretMetar } = await import('../src/metar.js');
const { esc } = await import('../src/esc.js');

let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} ${extra}`); if (!ok) fails++; };

// crash option off: a 9 m/s arrival (past the 7 m/s gear limit since the landing-forgiveness change) is soaked up once, the jet keeps its speed and never stops dead or bounces
{
  const f = new FlightModel(), g = () => 0, wind = new THREE.Vector3();
  f.reset(new THREE.Vector3(0, 10, 0), 90, 90, false); f.gearDown = true; f.gearPos = 1; f.vel.y = -9; f.crashOff = true;
  let absorbed = 0, crashed = 0, minGs = 1e9;
  for (let i = 0; i < 2400; i++) { f.step(1 / 240, g, wind); if (f.events.includes('crash-absorbed')) absorbed++; if (f.crashed) crashed++; f.events.length = 0; if (i > 240) minGs = Math.min(minGs, f.vel.length()); }
  check('crash off: impact absorbed, no crash, no dead stop', crashed === 0 && absorbed >= 1 && absorbed < 10 && minGs > 60, `absorbed ${absorbed}, min speed ${minGs.toFixed(1)} m/s`);
  const f2 = new FlightModel(); f2.reset(new THREE.Vector3(0, 10, 0), 90, 90, false); f2.gearDown = true; f2.gearPos = 1; f2.vel.y = -9;
  for (let i = 0; i < 2400 && !f2.crashed; i++) f2.step(1 / 240, g, wind);
  check('crash on: the same arrival still crashes', !!f2.crashed, String(f2.crashed));
}

// reset clears every state that could hold a NaN
{
  const f = new FlightModel();
  f.reset(new THREE.Vector3(0, 3000, 0), 90, 200, false);
  f.fuelAft = NaN; f.cgx = NaN; f.spool = NaN; f.engines[0].dry = NaN; f.engines[1].thrust = NaN; f.out.V = NaN; f.sas.de = NaN; f.surf.da = NaN; f.compress[1] = NaN; f.wheel[2] = NaN; f.fuel = NaN;
  f.reset(new THREE.Vector3(0, 3000, 0), 90, 200, false);
  const g = () => 0, wind = new THREE.Vector3(); for (let i = 0; i < 240; i++) f.step(1 / 240, g, wind);
  const bad = [f.pos.y, f.vel.x, f.quat.w, f.fuelAft, f.cgx, f.spool, f.fuel, f.out.V, f.out.nz, ...f.engines.map((e) => e.thrust), f.sas.de, f.surf.da].filter((v) => !Number.isFinite(v));
  check('reset clears a NaN from the fuel pools, engines, read-outs and surfaces', bad.length === 0, `non-finite after reset+1 s: ${bad.length}`);
}

// landing aid: entry needs a sink, once latched it holds through a flare that stops the sink, a gust over 260 kt, and lets go for the pilot
{
  const base = { enabled: true, onGround: false, crashed: null, gearPos: 1, agl: 13, vs: -0.1, iasKt: 180, pitch: 0 };
  check('landing aid: no entry without a sink rate', landingAidOn({ ...base, latched: false }) === false);
  check('landing aid: latched through the flare (sink slowed past -0.2)', landingAidOn({ ...base, latched: true }) === true);
  check('landing aid: latched through a gust past 260 kt', landingAidOn({ ...base, iasKt: 262, latched: true }) === true);
  check('landing aid: pilot pitch input takes over', landingAidOn({ ...base, pitch: 0.4, latched: true }) === false);
  check('landing aid: off at touchdown and above its height', landingAidOn({ ...base, onGround: true, latched: true }) === false && landingAidOn({ ...base, agl: AID_AGL + 1, latched: true }) === false);
}

// throttle keys: B held then Shift pushes the throttle (guide step 1); Ctrl is no throttle key; a Shift+B parking-brake chord does not move it
{
  const ev = (type, code, mods = {}) => (listeners[type] || []).forEach((fn) => fn({ code, key: code, target: {}, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods, preventDefault() {} }));
  const run = (c, s) => { for (let t = 0; t < s; t += 1 / 60) c.update(1 / 60); };
  const iso = () => { for (const k of Object.keys(listeners)) listeners[k].length = 0; const c = new Controls(); c.enabled = true; return c; };
  let c = iso(); ev('keydown', 'KeyB'); ev('keydown', 'ShiftLeft', { shiftKey: true }); run(c, 2);
  check('B held + Shift pushes the throttle', c.throttle > 0.6 && c.brake === 1, `throttle ${c.throttle.toFixed(2)}`);
  c = iso(); c.throttle = 0.5; ev('keydown', 'ControlLeft', { ctrlKey: true }); run(c, 1);
  check('Ctrl does not move the throttle', c.throttle === 0.5);
  c = iso(); c.throttle = 0.5; ev('keydown', 'KeyQ'); run(c, 1);
  check('Q pulls the throttle back', c.throttle < 0.2, c.throttle.toFixed(2));
  c = iso(); let pb = 0; c.on('parkingBrake', () => pb++); ev('keydown', 'ShiftLeft', { shiftKey: true }); ev('keydown', 'KeyB', { shiftKey: true }); run(c, 1);
  check('Shift+B sets the parking brake without pushing the throttle', pb === 1 && c.throttle === 0);
}

// METAR: missing temperature groups never throw, and the weather codes the fuzz found are read
{
  let ok = true;
  for (const t of ['M/M', '12/', '/////', '']) { try { const m = parseMetar(`KXYZ 121656Z AUTO 24010KT 10SM CLR ${t} A3001`); interpretMetar(m); if (m.temp !== null) ok = false; } catch { ok = false; } }
  check('METAR without a usable temperature parses, temp null', ok);
  check('METAR bare TS is thunder', parseMetar('KDFW 121653Z 18012KT 10SM TS SCT030CB 30/20 A2992').thunder === true);
  const vv = parseMetar('VIDP 121630Z 00000KT 0050 FG VV/// 08/08 Q1018');
  check('METAR VV/// is full cover', interpretMetar(vv).coverage === 1);
  check('METAR +BLSN is not rain', interpretMetar(parseMetar('KMSP 121653Z 32030G50KT 1/2SM +BLSN VV005 M25/M29 A2990')).rain === 0);
  check('METAR haze/smoke thin the air', interpretMetar(parseMetar('YPDN 121630Z 13012KT CAVOK 33/24 Q1008 FU HZ')).fog > 0);
  check('METAR wind direction 999 is rejected', parseMetar('KXYZ 121656Z 99910KT 10SM CLR 12/08 A3001').wdir === null);
  check('METAR OVX (JSON vertical visibility) is overcast', interpretMetar({ clouds: [{ cover: 'OVX', base: 0 }], visib: '1/4' }).coverage === 1);
}

// live-traffic text is escaped before it reaches Leaflet's innerHTML
check('traffic callsign markup is escaped', esc('<img src=x onerror=alert(1)>') === '&lt;img src=x onerror=alert(1)&gt;' && esc(null) === '' && esc(`a"b'c&`) === 'a&quot;b&#39;c&amp;');

if (fails) { console.error(`${fails} P0 fix test(s) failed`); process.exit(1); }
console.log('all P0 fix tests passed');
