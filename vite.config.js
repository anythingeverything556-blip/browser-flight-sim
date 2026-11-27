import { defineConfig } from 'vite';
import { cp } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

// dev and preview servers answer /api/metar and /api/traffic the way the Cloudflare Pages functions in functions/api/ do in production
const proxy = {
  // worldwide lists map to one upstream path here (the Pages function also merges the three emergency squawks)
  '/api/traffic': { target: 'https://api.adsb.lol', changeOrigin: true, rewrite: (p) => { const q = new URL(p, 'http://x').searchParams; const list = { mil: '/v2/mil', ladd: '/v2/ladd', pia: '/v2/pia', emergency: '/v2/sqk/7700' }[q.get('list')]; return list || `/v2/point/${q.get('lat')}/${q.get('lon')}/${Math.min(250, +q.get('dist') || 54)}`; } },
  '/api/metar': { target: 'https://aviationweather.gov', changeOrigin: true, rewrite: (p) => p.replace('/api/metar', '/api/data/metar') + '&format=json' },
};
// Cache the shared engine and map separately, but let Rollup split the optional
// GLTF/Draco/Meshopt loaders with the aircraft that actually uses them. A single
// node_modules vendor bucket makes every dynamic aircraft import eager again.
const vendor = (id) => {
  if (id.includes('/node_modules/three/') && !id.includes('/examples/')) return 'three';
  if (id.includes('/node_modules/leaflet/')) return 'leaflet';
};
const publicWithoutA380 = () => {
  let config;
  return {
    name: 'public-without-a380',
    apply: 'build',
    configResolved(resolved) { config = resolved; },
    async writeBundle() {
      const source = resolve(config.root, 'public');
      const excluded = resolve(source, 'models/a380x');
      await cp(source, resolve(config.root, config.build.outDir), {
        recursive: true,
        filter: (path) => path !== excluded && !path.startsWith(excluded + sep),
      });
    },
  };
};
export default defineConfig({ server: { proxy }, preview: { proxy }, plugins: [publicWithoutA380()], build: { copyPublicDir: false, chunkSizeWarningLimit: 1100, rollupOptions: { output: { manualChunks: vendor } } } });
