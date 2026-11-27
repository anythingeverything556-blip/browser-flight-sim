// Live weather: METAR observations remain separate from the simulator's visual tuning.
const COVER = { SKC: 0, CLR: 0, NSC: 0, NCD: 0, FEW: 0.25, SCT: 0.55, BKN: 0.8, OVC: 1, VV: 1, OVX: 1 };
const METRES_PER_SM = 1609.344;
export const METAR_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const finite = (n) => (typeof n === 'number' || typeof n === 'string' && n.trim() !== '') && Number.isFinite(Number(n));
const nonnegative = (n) => finite(n) && Number(n) >= 0;
const validElevation = (n) => finite(n) && Number(n) >= -500 && Number(n) <= 9000;
const weatherToken = /^[+-]?(?:VC)?(?:(?:MI|PR|BC|DR|BL|SH|TS|FZ)*(?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)+|TS|SH)$/;

const weatherIntensity = (token) => {
  const t = token.replace(/^[+-]/, '');
  // Nearby weather is advisory information, not precipitation at the reporting station.
  if (t.startsWith('VC')) return 0;
  const intensity = token[0] === '-' ? 0.32 : token[0] === '+' ? 0.95 : 0.62;
  const p = t.replace(/^(?:BL|DR)(?:SN|SA|DU|PY)$/, '');
  if (/TS/.test(p)) return 1;
  if (/RA|DZ|SN|SG|PL|GR|GS|IC|UP/.test(p)) {
    return clamp(intensity + (/SH/.test(t) ? 0.08 : 0) + (/SN|SG|PL|GR|GS|IC/.test(t) ? -0.12 : 0), 0.18, 0.98);
  }
  return 0;
};

/** Shared raw/JSON present-weather interpretation, including composite -FZRA tokens. */
export function parsePresentWeather(wxString = '') {
  const wxTokens = String(wxString).split(/\s+/).filter((t) => weatherToken.test(t));
  const vicinityWeather = wxTokens.filter((t) => t.replace(/^[+-]/, '').startsWith('VC'));
  const presentWeather = wxTokens.filter((t) => !vicinityWeather.includes(t));
  const fog = presentWeather.some((t) => /FG/.test(t)) ? 0.85 : presentWeather.some((t) => /BR/.test(t)) ? 0.4
    : presentWeather.some((t) => /HZ|FU|DU|SA|VA|BLSN|DRSN|SS|DS|PY/.test(t)) ? 0.25 : 0;
  return {
    wxString: wxTokens.join(' '), weather: wxTokens.map((t) => t.replace(/^[+-]/, '')),
    presentWeather, vicinityWeather, vicinityThunder: vicinityWeather.some((t) => /TS/.test(t)),
    rainIntensity: wxTokens.reduce((best, t) => Math.max(best, weatherIntensity(t)), 0),
    fog, thunder: presentWeather.some((t) => /TS/.test(t)),
  };
}

function smVisibility(value) {
  const match = String(value ?? '').trim().match(/^([PM])?(\d+(?:\.\d+)?(?:\s+\d+\/\d+)?|\.\d+|\d+\/\d+)(\+)?(?:SM)?$/);
  if (!match) return null;
  const sm = match[2].split(/\s+/).reduce((sum, part) => {
    const [numerator, denominator] = part.split('/').map(Number);
    return sum + (denominator === undefined ? numerator : denominator > 0 ? numerator / denominator : NaN);
  }, 0);
  const visibilityMeters = sm * METRES_PER_SM;
  if (!Number.isFinite(sm) || !Number.isFinite(visibilityMeters)) return null;
  return { visibilityMeters, visibilitySM: sm,
    visibilityQualifier: match[1] === 'M' ? 'less-than' : match[1] === 'P' || match[3] ? 'at-least' : null,
    visib: match[1] === 'M' ? `M${sm}` : match[1] === 'P' || match[3] ? `${sm}+` : String(sm) };
}

/** Normalize aviationweather visibility without treating missing/invalid values as clear. */
export function metarVisibility(m = {}) {
  const fromSM = smVisibility(m.visib);
  const raw = m.rawOb ? parseMetar(m.rawOb) : null;
  // Raw metric groups retain precision lost in the provider's rounded statute miles.
  const visibilityMeters = nonnegative(m.visibilityMeters) ? Number(m.visibilityMeters)
    : raw?.visibilityMeters ?? fromSM?.visibilityMeters ?? null;
  const qualifier = ['at-least', 'less-than'].includes(m.visibilityQualifier) ? m.visibilityQualifier
    : fromSM?.visibilityQualifier ?? raw?.visibilityQualifier ?? null;
  return { visibilityMeters, visibilityQualifier: visibilityMeters === null ? null : qualifier,
    visibilitySM: visibilityMeters === null ? null : visibilityMeters / METRES_PER_SM,
    visib: visibilityMeters === null ? null : qualifier === 'less-than' ? `M${visibilityMeters / METRES_PER_SM}`
      : `${visibilityMeters / METRES_PER_SM}${qualifier === 'at-least' ? '+' : ''}` };
}

/** Parse a plain-text METAR into the fields returned by aviationweather.gov. */
export function parseMetar(report) {
  const rawOb = String(report ?? '').trim().replace(/\s+/g, ' ');
  if (!rawOb) throw new Error('METAR report is empty');
  // Remarks/trend groups are not the current observation.
  const allTokens = rawOb.split(' '), trendIndex = allTokens.findIndex((t) => /^(?:RMK|TEMPO|BECMG|NOSIG)$/.test(t));
  const tokens = trendIndex < 0 ? allTokens : allTokens.slice(0, trendIndex);
  const station = tokens.find((t) => /^[A-Z]{4}$/.test(t) && t !== 'AUTO' && t !== 'CORR') || '';
  const wind = tokens.find((t) => /^(?:\d{3}|VRB)\d{2,3}(?:G\d{2,3})?(?:KT|MPS|KMH)$/.test(t));
  let wdir = null, wspd = 0, wgst = 0;
  if (wind) {
    const [, direction, speed, gust, unit] = wind.match(/^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS|KMH)$/);
    const factor = unit === 'MPS' ? 1.943844 : unit === 'KMH' ? 0.539957 : 1;
    wdir = direction === 'VRB' || direction === '000' ? 'VRB' : Number(direction) <= 360 ? Number(direction) : null;
    wspd = Math.round(Number(speed) * factor);
    wgst = gust ? Math.round(Number(gust) * factor) : 0;
  }
  const visibilityIndex = tokens.findIndex((t) => /^(?:CAVOK|\d{4}|[PM]?\d+(?:\/\d+)?SM)$/.test(t));
  const visibilityToken = tokens[visibilityIndex];
  let visibility = { visibilityMeters: null, visibilitySM: null, visibilityQualifier: null, visib: null };
  if (visibilityToken === 'CAVOK' || visibilityToken === '9999') {
    visibility = { visibilityMeters: 10000, visibilitySM: 10000 / METRES_PER_SM, visibilityQualifier: 'at-least', visib: String(10000 / METRES_PER_SM) };
  } else if (/^\d{4}$/.test(visibilityToken || '')) {
    const metres = Number(visibilityToken);
    visibility = { visibilityMeters: metres, visibilitySM: metres / METRES_PER_SM, visibilityQualifier: metres === 0 ? 'less-than' : null, visib: String(metres / METRES_PER_SM) };
    // 0000 is less than 50 metres, not a measured zero.
    if (metres === 0) visibility = { ...visibility, visibilityMeters: 50, visibilitySM: 50 / METRES_PER_SM, visib: String(50 / METRES_PER_SM) };
  } else if (visibilityToken) {
    const mixed = /^\d+\/\d+SM$/.test(visibilityToken) && /^\d+$/.test(tokens[visibilityIndex - 1] || '');
    visibility = smVisibility(mixed ? `${tokens[visibilityIndex - 1]} ${visibilityToken}` : visibilityToken) || visibility;
  }
  // Unknown vertical visibility stays unknown; the renderer may approximate it at station level.
  const clouds = tokens.filter((t) => /^(FEW|SCT|BKN|OVC|VV)(?:\d{3}|\/\/\/)(?:CB|TCU)?$/.test(t)).map((t) => {
    const [, cover, base] = t.match(/^(FEW|SCT|BKN|OVC|VV)(\d{3}|\/\/\/)/);
    return { cover, base: base === '///' ? null : Number(base) * 100 };
  });
  const weather = parsePresentWeather(tokens.join(' '));
  const temperatureToken = tokens.find((t) => /^M?\d{2}\/(?:M?\d{2}|\/\/)$/.test(t));
  const tempParts = temperatureToken ? temperatureToken.split('/') : [];
  const celsius = (s) => (typeof s === 'string' && /^M?\d{1,2}$/.test(s) ? Number(s.replace('M', '-')) : null);
  const altimeterToken = tokens.find((t) => /^(?:A\d{4}|Q\d{4})$/.test(t));
  const altim = altimeterToken ? (altimeterToken[0] === 'A' ? Number(altimeterToken.slice(1)) / 100 * 33.8638866667 : Number(altimeterToken.slice(1))) : null;
  return {
    rawOb, icaoId: station, wdir, wspd, wgst, ...visibility, clouds, ...weather,
    temp: celsius(tempParts[0]), dewp: celsius(tempParts[1]), altim,
    altimeterInHg: altimeterToken?.[0] === 'A' ? Number(altimeterToken.slice(1)) / 100 : altim == null ? null : altim / 33.8638866667,
  };
}

/** Resolve a true observation timestamp. Raw DDHHMMZ uses the closest valid UTC month. */
export function metarObservationTime(m, now = Date.now()) {
  if (m?.obsTime !== null && m?.obsTime !== undefined && m?.obsTime !== '') {
    const value = m.obsTime;
    if (typeof value === 'number' || /^\d+(?:\.\d+)?$/.test(String(value))) {
      const n = Number(value);
      return Number.isFinite(n) && n > 0 ? (n < 1e12 ? n * 1000 : n) : null;
    }
    // Do not interpret timezone-less local dates as UTC, or normalize invalid calendar dates.
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
    const stamp = Date.parse(value);
    const [, year, month, day] = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    const days = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
    return Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= days && Number(value.slice(11, 13)) <= 23 && Number.isFinite(stamp) ? stamp : null;
  }
  const match = String(typeof m === 'string' ? m : m?.rawOb || '').match(/(?:^|\s)(\d{2})(\d{2})(\d{2})Z(?:\s|=|$)/);
  if (!match || !Number.isFinite(now)) return null;
  const [, dd, hh, mm] = match.map(Number);
  if (dd < 1 || dd > 31 || hh > 23 || mm > 59) return null;
  const date = new Date(now), candidates = [];
  for (const offset of [-1, 0, 1]) {
    const month = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1));
    const stamp = Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), dd, hh, mm);
    if (new Date(stamp).getUTCMonth() === month.getUTCMonth()) candidates.push(stamp);
  }
  return candidates.sort((a, b) => Math.abs(now - a) - Math.abs(now - b))[0] ?? null;
}

export function isFreshMetar(m, now = Date.now()) {
  const stamp = metarObservationTime(m, now);
  return stamp !== null && stamp <= now + FUTURE_TOLERANCE_MS && now - stamp <= METAR_MAX_AGE_MS;
}

export async function fetchMetar(icao, base = '/') {
  const r = await fetch(`${base}api/metar?ids=${encodeURIComponent(icao)}`, { cache: 'no-store' });
  if (!r.ok) throw new Error('METAR service answered ' + r.status);
  const j = await r.json(), now = Date.now();
  const fresh = (Array.isArray(j) ? j : []).filter((m) => m && (!m.icaoId || m.icaoId === icao) && isFreshMetar(m, now))
    .sort((a, b) => metarObservationTime(b, now) - metarObservationTime(a, now));
  if (!fresh.length) throw new Error('No fresh METAR (within 2 hours) is published for ' + icao);
  return fresh[0];
}

// elevM is reporting-station MSL elevation; cloud bases are feet above that station.
export function interpretMetar(m, elevM = 0) {
  if (typeof m === 'string') m = parseMetar(m);
  const raw = m.rawOb ? parseMetar(m.rawOb) : {};
  const visibility = metarVisibility(m), sm = visibility.visibilitySM ?? 10;
  const wx = parsePresentWeather(m.wxString ?? raw.wxString ?? '');
  const layers = (m.clouds ?? raw.clouds ?? []).filter((c) => c.cover in COVER).map((c) => ({ ...c, base: nonnegative(c.base) ? Number(c.base) : null }));
  const obscured = layers.find((c) => c.cover === 'VV' || c.cover === 'OVX');
  const solid = layers.filter((c) => COVER[c.cover] >= 0.8 && c.base !== null);
  const lowest = (solid.length ? solid : layers.filter((c) => c.base !== null)).sort((a, b) => a.base - b.base)[0];
  const coverage = layers.reduce((a, c) => Math.max(a, COVER[c.cover] ?? 0), 0);
  const rain = wx.rainIntensity, thunder = wx.thunder;
  const fog = Math.max(wx.fog, clamp(1 - sm / 3, 0, 0.7));
  const wspd = nonnegative(m.wspd) ? Number(m.wspd) : 0, gust = nonnegative(m.wgst) ? Number(m.wgst) : 0;
  const stationElevationM = finite(elevM) ? Number(elevM) : 0;
  const baseAglM = obscured && obscured.base === null ? null : lowest ? lowest.base * 0.3048 : 3000;
  const atisObservation = { ...m, ...visibility, ...wx, clouds: layers,
    wdir: m.wdir ?? null, wspd, wgst: gust, temp: finite(m.temp) ? Number(m.temp) : null,
    dewp: finite(m.dewp) ? Number(m.dewp) : null, altim: finite(m.altim) ? Number(m.altim) : null };
  const observationTime = metarObservationTime(m);
  return {
    windDir: m.wdir === 'VRB' || m.wdir == null ? 0 : m.wdir, windKt: wspd, gustKt: gust, sm, coverage,
    baseM: (baseAglM ?? 0) + stationElevationM, baseAglM, stationElevationM,
    obscured: !!obscured, verticalVisibilityFt: obscured?.base ?? null, clouds: layers,
    ...visibility, atisObservation, observationTime,
    observationAgeMinutes: observationTime === null ? null : Math.max(0, (Date.now() - observationTime) / 60000),
    // Legacy rendering factor, deliberately independent of observed visibility.
    vis: clamp(0.3 + 0.9 * Math.min(1, (sm - 0.5) / 9.5), 0.3, 1.2),
    rain, rainIntensity: rain, fog, thunder, storm: thunder, vicinityWeather: wx.vicinityWeather, vicinityThunder: wx.vicinityThunder,
    gloom: Math.min(0.75, coverage * 0.5 + rain * 0.3),
    turb: Math.min(0.9, 0.04 + wspd / 70 + Math.max(0, gust - wspd) / 40 + (thunder ? 0.3 : 0)),
    tempC: atisObservation.temp, dewC: atisObservation.dewp, qnhHpa: atisObservation.altim, raw: m.rawOb || '', name: m.name || m.icaoId,
  };
}

// ---------- worldwide fallbacks ----------
const hav = (la1, lo1, la2, lo2) => { const r = Math.PI / 180, a = Math.sin((la2 - la1) * r / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin((lo2 - lo1) * r / 2) ** 2; return 12742 * Math.asin(Math.min(1, Math.sqrt(a))); };
async function withTimeout(promise, ms) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timed out')), ms); })]); }
  finally { clearTimeout(timer); }
}

// Nearest fresh reporting station; use its newest report if the feed contains duplicates.
export async function nearestMetar(lat, lon, base = '/', maxKm = 150) {
  const d = Math.min(3.95, 1.4 / Math.max(0.35, Math.cos(lat * Math.PI / 180)));
  const r = await fetch(`${base}api/metar?bbox=${(lat - 1.4).toFixed(2)},${(lon - d).toFixed(2)},${(lat + 1.4).toFixed(2)},${(lon + d).toFixed(2)}`, { cache: 'no-store' });
  if (!r.ok) throw new Error('METAR service answered ' + r.status);
  const j = await r.json(), now = Date.now(), stations = new Map();
  for (const m of Array.isArray(j) ? j : []) {
    if (!m || !finite(m.lat) || !finite(m.lon) || Math.abs(Number(m.lat)) > 90 || Math.abs(Number(m.lon)) > 180 || !isFreshMetar(m, now)) continue;
    const key = m.icaoId || `${m.lat},${m.lon}`, prior = stations.get(key);
    if (!prior || metarObservationTime(m, now) > metarObservationTime(prior, now)) stations.set(key, m);
  }
  let best = null;
  for (const m of stations.values()) {
    const km = hav(lat, lon, Number(m.lat), Number(m.lon));
    if (km <= maxKm && (!best || km < best.km)) best = { m, km };
  }
  if (!best) throw new Error(`no fresh METAR station within ${maxKm} km`);
  return best;
}

// WMO weather code -> { rain 0..1, fog, thunder }
export function mapWmoWeather(code) {
  if (code >= 95) return { rain: 1, thunder: true, fog: 0 };
  if (code === 45 || code === 48) return { rain: 0, thunder: false, fog: 0.85 };
  if (code >= 80 && code <= 82) return { rain: code === 82 ? 0.95 : 0.6, thunder: false, fog: 0 };
  if (code >= 61 && code <= 67) return { rain: code >= 65 ? 0.9 : code === 63 ? 0.6 : 0.35, thunder: false, fog: 0 };
  if (code >= 51 && code <= 57) return { rain: 0.22, thunder: false, fog: 0.1 };
  if (code >= 71 && code <= 77 || code === 85 || code === 86) return { rain: 0.35, thunder: false, fog: 0.15 };
  return { rain: 0, thunder: false, fog: 0 };
}

// Global model analysis (Open-Meteo): used when no fresh METAR is available.
export async function modelWeather(lat, lon, elevM = 0) {
  const cur = 'temperature_2m,dew_point_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,weather_code,visibility,pressure_msl';
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&current=${cur}&wind_speed_unit=kn`);
  if (!r.ok) throw new Error('weather model answered ' + r.status);
  const c = (await r.json())?.current;
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error('weather model returned nothing');
  // Do not turn a partial provider response into a successful calm/clear preset.
  const percent = (n) => nonnegative(n) && Number(n) <= 100;
  const codes = [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99];
  if (!nonnegative(c.wind_speed_10m) || !nonnegative(c.wind_direction_10m) || Number(c.wind_direction_10m) > 360
    || !percent(c.cloud_cover) || !finite(c.weather_code) || !codes.includes(Number(c.weather_code))) {
    throw new Error('weather model returned incomplete or invalid core measurements');
  }
  // Open-Meteo's default ISO clock is UTC even when its string omits Z. Reuse
  // the observation freshness policy, never the fetch time, for model fallback.
  const modelTime = typeof c.time === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?Z?$/.test(c.time)
    ? c.time.replace(/Z?$/, 'Z') : null;
  if (!modelTime || !isFreshMetar({ obsTime: modelTime })) throw new Error('weather model timestamp is missing, invalid or stale');
  const W = mapWmoWeather(Number(c.weather_code)), low = c.cloud_cover_low, mid = c.cloud_cover_mid, high = c.cloud_cover_high;
  const temp = finite(c.temperature_2m) ? Number(c.temperature_2m) : null;
  const dew = finite(c.dew_point_2m) ? Number(c.dew_point_2m) : null;
  const coverage = Number(c.cloud_cover) / 100;
  const spread = temp !== null && dew !== null ? Math.max(0, temp - dew) : null;
  const agl = coverage === 0 ? 4000 : ![low, mid, high].every(percent) ? null
    : low > 12 ? spread === null ? null : spread * 125 : mid > 12 ? 3000 : high > 12 ? 7500 : 4000;
  const visibilityMeters = nonnegative(c.visibility) ? Number(c.visibility) : null;
  const sm = visibilityMeters === null ? 10 : visibilityMeters / METRES_PER_SM;
  const wspd = Number(c.wind_speed_10m), gust = nonnegative(c.wind_gusts_10m) ? Number(c.wind_gusts_10m) : null;
  const fog = Math.max(W.fog, sm < 1 ? 0.8 : sm < 3 ? 0.35 : 0);
  const cover = coverage >= 0.9 ? 'OVC' : coverage >= 0.625 ? 'BKN' : coverage >= 0.375 ? 'SCT' : 'FEW';
  const clouds = coverage > 0 ? [{ cover, base: agl === null ? null : Math.round(agl / 0.3048 / 100) * 100, estimated: true }] : [];
  const windDir = Math.round(Number(c.wind_direction_10m)), windKt = Math.round(wspd), gustKt = Math.round(gust ?? 0);
  const atisObservation = {
    wdir: windDir, wspd: windKt, wgst: gust === null ? null : gustKt > windKt ? gustKt : 0, visibilityMeters, visibilityQualifier: null,
    visib: visibilityMeters === null ? null : String(sm), clouds,
    temp, dewp: dew,
    altim: finite(c.pressure_msl) ? Number(c.pressure_msl) : null, modeled: true, modelTime: c.time ?? null,
  };
  return {
    windDir, windKt, gustKt, sm, coverage, baseM: (agl ?? 4000) + elevM, baseAglM: agl, stationElevationM: elevM, clouds,
    visibilityMeters, visibilityQualifier: null, atisObservation, modeled: true, obscured: false, verticalVisibilityFt: null,
    vis: clamp(0.3 + 0.9 * Math.min(1, (sm - 0.5) / 9.5), 0.3, 1.2),
    rain: W.rain, rainIntensity: W.rain, fog, thunder: W.thunder, storm: W.thunder, gloom: Math.min(0.75, coverage * 0.5 + W.rain * 0.3),
    turb: Math.min(0.9, 0.04 + wspd / 70 + Math.max(0, gust - wspd) / 40 + (W.thunder ? 0.3 : 0)),
    tempC: atisObservation.temp, dewC: atisObservation.dewp, qnhHpa: atisObservation.altim,
    raw: `Model analysis ${modelTime}: wind ${String(windDir).padStart(3, '0')}/${windKt} kt, cloud ${c.cloud_cover}%, visibility ${visibilityMeters === null ? 'unavailable' : (visibilityMeters / 1000).toFixed(1) + ' km'}, ${temp ?? 'unavailable'}/${dew ?? 'unavailable'} °C, QNH ${atisObservation.altim === null ? 'unavailable' : Math.round(atisObservation.altim)}`,
    name: 'weather model',
  };
}

// Exact fresh METAR -> nearest fresh METAR -> model. apt: { ident, lat, lon, elev }.
export async function liveWeather(apt, base = '/') {
  const icao = /^[A-Z]{4}$/.test(apt.ident || '') ? apt.ident : null, tries = [];
  if (icao) {
    try {
      const m = await withTimeout(fetchMetar(icao, base), 6000);
      return { w: interpretMetar(m, validElevation(m.elev) ? Number(m.elev) : apt.elev || 0), source: `METAR ${icao}`, km: 0 };
    } catch (e) { tries.push(`${icao}: ${e.message}`); }
  }
  try {
    const { m, km } = await withTimeout(nearestMetar(apt.lat, apt.lon, base), 7000);
    return { w: interpretMetar(m, validElevation(m.elev) ? Number(m.elev) : apt.elev || 0), source: `nearest METAR ${m.icaoId}`, km: Math.round(km) };
  } catch (e) { tries.push(`nearby: ${e.message}`); }
  try {
    const w = await withTimeout(modelWeather(apt.lat, apt.lon, apt.elev || 0), 7000);
    return { w, source: 'weather model (no fresh METAR near here)', km: 0 };
  } catch (e) { tries.push(`model: ${e.message}`); }
  throw new Error(tries.join('; '));
}
