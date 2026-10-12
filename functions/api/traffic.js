const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' };
const DEFAULT_UPSTREAM = 'https://api.adsb.lol';
const BUILTIN_HOSTS = new Set(['api.adsb.lol', 'api.adsb.fi']);

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

export async function onRequestGet({ request, env = {} }) {
  const query = new URL(request.url).searchParams;
  const rawLat = numeric(query.get('lat')), rawLon = numeric(query.get('lon'));
  const rawDistance = query.has('dist') ? numeric(query.get('dist')) : 54;
  if (rawLat === null || rawLon === null || rawDistance === null) return badRequest('lat, lon and dist must be numeric');

  const lat = Math.max(-90, Math.min(90, rawLat));
  const lon = Math.max(-180, Math.min(180, rawLon));
  const distance = Math.round(Math.max(1, Math.min(100, rawDistance)));
  const cacheSeconds = Math.max(15, Math.min(120, Number.parseInt(env.TRAFFIC_CACHE_SECONDS || '15', 10) || 15));
  let upstream;
  try { upstream = allowedUpstream(env.TRAFFIC_PROXY_URL, env); }
  catch { return new Response(JSON.stringify({ aircraft: [], error: 'Traffic upstream is not configured safely' }), { status: 502, headers: jsonHeaders }); }

  upstream.pathname = `/v2/point/${lat.toFixed(2)}/${lon.toFixed(2)}/${distance}`;
  const headers = { accept: 'application/json', 'user-agent': 'blackbird-sr71-sim/1.0 (live aircraft traffic)' };
  if (env.TRAFFIC_API_KEY) {
    headers.authorization = `Bearer ${env.TRAFFIC_API_KEY}`;
    headers['x-api-key'] = env.TRAFFIC_API_KEY;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(upstream, { headers, signal: controller.signal, cf: { cacheTtl: cacheSeconds, cacheEverything: true } });
    const body = await response.text();
    return new Response(body || JSON.stringify({ aircraft: [] }), {
      status: response.status,
      headers: { ...jsonHeaders, 'cache-control': `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}` },
    });
  } catch {
    return new Response(JSON.stringify({ aircraft: [], error: 'Traffic upstream unavailable' }), {
      status: 502,
      headers: { ...jsonHeaders, 'cache-control': 'no-store' },
    });
  } finally { clearTimeout(timeout); }
}
