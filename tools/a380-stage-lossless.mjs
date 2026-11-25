import { readFile, writeFile, copyFile, mkdir, readdir, link, stat } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { build } from 'vite';

// The raw pack stays protected in public/. This preview publishes only exact
// lossless transport payloads, not a second copy of the originals.
if (process.argv.length !== 3) throw new Error('Usage: node tools/a380-stage-lossless.mjs <fully generated gzip pack directory>');
const source=resolve(process.argv[2]), publicDir=resolve('public'), dist=resolve('dist');
const manifestBytes=await readFile(join(source,'transport.json'));
const manifest=JSON.parse(manifestBytes);
if(manifest.version!==1||manifest.codec!=='gzip'||!manifest.entries||Object.keys(manifest.entries).length<400)throw new Error('Expected a complete A380 gzip pack');
for(const [name,entry] of Object.entries(manifest.entries)){
 if(entry.encoding!=='gzip')throw new Error(`Compressed-only preview cannot serve unhosted original: ${name}`);
 const p=resolve(source,entry.url);if(relative(source,p).startsWith('..')||!(await stat(p)).isFile())throw new Error(`Invalid gzip path: ${entry.url}`);
}
const tag=createHash('sha256').update(manifestBytes).digest('hex').slice(0,8), prefix=`gzip-v1-${tag}`;
await build({mode:'a380-lossless',build:{emptyOutDir:true,copyPublicDir:false}});
async function put(from,to,shouldLink){
 await mkdir(resolve(to,'..'),{recursive:true});
 if(!shouldLink){await copyFile(from,to);return;}
 try{await link(from,to);}catch(e){if(e.code!=='EXDEV')throw e;await copyFile(from,to);}
}
async function copyTree(from,to,root,skip,shouldLink){
 for(const e of await readdir(from,{withFileTypes:true})){
  const input=join(from,e.name), output=join(to,e.name), rel=relative(root,input);
  if(skip(rel))continue;
  if(e.isDirectory())await copyTree(input,output,root,skip,shouldLink);
  else if(e.isFile())await put(input,output,shouldLink);
  else throw new Error(`Unexpected non-file asset ${input}`);
 }
}
await copyTree(publicDir,dist,publicDir,p=>p==='models/a380x',false);
const model=join(dist,'models/a380x');
await mkdir(model,{recursive:true});
await copyTree(source,join(model,prefix),source,p=>p==='progress.json',true);
for(const n of ['ATTRIBUTION.md','ASSET-CONTRACT.md','source-fidelity-verification.json'])await copyFile(join(publicDir,'models/a380x',n),join(model,n));
await writeFile(join(model,'lossless-scene.json'),JSON.stringify({
 version:1,exterior:'a380_exterior.native.gltf',cockpit:'a380_cockpit.native.gltf',cabin:'a380_cockpit.native.gltf',
 rotation:[0,Math.PI/2,0],position:[0,3.24,0],transport:`${prefix}/transport.json`,transportRequired:true
},null,2)+'\n');
console.log(`Staged ${Object.keys(manifest.entries).length} exact gzip payloads in ${prefix}; original native pack preserved locally.`);
