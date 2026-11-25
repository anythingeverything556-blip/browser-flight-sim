// Shared only by the deliberately separate embed function. No query-controlled policy.
export const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "accelerometer=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), fullscreen=(self), gamepad=(self)",
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: server.arcgisonline.com services.arcgisonline.com tiles.arcgis.com; connect-src 'self' blob: cloudflareinsights.com server.arcgisonline.com services.arcgisonline.com ags.cuzk.cz cyberjapandata.gsi.go.jp data.geopf.fr geo.api.vlaanderen.be geo4.service24.rlp.de geoservices.bayern.de geoservices.buergernetz.bz.it maps.six.nsw.gov.au mapsneu.wien.gv.at mapy.geoportal.gov.pl service.pdok.nl tiles.maaamet.ee wmts.geo.admin.ch wmts.geoportail.lu www.ign.es data.grandlyon.com public.sig.rennesmetropole.fr raster.sitg.ge.ch wms.geo.bs.ch geoportal.stadt-koeln.de geodaten.metropoleruhr.de www.wms.nrw.de gdi.berlin.de geodienste.hamburg.de dienste.gdi-sh.de owsproxy.lgl-bw.de www.gds-srv.hessen.de geoportal.saarland.de geoservices-grid.irisnet.be geoservices.wallonie.be tiles.arcgis.com vogis.cnv.at servpub.madrid.es geoserveis.icgc.cat cartografia.dgterritorio.gov.pt opengeodata.goteborg.se sitmappe.comune.bologna.it kygisserver.ky.gov maps2.dcgis.dc.gov imagery.pasda.psu.edu cteco.uconn.edu serviciosgis.catastrobogota.gov.co ws.geoservices.lrc.gov.on.ca servicesmatriciels.mern.gouv.qc.ca mapas.ide.uy services.thelist.tas.gov.au spatial-img.information.qld.gov.au wayback.maptiles.arcgis.com tiles.openfreemap.org stac.overturemaps.org overturemaps-extras-us-west-2.s3.amazonaws.com elevation-tiles-prod.s3.amazonaws.com s3.amazonaws.com api.open-meteo.com; worker-src 'self' blob:; font-src 'self' data:; media-src 'self' blob: data:; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
};
export function allowedOrigins(raw) {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list) || !list.length || list.length > 10) return [];
    if (!list.every(origin => { if (typeof origin !== 'string' || /[\s*]/.test(origin)) return false; const u = new URL(origin); return /^[a-z\d.-]+$|^\[[a-f\d:]+\]$/i.test(u.hostname) && u.protocol === 'https:' && u.origin === origin && !u.username && !u.password; })) return [];
    return [...new Set(list)];
  } catch { return []; }
}
export async function embedResponse({ request, env }) {
  const headers = new Headers(SECURITY_HEADERS);
  headers.set('Cache-Control', 'no-store');
  const origins = allowedOrigins(env.EARTHWING_EMBED_ORIGINS);
  const url = new URL(request.url);
  if (url.pathname !== '/embed/' || !origins.length) return new Response('Embedding is not enabled for this path.', { status: 403, headers });
  const target = new URL('/', url); target.search = url.search;
  const asset = await env.ASSETS.fetch(new Request(target, request));
  const merged = new Headers(asset.headers);
  for (const [key, value] of headers) merged.set(key, value);
  // XFO has no supported exact-origin allowlist. Only this opt-in path omits it;
  // CSP still enforces the full ancestor chain against exact HTTPS origins.
  merged.delete('X-Frame-Options');
  merged.set('Content-Security-Policy', SECURITY_HEADERS['Content-Security-Policy'].replace("frame-ancestors 'none'", 'frame-ancestors ' + origins.join(' ')));
  return new Response(asset.body, { status: asset.status, headers: merged });
}
