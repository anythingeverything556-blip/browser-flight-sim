# Live traffic setup

The 3D traffic requests `GET /api/traffic?lat=…&lon=…&dist=54`; the flight map asks for the area it shows (`dist` up to 250) and for the worldwide lists `GET /api/traffic?list=mil|emergency|ladd|pia` (emergency merges squawks 7700, 7600 and 7500; lists fall back to adsb.fi and complete fresh lists are cached 30 s). The Pages Function defaults to the fixed ADS-B endpoint at `https://api.adsb.lol`; it is not a general-purpose URL proxy. Queries require numeric coordinates, coordinates are clamped to valid ranges, and radius is clamped to 1–250 nautical miles (areas over 100 NM share 1° cells, smaller ones 0.25°). Records are slimmed to the fields the simulator reads. Browser polling caches successful responses for 15–120 seconds and backs off failed 3-D polls exponentially to 300 seconds. Retries cover HTTP 403, 429, 5xx (including 522), and network timeouts; unavailable traffic is reported once per failure streak. Snapshots carry `acquiredAt` (Unix milliseconds), `stale`, and `partial`; clients expire observations after 90 seconds rather than refreshing their age on receipt. See [EW-12–15 reliability contract](ew-12-15-traffic-reliability.md).

## Deploy with the default source

1. Deploy the site to Cloudflare Pages with the `functions/api/traffic.js` function included.
2. No credentials are required for the default adsb.lol endpoint. Requests use a fixed path and a descriptive `User-Agent`.
3. Confirm the deployment can reach `api.adsb.lol`; provider availability and Cloudflare egress acceptance are external dependencies.

## Why the default source fails on Cloudflare

Measured from a Pages Function on 2026-10-13: api.adsb.lol answers 429 (403 without a descriptive User-Agent), opendata.adsb.fi, api.adsb.one and api.airplanes.live return 403 bot-blocks, OpenSky times out, and ADSBexchange wants a purchased key. Cloudflare's shared egress IPs are the problem, not the code, so the fix is a relay on a host that is not on Cloudflare.

## Quick path: `tools/traffic-relay.mjs`

1. On a machine outside Cloudflare (home PC, VPS, Fly.io, Render), run `RELAY_TOKEN=<long random string> RELAY_CONTACT=you@example.com node tools/traffic-relay.mjs` (Node 18+, no install step). Keep `shared/traffic-contract.js` alongside the `tools/` folder when copying the relay. It serves `GET /v2/point/{lat}/{lon}/{radius}` (up to 250 NM), `/v2/mil`, `/v2/ladd`, `/v2/pia`, `/v2/sqk/{7700,7600,7500}`, and `GET /health`. It caches each area/list key for 15 s, tries adsb.lol then adsb.fi within one 3-second budget, backs off 30 s after a 429/403 and retains stale snapshots for up to 15 minutes without renewing their acquisition time. Simulator clients still discard observations older than 90 seconds. All traffic routes require the configured token; health does not.
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

The browser calls only the Pages function; provider fallback happens server-side within one 6.5-second budget, below the clients’ 9-second deadlines. Total worldwide failure returns a non-cacheable 502, not a successful empty picture. Partial emergency categories are explicitly marked and do not replace retained map data. Live provider access is not guaranteed by the local unit tests.
