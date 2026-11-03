// Live ADS-B traffic proxy for Cloudflare Pages.
//
// The single upstream (adsb.lol) answers 429 to Cloudflare's shared egress addresses, so most players saw "Live traffic unavailable". This version
//  * snaps the request to a 0.25 degree cell and caches the answer at the edge, so every player in a cell shares one upstream call per TTL;
//  * tries adsb.lol, then adsb.fi, then OpenSky (converted to the same shape) until one answers with data;
//  * keeps the last good answer for 15 minutes and serves it (marked stale) when every provider fails.
const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' };
const DEFAULT_UPSTREAM = 'https://api.adsb.lol';
const BUILTIN_HOSTS = new Set(['api.adsb.lol', 'api.adsb.fi', 'opendata.adsb.fi', 'opensky-network.org']);
export const SNAP = 0.25, STALE_SECONDS = 900;

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

export const snapTo = (v, max) => Math.max(-max, Math.min(max, Math.round(v / SNAP) * SNAP));

// OpenSky state vector -> the adsb.lol aircraft shape the client reads (altitude in feet, speed in knots, climb in ft/min)
const OPENSKY_TYPE = { 2: 'C172', 3: 'A320', 4: 'B753', 5: 'B744', 6: 'B744', 7: 'F16', 8: 'H60', 9: 'GLID', 10: 'BALL' };
export function fromOpenSky(data) {
  const out = [];
  for (const s of (data && data.states) || []) {
    const lon = s[5], lat = s[6], alt = s[13] ?? s[7];
    if (lat == null || lon == null) continue;
    out.push({ hex: s[0], flight: (s[1] || '').trim(), lat, lon, alt_baro: s[8] ? 'ground' : alt == null ? null : alt / 0.3048, gs: (s[9] || 0) / 0.514444, track: s[10] || 0, baro_rate: (s[11] || 0) / 0.00508, t: OPENSKY_TYPE[s[17]] || '', squawk: s[14], seen_pos: s[3] ? Math.max(0, Math.min(40, Date.now() / 1000 - s[3])) : 0 });
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
    list.push({ name: 'opensky', url: new URL(`https://opensky-network.org/api/states/all?${q}`), parse: fromOpenSky });
  }
  return list;
}

export async function onRequestGet({ request, env = {}, waitUntil }) {
  const query = new URL(request.url).searchParams;
  const rawLat = numeric(query.get('lat')), rawLon = numeric(query.get('lon'));
  const rawDistance = query.has('dist') ? numeric(query.get('dist')) : 54;
  if (rawLat === null || rawLon === null || rawDistance === null) return badRequest('lat, lon and dist must be numeric');

  const distance = Math.round(Math.max(1, Math.min(100, rawDistance)));
  // the cell centre, with a radius that still covers everything within `distance` of the player
  const lat = snapTo(Math.max(-90, Math.min(90, rawLat)), 90), lon = snapTo(Math.max(-180, Math.min(180, rawLon)), 180);
  const cellDist = Math.min(100, distance + 8);
  const cacheSeconds = Math.max(15, Math.min(120, Number.parseInt(env.TRAFFIC_CACHE_SECONDS || '15', 10) || 15));
  let primary;
  try { primary = allowedUpstream(env.TRAFFIC_PROXY_URL, env); }
  catch { return new Response(JSON.stringify({ aircraft: [], error: 'Traffic upstream is not configured safely' }), { status: 502, headers: jsonHeaders }); }

  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const key = new Request(`https://traffic-cache.invalid/v2/${lat.toFixed(2)}/${lon.toFixed(2)}/${cellDist}`);
  const staleKey = new Request(key.url + '/stale');
  const respond = (body, source, extra = {}) => new Response(JSON.stringify({ aircraft: body, source, ...extra }), {
    status: 200, headers: { ...jsonHeaders, 'cache-control': `public, max-age=${extra.stale ? 15 : cacheSeconds}, s-maxage=${extra.stale ? 15 : cacheSeconds}`, 'x-traffic-source': source },
  });
  if (cache) { const hit = await cache.match(key).catch(() => null); if (hit) return hit; }

  const baseHeaders = { accept: 'application/json', 'user-agent': 'blackbird-sr71-sim/1.0 (live aircraft traffic)' };
  const headersFor = (prov) => (env.TRAFFIC_API_KEY && prov.url.hostname === primary.hostname ? { ...baseHeaders, authorization: `Bearer ${env.TRAFFIC_API_KEY}`, 'x-api-key': env.TRAFFIC_API_KEY } : baseHeaders); // the key goes to the configured primary/relay only, never to the fallback providers
  const errors = [];
  for (const prov of providers(lat, lon, cellDist, primary.href)) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 4500);
    try {
      const response = await fetch(prov.url, { headers: headersFor(prov), signal: controller.signal, cf: { cacheTtl: cacheSeconds, cacheTtlByStatus: { '200-299': cacheSeconds, '400-599': 0 }, cacheEverything: true } });
      if (!response.ok) { errors.push(`${prov.name} ${response.status}`); continue; }
      const list = prov.parse(await response.json());
      if (!Array.isArray(list)) { errors.push(`${prov.name} bad data`); continue; }
      const res = respond(list, prov.name);
      if (cache) {
        const put = [cache.put(key, res.clone())];
        if (list.length) put.push(cache.put(staleKey, new Response(res.clone().body, { headers: { ...jsonHeaders, 'cache-control': `public, max-age=${STALE_SECONDS}`, 'x-traffic-source': prov.name } })));
        const all = Promise.all(put).catch(() => {});
        if (waitUntil) waitUntil(all);
      }
      return res;
    } catch (error) { errors.push(`${prov.name} ${error && error.name === 'AbortError' ? 'timeout' : 'failed'}`); }
    finally { clearTimeout(timer); }
  }
  if (cache) {
    const old = await cache.match(staleKey).catch(() => null);
    if (old) { try { const j = await old.json(); if (Array.isArray(j.aircraft)) return respond(j.aircraft, `${j.source || 'cache'} (stale)`, { stale: true }); } catch { /* fall through */ } }
  }
  return new Response(JSON.stringify({ aircraft: [], error: `Traffic upstreams unavailable: ${errors.join(', ')}` }), { status: 502, headers: { ...jsonHeaders, 'cache-control': 'no-store' } });
}
