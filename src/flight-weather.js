import { WEATHER } from './weather.js';

// Older saves cannot distinguish default-on live weather from an explicit opt-in.
// Clear that automatic snapshot once; keep deliberately named training presets.
export function startupWeather(saved = {}) {
  const out = { ...saved }, knownPreset = Object.hasOwn(WEATHER, out.weather);
  const reset = !knownPreset && (out.weather !== 'metar' || !out.weatherPolicyV1 || !out.metarWx || typeof out.metarWx !== 'object');
  const id = reset ? 'clear' : out.weather, p = WEATHER[id] || WEATHER.clear;
  const defaults = { clouds: p.clouds, cloudBase: 6000 / 3.28084, windDir: 320, windSpd: p.wind / 1.94384, turb: p.turb, vis: p.vis };
  if (reset) { Object.assign(out, defaults); delete out.metarWx; }
  else {
    for (const [key, value] of Object.entries(defaults)) {
      const [lo, hi] = LIMITS[key];
      if (!Number.isFinite(out[key]) || out[key] < lo || out[key] > hi) out[key] = value;
    }
    if (id !== 'metar') delete out.metarWx; // presets cannot revive a stale live fog veil
    else out.metarWx = cleanWeatherSnapshot(out).metarWx;
  }
  out.weather = id;
  out.metarAuto = !!out.weatherPolicyV1 && out.metarAuto === true;
  out.weatherPolicyV1 = true;
  return out;
}

// Runtime weather can be temporary without leaking into unrelated preference saves.
const WX_KEYS = ['weather', 'clouds', 'cloudBase', 'windDir', 'windSpd', 'turb', 'vis', 'metarWx', 'metarAuto', 'runClock'];
export function makeWeatherPreferences(settings) {
  let saved = null;
  return {
    begin() { if (!saved) saved = Object.fromEntries(WX_KEYS.map(k => [k, settings[k]])); },
    commit() { saved = null; },
    serialized() { return { ...settings, ...(saved || {}) }; },
  };
}
const LIMITS = { clouds: [0, 1], cloudBase: [-600, 20000], windDir: [0, 360], windSpd: [0, 200], turb: [0, 1], vis: [0.3, 3] };
export function cleanWeatherSnapshot(v) {
  if (!v || typeof v !== 'object') return null;
  const out = {};
  for (const [key, [lo, hi]] of Object.entries(LIMITS)) {
    if (!Number.isFinite(v[key]) || v[key] < lo || v[key] > hi) return null;
    out[key] = v[key];
  }
  if (v.metarWx && typeof v.metarWx === 'object') {
    out.metarWx = {};
    for (const key of ['rain', 'gloom', 'fog', 'bolts']) {
      const n = v.metarWx[key]; out.metarWx[key] = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
    }
  }
  return out;
}
export const weatherSnapshot = settings => cleanWeatherSnapshot(settings);
export function restoreWeather(settings, snapshot) {
  const clean = cleanWeatherSnapshot(snapshot); if (!clean) return false;
  delete settings.metarWx;
  Object.assign(settings, clean); return true;
}

// Observations and the renderer's dimensionless tuning factor are separate quantities.
export function formatReportedVisibility(observation, metric = true) {
  const meters = observation?.visibilityMeters;
  if (!Number.isFinite(meters) || meters < 0) return 'unavailable';
  const qualifier = observation.visibilityQualifier === 'at-least' ? '≥ ' : observation.visibilityQualifier === 'less-than' ? '< ' : '';
  const distance = metric
    ? meters < 1000 ? `${Math.round(meters)} m` : `${Number((meters / 1000).toFixed(2))} km`
    : `${Number((meters / 1609.344).toFixed(3))} mi`;
  return qualifier + distance;
}
