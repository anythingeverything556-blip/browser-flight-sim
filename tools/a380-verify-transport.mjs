/** Verify the complete generated pack through the SAME native gzip transport
 * used by the browser, including every DDS mip trait. No renderer or asset edits.
 * node tools/a380-verify-transport.mjs [pack-directory] [source-directory] [report]
 */
import {readFile,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createA380Transport} from '../src/a380xtransport.js';
import {parseA380DDS} from './a380-native-textures.mjs';
const root=path.resolve(process.argv[2]||'../../external-aircraft/transport/a380x-gzip');
const source=path.resolve(process.argv[3]||'public/models/a380x');
const report=process.argv[4]||'.scratch/a380x-sim/lossless-native-verification.json';
const pack=JSON.parse(await readFile(path.join(root,'transport.json')));
const base='https://verify.invalid/models/a380x/',payload='https://verify.invalid/transport/';
const requests=[];
const transport=createA380Transport(pack,base,{payloadBase:payload,fetcher:async url=>{
  requests.push(String(url));const compressed=String(url).startsWith(payload);
  const file=path.join(compressed?root:source,decodeURIComponent(String(url).slice((compressed?payload:base).length)));
  return new Response(Readable.toWeb(createReadStream(file)));
}});
assert.ok(transport.enabled,'native DecompressionStream and WebCrypto are required for this verification');
const totals={files:0,dds:0,ddsMips:0,json:0,bin:0,decodedBytes:0,sourceSHA256Matches:0,compressedRequests:0,originalRequests:0};
for(const [name,entry]of Object.entries(pack.entries)){
  const response=await transport.fetch(base+name),buffer=await response.arrayBuffer();
  assert.equal(buffer.byteLength,entry.byteLength);
  // Independent source stream hash confirms preserved originals still match.
  const hash=createHash('sha256');for await(const chunk of createReadStream(path.join(source,name)))hash.update(chunk);
  assert.equal(hash.digest('hex'),entry.sha256,name);totals.sourceSHA256Matches++;
  if(/\.dds$/i.test(name)){
    const p=parseA380DDS(buffer),d=entry.dds;assert.equal(p.width,d.width);assert.equal(p.height,d.height);assert.equal(p.mipmaps.length,d.mips.length);
    for(let i=0;i<p.mipmaps.length;i++){const m=p.mipmaps[i],original=d.mips[i];assert.deepEqual({width:m.width,height:m.height,offset:m.data.byteOffset,byteLength:m.data.byteLength},original);}
    totals.dds++;totals.ddsMips+=p.mipmaps.length;
  }else if(/\.(gltf|json)$/i.test(name)){JSON.parse(new TextDecoder().decode(buffer));totals.json++;}else totals.bin++;
  totals.files++;totals.decodedBytes+=buffer.byteLength;
}
totals.compressedRequests=requests.filter(u=>u.startsWith(payload)).length;totals.originalRequests=requests.length-totals.compressedRequests;
assert.equal(totals.files,pack.totals.files);assert.equal(totals.decodedBytes,pack.totals.originalBytes);assert.equal(totals.dds,377);assert.equal(totals.originalRequests,pack.totals.identityFiles);
const result={status:'pass',decoder:'native DecompressionStream(gzip), same src/a380xtransport.js as player',integrity:'decoded length and SHA-256 checked by runtime, independent unchanged-source SHA-256',...totals};
await writeFile(report,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
