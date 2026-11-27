"""ASOBO-to-glTF rigid/skin geometry normalization, adapted from the local SR-71 viewer.
The caller must resolve textures from its approved debranded inputs.
"""
import pathlib,json,copy,hashlib
import numpy as np
import zstandard as zstd
COMP={5120:'i1',5121:'u1',5122:'i2',5123:'u2',5125:'u4',5126:'f4'};NC={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}
def node_matrix(n):
 if 'matrix' in n:return np.array(n['matrix'],dtype=np.float64).reshape((4,4),order='F')
 x,y,z,w=n.get('rotation',[0,0,0,1]);r=np.array([[1-2*y*y-2*z*z,2*x*y-2*z*w,2*x*z+2*y*w],[2*x*y+2*z*w,1-2*x*x-2*z*z,2*y*z-2*x*w],[2*x*z-2*y*w,2*y*z+2*x*w,1-2*x*x-2*y*y]])
 a=np.eye(4);a[:3,:3]=r@np.diag(n.get('scale',[1,1,1]));a[:3,3]=n.get('translation',[0,0,0]);return a
BAD_SKINS={'cockpit':{'canopy_hose_boned','STICK-BOOT','SNAKE_LIGHT_L_WIRE','SNAKE_LIGHT_R_WIRE'},'nose-gear':{'Object12.166','Object5329'},'gear-left':{'L_Wires_10','L_Wires_01','L_Gear_287','L_Wires_02'}}
reports=[]
def convert(label,rel,ROOT,OUT,WORK,texture):
 src=ROOT/rel;d=json.loads(src.read_text());b=(src.parent/d['buffers'][0]['uri']).read_bytes();nodes=d['nodes'];root_nodes=d['scenes'][d.get('scene',0)]['nodes']
 drop=set();drop_names=[]
 for i,n in enumerate(nodes):
  name=n.get('name','')
  if (label=='exterior-flight' and name in ['Ground_Equipment_Animation','NODE_RBF_EXT','RBF_ENGINES','FUEL_SPILL_BODY','FUEL_SPILL_PORT','AB_R_HEAT','AB_L_HEAT']) or (label=='cockpit' and (name=='Tube' or name.startswith(('CS01_','Bip001','HELMET','PILOT_VIZ')))):
   drop_names.append(name)
   def mark(j):
    if j in drop:return
    drop.add(j)
    for c in nodes[j].get('children',[]):mark(c)
   mark(i)
 keep=set();world={}
 def walk(i,parent):
  if i in drop:return
  keep.add(i);world[i]=parent@node_matrix(nodes[i])
  for j in nodes[i].get('children',[]):walk(j,world[i])
 for i in root_nodes:walk(i,np.eye(4))
 # Retain skeleton ancestry already in scene; mesh skin references remain standard glTF.
 ndmap={i:j for j,i in enumerate(sorted(keep))}
 o={'asset':{'version':'2.0','generator':'SR71 static ASOBO normalization; no vertex simplification'},'scene':0,'scenes':[{'nodes':[ndmap[i] for i in root_nodes if i in keep]}],'nodes':[],'meshes':[],'materials':[],'accessors':[],'bufferViews':[],'buffers':[],'textures':[],'images':[],'samplers':[{'magFilter':9729,'minFilter':9987,'wrapS':10497,'wrapT':10497}]}
 raw=bytearray();blob_cache={};acc_cache={};mat_cache={};mesh_cache={};skin_cache={};bbmin=np.full(3,np.inf);bbmax=-bbmin;triangles=0;position_count=0;max_position_error=0.;reversed_winding=True;opaque_invisible=0
 def readacc(ai,semantic=''):
  a=d['accessors'][ai];v=d['bufferViews'][a['bufferView']];dt=COMP[a['componentType']]
  if semantic.startswith('TEXCOORD') or (semantic.startswith('COLOR') and a['componentType']==5123):dt='f2'
  dt=np.dtype('<'+dt);nc=NC[a['type']];stride=v.get('byteStride',nc*dt.itemsize);offset=v.get('byteOffset',0)+a.get('byteOffset',0)
  assert offset+(a['count']-1)*stride+nc*dt.itemsize<=len(b),(ai,a)
  arr=np.ndarray((a['count'],nc),dtype=dt,buffer=b,offset=offset,strides=(stride,dt.itemsize)).copy()
  return arr
 def appendacc(arr,semantic='',typ=None,ct=None):
  while len(raw)%4:raw.append(0)
  offset=len(raw)
  if ct is None:
   ct=5123 if arr.dtype==np.dtype('uint16') else 5125 if arr.dtype==np.dtype('uint32') else 5126
  dt=np.dtype('<'+COMP[ct]);arr=np.ascontiguousarray(arr,dtype=dt);payload=arr.tobytes();key=(ct,arr.shape,semantic=='POSITION',typ,hashlib.blake2b(payload,digest_size=20).digest())
  if key in blob_cache:return blob_cache[key]
  raw.extend(payload);vi=len(o['bufferViews']);o['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':arr.nbytes})
  a={'bufferView':vi,'componentType':ct,'count':len(arr),'type':typ or {1:'SCALAR',2:'VEC2',3:'VEC3',4:'VEC4',16:'MAT4'}[arr.shape[1]]}
  if semantic=='POSITION':a.update(min=arr.min(axis=0).tolist(),max=arr.max(axis=0).tolist())
  ai=len(o['accessors']);o['accessors'].append(a);blob_cache[key]=ai;return ai
 def attr(ai,semantic):
  key=(ai,semantic)
  if key in acc_cache:return acc_cache[key]
  arr=readacc(ai,semantic);a=d['accessors'][ai]
  if semantic=='NORMAL':
   arr=arr[:,:3].astype('f4')/127.;length=np.linalg.norm(arr,axis=1,keepdims=True);arr/=np.maximum(length,1e-20)
  elif semantic.startswith('COLOR'):
   if a['componentType']==5120:arr=arr.view('u1').astype('f4')/255.
   arr=np.clip(arr,0,1)
  elif semantic.startswith('WEIGHTS'):
   arr=arr.astype('f4')/65535.;arr/=np.maximum(arr.sum(axis=1,keepdims=True),1e-20)
  result=appendacc(arr,semantic,ct=5123 if semantic.startswith('JOINTS') else 5126);acc_cache[key]=result;return result
 def material(mi):
  if mi in mat_cache:return mat_cache[mi]
  m=copy.deepcopy(d['materials'][mi]);ext=m.get('extensions',{});p=m.get('pbrMetallicRoughness',{});q={'baseColorFactor':p.get('baseColorFactor',[1,1,1,1]),'metallicFactor':p.get('metallicFactor',0.12 if label=='exterior-flight' else 0.0),'roughnessFactor':p.get('roughnessFactor',0.78 if label=='exterior-flight' else 0.63)}
  out={'name':m.get('name',str(mi)),'pbrMetallicRoughness':q}
  for k in ['alphaMode','alphaCutoff','doubleSided']: 
   if k in m:out[k]=m[k]
  if 'baseColorTexture' in p:
   t=d['textures'][p['baseColorTexture']['index']];ii=t.get('source',t.get('extensions',{}).get('MSFT_texture_dds',{}).get('source'));uri=texture(d['images'][ii]['uri']) if ii is not None else None
   if uri:
    imidx=len(o['images']);o['images'].append({'uri':uri,'mimeType':'image/webp'});ti=len(o['textures']);o['textures'].append({'sampler':0,'extensions':{'EXT_texture_webp':{'source':imidx}}});q['baseColorTexture']={'index':ti}
  decal=ext.get('ASOBO_material_geometry_decal')
  if decal is not None:
   out['extras']={'decal':True,'drawOrder':ext.get('ASOBO_material_draw_order',{}).get('drawOrderOffset',0),'sourceBaseColorBlendFactor':decal.get('baseColorBlendFactor',1)}
   if decal.get('baseColorBlendFactor',1)==0:q['baseColorFactor']=[1,1,1,0];out['alphaMode']='BLEND'
   # Base color-bearing livery overlays preserved; normal-only MSFS decals transparent.
  if any('glass' in x.lower() or 'windshield' in x.lower() for x in [m.get('name','')]):out['doubleSided']=True
  idx=len(o['materials']);o['materials'].append(out);mat_cache[mi]=idx;return idx
 def mesh(mi):
  nonlocal triangles,position_count,opaque_invisible
  if mi in mesh_cache:return mesh_cache[mi]
  m=d['meshes'][mi];prims=[]
  for pr in m['primitives']:
   sm=d['materials'][pr.get('material',0)];ext=sm.get('extensions',{});nam=sm.get('name','').lower()
   if 'ASOBO_material_invisible' in ext or nam in ['lod_helper','effects','oil.puddle']:
    opaque_invisible+=1;continue
   meta=pr.get('extras',{}).get('ASOBO_primitive',{});idx=readacc(pr['indices']).reshape(-1);start=meta.get('StartIndex',0);count=meta.get('PrimitiveCount',len(idx)//3)*3;base=meta.get('BaseVertexIndex',0);idx=idx[start:start+count].astype('u4')+base
   assert len(idx)==count and len(idx)%3==0
   n=d['accessors'][pr['attributes']['POSITION']]['count'];assert int(idx.max())<n,(label,m['name'],int(idx.max()),n)
   idx=idx.reshape((-1,3))[:,::-1].copy().reshape((-1,1));idx=idx.astype('u2' if idx.max()<65536 else 'u4');attrs={}
   for sem,ai in pr['attributes'].items():
    if sem=='TANGENT':continue
    if sem.startswith('COLOR'):
     col=readacc(ai,sem)
     if np.all(col==1) or (col.dtype==np.int8 and np.all(col==-1)):continue
    attrs[sem]=attr(ai,sem)
   prims.append({'attributes':attrs,'indices':appendacc(idx),'material':material(pr.get('material',0)),'mode':4});triangles+=len(idx)//3
  if not prims:mesh_cache[mi]=None;return None
  idx=len(o['meshes']);o['meshes'].append({'name':m.get('name',str(mi)),'primitives':prims});mesh_cache[mi]=idx;return idx
 for i in sorted(keep):
  n=nodes[i];out={k:copy.deepcopy(v) for k,v in n.items() if k in ['name','translation','rotation','scale','matrix']}
  if 'children' in n and any(j in keep for j in n['children']):out['children']=[ndmap[j] for j in n['children'] if j in keep]
  if 'mesh' in n and n.get('name') not in BAD_SKINS.get(label,set()):
   mi=mesh(n['mesh'])
   if mi is not None:
    out['mesh']=mi
    for pr in o['meshes'][mi]['primitives']:
     a=o['accessors'][pr['attributes']['POSITION']];lo=a['min'];hi=a['max'];corners=np.array([[x,y,z,1] for x in [lo[0],hi[0]] for y in [lo[1],hi[1]] for z in [lo[2],hi[2]]]);wc=(world[i]@corners.T).T[:,:3];bbmin=np.minimum(bbmin,wc.min(axis=0));bbmax=np.maximum(bbmax,wc.max(axis=0))
    if 'skin' in n:
     sk=n['skin']
     if sk not in skin_cache:
      s=copy.deepcopy(d['skins'][sk]);s['joints']=[ndmap[j] for j in s['joints']];
      if 'skeleton' in s:s['skeleton']=ndmap[s['skeleton']]
      s['inverseBindMatrices']=appendacc(readacc(s['inverseBindMatrices']),typ='MAT4');skin_cache[sk]=len(o.setdefault('skins',[]));o['skins'].append(s)
     out['skin']=skin_cache[sk]
  o['nodes'].append(out)
 if o['images']:o['extensionsUsed']=['EXT_texture_webp'];o['extensionsRequired']=['EXT_texture_webp']
 # Align complete buffer and compress losslessly: custom manifest replaces virtual URI.
 while len(raw)%4:raw.append(0)
 virtual=label+'.bin';o['buffers']=[{'uri':virtual,'byteLength':len(raw)}]
 compressed=zstd.ZstdCompressor(level=19).compress(raw);parts=[]
 for k,off in enumerate(range(0,len(compressed),19*1024*1024)):
  name=f'{label}.bin.zst.part{k:02}';(OUT/name).write_bytes(compressed[off:off+19*1024*1024]);parts.append('/data/'+name)
 (OUT/(label+'.gltf')).write_text(json.dumps(o,separators=(',',':')))
 # Intermediate uncompressed buffers are restricted to the non-hosted working directory.
 (WORK/(label+'.bin')).write_bytes(raw)
 rep={'name':label,'source':rel,'path':'/data/'+label+'.gltf','resources':{virtual:{'parts':parts,'encoding':'zstd'}},'boundingBox':{'min':bbmin.tolist(),'max':bbmax.tolist()},'triangles':triangles,'meshes':len(o['meshes']),'rawBytes':len(raw),'compressedBytes':len(compressed),'excludedSubtrees':drop_names,'excludedInvalidBindPoseMeshes':sorted(BAD_SKINS.get(label,set())),'excludedInvisiblePrimitives':opaque_invisible,'positionPrecision':'Source float32 byte values retained; no quantization or simplification','animations':'None; original default local transforms and skin bind data retained'};reports.append(rep);print('MODEL',json.dumps(rep),flush=True);return {k:rep[k] for k in ['path','resources']}
