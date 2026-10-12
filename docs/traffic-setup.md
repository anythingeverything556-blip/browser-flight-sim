# Live traffic setup

The app requests `GET /api/traffic?lat=…&lon=…&dist=54`. The Pages Function defaults to the fixed ADS-B endpoint at `https://api.adsb.lol`; it is not a general-purpose URL proxy. Queries require numeric coordinates, coordinates are clamped to valid ranges, and radius is clamped to 1–100 nautical miles. Browser polling caches successful responses for 15–120 seconds and backs off failed polls exponentially to 120 seconds. Retries cover HTTP 403, 429, 5xx (including 522), and network timeouts; unavailable traffic is reported once per session.

## Deploy with the default source

1. Deploy the site to Cloudflare Pages with the `functions/api/traffic.js` function included.
2. No credentials are required for the default adsb.lol endpoint. Requests use a fixed path and a descriptive `User-Agent`.
3. Confirm the deployment can reach `api.adsb.lol`; provider availability and Cloudflare egress acceptance are external dependencies.

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
