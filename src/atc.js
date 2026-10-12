// A light-weight air traffic controller: it reads the weather, clears the take-off, hands the climb to departure, and talks the ILS
// approach down to the landing, with a squelch click and (optionally) a synthesised voice. Everything is text in the radio log first.
import { parseMetar } from './metar.js';
const DIG = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'];
const dig = (n, pad = 0) => String(Math.round(n)).padStart(pad, '0').split('').map((d) => DIG[+d] || d).join(' ');
const rwySpoken = (id) => String(id).replace(/(\d+)/, (m) => dig(m, 2)).replace(/L$/, ' left').replace(/R$/, ' right').replace(/C$/, ' centre');
export const CALLSIGN = 'Blackbird 71', SPOKEN = 'Blackbird seven one';

export class Atc {
  constructor(el, audio) {
    this.el = el; this.audio = audio; this.voice = true; this.t = 0; this.reset(); this.ctx = null;
  }
  reset() { this.s = { atis: false, clr: false, dep: false, app: false, land: false, down: false, goAround: false }; this.t = 0; this.quiet = 0; this.approachSample = null; this.lastAdvisoryAt = 0; }
  squelch() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      const a = this.ctx || (this.ctx = new AC()), n = a.sampleRate * 0.11, b = a.createBuffer(1, n, a.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / n * 5);
      const src = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 0.8;
      g.gain.value = 0.16 * (this.audio && this.audio.enabled ? this.audio.volume ?? 0.7 : 0); src.buffer = b; src.connect(f); f.connect(g); g.connect(a.destination); src.start();
    } catch { /* audio is optional */ }
  }
  say(from, text, spoken, you = false) {
    const m = document.createElement('div'); m.className = 'rmsg' + (you ? ' you' : ''); m.innerHTML = `<b></b><span></span>`; m.firstChild.textContent = from; m.lastChild.textContent = text;
    this.el.appendChild(m); while (this.el.children.length > 3) this.el.firstChild.remove();
    setTimeout(() => m.classList.add('old'), 14000 + text.length * 40); setTimeout(() => m.remove(), 16000 + text.length * 40);
    if (!(this.audio && this.audio.enabled)) return;
    this.squelch();
    if (this.voice && 'speechSynthesis' in window && spoken) {
      try { const u = new SpeechSynthesisUtterance(spoken); u.rate = you ? 1.12 : 1.04; u.pitch = you ? 0.85 : 0.95; u.volume = Math.min(1, (this.audio.volume ?? 0.7) * 0.9); setTimeout(() => speechSynthesis.speak(u), 140); } catch { /* ignore */ }
    }
  }
  wxLine(c) {
    const w = c.wind, kt = Math.round(w.kt);
    return { text: kt < 1 ? 'wind calm' : `wind ${String(Math.round(w.dir)).padStart(3, '0')} at ${kt}`, spoken: kt < 1 ? 'wind calm' : `wind ${dig(w.dir, 3)} at ${dig(kt)}` };
  }
  sendPhase(phase, c, extra = {}) {
    const airport = c.apt.name.replace(/ (International|Intl|Airport|Air Force Base|AFB)$/i, '');
    const wind = this.wxLine(c).text.replace(/^wind\s+/, '');
    const message = advanceAtcPhase(this.s, phase, {
      region: c.region, airport, runway: c.rwy, wind, qnhHpa: c.qnhHpa, ...extra,
    });
    if (!message) return null;
    this.say(`${airport} ${message.station}`, message.text, message.text);
    const readback = buildReadback(message);
    setTimeout(() => this.say(CALLSIGN, readback, readback, true), 4200);
    return message;
  }
  // c: { started, crashed, onGround, gsKt, agl (ft), gearDown, apt: {ident, name}, rwy, wind: {dir, kt}, nav: {ilsValid, thrDist (m)}, tempC, qnhHpa }
  update(dt, c) {
    if (!c.started || c.crashed || !c.apt) return;
    this.t += dt; const s = this.s, w = this.wxLine(c), name = c.apt.name.replace(/ (International|Intl|Airport|Air Force Base|AFB)$/i, ''), rid = c.rwy;
    if (c.onGround && c.gsKt < 5 && !s.clr && this.t > 3) {
      s.clr = true;
      this.sendPhase('takeoff', c);
    }
    if (!c.onGround && c.agl > 1800 && !c.gearDown && s.clr && !s.dep) {
      s.dep = true;
      this.sendPhase('climb', c);
    }
    const n = c.nav;
    if (n && n.ilsValid && !c.onGround && n.thrDist != null) {
      if (!s.app && n.thrDist < 24000 && n.thrDist > 8000) {
        s.app = true;
        s.goAround = false;
        this.approachSample = { distance: n.thrDist, agl: c.agl };
        this.sendPhase('approach', c);
      }
      if (s.app && !s.goAround && this.approachSample) {
        if (n.thrDist < this.approachSample.distance) {
          this.approachSample = { distance: n.thrDist, agl: c.agl };
        } else if (n.thrDist > this.approachSample.distance + 500 && c.agl > this.approachSample.agl + 100 && c.agl < 5000) {
          this.sendPhase('approach', c, { goAround: true });
          s.goAround = true; s.land = false; this.approachSample = null;
        }
      }
      if (!s.land && n.thrDist < 9500 && n.thrDist > 600) {
        s.land = true;
        this.sendPhase('landing', c);
      }
    }
    if (s.land && c.onGround && c.gsKt < 60 && !s.down) { s.down = true; this.sendPhase('landed', c); }
    if (this.t - (this.lastAdvisoryAt || 0) >= 30 && c.traffic && c.ownship) {
      this.lastAdvisoryAt = this.t;
      const advisory = buildTrafficAdvisory(c.traffic, c.ownship);
      if (advisory) this.say(`${name} Approach`, advisory, advisory);
    }
  }
}

const regionOf = (region) => String(region || 'ICAO').toUpperCase() === 'FAA' ? 'FAA' : 'ICAO';
const pressurePhrase = (region, qnhHpa) => regionOf(region) === 'FAA'
  ? `altimeter ${(qnhHpa / 33.8638866667).toFixed(2)}`
  : `QNH ${Math.round(qnhHpa)}`;

function runwayHeading(runway) {
  if (typeof runway === 'number') return runway % 360;
  const explicit = runway?.headingDeg ?? runway?.heading ?? runway?.hdg ?? runway?.directionDeg;
  if (Number.isFinite(Number(explicit))) return Number(explicit) % 360;
  const id = typeof runway === 'string' ? runway : runway?.ident ?? runway?.id ?? runway?.name ?? '';
  const n = String(id).match(/(?:^|\D)(\d{1,2})(?:[LRC])?(?:$|\D)/i);
  return n ? (Number(n[1]) % 36) * 10 : null;
}

/** Pick the runway with the least crosswind and tailwind exposure. */
export function selectRunwayFromWind(runways, wind = {}) {
  const list = Array.from(runways || []);
  if (!list.length) return null;
  const direction = Number(typeof wind === 'number' ? wind : wind.dir ?? wind.direction ?? wind.wdir);
  const speed = Math.max(0, Number(typeof wind === 'object' ? wind.kt ?? wind.speedKt ?? wind.speed ?? 0 : 0) || 0);
  const firstEnd = list[0]?.ends?.[0];
  if (!Number.isFinite(direction) || speed < 1) return typeof list[0] === 'string' ? list[0] : firstEnd?.ident ?? list[0].ident ?? list[0].id ?? list[0].name ?? list[0];
  let best = null;
  for (const runway of list) {
    const ends = Array.isArray(runway?.ends) ? runway.ends : [null];
    for (const end of ends) {
      const candidate = end || runway, heading = runwayHeading(candidate);
      if (heading == null) continue;
      const delta = ((direction - heading + 540) % 360) - 180;
      const headwind = speed * Math.cos(delta * Math.PI / 180);
      const crosswind = Math.abs(speed * Math.sin(delta * Math.PI / 180));
      const score = crosswind + Math.max(0, -headwind) * 2;
      if (!best || score < best.score) best = { score, runway, end };
    }
  }
  if (!best) return typeof list[0] === 'string' ? list[0] : firstEnd?.ident ?? list[0].ident ?? list[0].id ?? list[0].name ?? list[0];
  if (best.end?.ident) return best.end.ident;
  const runway = best.runway;
  return typeof runway === 'string' ? runway : runway.ident ?? runway.id ?? runway.name ?? runway;
}

const coverSpoken = { FEW: 'few', SCT: 'scattered', BKN: 'broken', OVC: 'overcast', VV: 'vertical visibility' };
const visibilitySpoken = (metar) => {
  if (metar.visibilityMeters >= 10000) return '10 kilometres or greater';
  if (metar.visibilitySM >= 6) return `${Math.round(metar.visibilitySM)} miles`;
  if (metar.visibilityMeters >= 5000) return `${(metar.visibilityMeters / 1000).toFixed(0)} kilometres`;
  return `${Math.round(metar.visibilityMeters / 100) * 100} metres`;
};

/** Build an ATIS from a raw METAR string or aviationweather.gov record. */
export function buildAtis({ metar, information = 'A', region = 'ICAO', runways = [], runway = null } = {}) {
  const m = typeof metar === 'string' ? parseMetar(metar) : metar;
  if (!m) throw new Error('A METAR is required to build ATIS');
  const clouds = (m.clouds || []).filter((c) => coverSpoken[c.cover]).map((c) => `${coverSpoken[c.cover]} ${c.base == null ? 'unknown' : `${Math.round(c.base / 100) * 100} feet`}`);
  const windDir = m.wdir ?? m.windDirection ?? 'VRB';
  const windSpeed = Math.round(m.wspd ?? m.windSpeed ?? 0);
  const wind = windSpeed ? `${windDir === 'VRB' ? 'variable' : `wind ${String(windDir).padStart(3, '0')} degrees`} at ${windSpeed}${m.wgst || m.windGust ? ` gusting ${Math.round(m.wgst ?? m.windGust)}` : ''} knots` : 'wind calm';
  const temp = m.temp == null ? 'temperature unavailable' : `temperature ${m.temp}, dew point ${m.dewp ?? 'unavailable'}`;
  const qnh = m.altim ?? m.qnhHpa ?? null;
  const pressure = qnh == null ? 'pressure unavailable' : pressurePhrase(region, qnh);
  const activeRunway = runway || selectRunwayFromWind(runways, { dir: Number(windDir), kt: windSpeed });
  const runwayText = activeRunway ? `runway ${activeRunway} in use` : 'runway in use not available';
  const weather = m.wxString ? ` ${m.wxString}.` : '';
  const cloudText = clouds.length ? clouds.join(', ') : 'no significant cloud';
  return `Information ${String(information).toUpperCase()}. ${runwayText}. ${wind}. Visibility ${visibilitySpoken({ visibilitySM: Number(m.visib) || 10, visibilityMeters: m.visibilityMeters ?? (Number(m.visib) || 10) * 1609.344 })}.${weather} ${cloudText}. ${temp}. ${pressure}.`;
}

const PHASE_STATIONS = {
  parked: 'Clearance', taxi: 'Ground', 'hold-short': 'Tower', takeoff: 'Tower', climb: 'Departure', cruise: 'Centre',
  descent: 'Centre', approach: 'Approach', landing: 'Tower', landed: 'Tower',
};

/** Pure phase call builder for clearance, ground, tower and handoffs. */
export function buildPhaseMessage(phase, context = {}) {
  const region = regionOf(context.region), callsign = context.callsign || CALLSIGN, runway = context.runway || context.rwy || 'not assigned';
  const airport = context.airport || context.apt || 'the airport', qnh = context.qnhHpa == null ? '' : `, ${pressurePhrase(region, context.qnhHpa)}`;
  const hold = region === 'FAA' ? 'position and hold' : 'line up and wait';
  if (context.goAround || context.missedApproach) return { station: 'Approach', text: `${callsign}, go around. Fly the published missed approach and contact approach.`, readback: `Going around, published missed approach, ${callsign}.` };
  const messages = {
    parked: { station: 'Clearance', text: `${callsign}, cleared to ${context.destination || airport} via ${context.route || 'flight planned route'}, runway ${runway}${qnh}.`, readback: `Cleared to ${context.destination || airport}, runway ${runway}, ${callsign}.` },
    taxi: { station: 'Ground', text: `${callsign}, taxi to runway ${runway} via ${context.taxiRoute || 'the published taxiway'}. Hold short runway ${runway}.`, readback: `Taxi runway ${runway}, hold short, ${callsign}.` },
    'hold-short': { station: 'Tower', text: `${callsign}, runway ${runway}, ${hold}.`, readback: `${hold} runway ${runway}, ${callsign}.` },
    takeoff: { station: 'Tower', text: `${callsign}, wind ${context.wind || 'calm'}, runway ${runway}, cleared for takeoff.`, readback: `Cleared for takeoff runway ${runway}, ${callsign}.` },
    climb: { station: 'Departure', text: `${callsign}, radar contact. Climb and maintain ${context.altitude || 'flight level 600'}, proceed on course.`, readback: `Climb and maintain ${context.altitude || 'flight level 600'}, ${callsign}.` },
    cruise: { station: 'Centre', text: `${callsign}, contact centre on the published frequency.`, readback: `Contact centre, ${callsign}.` },
    descent: { station: 'Centre', text: `${callsign}, descend via arrival, expect approach runway ${runway}${qnh}.`, readback: `Descend via arrival, expect runway ${runway}, ${callsign}.` },
    approach: { station: 'Approach', text: `${callsign}, cleared ILS approach runway ${runway}; contact tower.`, readback: `Cleared ILS runway ${runway}, ${callsign}.` },
    landing: { station: 'Tower', text: `${callsign}, wind ${context.wind || 'calm'}, runway ${runway}, cleared to land.`, readback: `Cleared to land runway ${runway}, ${callsign}.` },
    landed: { station: 'Tower', text: `${callsign}, welcome to ${airport}. Vacate when able and contact ground.`, readback: `Vacating when able, contact ground, ${callsign}.` },
  };
  return messages[phase] || null;
}

/** Small phase-keyed state machine; duplicate phase updates emit no duplicate radio call. */
export function advanceAtcPhase(state, phase, context = {}) {
  const previous = state?.phase;
  if (previous === phase && !context.goAround && !context.missedApproach) return null;
  const message = buildPhaseMessage(phase, context);
  if (state) state.phase = phase;
  return message ? { ...message, phase, handoff: previous !== phase && PHASE_STATIONS[previous] !== PHASE_STATIONS[phase] } : null;
}

export function buildTrafficAdvisory(trafficList, ownship = {}) {
  const entries = trafficList instanceof Map ? [...trafficList.values()] : Array.from(trafficList || []);
  if (!Number.isFinite(ownship.lat) || !Number.isFinite(ownship.lon)) return null;
  let nearest = null;
  for (const aircraft of entries) {
    if (!Number.isFinite(aircraft.lat) || !Number.isFinite(aircraft.lon)) continue;
    const lat1 = ownship.lat * Math.PI / 180, lat2 = aircraft.lat * Math.PI / 180;
    const dy = (aircraft.lat - ownship.lat) * 111.32, dx = (aircraft.lon - ownship.lon) * 111.32 * Math.cos(lat1);
    const distance = Math.hypot(dx, dy);
    if (distance < 0.2 || distance > 20 || (nearest && distance >= nearest.distance)) continue;
    const bearing = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
    const clock = Math.round(bearing / 30) % 12 || 12;
    nearest = { aircraft, distance, clock };
  }
  if (!nearest) return null;
  const relativeFeet = Math.round(((nearest.aircraft.alt || 0) - (ownship.alt || 0)) * 3.28084 / 100) * 100;
  const relative = relativeFeet === 0 ? 'same altitude' : `${Math.abs(relativeFeet)} feet ${relativeFeet > 0 ? 'above' : 'below'}`;
  return `Traffic ${nearest.clock} o'clock, ${Math.round(nearest.distance * 0.539957)} miles, ${relative}.`;
}

export function buildReadback(message, callsign = CALLSIGN) {
  if (!message) return '';
  return message.readback || `${message.text.replace(new RegExp(callsign.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '').trim()}, ${callsign}.`;
}
