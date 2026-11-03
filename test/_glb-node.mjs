import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { resolveObjectURL } from 'node:buffer';
import { fileURLToPath } from 'node:url';

const PUBLIC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const realFetch = globalThis.fetch, RealRequest = globalThis.Request, HOST = 'http://sr71.local';

// node stand-ins for what the browser gives GLTFLoader + DRACOLoader: fetch of /models and /draco from public/, and Workers that run the decoder blob in a vm
const hostArrays = (g) => { const host = (a) => new globalThis[a.constructor.name](a); for (const a of g.attributes) a.array = host(a.array); if (g.index) g.index.array = host(g.index.array); return false; };

export function installBrowserShims() {
  globalThis.Request = class extends RealRequest { constructor(u, o) { super(typeof u === 'string' && u.startsWith('/') ? HOST + u : u, o); } };
  globalThis.ProgressEvent = globalThis.ProgressEvent || class { constructor(t, o) { this.type = t; Object.assign(this, o); } };
  globalThis.fetch = async (req, init) => {
    const u = typeof req === 'string' ? req : req.url;
    if (!u.startsWith(HOST) && /^https?:|^blob:/.test(u)) return realFetch(req, init);
    const f = path.join(PUBLIC, decodeURIComponent(new URL(u, HOST).pathname).replace(/^\/+/, ''));
    return new Response(fs.readFileSync(f));
  };
  globalThis.Worker = class {
    constructor(url) {
      const location = { href: HOST + '/draco/' }; const self = { location, postMessage: (data) => (data.geometry && hostArrays(data.geometry)) || setTimeout(() => this.onmessage && this.onmessage({ data }), 0) };
      const ctx = { self, location, console, setTimeout, TextDecoder, WebAssembly, Promise, performance, URL, onmessage: null, importScripts() {} };
      ctx.globalThis = ctx;
      resolveObjectURL(url).text().then((src) => { vm.createContext(ctx); vm.runInContext('for (const k of ["Float32Array", "Int8Array", "Int16Array", "Int32Array", "Uint8Array", "Uint16Array", "Uint32Array"]) self[k] = globalThis[k];', ctx); try { vm.runInContext(src, ctx); } catch (e) { console.log('VMERR', e); } this.ready = true; this.q.forEach((m) => ctx.onmessage({ data: m })); this.q = []; this.ctx = ctx; });
      this.q = [];
    }
    postMessage(m) { m = m.type === 'init' ? { ...m, decoderConfig: { ...m.decoderConfig } } : m; if (this.ready) this.ctx.onmessage({ data: m }); else this.q.push(m); }
    terminate() {}
  };
}

export async function loadModel(name = 'SR71_sim') {
  installBrowserShims();
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const { DRACOLoader } = await import('three/examples/jsm/loaders/DRACOLoader.js');
  const draco = new DRACOLoader().setDecoderPath('/draco/'); draco.setDecoderConfig({ type: 'js' });
  const loader = new GLTFLoader().setDRACOLoader(draco);
  // WebP textures (EXT_texture_webp) need a browser image decoder: node gets 1x1 placeholders so materials and UVs still load; the GLTFLoader reads `self.URL` while resolving images
  globalThis.self = globalThis.self || globalThis;
  const { DataTexture } = await import('three');
  loader.register((parser) => ({ name: 'node_texture_stub', beforeRoot() { parser.textureLoader = { load: (u, onLoad) => onLoad(new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)) }; } }));
  try {
    const gltf = await loader.loadAsync(`/models/${name}.glb`);
    const host = (a) => (a.constructor === globalThis[a.constructor.name] ? a : new globalThis[a.constructor.name](a));
    gltf.scene.traverse((o) => { if (!o.isMesh) return; for (const a of Object.values(o.geometry.attributes)) a.array = host(a.array); if (o.geometry.index) o.geometry.index.array = host(o.geometry.index.array); });
    return gltf;
  } finally { draco.dispose(); }
}
