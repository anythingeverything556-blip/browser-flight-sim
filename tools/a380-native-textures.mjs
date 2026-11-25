/**
 * Original FlyByWire A380 DDS texture adapter for Three r180.
 * No texture blocks modified/re-encoded, all original mip levels preserved.
 * Requires WebGL EXT_texture_compression_bptc, EXT_texture_compression_rgtc,
 * S3TC is optional; DXT1/DXT5 expand to RGBA at the original mip sizes when needed.
 * Use new GLTFLoader(configureA380TextureManager(renderer)).loadAsync(url).
 * Then applyA380NativeMaterials(gltf.scene) BEFORE first render.
 */
import { createA380FileLoader } from '../src/a380xtransport.js';
import {CompressedTexture,DataTexture,LoadingManager,RGBA_BPTC_Format,
 SIGNED_RED_GREEN_RGTC2_Format,RGB_S3TC_DXT1_Format,RGBA_S3TC_DXT1_Format,
 RGBA_S3TC_DXT5_Format,UnsignedByteType,LinearFilter,LinearMipmapLinearFilter,RepeatWrapping} from 'three';
export function parseA380DDS(buffer){
 const d=new DataView(buffer);if(d.getUint32(0,true)!==0x20534444||d.getUint32(4,true)!==124)throw Error('Invalid DDS header');
 const height=d.getUint32(12,true),width=d.getUint32(16,true),count=Math.max(1,d.getUint32(28,true));
 const four=String.fromCharCode(...new Uint8Array(buffer,84,4));let offset=128,format,blockBytes=16,signed=false,required;
 if(four==='DX10'){
  const dxgi=d.getUint32(128,true);offset=148;
  if(dxgi!==98&&dxgi!==99)throw Error('Unsupported original DDS DXGI format '+dxgi);
  format=RGBA_BPTC_Format;required='EXT_texture_compression_bptc';
 }else if(four==='BC5S'){
  format=SIGNED_RED_GREEN_RGTC2_Format;signed=true;required='EXT_texture_compression_rgtc';
 }else if(four==='DXT1'){
  format=RGBA_S3TC_DXT1_Format;blockBytes=8;required='WEBGL_compressed_texture_s3tc';
 }else if(four==='DXT5'){
  format=RGBA_S3TC_DXT5_Format;required='WEBGL_compressed_texture_s3tc';
 }else throw Error('Unsupported original DDS FourCC '+four);
 const mipmaps=[];let w=width,h=height;
 for(let i=0;i<count;i++){
  const size=Math.max(1,Math.ceil(w/4))*Math.max(1,Math.ceil(h/4))*blockBytes;
  if(offset+size>buffer.byteLength)throw Error('Truncated DDS mip '+i);
  mipmaps.push({data:new Uint8Array(buffer,offset,size),width:w,height:h});offset+=size;w=Math.max(1,w>>1);h=Math.max(1,h>>1);
 }
 if(offset!==buffer.byteLength)throw Error('Unexpected DDS trailing data: '+(buffer.byteLength-offset));
 return {mipmaps,width,height,format,signed,required,bytes:offset};
}
// CPU path for WebGL2 drivers without S3TC (e.g. SwiftShader). Decode the
// original BC1/BC3 blocks directly, including every mip and transparency bit.
export function decodeA380DXT(mip, bc3) {
 const {data,width,height}=mip, rgba=new Uint8Array(width*height*4), n=bc3?16:8;
 const color=new Uint8Array(16), alpha=new Uint8Array(8);
 const fill=(i,c)=>{const r=c>>11,g=(c>>5)&63,b=c&31;color[i]=(r<<3)|(r>>2);color[i+1]=(g<<2)|(g>>4);color[i+2]=(b<<3)|(b>>2);color[i+3]=255;};
 for(let y=0,o=0;y<height;y+=4)for(let x=0;x<width;x+=4,o+=n){
  const i=o+(bc3?8:0), a=data[i]|(data[i+1]<<8), b=data[i+2]|(data[i+3]<<8);fill(0,a);fill(4,b);
  const four=bc3||a>b;
  for(let c=0;c<3;c++){color[8+c]=four?(2*color[c]+color[4+c])/3:(color[c]+color[4+c])/2;color[12+c]=four?(color[c]+2*color[4+c])/3:0;}
  color[11]=255;color[15]=four?255:0;
  if(bc3){alpha[0]=data[o];alpha[1]=data[o+1];const hi=alpha[0]>alpha[1], d=hi?7:5;for(let k=1;k<d;k++)alpha[k+1]=((d-k)*alpha[0]+k*alpha[1])/d;if(!hi){alpha[6]=0;alpha[7]=255;}}
  for(let yy=0;yy<4&&y+yy<height;yy++)for(let xx=0;xx<4&&x+xx<width;xx++){
   const sel=((data[i+4+yy]>>(2*xx))&3)*4, p=((y+yy)*width+x+xx)*4, bit=(yy*4+xx)*3,
      ai=(((data[o+2+(bit>>3)]|(data[o+3+(bit>>3)]<<8))>>(bit&7))&7);
   rgba[p]=color[sel];rgba[p+1]=color[sel+1];rgba[p+2]=color[sel+2];rgba[p+3]=bc3?alpha[ai]:color[sel+3];
  }
 }
 return {data:rgba,width,height};
}
export class A380DDSLoader{
 constructor(manager,renderer){this.manager=manager;this.renderer=renderer;}
 setCrossOrigin(){return this;}setRequestHeader(v){this.requestHeader=v;return this;}setWithCredentials(v){this.withCredentials=v;return this;}
 load(url,onLoad,onProgress,onError){
  const placeholder=new CompressedTexture();const file=createA380FileLoader(this.manager).setResponseType('arraybuffer');
  if(this.requestHeader)file.setRequestHeader(this.requestHeader);if(this.withCredentials)file.setWithCredentials(true);
  file.load(url,buffer=>{
   try{
    const p=parseA380DDS(buffer);
    const unsupported=this.renderer&&!this.renderer.extensions.has(p.required);
    const decode=unsupported&&p.required==='WEBGL_compressed_texture_s3tc';
    if(unsupported&&!decode)throw Error('Full original A380 textures require '+p.required+'. Select a desktop GPU with BC compression support.');
    const texture=decode?new DataTexture():placeholder;
    const mips=decode?p.mipmaps.map(m=>decodeA380DXT(m,p.format===RGBA_S3TC_DXT5_Format)):p.mipmaps;
    texture.image=decode?mips[0]:{width:p.width,height:p.height};texture.mipmaps=mips;
    if(!decode)texture.format=p.format;texture.type=UnsignedByteType;
    texture.minFilter=p.mipmaps.length>1?LinearMipmapLinearFilter:LinearFilter;texture.magFilter=LinearFilter;
    texture.wrapS=texture.wrapT=RepeatWrapping;texture.generateMipmaps=false;texture.flipY=false;texture.needsUpdate=true;
    texture.userData.a380BC5Signed=p.signed;texture.userData.a380SourceBytes=buffer.byteLength;
    onLoad?.(texture);
   }catch(e){onError?.(e);}
  },onProgress,onError);return placeholder;
 }
}
export function configureA380TextureManager(renderer,manager=new LoadingManager(),{transport}={}){
 if(transport)manager.a380Transport=transport;
 if(renderer)for(const e of ['EXT_texture_compression_bptc','EXT_texture_compression_rgtc'])if(!renderer.extensions.has(e))throw Error('Original full-resolution A380 requires '+e+'; use a desktop GPU with BC texture compression.');
 manager.addHandler(/\.dds$/i,new A380DDSLoader(manager,renderer));return manager;
}
export function applyA380NativeMaterials(root){
 const seen=new Set();
 root.traverse(o=>{
  if(!o.isMesh)return;
  const mats=Array.isArray(o.material)?o.material:[o.material];
  for(const m of mats){
   if(seen.has(m))continue;seen.add(m);
   for(const key of ['map','normalMap','metalnessMap','roughnessMap','aoMap','emissiveMap'])if(m[key]?.isCompressedTexture&&m[key].mipmaps.length===1)m[key].minFilter=LinearFilter;
   if(m.normalMap?.format===SIGNED_RED_GREEN_RGTC2_Format){
    // Signed BC5 samples are already [-1,1]. MSFS DirectX normal green is inverted.
    // BC5 stores XY only: recover the same positive Z the simulator reconstructs.
    m.onBeforeCompile=shader=>{
     shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`
#ifdef USE_NORMALMAP_TANGENTSPACE
 vec2 a380xy=texture2D(normalMap,vNormalMapUv).xy;
 a380xy.y=-a380xy.y;
 vec3 mapN=vec3(a380xy,sqrt(max(0.0,1.0-dot(a380xy,a380xy))));
 mapN.xy*=normalScale;
 normal=normalize(tbn*mapN);
#endif
`);
    };
    m.customProgramCacheKey=()=> 'a380-native-bc5-signed-normal-v1';m.needsUpdate=true;
   }
  }
 });
 return root;
}
