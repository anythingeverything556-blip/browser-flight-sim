// Live-traffic relay for hosts Cloudflare cannot reach directly (Cloudflare's shared egress IPs are rate-limited or blocked by the ADS-B providers).
// Run it on any machine that is not on Cloudflare (home PC, VPS, Fly.io, Render, Oracle free tier) and put an HTTPS front on it (Caddy, ngrok, a Cloudflare Tunnel).
// usage: RELAY_TOKEN=secret RELAY_CONTACT=you@example.com node tools/traffic-relay.mjs
// env:   PORT (8787), HOST (0.0.0.0), RELAY_TOKEN (optional shared secret, sent by the Pages Function as Bearer / X-API-Key), RELAY_CONTACT (put in the User-Agent, adsb.lol asks for it),
//        RELAY_CACHE_SECONDS (15), RELAY_UPSTREAMS (comma list of adsb.lol, adsb.fi, airplanes.live; default adsb.lol,adsb.fi)
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';

const PORT = Number(process.env.PORT || 8787), HOST = process.env.HOST || '0.0.0.0';
const TOKEN = process.env.RELAY_TOKEN || '', CONTACT = process.env.RELAY_CONTACT || 'unset';
const CACHE_MS = Math.max(5, Math.min(120, Number(process.env.RELAY_CACHE_SECONDS || 15))) * 1000;
const UA = `blackbird-sr71-sim-relay/1.0 (contact: ${CONTACT})`;
const UPSTREAMS = {
  'adsb.lol': (lat, lon, r) => `https://api.adsb.lol/v2/point/${lat}/${lon}/${r}`,
  'adsb.fi': (lat, lon, r) => `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${r}`,
  'airplanes.live': (lat, lon, r) => `https://api.airplanes.live/v2/point/${lat}/${lon}/${r}`,
};
const order = (process.env.RELAY_UPSTREAMS || 'adsb.lol,adsb.fi').split(',').map((s) => s.trim()).filter((s) => UPSTREAMS[s]);
const cache = new Map(), inflight = new Map(), cooldown = new Map();

const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const authorised = (req) => {
  if (!TOKEN) return true;
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''), key = String(req.headers['x-api-key'] || '');
  return same(bearer, TOKEN) || same(key, TOKEN);
};

async function fetchUpstream(lat, lon, r) {
  const errors = [];
  for (const name of order) {
    if ((cooldown.get(name) || 0) > Date.now()) { errors.push(`${name} cooling down`); continue; }
    try {
      const res = await fetch(UPSTREAMS[name](lat, lon, r), { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      if (res.status === 429 || res.status === 403) cooldown.set(name, Date.now() + 30000);
      if (!res.ok) { errors.push(`${name} ${res.status}`); continue; }
      const body = await res.json(), ac = body.ac || body.aircraft;
      if (!Array.isArray(ac)) { errors.push(`${name} bad data`); continue; }
      return { ac, source: name };
    } catch (e) { errors.push(`${name} ${e.name === 'TimeoutError' ? 'timeout' : 'failed'}`); }
  }
  throw new Error(errors.join(', ') || 'no upstream configured');
}

async function lookup(lat, lon, r) {
  const key = `${lat}/${lon}/${r}`, hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  if (inflight.has(key)) return inflight.get(key);
  const job = fetchUpstream(lat, lon, r).then((value) => { cache.set(key, { value, until: Date.now() + CACHE_MS, keep: Date.now() + 15 * 60000 }); return value; })
    .catch((e) => { if (hit && hit.keep > Date.now() && hit.value.ac.length) return { ...hit.value, stale: true }; throw e; })
    .finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

setInterval(() => { for (const [k, v] of cache) if (v.keep < Date.now()) cache.delete(k); }, 60000).unref();

export const server = http.createServer(async (req, res) => {
  const send = (code, obj, extra = {}) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra }); res.end(JSON.stringify(obj)); };
  const url = new URL(req.url, 'http://relay');
  if (url.pathname === '/health') return send(200, { ok: true, upstreams: order, cached: cache.size });
  if (!authorised(req)) return send(401, { error: 'unauthorised' });
  const m = /^\/v2\/point\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/.exec(url.pathname);
  if (req.method !== 'GET' || !m) return send(404, { error: 'use GET /v2/point/{lat}/{lon}/{radius_nm}' });
  const lat = Math.max(-90, Math.min(90, Number(m[1]))), lon = Math.max(-180, Math.min(180, Number(m[2]))), r = Math.max(1, Math.min(100, Math.round(Number(m[3]))));
  try {
    const out = await lookup(lat.toFixed(2), lon.toFixed(2), r);
    send(200, { ac: out.ac, source: out.source, stale: !!out.stale });
  } catch (e) { send(502, { ac: [], error: String(e.message).slice(0, 200) }); }
});

if (import.meta.url === `file://${process.argv[1]}`) {
  server.listen(PORT, HOST, () => console.log(`traffic relay on http://${HOST}:${PORT} upstreams=${order.join(',')} auth=${TOKEN ? 'on' : 'OFF'} contact=${CONTACT}`));
}
