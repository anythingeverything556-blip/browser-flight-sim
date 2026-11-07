import { defineConfig } from 'vite';

// dev and preview servers answer /api/metar and /api/traffic the way the Cloudflare Pages functions in functions/api/ do in production
const proxy = {
  // worldwide lists map to one upstream path here (the Pages function also merges the three emergency squawks)
  '/api/traffic': { target: 'https://api.adsb.lol', changeOrigin: true, rewrite: (p) => { const q = new URL(p, 'http://x').searchParams; const list = { mil: '/v2/mil', ladd: '/v2/ladd', pia: '/v2/pia', emergency: '/v2/sqk/7700' }[q.get('list')]; return list || `/v2/point/${q.get('lat')}/${q.get('lon')}/${Math.min(250, +q.get('dist') || 54)}`; } },
  '/api/metar': { target: 'https://aviationweather.gov', changeOrigin: true, rewrite: (p) => p.replace('/api/metar', '/api/data/metar') + '&format=json' },
};
// three, leaflet and the tile decoders change far less often than the game code, so they ship as their own long-cached chunk.
// Both chunks are needed at boot (three alone is ~1 MB minified), so the warning limit sits just above them rather than at Vite's 500 kB.
const vendor = (id) => (id.includes('node_modules') ? 'vendor' : undefined);
export default defineConfig({ server: { proxy }, preview: { proxy }, build: { chunkSizeWarningLimit: 1100, rollupOptions: { output: { manualChunks: vendor } } } });
