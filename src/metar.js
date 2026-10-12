// Live weather: fetch the current METAR for an airport and turn it into the simulator's weather settings.
const COVER = { SKC: 0, CLR: 0, NSC: 0, NCD: 0, FEW: 0.25, SCT: 0.55, BKN: 0.8, OVC: 1, VV: 1 };

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const weatherIntensity = (token) => {
  const t = token.replace(/^[+-]/, '').replace(/^VC/, '');
  const intensity = token[0] === '-' ? 0.32 : token[0] === '+' ? 0.95 : 0.62;
  if (/TS/.test(t)) return 1;
  if (/RA|DZ|SN|SG|PL|GR|GS|IC/.test(t)) {
    const snow = /SN|SG|PL|GR|GS|IC/.test(t);
    const shower = /SH/.test(t);
    return clamp(intensity + (shower ? 0.08 : 0) + (snow ? -0.12 : 0), 0.18, 0.98);
  }
  return 0;
};

/** Parse a plain-text METAR into the fields returned by aviationweather.gov. */
export function parseMetar(report) {
  const rawOb = String(report ?? '').trim().replace(/\s+/g, ' ');
  if (!rawOb) throw new Error('METAR report is empty');
  const tokens = rawOb.split(' ');
  const station = tokens.find((t) => /^[A-Z]{4}$/.test(t)) || '';
  const wind = tokens.find((t) => /^(?:\d{3}|VRB)\d{2,3}(?:G\d{2,3})?(?:KT|MPS|KMH)$/.test(t));
  let wdir = null, wspd = 0, wgst = 0;
  if (wind) {
    const [, direction, speed, gust, unit] = wind.match(/^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS|KMH)$/);
    const factor = unit === 'MPS' ? 1.943844 : unit === 'KMH' ? 0.539957 : 1;
    wdir = direction === 'VRB' || direction === '000' ? 'VRB' : Number(direction);
    wspd = Math.round(Number(speed) * factor);
    wgst = gust ? Math.round(Number(gust) * factor) : 0;
  }

  const visibilityToken = tokens.find((t) => /^(?:CAVOK|\d{4}|(?:P|M)?(?:\d+\s+)?\d+(?:\/\d+)?SM)$/.test(t));
  const mixedVisibility = tokens.findIndex((t, i) => /^\d+$/.test(t) && /^\d+\/\d+SM$/.test(tokens[i + 1] || ''));
  let visibilityMeters = 10000, sm = 10, visib = '10+';
  if (visibilityToken === 'CAVOK') { visibilityMeters = 10000; sm = 10000 / 1609.344; visib = String(sm); }
  else if (visibilityToken && /^\d{4}$/.test(visibilityToken)) {
    // ICAO 9999 means 10 km or more, not exactly 9,999 m.
    visibilityMeters = Number(visibilityToken) === 9999 ? 10000 : Number(visibilityToken);
    sm = visibilityMeters / 1609.344; visib = String(sm);
  } else {
    let smToken = visibilityToken;
    if (mixedVisibility >= 0) smToken = `${tokens[mixedVisibility]} ${tokens[mixedVisibility + 1]}`;
    if (smToken && /SM$/.test(smToken)) {
      const body = smToken.slice(0, -2), modifier = body[0] === 'P' || body[0] === 'M' ? body[0] : '';
      const value = body.slice(modifier ? 1 : 0).trim().split(/\s+/).reduce((sum, part) => {
        const fraction = part.match(/^(\d+)\/(\d+)$/);
        return sum + (fraction ? Number(fraction[1]) / Number(fraction[2]) : Number(part) || 0);
      }, 0);
      sm = value;
      visibilityMeters = sm * 1609.344;
      visib = modifier === 'P' ? `${sm}+` : String(sm);
    }
  }

  const clouds = tokens.filter((t) => /^(FEW|SCT|BKN|OVC|VV)\d{3}(?:CB|TCU)?$/.test(t)).map((t) => {
    const [, cover, base] = t.match(/^(FEW|SCT|BKN|OVC|VV)(\d{3})/);
    return { cover, base: Number(base) * 100 };
  });
  const wxTokens = tokens.filter((t) => t === 'VCTS' || /^[+-]?(?:VC)?(?:MI|PR|BC|DR|BL|SH|TS|FZ)*(?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS)+$/.test(t));
  const wxString = wxTokens.join(' ');
  const weather = wxTokens.map((token) => token.replace(/^[+-]/, '').replace(/^VC/, ''));
  const rainIntensity = wxTokens.reduce((best, token) => Math.max(best, weatherIntensity(token)), 0);
  const fog = wxTokens.some((t) => /FG/.test(t)) ? 0.85 : wxTokens.some((t) => /BR/.test(t)) ? 0.4 : 0;
  const thunder = wxTokens.some((t) => /TS/.test(t));

  const temperatureToken = tokens.find((t) => /^M?\d{2}\/(?:M?\d{2}|\/\/)$/.test(t));
  const tempParts = temperatureToken ? temperatureToken.split('/') : [];
  const celsius = (s) => s === '//' ? null : Number(s.replace('M', '-'));
  const altimeterToken = tokens.find((t) => /^(?:A\d{4}|Q\d{4})$/.test(t));
  const altim = altimeterToken ? (altimeterToken[0] === 'A' ? Number(altimeterToken.slice(1)) / 100 * 33.8638866667 : Number(altimeterToken.slice(1))) : null;

  return {
    rawOb, icaoId: station, wdir, wspd, wgst, visib, visibilityMeters, visibilitySM: sm,
    clouds, wxString, weather, rainIntensity, fog, thunder,
    temp: celsius(tempParts[0]), dewp: celsius(tempParts[1]), altim,
    altimeterInHg: altimeterToken?.[0] === 'A' ? Number(altimeterToken.slice(1)) / 100 : altim == null ? null : altim / 33.8638866667,
  };
}

export async function fetchMetar(icao, base = '/') {
  const r = await fetch(`${base}api/metar?ids=${encodeURIComponent(icao)}`, { cache: 'no-store' });
  if (!r.ok) throw new Error('METAR service answered ' + r.status);
  const j = await r.json();
  if (!Array.isArray(j) || !j.length) throw new Error('No METAR is published for ' + icao);
  return j[0];
}

// m: one record of the aviationweather.gov JSON; elevM: airport elevation (cloud bases are feet above the airport)
export function interpretMetar(m, elevM = 0) {
  if (typeof m === 'string') m = parseMetar(m);
  const sm = m.visib === '10+' || m.visib == null ? 10 : parseFloat(String(m.visib).replace('+', '')) || 10;
  const wx = String(m.wxString || ''), has = (c) => new RegExp(`(^|\\s|[-+])${c}`).test(wx);
  const layers = (m.clouds || []).filter((c) => c.cover in COVER);
  const solid = layers.filter((c) => COVER[c.cover] >= 0.8 && c.base != null);
  const lowest = solid[0] || layers.find((c) => c.base != null);
  const coverage = layers.reduce((a, c) => Math.max(a, COVER[c.cover] ?? 0), 0);
  const thunder = has('TS'), precip = has('RA') || has('DZ') || has('SH') || has('SN') || thunder;
  const heavy = /\+/.test(wx), light = /-/.test(wx);
  const rain = Number.isFinite(m.rainIntensity) ? m.rainIntensity : thunder ? 1 : precip ? (heavy ? 0.95 : light ? 0.32 : 0.62) : 0;
  const fog = Number.isFinite(m.fog) ? m.fog : has('FG') ? 0.85 : has('BR') ? 0.4 : Math.max(0, Math.min(0.7, 1 - sm / 3));
  const wspd = m.wspd || 0, gust = m.wgst || 0;
  return {
    windDir: m.wdir === 'VRB' || m.wdir == null ? 0 : m.wdir, windKt: wspd, gustKt: gust, sm, coverage,
    baseM: Math.max(300, Math.min(9000, (lowest ? lowest.base * 0.3048 : 3000) + elevM)),
    vis: Math.max(0.3, Math.min(1.2, 0.3 + 0.9 * Math.min(1, (sm - 0.5) / 9.5))),
    rain, rainIntensity: rain, fog, thunder, storm: thunder, gloom: Math.min(0.75, coverage * 0.5 + rain * 0.3),
    turb: Math.min(0.9, 0.04 + wspd / 70 + (gust ? (gust - wspd) / 40 : 0) + (thunder ? 0.3 : 0)),
    tempC: m.temp, dewC: m.dewp, qnhHpa: m.altim, raw: m.rawOb || '', name: m.name || m.icaoId,
  };
}

// ---------- worldwide fallbacks ----------
const hav = (la1, lo1, la2, lo2) => { const r = Math.PI / 180, a = Math.sin((la2 - la1) * r / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin((lo2 - lo1) * r / 2) ** 2; return 12742 * Math.asin(Math.sqrt(a)); };
const timeout = (ms) => new Promise((_, rj) => setTimeout(() => rj(new Error('timed out')), ms));

// nearest published METAR within maxKm of a point (many airports, and most of the world's small ones, issue none)
export async function nearestMetar(lat, lon, base = '/', maxKm = 150) {
  const d = 1.4 / Math.max(0.35, Math.cos(lat * Math.PI / 180));
  const r = await fetch(`${base}api/metar?bbox=${(lat - 1.4).toFixed(2)},${(lon - d).toFixed(2)},${(lat + 1.4).toFixed(2)},${(lon + d).toFixed(2)}`, { cache: 'no-store' });
  if (!r.ok) throw new Error('METAR service answered ' + r.status);
  const j = await r.json(); let best = null;
  for (const m of Array.isArray(j) ? j : []) { if (m.lat == null || m.lon == null) continue; const km = hav(lat, lon, m.lat, m.lon); if (km <= maxKm && (!best || km < best.km)) best = { m, km }; }
  if (!best) throw new Error(`no METAR station within ${maxKm} km`);
  return best;
}

// WMO weather code -> { rain 0..1, fog, thunder }
export function mapWmoWeather(code) {
  if (code >= 95) return { rain: 1, thunder: true, fog: 0 };
  if (code === 45 || code === 48) return { rain: 0, thunder: false, fog: 0.85 };
  if (code >= 80 && code <= 82) return { rain: code === 82 ? 0.95 : 0.6, thunder: false, fog: 0 };
  if (code >= 61 && code <= 67) return { rain: code >= 65 ? 0.9 : code === 63 ? 0.6 : 0.35, thunder: false, fog: 0 };
  if (code >= 51 && code <= 57) return { rain: 0.22, thunder: false, fog: 0.1 };
  if (code >= 71 && code <= 77 || code === 85 || code === 86) return { rain: 0.35, thunder: false, fog: 0.15 }; // snow is drawn as light precipitation
  return { rain: 0, thunder: false, fog: 0 };
}
const wmo = mapWmoWeather;

// global model analysis (Open-Meteo, no key, allows browser requests): used where there is no METAR within reach
export async function modelWeather(lat, lon, elevM = 0) {
  const cur = 'temperature_2m,dew_point_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,weather_code,visibility,pressure_msl';
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&current=${cur}&wind_speed_unit=kn`);
  if (!r.ok) throw new Error('weather model answered ' + r.status);
  const c = (await r.json()).current; if (!c) throw new Error('weather model returned nothing');
  const W = wmo(c.weather_code), low = c.cloud_cover_low ?? 0, mid = c.cloud_cover_mid ?? 0, high = c.cloud_cover_high ?? 0;
  const coverage = Math.min(1, Math.max(0, c.cloud_cover / 100)), spread = Math.max(0, (c.temperature_2m ?? 15) - (c.dew_point_2m ?? 10));
  const agl = low > 12 ? Math.max(300, spread * 125) : mid > 12 ? 3000 : high > 12 ? 7500 : 4000;
  const sm = c.visibility != null ? Math.max(0.2, c.visibility / 1609) : 10, wspd = c.wind_speed_10m || 0, gust = c.wind_gusts_10m || 0;
  const fog = Math.max(W.fog, sm < 1 ? 0.8 : sm < 3 ? 0.35 : 0);
  return {
    windDir: Math.round(c.wind_direction_10m || 0), windKt: Math.round(wspd), gustKt: Math.round(gust), sm, coverage, baseM: Math.max(300, Math.min(9000, agl + elevM)),
    vis: Math.max(0.3, Math.min(1.2, 0.3 + 0.9 * Math.min(1, (sm - 0.5) / 9.5))), rain: W.rain, rainIntensity: W.rain, fog, thunder: W.thunder, storm: W.thunder, gloom: Math.min(0.75, coverage * 0.5 + W.rain * 0.3),
    turb: Math.min(0.9, 0.04 + wspd / 70 + (gust ? (gust - wspd) / 40 : 0) + (W.thunder ? 0.3 : 0)), tempC: c.temperature_2m, dewC: c.dew_point_2m, qnhHpa: c.pressure_msl,
    raw: `Model analysis ${c.time}Z: wind ${String(Math.round(c.wind_direction_10m || 0)).padStart(3, '0')}/${Math.round(wspd)} kt, cloud ${c.cloud_cover}%, visibility ${(sm * 1.609).toFixed(0)} km, ${c.temperature_2m}/${c.dew_point_2m} °C, QNH ${Math.round(c.pressure_msl)}`,
    name: 'weather model',
  };
}

// exact METAR -> nearest METAR -> model, whichever answers first. apt: { ident, lat, lon, elev }
export async function liveWeather(apt, base = '/') {
  const icao = /^[A-Z]{4}$/.test(apt.ident || '') ? apt.ident : null, tries = [];
  if (icao) { try { const m = await Promise.race([fetchMetar(icao, base), timeout(6000)]); return { w: interpretMetar(m, apt.elev || 0), source: `METAR ${icao}`, km: 0 }; } catch (e) { tries.push(`${icao}: ${e.message}`); } }
  try { const { m, km } = await Promise.race([nearestMetar(apt.lat, apt.lon, base), timeout(7000)]); return { w: interpretMetar(m, apt.elev || 0), source: `nearest METAR ${m.icaoId}`, km: Math.round(km) }; } catch (e) { tries.push(`nearby: ${e.message}`); }
  try { const w = await Promise.race([modelWeather(apt.lat, apt.lon, apt.elev || 0), timeout(7000)]); return { w, source: 'weather model (no METAR near here)', km: 0 }; } catch (e) { tries.push(`model: ${e.message}`); }
  throw new Error(tries.join('; '));
}
