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
const LIMITS = { clouds: [0, 1], cloudBase: [0, 20000], windDir: [0, 360], windSpd: [0, 200], turb: [0, 1], vis: [0, 2] };
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
