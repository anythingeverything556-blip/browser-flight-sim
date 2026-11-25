import { FileLoader } from 'three';

// A transport, NOT a texture/geometry codec. Decoded bytes are verified before
// any parser sees them. No global fetch/FileLoader patches or decoded-byte cache.
export function supportsA380Gzip(Decompressor = globalThis.DecompressionStream) {
  try { new Decompressor('gzip'); return true; } catch { return false; }
}
async function checkedBytes(stream, expected, label) {
  if (!Number.isSafeInteger(expected) || expected < 0) throw new Error('Invalid A380 transport byte length');
  const out = new Uint8Array(expected), reader = stream.getReader(); let offset = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read(); if (done) break;
      if (offset + value.byteLength > expected) throw new Error(`A380 transport length mismatch: ${label}`);
      out.set(value, offset); offset += value.byteLength;
    }
    if (offset !== expected) throw new Error(`A380 transport length mismatch: ${label}`);
    return out;
  } catch (error) { await reader.cancel(error).catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
}
async function verify(bytes, expected, label) {
  const hash = [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
  if (hash !== expected) throw new Error(`A380 transport SHA-256 mismatch: ${label}`);
}
export function createA380Transport(pack, base, {
  fetcher = globalThis.fetch.bind(globalThis), payloadBase = base, Decompressor = globalThis.DecompressionStream, maxConcurrent = 2,
} = {}) {
  if (pack.version !== 1 || pack.codec !== 'gzip' || !pack.entries) throw new Error('Unsupported A380 transport manifest');
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) throw new Error('Invalid A380 transport concurrency');
  // Do not fetch compressed payloads at all if there is no native decoder or
  // secure-context integrity API. Originals are the backwards-compatible path.
  const enabled = supportsA380Gzip(Decompressor) && !!globalThis.crypto?.subtle;
  const entries = new Map(Object.entries(pack.entries).map(([url, entry]) => [new URL(url, base).href, entry]));
  let active = 0; const waiters = [];
  async function acquire() { if (active >= maxConcurrent) await new Promise(resolve => waiters.push(resolve)); else active++; }
  function release() { if (waiters.length) waiters.shift()(); else active--; }
  return {
    enabled, pack,
    async fetch(url, init) {
      const original = new URL(typeof url === 'string' ? url : url.url, base).href;
      const entry = enabled && entries.get(original);
      if (!entry || entry.encoding === 'identity') return fetcher(url, init);
      await acquire();
      try {
        const response = await fetcher(new URL(entry.url, payloadBase).href, init);
        if (!response.ok) return response; // No second request to a potentially stale original.
        // Gzip is stored as application/octet-stream, without Content-Encoding.
        // Some hosts set Content-Encoding anyway, and fetch auto-decodes it.
        // Read the first chunk to distinguish these paths without buffering gzip.
        const source = (response.body || new Blob([await response.arrayBuffer()]).stream()).getReader();
        let first; const prefix = []; let prefixLength = 0;
        try {
          do { first = await source.read(); if (!first.done) { prefix.push(first.value); prefixLength += first.value.byteLength; } } while (!first.done && prefixLength < 2);
        } catch (error) { source.releaseLock(); throw error; }
        const head = new Uint8Array(prefixLength); let headOffset = 0;
        for (const chunk of prefix) { head.set(chunk, headOffset); headOffset += chunk.byteLength; }
        const ended = first.done;
        if (ended) source.releaseLock();
        const stream = new ReadableStream({
          start(controller) { if (head.byteLength) controller.enqueue(head); if (ended) controller.close(); },
          async pull(controller) { const next = await source.read(); if (next.done) { source.releaseLock(); controller.close(); } else controller.enqueue(next.value); },
          cancel(reason) { return source.cancel(reason); },
        });
        // Compressed gzip headers always start 1f 8b. An auto-decoded response
        // is accepted only with an HTTP content-encoding and a matching SHA.
        const gzip = head[0] === 0x1f && head[1] === 0x8b;
        if (!gzip && !/\bgzip\b/i.test(response.headers.get('content-encoding') || '')) {
          await stream.cancel(); throw new Error('A380 transport missing gzip header');
        }
        const decoded = gzip ? stream.pipeThrough(new Decompressor('gzip')) : stream;
        const bytes = await checkedBytes(decoded, entry.byteLength, original);
        await verify(bytes, entry.sha256, original);
        return new Response(bytes, {status: 200, headers: {'Content-Type': /\.(?:gltf|json)$/i.test(original) ? 'application/json' : 'application/octet-stream', 'Content-Length': String(bytes.byteLength)}});
      } finally { release(); }
    },
  };
}

export async function loadA380Transport(url, sourceBase, options = {}) {
  const response = await (options.fetcher || globalThis.fetch)(url);
  if (!response.ok) throw new Error(`A380 transport manifest unavailable (${response.status})`);
  const pack = await response.json();
  return createA380Transport(pack, sourceBase, {...options, payloadBase: new URL('.', url).href});
}

// Three's glTF parser creates a FileLoader internally. Replace only that local
// instance through the documented register hook; DDS uses the same factory.
export class A380TransportFileLoader extends FileLoader {
  constructor(manager, transport) { super(manager); this.transport = transport; }
  load(url, onLoad, onProgress, onError) {
    url = this.manager.resolveURL((this.path || '') + url);
    this.manager.itemStart(url);
    this.transport.fetch(url, {headers: this.requestHeader, credentials: this.withCredentials ? 'include' : 'same-origin'})
      .then(async response => {
        if (!response.ok) throw new Error(`A380X asset unavailable (${response.status}): ${url}`);
        let value;
        switch (this.responseType) {
          case 'arraybuffer': value = await response.arrayBuffer(); break;
          case 'json': value = await response.json(); break;
          case 'blob': value = await response.blob(); break;
          default: value = await response.text();
        }
        onProgress?.({loaded: Number(response.headers.get('content-length')) || 0, total: Number(response.headers.get('content-length')) || 0, lengthComputable: response.headers.has('content-length')});
        onLoad?.(value);
      }).catch(error => { onError?.(error); this.manager.itemError(url); })
      .finally(() => this.manager.itemEnd(url));
  }
}
export function createA380FileLoader(manager) {
  return manager?.a380Transport ? new A380TransportFileLoader(manager, manager.a380Transport) : new FileLoader(manager);
}
export function configureA380TransportLoader(loader, transport = loader.manager?.a380Transport) {
  if (!transport) return loader;
  loader.register(parser => {
    const previous = parser.fileLoader;
    parser.fileLoader = new A380TransportFileLoader(loader.manager, transport).setResponseType('arraybuffer')
      .setRequestHeader(previous.requestHeader).setWithCredentials(previous.withCredentials);
    return {name: 'A380_lossless_transport'};
  });
  return loader;
}
