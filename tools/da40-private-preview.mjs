// Private localhost preview. Node 20+; no dependency installation required.
import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import {dirname, extname, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url));
const root=resolve(process.argv[2]||resolve(here,'dist'));
const port=Number(process.argv[3]||4184);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Use a local port between 1024 and 65535.');
const mime={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.svg':'image/svg+xml','.woff2':'font/woff2','.wasm':'application/wasm','.glb':'model/gltf-binary','.wav':'audio/wav','.ogg':'audio/ogg','.mp3':'audio/mpeg','.txt':'text/plain; charset=utf-8','.md':'text/plain; charset=utf-8'};
await stat(resolve(root,'models/da40/da40-ng.glb'));
const server=createServer(async(req,res)=>{
 try {
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end();}
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/api/traffic'||url.pathname==='/api/metar'){
   res.setHeader('content-type','application/json');
   return res.end(url.pathname.endsWith('traffic')?'{"ac":[]}':'[]');
  }
  let file=resolve(root,'.'+decodeURIComponent(url.pathname));
  if(file!==root&&!file.startsWith(root+sep)){res.writeHead(403);return res.end('Forbidden');}
  if(file===root)file=resolve(root,'index.html');
  const info=await stat(file);
  if(!info.isFile()){res.writeHead(404);return res.end('Not found');}
  res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream','content-length':info.size,'x-content-type-options':'nosniff'});
  if(req.method==='HEAD')return res.end();
  const stream=createReadStream(file);stream.on('error',()=>res.destroy());stream.pipe(res);
 }catch{if(!res.headersSent)res.writeHead(404);if(!res.writableEnded)res.end('Not found');}
});
server.listen(port,'127.0.0.1',()=>console.log(`DA40 private preview: http://127.0.0.1:${port}/?aircraft=da40`));
