# Live traffic setup

The 3D traffic requests `GET /api/traffic?lat=…&lon=…&dist=54`; the flight map asks for the area it shows (`dist` up to 250) and for the worldwide lists `GET /api/traffic?list=mil|emergency|ladd|pia` (emergency merges squawks 7700, 7600 and 7500; lists fall back to adsb.fi and are cached 30 s). The Pages Function defaults to the fixed ADS-B endpoint at `https://api.adsb.lol`; it is not a general-purpose URL proxy. Queries require numeric coordinates, coordinates are clamped to valid ranges, and radius is clamped to 1–250 nautical miles (areas over 100 NM share 1° cells, smaller ones 0.25°). Records are slimmed to the fields the simulator reads. Browser polling caches successful responses for 15–120 seconds and backs off failed polls exponentially to 120 seconds. Retries cover HTTP 403, 429, 5xx (including 522), and network timeouts; unavailable traffic is reported once per session.

## Deploy with the default source

1. Deploy the site to Cloudflare Pages with the `functions/api/traffic.js` function included.
2. No credentials are required for the default adsb.lol endpoint. Requests use a fixed path and a descriptive `User-Agent`.
3. Confirm the deployment can reach `api.adsb.lol`; provider availability and Cloudflare egress acceptance are external dependencies.

## Why the default source fails on Cloudflare

Measured from a Pages Function on 2026-10-13: api.adsb.lol answers 429 (403 without a descriptive User-Agent), opendata.adsb.fi, api.adsb.one and api.airplanes.live return 403 bot-blocks, OpenSky times out, and ADSBexchange wants a purchased key. Cloudflare's shared egress IPs are the problem, not the code, so the fix is a relay on a host that is not on Cloudflare.

## Quick path: `tools/traffic-relay.mjs`

1. On a machine outside Cloudflare (home PC, VPS, Fly.io, Render), run `RELAY_TOKEN=<long random string> RELAY_CONTACT=you@example.com node tools/traffic-relay.mjs` (Node 18+, no install step). It serves `GET /v2/point/{lat}/{lon}/{radius}` and `GET /health`, caches each 0.25 degree cell for 15 s, tries adsb.lol then adsb.fi, backs off 30 s after a 429/403 and serves a stale result for up to 15 minutes.
2. Give it an HTTPS address (Caddy, a Cloudflare Tunnel, or `ngrok http 8787`). The relay must stay running.
3. Run `CLOUDFLARE_API_TOKEN=... RELAY_URL=https://your-relay RELAY_TOKEN=<same string> bash tools/set-traffic-relay.sh`. It sets `TRAFFIC_PROXY_URL`, `TRAFFIC_ALLOWED_HOSTS` and `TRAFFIC_API_KEY` on the Pages project and redeploys.
4. Check `https://sr71-blackbird.pages.dev/api/traffic?lat=51.5&lon=-0.1&dist=54` returns aircraft. `test/relay-test.mjs` covers the relay and the function together offline.

## Use an owner-operated relay or keyed provider

1. Configure the relay to accept `GET /v2/point/{lat}/{lon}/{radius}` and return an ADS-B JSON response containing an `aircraft` or `ac` array. Keep the path contract fixed; the Pages Function always constructs this path itself.
2. In **Cloudflare Dashboard → Workers & Pages → your Pages project → Settings → Variables and Secrets**, add these Production (and optionally Preview) variables:
   - `TRAFFIC_PROXY_URL`: the relay's HTTPS origin, for example `https://traffic-relay.example`.
   - `TRAFFIC_ALLOWED_HOSTS`: the exact relay hostname, for example `traffic-relay.example`. The URL is rejected unless its host is one of the built-in provider hosts or explicitly listed here.
   - `TRAFFIC_API_KEY`: optional secret; when set, the function sends it as both `Authorization: Bearer …` and `X-API-Key` to the configured upstream.
   - `TRAFFIC_CACHE_SECONDS`: optional integer cache TTL; clamped to 15–120 seconds (default 15).
3. Save the settings and redeploy the Pages project so the function receives them.
4. Keep the relay host allowlist narrow. Do not put credentials in `TRAFFIC_PROXY_URL`, client code, or query parameters.

The browser still falls back to a direct `api.adsb.lol` request if the Pages function cannot be reached. Cross-origin policies or provider blocking may make that fallback unavailable; in that case traffic stays disabled silently after the one-time “Live traffic unavailable” notice. Live provider access is not guaranteed by the local unit tests.
