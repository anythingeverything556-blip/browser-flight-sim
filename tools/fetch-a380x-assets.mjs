import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// Run from either ZIP after extraction: node tools/fetch-a380x-assets.mjs
const root = fileURLToPath(new URL('../', import.meta.url));
const dest = resolve(root, 'public/models/a380x');
const manifest = JSON.parse(await readFile(new URL('../notes/A380X-PREVIEW-ASSETS.json', import.meta.url), 'utf8'));
const origin = new URL(manifest.origin);
if (!/^https:$/.test(origin.protocol) || !['.earthwing.pages.dev', '.sr71-blackbird.pages.dev'].some(s=>origin.hostname.endsWith(s)) || origin.pathname !== '/' || origin.username || origin.password || origin.port || origin.search || origin.hash) throw new Error('Invalid preview origin in asset manifest');
const queue = Object.entries(manifest.files);
const total = queue.length;
if (!total) throw new Error('Asset manifest is empty');
let count = 0;
const digest = async (path) => { const h=createHash('sha256'); for await (const b of createReadStream(path)) h.update(b); return h.digest('hex'); };
async function install([name, meta]) {
  if (!name.split('/').every(p=>p && p !== '.' && p !== '..' && /^[a-zA-Z0-9_.@ +()-]+$/.test(p)) || !/^[0-9a-f]{64}$/.test(meta.sha256) || !Number.isSafeInteger(meta.size) || meta.size < 0) throw new Error(`Invalid asset manifest entry: ${name}`);
  const out = resolve(dest, name); const rel=relative(dest,out);
  if (!rel || rel.startsWith('..'+sep) || rel === '..') throw new Error('Unsafe asset path');
  const existing = await stat(out).catch(e=>e.code==='ENOENT'?null:Promise.reject(e));
  if (existing?.isFile() && existing.size===meta.size && await digest(out)===meta.sha256) return;
  const url = new URL('/models/a380x/'+name.split('/').map(encodeURIComponent).join('/'), origin);
  const tmp = `${out}.part-${process.pid}`;
  const h=createHash('sha256');let size=0;
  await mkdir(resolve(out, '..'), {recursive:true});
  try {
    const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(150000)});
    if(!response.ok || !response.body) throw new Error(`${response.status} from ${url}`);
    const sum=new Transform({transform(bytes,_enc,cb){size+=bytes.length;if(size>meta.size)return cb(new Error('Asset larger than manifest'));h.update(bytes);cb(null,bytes);}});
    await pipeline(Readable.fromWeb(response.body),sum,createWriteStream(tmp,{flags:'wx'}));
    if(size!==meta.size || h.digest('hex')!==meta.sha256) throw new Error(`Integrity check failed: ${name}`);
    await rename(tmp,out);
  } finally { await rm(tmp, {force:true}); }
}
const results=await Promise.allSettled(Array.from({length:4},async()=>{
  for(let entry; (entry=queue.shift());) {
    await install(entry);
    if (++count % 20 === 0 || count === total) console.log(`${count}/${total} asset files verified`);
  }
}));
const failed=results.find(r=>r.status==='rejected');
if(failed) throw failed.reason;
console.log(`FlyByWire A380X assets installed to ${dest}.`);
