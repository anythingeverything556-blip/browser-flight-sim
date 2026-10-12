// Same-origin proxy for aviationweather.gov METARs (the service sends no CORS headers, so a browser cannot call it directly).
// ?ids=ICAO[,ICAO]  or  ?bbox=lat0,lon0,lat1,lon1 (every station in a box, used to find the nearest one when an airport has no METAR)
export async function onRequestGet({ request }) {
  const q = new URL(request.url).searchParams, ids = (q.get('ids') || '').replace(/[^A-Za-z0-9,]/g, '').slice(0, 40);
  const bb = (q.get('bbox') || '').split(',').map(Number);
  const okBox = bb.length === 4 && bb.every(Number.isFinite) && Math.abs(bb[2] - bb[0]) <= 6 && Math.abs(bb[3] - bb[1]) <= 8;
  const qs = ids ? `ids=${ids}` : okBox ? `bbox=${bb.map((v) => v.toFixed(2)).join(',')}` : '';
  if (!qs) return new Response('[]', { status: 400, headers: { 'content-type': 'application/json' } });
  const r = await fetch(`https://aviationweather.gov/api/data/metar?${qs}&format=json`, { headers: { 'user-agent': 'blackbird-sr71-sim' }, cf: { cacheTtl: 120, cacheEverything: true } });
  return new Response(await r.text(), { status: r.status, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=120' } });
}
