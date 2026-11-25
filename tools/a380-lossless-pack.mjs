/** Byte-exact per-file gzip transport builder. Never rewrites source/public assets.
 * node tools/a380-lossless-pack.mjs [source-directory] [outside-public-output]
 * Sequential streaming: one source, one gzip, one verification at a time.
 */
import {createReadStream, createWriteStream} from 'node:fs';
import {mkdir, readdir, stat, open, rename, unlink, writeFile, realpath} from 'node:fs/promises';
import path from 'node:path';
import {createGzip, createGunzip} from 'node:zlib';
import {createHash} from 'node:crypto';
import {Transform, Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';

class HashStream extends Transform {
  constructor(){super();this.hash=createHash('sha256');this.bytes=0;}
  _transform(chunk, encoding, callback){this.bytes+=chunk.length;this.hash.update(chunk);callback(null,chunk);}
  digest(){return this.hash.digest('hex');}
}
async function filesIn(root, relative='') {
  const names=[];
  for(const entry of await readdir(path.join(root,relative),{withFileTypes:true})) {
    const file=path.posix.join(relative,entry.name);
    if(entry.isDirectory()) names.push(...await filesIn(root,file));
    else if(entry.isFile()&&/\.(dds|bin|gltf|json)$/i.test(file)) names.push(file);
  }
  return names.sort();
}
async function ddsTraits(file, size) {
  const handle=await open(file); const bytes=Buffer.alloc(148);
  try {await handle.read(bytes,0,bytes.length,0);} finally {await handle.close();}
  if(bytes.readUInt32LE(0)!==0x20534444||bytes.readUInt32LE(4)!==124)throw new Error('Invalid DDS '+file);
  const fourCC=bytes.toString('ascii',84,88), width=bytes.readUInt32LE(16),height=bytes.readUInt32LE(12),count=Math.max(1,bytes.readUInt32LE(28));
  const dxgiFormat=fourCC==='DX10'?bytes.readUInt32LE(128):null;
  if(!['DX10','BC5S','DXT1','DXT5'].includes(fourCC)||fourCC==='DX10'&&![98,99].includes(dxgiFormat))throw new Error('Unsupported DDS '+file);
  const mips=[];let w=width,h=height,offset=fourCC==='DX10'?148:128;
  for(let i=0;i<count;i++){const byteLength=Math.max(1,Math.ceil(w/4))*Math.max(1,Math.ceil(h/4))*(fourCC==='DXT1'?8:16);mips.push({width:w,height:h,offset,byteLength});offset+=byteLength;w=Math.max(1,w>>1);h=Math.max(1,h>>1);}
  if(offset!==size)throw new Error('DDS mip length mismatch '+file);
  return {width,height,fourCC,dxgiFormat,mips};
}
export async function buildA380LosslessPack(source, output, {level=6, log=console.log}={}) {
  source=await realpath(source);output=path.resolve(output);
  const publicRoot=path.resolve('public');
  if(output===source||output.startsWith(source+path.sep)||output===publicRoot||output.startsWith(publicRoot+path.sep))throw new Error('Transport output must be outside public/source');
  await mkdir(output,{recursive:true});
  const pack={version:1,codec:'gzip',compressionLevel:level,integrity:'SHA-256 decoded bytes + gzip CRC32',entries:{},totals:{files:0,gzipFiles:0,identityFiles:0,ddsFiles:0,originalBytes:0,transferBytes:0,verifiedBytes:0}};
  const names=await filesIn(source);
  for(const name of names) {
    const input=path.join(source,name),destination=path.join(output,name+'.gz'),temporary=destination+'.partial';
    const size=(await stat(input)).size;await mkdir(path.dirname(destination),{recursive:true});
    const raw=new HashStream(), compressed=new HashStream();
    await pipeline(createReadStream(input),raw,createGzip({level}),compressed,createWriteStream(temporary));
    const sha256=raw.digest(),compressedSha256=compressed.digest();
    const decoded=new HashStream();
    await pipeline(createReadStream(temporary),createGunzip(),decoded,new Writable({write(chunk,encoding,callback){callback();}}));
    if(decoded.bytes!==size||decoded.digest()!==sha256)throw new Error('Byte-exact verification failed '+name);
    const profitable=compressed.bytes<size;
    const entry={url:profitable?name+'.gz':name,encoding:profitable?'gzip':'identity',byteLength:size,sha256,transferBytes:profitable?compressed.bytes:size};
    if(profitable){entry.compressedSha256=compressedSha256;await rename(temporary,destination);}else await unlink(temporary);
    if(/\.dds$/i.test(name)){entry.dds=await ddsTraits(input,size);pack.totals.ddsFiles++;}
    pack.entries[name]=entry;const t=pack.totals;t.files++;t[profitable?'gzipFiles':'identityFiles']++;t.originalBytes+=size;t.transferBytes+=entry.transferBytes;t.verifiedBytes+=decoded.bytes;
    if(t.files%10===0||t.files===names.length){log(`${t.files}/${names.length}: ${t.originalBytes} original / ${t.transferBytes} transfer bytes`);await writeFile(path.join(output,'progress.json'),JSON.stringify(t,null,2)+'\n');}
  }
  pack.totals.savedBytes=pack.totals.originalBytes-pack.totals.transferBytes;
  pack.totals.savingsPercent=100*pack.totals.savedBytes/pack.totals.originalBytes;
  // manifest size reported separately: no circular totals or false ratio.
  await writeFile(path.join(output,'transport.json'),JSON.stringify(pack,null,2)+'\n');
  log(JSON.stringify({...pack.totals,manifestBytes:(await stat(path.join(output,'transport.json'))).size}));
  return pack;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  await buildA380LosslessPack(process.argv[2]||'public/models/a380x',process.argv[3]||'../../external-aircraft/transport/a380x-gzip');
}
