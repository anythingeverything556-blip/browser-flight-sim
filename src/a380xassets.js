// Standard glTF remains standard: only oversized binary files are reassembled before parsing.
// Optional descriptor.buffers[uri] = {parts:['part-000.bin',...], byteLength:N}.
export async function readAsset(url, kind = 'json', fetcher = fetch) {
  const r = await fetcher(url);
  if (!r.ok) throw new Error(`A380X asset unavailable (${r.status}): ${new URL(url, 'https://local.invalid').pathname}`);
  return kind === 'json' ? r.json() : r.arrayBuffer();
}
export async function joinBufferParts(spec, base, { fetcher = fetch, progress = () => {} } = {}) {
  const parts = Array.isArray(spec) ? spec : spec.parts;
  if (!parts?.length) throw new Error('A380X binary has no parts');
  // Sequential fetch limits peak memory (source binaries can exceed several hundred MB).
  const output = Number.isSafeInteger(spec.byteLength) && spec.byteLength >= 0 ? new Uint8Array(spec.byteLength) : null;
  const chunks = output ? null : [];
  let length = 0;
  for (let i = 0; i < parts.length; i++) {
    const value = typeof parts[i] === 'string' ? parts[i] : parts[i].url;
    const chunk = new Uint8Array(await readAsset(new URL(value, base).href, 'buffer', fetcher));
    if (parts[i].byteLength !== undefined && chunk.byteLength !== parts[i].byteLength) throw new Error('A380X binary part length mismatch');
    if (output) {
      if (length + chunk.byteLength > output.byteLength) throw new Error('A380X binary length mismatch');
      output.set(chunk, length);
    } else chunks.push(chunk);
    length += chunk.byteLength; progress((i + 1) / parts.length);
  }
  if (spec.byteLength !== undefined && length !== spec.byteLength) throw new Error(`A380X binary length mismatch: ${length} / ${spec.byteLength}`);
  if (output) return output.buffer;
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes.buffer;
}
export async function prepareGltf(url, descriptor = {}, { fetcher = fetch, progress = () => {} } = {}) {
  const json = await readAsset(url, 'json', fetcher), base = new URL('.', url).href, blobs = [];
  try {
    const buffers = json.buffers || [];
    for (let i = 0; i < buffers.length; i++) {
      const b = buffers[i], spec = descriptor.buffers?.[b.uri] || b.extras?.segments;
      if (!spec) continue;
      const bytes = await joinBufferParts(Array.isArray(spec) ? { parts: spec, byteLength: b.byteLength } : { byteLength: b.byteLength, ...spec }, base, { fetcher, progress });
      const blob = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' })); blobs.push(blob); b.uri = blob;
    }
    return { json, base, dispose: () => blobs.forEach(u => URL.revokeObjectURL(u)) };
  } catch (error) { blobs.forEach(u => URL.revokeObjectURL(u)); throw error; }
}
