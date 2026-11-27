import { decompress } from './vendor/fzstd.mjs';
// Transfer buffer ownership in both directions; authored float bytes are unchanged.
self.onmessage=({data})=>{
  try{const decoded=decompress(new Uint8Array(data));self.postMessage({buffer:decoded.buffer,byteOffset:decoded.byteOffset,byteLength:decoded.byteLength},[decoded.buffer]);}
  catch(error){self.postMessage({error:error.message});}
};
