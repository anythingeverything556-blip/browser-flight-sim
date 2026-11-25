#!/usr/bin/env python3
"""Lossless geometry repack of original FBW compiled A380 glTF + full-res DDS->PNG.
Dependencies: numpy, Pillow (tested 2.4.6 / 13.0.0).
No simplification, resize, texture-quality setting or lossy codec is used.
Original UV and static-color SHORT/USHORT payloads are IEEE-754 half floats.
Reference format investigation: https://github.com/kohula/msfs2xp (MIT);
implementation below is independent and does not use its scenery exporter.
Usage: python3 tools/a380-convert.py extracted-source public/models/a380x [--png]
"""
import pathlib,sys,json,hashlib,copy,struct,concurrent.futures
import numpy as np
from PIL import Image
ROOT=pathlib.Path(sys.argv[1]); OUT=pathlib.Path(sys.argv[2]);OUT.mkdir(parents=True,exist_ok=True)
LIMIT=24*1024*1024
D={5120:'i1',5121:'u1',5122:'<i2',5123:'<u2',5125:'<u4',5126:'<f4'}
N={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}
def sha(p):return hashlib.file_digest(p.open('rb'),'sha256').hexdigest()
class Writer:
 def __init__(self,name):self.name=name;self.parts=[bytearray()];self.views=[];self.accessors=[]
 def add(self,arr,typ,ct=5126,name=None,target=None):
  arr=np.ascontiguousarray(arr,dtype=D[ct]);b=arr.tobytes()
  if len(b)>LIMIT:raise ValueError('Single accessor exceeds 24MiB; needs primitive-aware buffer sharding')
  if len(self.parts[-1])+len(b)+4>LIMIT:self.parts.append(bytearray())
  part=self.parts[-1];part.extend(b'\0'*((-len(part))%4));offset=len(part);part.extend(b)
  v={'buffer':len(self.parts)-1,'byteOffset':offset,'byteLength':len(b)}
  if target:v['target']=target
  self.views.append(v);a={'bufferView':len(self.views)-1,'componentType':ct,'count':len(arr),'type':typ}
  if name:a['name']=name
  if 'POSITION' in (name or '') or typ=='SCALAR' and ct==5126:
   a['min']=arr.min(axis=0).reshape(-1).tolist();a['max']=arr.max(axis=0).reshape(-1).tolist()
  self.accessors.append(a);return len(self.accessors)-1
 def save(self):
  out=[]
  for i,b in enumerate(self.parts):
   p=OUT/f'{self.name}-{i:03}.bin';p.write_bytes(b);out.append({'uri':p.name,'byteLength':len(b)})
  return out
all_images={};stats=[]
def convert(name):
 p=ROOT/'model'/f'{name}.gltf';g=json.loads(p.read_text());source=copy.deepcopy(g)
 raw=(ROOT/'model'/g['buffers'][0]['uri']).read_bytes();w=Writer(name);cache={}
 def read(idx):
  a=g['accessors'][idx];v=g['bufferViews'][a['bufferView']];dt=np.dtype(D[a['componentType']]);c=N[a['type']]
  return np.ndarray((a['count'],c),dtype=dt,buffer=raw,offset=v.get('byteOffset',0)+a.get('byteOffset',0),strides=(v.get('byteStride',dt.itemsize*c),dt.itemsize))
 def cv(idx,semantic=''):
  key=(idx,semantic)
  if key in cache:return cache[key]
  a=g['accessors'][idx];arr=read(idx);typ=a['type'];ct=5126;target=34962 if semantic else None
  if semantic.startswith('TEXCOORD') or semantic=='COLOR_0' and a['componentType']==5123:
   arr=arr.view('<f2').astype('<f4')
  elif semantic=='COLOR_0' and a['componentType']==5120:arr=arr.view('u1').astype('<f4')/255
  elif semantic in ('NORMAL','TANGENT') and a['componentType']==5120:
   arr=np.maximum(arr.astype('<f4')/127,-1)
   if semantic=='NORMAL':arr=arr[:,:3];typ='VEC3'
  elif semantic=='WEIGHTS_0' and typ=='SCALAR':
   arr=np.hstack([arr,np.zeros((len(arr),3),dtype='<f4')]);typ='VEC4'
  elif semantic=='JOINTS_0':ct=5123
  elif a.get('normalized'):
   arr=arr.astype('<f4')/np.iinfo(np.dtype(D[a['componentType']])).max
  elif not semantic and a['componentType']!=5126:ct=a['componentType']
  if not np.isfinite(arr).all():raise ValueError(f'Nonfinite {name}/{idx}/{semantic}')
  k=w.add(arr,typ,ct,a.get('name'),target);cache[key]=k;return k
 triangles=0;vertices=0;uvmin=[float('inf')]*2;uvmax=[-float('inf')]*2
 for mesh in g['meshes']:
  for pr in mesh['primitives']:
   attrs=pr['attributes'];count=g['accessors'][attrs['POSITION']]['count'];ex=pr.get('extras',{}).get('ASOBO_primitive',{})
   indices=read(pr['indices']).reshape(-1).astype(np.uint32) if 'indices' in pr else np.arange(count,dtype=np.uint32)
   st=ex.get('StartIndex',0);n=ex.get('PrimitiveCount',len(indices)//3)*3
   indices=indices[st:st+n]+ex.get('BaseVertexIndex',0)
   assert len(indices)==n and int(indices.max())<count,(name,mesh.get('name'),count,indices.max())
   pr['indices']=w.add(indices.reshape(-1,1),'SCALAR',5123 if indices.max()<65536 else 5125,target=34963)
   for sem,i in list(attrs.items()):attrs[sem]=cv(i,sem)
   if 'extras' in pr:pr['extras']['sourceASOBO_primitive']=pr['extras'].pop('ASOBO_primitive',{})
   triangles+=len(indices)//3;vertices+=count
 for skin in g.get('skins',[]):
  if 'inverseBindMatrices' in skin:skin['inverseBindMatrices']=cv(skin['inverseBindMatrices'])
 for anim in g.get('animations',[]):
  for s in anim['samplers']:s['input']=cv(s['input']);s['output']=cv(s['output'])
 for i,im in enumerate(g.get('images',[])):
  uri=im['uri'];src=ROOT/'texture'/uri
  if not src.exists():raise FileNotFoundError(f'Missing referenced original texture: {uri}')
  dst=uri.removesuffix('.DDS')+'.png'
  if dst.endswith('.PNG.png'):dst=dst[:-8]+'.png'
  all_images[uri]=dst; im['uri']='textures/'+dst;im.pop('extras',None);im['mimeType']='image/png'
 for tx in g.get('textures',[]):
  ex=tx.pop('extensions',{})
  if 'MSFT_texture_dds' in ex:tx['source']=ex['MSFT_texture_dds']['source']
 for mat in g['materials']:
  ex=mat.get('extensions',{})
  # DirectX tangent normal convention: texture-derived Y is flipped at decode.
  # Simulator glass/occluder flags are preserved as metadata, not silent opaque fills.
  if any(x in ex for x in ['ASOBO_material_kitty_glass','ASOBO_material_glass','ASOBO_material_windshield']):
   mat['alphaMode']='BLEND';mat['doubleSided']=True
   pbr=mat.setdefault('pbrMetallicRoughness',{});factor=pbr.setdefault('baseColorFactor',[1,1,1,1]);factor[3]=min(factor[3],0.16);pbr['metallicFactor']=0;pbr['roughnessFactor']=0.08
  if 'ASOBO_material_invisible' in ex or 'ASOBO_material_environment_occluder' in ex:
   mat['alphaMode']='BLEND';mat.setdefault('pbrMetallicRoughness',{})['baseColorFactor']=[0,0,0,0]
  if ex:mat.setdefault('extras',{})['sourceMSFSMaterial']=ex;mat.pop('extensions',None)
 g['buffers']=w.save();g['bufferViews']=w.views;g['accessors']=w.accessors
 # Retain simulator-only extensions for provenance in extras; they do not imply browser support.
 for key in ['extensionsRequired','extensionsUsed']:g.pop(key,None)
 g['asset']={'version':'2.0','generator':'Earthwing FBW A380 exact geometry repack','copyright':'Copyright FlyByWire Simulations. Original 3D assets CC BY-NC 4.0. Modified for browser display; no endorsement.','extras':{'sourceAsset':source['asset'],'license':'https://creativecommons.org/licenses/by-nc/4.0/'}}
 out=OUT/f'{name}.gltf';out.write_text(json.dumps(g,separators=(',',':')))
 result={'id':name,'url':out.name,'nodes':len(g['nodes']),'meshes':len(g['meshes']),'primitives':sum(len(m['primitives']) for m in g['meshes']),'verticesIncludingSharedAccessorReferences':vertices,'triangles':triangles,'skins':len(g.get('skins',[])),'animations':[a.get('name') for a in g['animations']],'images':len(g['images']),'sourceGltfSHA256':sha(p),'sourceBinarySHA256':hashlib.sha256(raw).hexdigest(),'geometryBytes':sum(len(b) for b in w.parts),'bufferFiles':len(w.parts)}
 print(json.dumps({k:v for k,v in result.items() if k!='animations'}),flush=True);stats.append(result)
for name in ['a380_exterior','a380_cockpit']:convert(name)
(OUT/'geometry-manifest.json').write_text(json.dumps({'version':1,'models':stats},indent=2))
if '--png' not in sys.argv:
 print('Geometry ready. Run a380-native.py for byte-for-byte original DDS packaging. Add --png only for optional large-memory compatibility conversion.',flush=True)
 raise SystemExit(0)
(OUT/'textures').mkdir(exist_ok=True)
def texture(item):
 uri,dst=item;p=ROOT/'texture'/uri;q=OUT/'textures'/dst
 b=p.read_bytes();h,wid=struct.unpack_from('<II',b,12);four=b[84:88];dx=struct.unpack_from('<I',b,128)[0] if four==b'DX10' else None
 normal=four in [b'BC5S',b'BC5U',b'ATI2'] or dx in (82,83,84)
 if not q.exists():
  im=Image.open(p);im.load()
  if normal:
   # The simulator reconstructs positive Z from BC5 XY; PNG keeps full dimensions.
   # This is normal-vector interpretation, not texture downsampling or lossy encoding.
   a=np.asarray(im.convert('RGB')).copy();x=a[:,:,0].astype(np.float32)/127.5-1;y=a[:,:,1].astype(np.float32)/127.5-1
   a[:,:,1]=255-a[:,:,1];a[:,:,2]=np.rint((np.sqrt(np.maximum(0,1-x*x-y*y))+1)*127.5).astype(np.uint8);im=Image.fromarray(a)
  assert im.size==(wid,h)
  im.save(q,compress_level=6)
 # Pillow's BC7 decoder produces the original compressed source's decoded pixels.
 return {'source':uri,'url':'textures/'+dst,'width':wid,'height':h,'sourceDDSFormat':dx if dx is not None else four.decode('ascii',errors='replace'),'normalReconstructed':normal,'sourceSHA256':hashlib.sha256(b).hexdigest(),'bytes':q.stat().st_size,'sha256':sha(q)}
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
 tex=[]
 for t in pool.map(texture,sorted(all_images.items())):
  tex.append(t);print('texture',t['url'],t['bytes'],flush=True)
# Split any large PNG reversibly, while preserving the virtual .png URI in glTF.
split={}
for t in tex:
 p=OUT/t['url']
 if p.stat().st_size>LIMIT:
  b=p.read_bytes();parts=[]
  for i,start in enumerate(range(0,len(b),LIMIT)):
   q=p.with_name(p.name+f'.part{i:03}');q.write_bytes(b[start:start+LIMIT]);parts.append({'url':str(q.relative_to(OUT)),'bytes':q.stat().st_size,'sha256':sha(q)})
  split[t['url']]={'bytes':len(b),'sha256':t['sha256'],'parts':parts};p.unlink()
manifest={'version':1,'status':'converted-awaiting-browser-verification','source':'Official FlyByWire A380X stable 4K release','copyright':'Copyright FlyByWire Simulations','sourceURL':'https://flybywiresim.com/a380x/','licenseURL':'https://creativecommons.org/licenses/by-nc/4.0/','modified':True,'noEndorsement':True,'units':'meters','axes':{'up':'+Y','nose':'+Z','lateral':'X'},'maxFileBytes':LIMIT,'models':stats,'textures':tex,'splitImages':split,'notes':['Full original source LOD00 geometry retained, no decimation.','DDS decoded at native dimensions to PNG without lossy codec. BC5 normal positive Z reconstructed, DirectX Y flipped.','Simulator-only material features mapped approximately to standard PBR; raw source extension data retained in material extras.','MSFS avionics runtime and proprietary simulator code are not included.']}
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2))
print('DONE',len(tex),'textures',sum(t['bytes'] for t in tex),'texture bytes',len(split),'split PNG images',flush=True)
