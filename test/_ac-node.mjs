import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installBrowserShims } from './_glb-node.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// A canvas stand-in good enough for CanvasTexture / procedural textures (nothing is rasterised)
const ctx2d = () => new Proxy(function () {}, { get: (t, k) => (k === 'canvas' ? undefined : k === 'measureText' ? () => ({ width: 10 }) : k === 'createLinearGradient' || k === 'createRadialGradient' || k === 'createPattern' ? () => ({ addColorStop() {} }) : k === 'getImageData' || k === 'createImageData' ? (w, h) => ({ data: new Uint8ClampedArray(4 * (w || 1) * (h || 1)), width: w, height: h }) : ctx2d()), set: () => true, apply: () => ctx2d() });
const fakeCanvas = () => { const c = { width: 300, height: 150, style: {}, getContext: (t) => (t === '2d' ? ctx2d() : null), addEventListener() {}, removeEventListener() {}, toDataURL: () => '', toBlob() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 150 }) }; return c; };

export function installDomShims() {
  installBrowserShims();
  const el = (tag) => (tag === 'canvas' ? fakeCanvas() : { style: {}, appendChild() {}, setAttribute() {}, addEventListener() {}, getContext: () => ctx2d(), classList: { add() {}, remove() {}, toggle() {} } });
  globalThis.document = { createElement: el, createElementNS: (ns, t) => el(t), body: { appendChild() {} }, addEventListener() {}, getElementById: () => null, querySelector: () => null };
  globalThis.window = globalThis; globalThis.self = globalThis;
  globalThis.devicePixelRatio = 1; globalThis.innerWidth = 1920; globalThis.innerHeight = 1080;
  globalThis.requestIdleCallback = (fn) => setTimeout(() => fn({ timeRemaining: () => 50, didTimeout: false }), 0);
  globalThis.cancelIdleCallback = clearTimeout;
  globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 0);
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.ImageBitmap = class {};
}

// loads the game's own AircraftVisual (vite SSR, so import.meta.env works) against the real GLBs
export async function createViteSsr() {
  installDomShims();
  const { createServer } = await import('vite');
  const vite = await createServer({ root: ROOT, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } });
  return { vite, load: (p) => vite.ssrLoadModule(p) };
}
