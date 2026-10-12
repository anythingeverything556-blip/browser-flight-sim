import { defineConfig } from 'vite';

// dev and preview servers answer /api/metar and /api/traffic the way the Cloudflare Pages functions in functions/api/ do in production
const proxy = {
  '/api/traffic': { target: 'https://api.adsb.lol', changeOrigin: true, rewrite: (p) => { const q = new URL(p, 'http://x').searchParams; return `/v2/point/${q.get('lat')}/${q.get('lon')}/${q.get('dist')}`; } },
  '/api/metar': { target: 'https://aviationweather.gov', changeOrigin: true, rewrite: (p) => p.replace('/api/metar', '/api/data/metar') + '&format=json' },
};
export default defineConfig({ server: { proxy }, preview: { proxy } });
