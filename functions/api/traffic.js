import { acquiredAt, observationAge, TRAFFIC_KEEP_SECONDS, PAGES_BUDGET_MS, withinDeadline } from '../../shared/traffic-contract.js';
// Live ADS-B traffic proxy for Cloudflare Pages.
//
// The single upstream (adsb.lol) answers 429 to Cloudflare's shared egress addresses, so most players saw "Live traffic unavailable". This version
//  * snaps the request to a 0.25 degree cell and caches the answer at the edge, so every player in a cell shares one upstream call per TTL;
//  * tries adsb.lol, then adsb.fi, then OpenSky (converted to the same shape) until one answers with data;
//  * keeps the last good answer for 15 minutes and serves it (marked stale) when every provider fails.
// The flight map asks for whatever area it shows, anywhere in the world (radius up to 250 NM, coarser cells for big areas), and for the
// providers' worldwide lists (?list=mil|emergency|ladd|pia). Records are slimmed to the fields the simulator reads.
const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' };
const DEFAULT_UPSTREAM = 'https://api.adsb.lol';
const BUILTIN_HOSTS = new Set(['api.adsb.lol', 'api.adsb.fi', 'opendata.adsb.fi', 'opensky-network.org']);
export const SNAP = 0.25, STALE_SECONDS = 900, MAX_DIST = 250;
// big areas share coarser cells: a 1 degree cell centre is at most ~43 NM from the asked centre, so the cell radius grows by that much
export const snapStep = (dist) => (dist > 100 ? 1 : SNAP);
const KEEP = ['hex', 'flight', 'r', 't', 'desc', 'ownOp', 'year', 'type', 'alt_baro', 'alt_geom', 'gs', 'ias', 'mach', 'track', 'true_heading', 'baro_rate', 'geom_rate',
  'squawk', 'emergency', 'category', 'nav_altitude_mcp', 'lat', 'lon', 'seen_pos', 'seen', 'dbFlags'];
export function slim(list) {
  return list.map((a) => { const o = {}; for (const k of KEEP) if (a[k] !== undefined && a[k] !== null && a[k] !== '') o[k] = a[k]; return o; });
}
// worldwide lists: one upstream path each (emergency merges the three emergency squawks)
export const LISTS = { mil: ['/v2/mil'], ladd: ['/v2/ladd'], pia: ['/v2/pia'], emergency: ['/v2/sqk/7700', '/v2/sqk/7600', '/v2/sqk/7500'] };
const LIST_FALLBACK = { 'api.adsb.lol': (path) => `https://opendata.adsb.fi/api${path}` };

// Apply the same observation lifetime as both browser clients before choosing
// a provider or renewing a cache. A fresh empty snapshot is still valid.
function usableSnapshot(body, records) {
  const now = Date.now(), at = acquiredAt(body, now);
  if (!Array.isArray(records) || body.error || at == null) throw new Error('bad data');
  const age = Math.max(0, (now - at) / 1000);
  if (age > TRAFFIC_KEEP_SECONDS) throw new Error('traffic observations expired');
  const list = records.filter((a) => a && age + observationAge(a) <= TRAFFIC_KEEP_SECONDS);
  if (records.length && !list.length) throw new Error('traffic observations expired');
  return { list, at };
}

async function usableCacheHit(cache, key) {
  const hit = await cache.match(key).catch(() => null);
  if (hit) {
    try { const body = await hit.clone().json(); usableSnapshot(body, body.aircraft); return hit; }
    catch { /* expired or invalid cached data must not block provider fallback */ }
  }
  return null;
}

function numeric(value) {
  if (value == null || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function badRequest(message) {
  return new Response(JSON.stringify({ aircraft: [], error: message }), { status: 400, headers: jsonHeaders });
}

function allowedUpstream(raw, env) {
  const url = new URL(raw || DEFAULT_UPSTREAM);
  const configuredHosts = String(env.TRAFFIC_ALLOWED_HOSTS || '').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean);
  const allowed = new Set([...BUILTIN_HOSTS, ...configuredHosts]);
  if (url.protocol !== 'https:' || !allowed.has(url.hostname.toLowerCase()) || (url.port && url.port !== '443') || url.username || url.password || url.search || url.hash) {
    throw new Error('Traffic upstream host is not allowed');
  }
  return url;
}

export const snapTo = (v, max, step = SNAP) => Math.max(-max, Math.min(max, Math.round(v / step) * step));

// OpenSky state vector -> the adsb.lol aircraft shape the client reads (altitude in feet, speed in knots, climb in ft/min)
const OPENSKY_TYPE = { 2: 'C172', 3: 'A320', 4: 'B753', 5: 'B744', 6: 'B744', 7: 'F16', 8: 'H60', 9: 'GLID', 10: 'BALL' };
export function fromOpenSky(data) {
  const out = [];
  for (const s of (data && data.states) || []) {
    const lon = s[5], lat = s[6], alt = s[13] ?? s[7];
    if (lat == null || lon == null) continue;
    out.push({ hex: s[0], flight: (s[1] || '').trim(), lat, lon, alt_baro: s[8] ? 'ground' : alt == null ? null : alt / 0.3048, gs: (s[9] || 0) / 0.514444, track: s[10] || 0, baro_rate: (s[11] || 0) / 0.00508, t: OPENSKY_TYPE[s[17]] || '', squawk: s[14], seen_pos: s[3] ? Math.max(0, (data.time || Date.now() / 1000) - s[3]) : 0 });
  }
  return out;
}

export function providers(lat, lon, dist, primary) {
  const list = [];
  const p = new URL(primary); p.pathname = `/v2/point/${lat.toFixed(2)}/${lon.toFixed(2)}/${dist}`;
  list.push({ name: p.hostname, url: p, parse: (j) => j.ac || j.aircraft });
  if (p.hostname === 'api.adsb.lol') {
    list.push({ name: 'adsb.fi', url: new URL(`https://opendata.adsb.fi/api/v2/lat/${lat.toFixed(2)}/lon/${lon.toFixed(2)}/dist/${dist}`), parse: (j) => j.ac || j.aircraft });
    const d = Math.min(1.8, dist / 60), dl = d / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
    const q = `lamin=${(lat - d).toFixed(3)}&lomin=${(lon - dl).toFixed(3)}&lamax=${(lat + d).toFixed(3)}&lomax=${(lon + dl).toFixed(3)}`;
    list.push({ name: 'opensky', url: new URL(`https://opensky-network.org/api/states/all?${q}`), parse: (j) => Array.isArray(j.states) || j.states === null ? fromOpenSky(j) : null });
  }
  return list;
}

const baseHeaders = { accept: 'application/json', 'user-agent': 'blackbird-sr71-sim/1.0 (live aircraft traffic)' };
const headersFor = (url, primary, env) => (env.TRAFFIC_API_KEY && url.hostname === primary.hostname
  ? { ...baseHeaders, authorization: `Bearer ${env.TRAFFIC_API_KEY}`, 'x-api-key': env.TRAFFIC_API_KEY } : baseHeaders);
const unavailable = (error) => new Response(JSON.stringify({ aircraft: [], error }), {
  status: 502, headers: { ...jsonHeaders, 'cache-control': 'no-store' },
});
async function worldList(name, { env, waitUntil, primary }) {
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const key = new Request(`https://traffic-cache.invalid/v3/${primary.hostname}/list/${name}`);
  if (cache) { const hit = await usableCacheHit(cache, key); if (hit) return hit; }
  const deadline = Date.now() + PAGES_BUDGET_MS;
  // Independent categories run concurrently under one budget, not three serial budgets.
  const parts = await Promise.all(LISTS[name].map(async (path) => {
    const urls = [new URL(path, primary.href)];
    if (LIST_FALLBACK[primary.hostname]) urls.push(new URL(LIST_FALLBACK[primary.hostname](path)));
    for (const [i, url] of urls.entries()) {
      try {
        const j = await withinDeadline(deadline, urls.length - i, async (signal) => {
          const r = await fetch(url, { headers: headersFor(url, primary, env), signal });
          if (!r.ok) throw new Error(String(r.status));
          return r.json();
        });
        const { list, at } = usableSnapshot(j, j.ac || j.aircraft);
        return { list, at, stale: !!j.stale, partial: !!j.partial, source: url.hostname === primary.hostname ? primary.hostname : 'adsb.fi' };
      } catch { /* use remaining provider budget */ }
    }
    return null;
  }));
  const good = parts.filter(Boolean);
  if (!good.length) return unavailable('Traffic list providers unavailable');
  const seen = new Set(), out = [], at = Math.max(...good.map((p) => p.at));
  // Rebase each report age to the newest component acquisition, preserving
  // its actual observation time when snapshots from different caches are merged.
  for (const part of good) for (const a of part.list) if (a && a.hex && !seen.has(a.hex)) {
    seen.add(a.hex); out.push({ ...a, seen_pos: Math.max(0, Number(a.seen_pos ?? a.seen ?? 0) + (at - part.at) / 1000) });
  }
  const partial = good.length !== parts.length || good.some((p) => p.partial), stale = good.some((p) => p.stale);
  const source = [...new Set(good.map((p) => p.source))].join(', ');
  const res = new Response(JSON.stringify({ aircraft: slim(out), source, list: name, acquiredAt: at, stale, partial,
    missing: LISTS[name].filter((_, i) => !parts[i]) }), { status: 200, headers: { ...jsonHeaders,
    'cache-control': partial || stale ? 'no-store' : 'public, max-age=30, s-maxage=30', 'x-traffic-source': source } });
  if (cache && !partial && !stale) { const put = cache.put(key, res.clone()).catch(() => {}); if (waitUntil) waitUntil(put); }
  return res;
}

export async function onRequestGet({ request, env = {}, waitUntil }) {
  const query = new URL(request.url).searchParams;
  if (query.has('list')) {
    const name = query.get('list');
    if (!LISTS[name]) return badRequest(`list must be one of ${Object.keys(LISTS).join(', ')}`);
    let primary;
    try { primary = allowedUpstream(env.TRAFFIC_PROXY_URL, env); }
    catch { return new Response(JSON.stringify({ aircraft: [], error: 'Traffic upstream is not configured safely' }), { status: 502, headers: jsonHeaders }); }
    return worldList(name, { env, waitUntil, primary });
  }
  const rawLat = numeric(query.get('lat')), rawLon = numeric(query.get('lon'));
  const rawDistance = query.has('dist') ? numeric(query.get('dist')) : 54;
  if (rawLat === null || rawLon === null || rawDistance === null) return badRequest('lat, lon and dist must be numeric');

  const distance = Math.round(Math.max(1, Math.min(MAX_DIST, rawDistance)));
  // the cell centre, with a radius that still covers everything within `distance` of the player
  const step = snapStep(distance);
  const lat = snapTo(Math.max(-90, Math.min(90, rawLat)), 90, step), lon = snapTo(Math.max(-180, Math.min(180, rawLon)), 180, step);
  const cellDist = Math.min(MAX_DIST, distance + (step === SNAP ? 8 : 43));
  const cacheSeconds = Math.max(15, Math.min(120, Number.parseInt(env.TRAFFIC_CACHE_SECONDS || '15', 10) || 15));
  let primary;
  try { primary = allowedUpstream(env.TRAFFIC_PROXY_URL, env); }
  catch { return new Response(JSON.stringify({ aircraft: [], error: 'Traffic upstream is not configured safely' }), { status: 502, headers: jsonHeaders }); }

  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const key = new Request(`https://traffic-cache.invalid/v3/${primary.hostname}/${lat.toFixed(2)}/${lon.toFixed(2)}/${cellDist}`);
  const staleKey = new Request(key.url + '/stale');
  const respond = (body, source, extra = {}) => new Response(JSON.stringify({ aircraft: body, source, ...extra }), {
    status: 200, headers: { ...jsonHeaders, 'cache-control': extra.stale || extra.partial ? 'no-store' : `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}`, 'x-traffic-source': source },
  });
  if (cache) { const hit = await usableCacheHit(cache, key); if (hit) return hit; }

  const errors = [], chain = providers(lat, lon, cellDist, primary.href), deadline = Date.now() + PAGES_BUDGET_MS;
  for (const [i, prov] of chain.entries()) {
    try {
      const j = await withinDeadline(deadline, chain.length - i, async (signal) => {
        const response = await fetch(prov.url, { headers: headersFor(prov.url, primary, env), signal,
          cf: { cacheTtl: cacheSeconds, cacheTtlByStatus: { '200-299': cacheSeconds, '400-599': 0 }, cacheEverything: true } });
        if (!response.ok) throw new Error(String(response.status));
        return response.json();
      });
      const { list, at } = usableSnapshot(j, prov.parse(j));
      const res = respond(slim(list), prov.name, { acquiredAt: at, stale: !!j.stale, partial: !!j.partial });
      // A stale relay response must not renew either edge cache's lifetime.
      if (cache && !j.stale && !j.partial) {
        const put = [cache.put(key, res.clone())];
        if (list.length) put.push(cache.put(staleKey, new Response(res.clone().body, { headers: { ...jsonHeaders, 'cache-control': `public, max-age=${STALE_SECONDS}`, 'x-traffic-source': prov.name } })));
        const all = Promise.all(put).catch(() => {});
        if (waitUntil) waitUntil(all);
      }
      return res;
    } catch (error) { errors.push(`${prov.name} ${error.message || 'failed'}`); }
  }
  if (cache) {
    const old = await cache.match(staleKey).catch(() => null);
    if (old) { try { const j = await old.json(), { list, at } = usableSnapshot(j, j.aircraft); return respond(list, `${j.source || 'cache'} (stale)`, { stale: true, acquiredAt: at }); } catch { /* fall through */ } }
  }
  return new Response(JSON.stringify({ aircraft: [], error: `Traffic upstreams unavailable: ${errors.join(', ')}` }), { status: 502, headers: { ...jsonHeaders, 'cache-control': 'no-store' } });
}
