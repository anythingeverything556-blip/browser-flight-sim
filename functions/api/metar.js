// Same-origin proxy for aviationweather.gov METARs (the service sends no CORS headers, so a browser cannot call it directly).
// ?ids=ICAO[,ICAO]  or  ?bbox=lat0,lon0,lat1,lon1 (every station in a box, used to find the nearest one when an airport has no METAR)
const json = { 'content-type': 'application/json' };
const TIMEOUT_MS = 8000, BOX_EPS = 0.02; // BOX_EPS: a client box 2 x 3.95 deg wide plus toFixed(2) rounding can land a hair over the limit
export async function onRequestGet({ request, env = {} }) {
  const q = new URL(request.url).searchParams, ids = (q.get('ids') || '').replace(/[^A-Za-z0-9,]/g, '').slice(0, 40);
  const bb = (q.get('bbox') || '').split(',').map((s) => (s.trim() === '' ? NaN : Number(s)));
  const okBox = bb.length === 4 && bb.every(Number.isFinite) && Math.abs(bb[2] - bb[0]) <= 6 + BOX_EPS && Math.abs(bb[3] - bb[1]) <= 8 + BOX_EPS;
  const qs = ids ? `ids=${ids}` : okBox ? `bbox=${bb.map((v) => v.toFixed(2)).join(',')}` : '';
  if (!qs) return new Response('[]', { status: 400, headers: { ...json, 'cache-control': 'no-store' } });
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), Number(env.METAR_TIMEOUT_MS) || TIMEOUT_MS);
  try {
    const r = await fetch(`https://aviationweather.gov/api/data/metar?${qs}&format=json`, { headers: { 'user-agent': 'blackbird-sr71-sim' }, signal: controller.signal, cf: { cacheTtl: 120, cacheTtlByStatus: { '200-299': 120, '300-599': 0 }, cacheEverything: true } });
    if (r.status === 204) return new Response('[]', { status: 200, headers: { ...json, 'cache-control': 'public, max-age=120' } }); // no stations in the box: an empty list, not a 204 with a body
    const text = await r.text();
    if (!r.ok) return new Response(text || '[]', { status: r.status, headers: { ...json, 'cache-control': 'no-store' } });
    return new Response(text, { status: r.status, headers: { ...json, 'cache-control': 'public, max-age=120' } });
  } catch (error) {
    const timedOut = error && error.name === 'AbortError';
    return new Response('[]', { status: timedOut ? 504 : 502, headers: { ...json, 'cache-control': 'no-store' } });
  } finally { clearTimeout(timer); }
}
