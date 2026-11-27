"""Compact exact active LOD0 cockpit subset; untouched complete LOD0 stays on disk.
No source geometry simplification, coordinate transforms or keyframe quantization.
"""
from pathlib import Path
import json,copy,hashlib,sys
sys.path.insert(0,'/home/sr71-viewer/build-assets/py')
import zstandard as zstd
OUT=Path(__file__).resolve().parents[2]/'public/models/sr71/cockpit'
sha=lambda b:hashlib.sha256(b).hexdigest()
manifest=json.loads((OUT/'manifest.json').read_text());original=manifest['models'].get('fullDetailInterior',manifest['models']['interior']);entry=next(e for e in original if not e.get('optional'));d=json.loads((OUT/'cockpit.gltf').read_text());src=copy.deepcopy(d)
active={'CANOPY','CANOPY_LEVER_F','canopy_pressure_seal','GEAR_HANDLE','HANDLING_YOKE_Lever_StickLR','HANDLING_YOKE_Lever_StickForeAft','HANDLING_RudderPedals','HANDLING_RudderPedals_Brake_L','HANDLING_RudderPedals_Brake_R','DRAG_CHUTE_PULL_HANDLE','ENGINE_LEVER_THROTTLE_1','ENGINE_LEVER_THROTTLE_2'}
active.update(json.loads((Path(__file__).parent/'cockpit-active-clips.json').read_text()))
d['animations']=[a for a in d['animations'] if a['name'] in active]
rawbuffers=[]
for b in src['buffers']:
 spec=entry['resources'][b['uri']];data=b''.join((OUT/p.removeprefix('/data/')).read_bytes() for p in spec['parts']);rawbuffers.append(zstd.ZstdDecompressor().decompress(data) if spec['encoding']=='zstd' else data)
removed=0
for n in d['nodes']:
 if n.get('name')=='ENVIRONMENT_OCCLUDER' and 'mesh' in n:
  mats=[d['materials'][p['material']]['name'] for p in d['meshes'][n['mesh']]['primitives']]
  if mats and all(m=='OCCLUDER' for m in mats):n.pop('mesh');removed+=1
for m in d['meshes']:
 old=len(m['primitives']);m['primitives']=[p for p in m['primitives'] if d['materials'][p['material']].get('pbrMetallicRoughness',{}).get('baseColorFactor',[1,1,1,1])[3]>0];removed+=old-len(m['primitives'])
for n in d['nodes']:
 if 'mesh' in n and not d['meshes'][n['mesh']]['primitives']:n.pop('mesh')
meshes=sorted({n['mesh'] for n in d['nodes'] if 'mesh' in n});mm={i:j for j,i in enumerate(meshes)};d['meshes']=[d['meshes'][i] for i in meshes]
for n in d['nodes']:
 if 'mesh' in n:n['mesh']=mm[n['mesh']]
# Compact only the accessors referenced by actual retained meshes, skins and controls.
raw=bytearray();accessors=[];views=[];am={};proof=[];cache={}
components={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4};nc={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}
def acc(ai):
 if ai in am:return am[ai]
 a=copy.deepcopy(src['accessors'][ai]);v=src['bufferViews'][a['bufferView']];size=components[a['componentType']]*nc[a['type']];stride=v.get('byteStride',size);start=v.get('byteOffset',0)+a.get('byteOffset',0);buf=rawbuffers[v['buffer']]
 data=b''.join(buf[start+i*stride:start+i*stride+size] for i in range(a['count']));key=(a['componentType'],a['type'],a['count'],sha(data),v.get('target'))
 if key in cache:am[ai]=cache[key];return cache[key]
 while len(raw)%4:raw.append(0)
 view={'buffer':0,'byteOffset':len(raw),'byteLength':len(data)}
 if 'target' in v:view['target']=v['target']
 raw.extend(data);a.pop('byteOffset',None);a['bufferView']=len(views);views.append(view);am[ai]=len(accessors);accessors.append(a);cache[key]=am[ai];proof.append({'sourceAccessor':ai,'outputAccessor':am[ai],'sha256':sha(data),'sourceBytesExact':True,'bytes':len(data)});return am[ai]
for m in d['meshes']:
 for p in m['primitives']:
  p['attributes']={k:acc(v) for k,v in p['attributes'].items()}
  if 'indices' in p:p['indices']=acc(p['indices'])
for sk in d.get('skins',[]):
 if 'inverseBindMatrices' in sk:sk['inverseBindMatrices']=acc(sk['inverseBindMatrices'])
for a in d['animations']:
 for s in a['samplers']:s['input']=acc(s['input']);s['output']=acc(s['output'])
d['accessors']=accessors;d['bufferViews']=views;d['buffers']=[{'uri':'cockpit-flight.bin','byteLength':len(raw)}]
# Remap only referenced materials/images. The existing debranded texture bytes stay untouched.
used=sorted({p['material'] for m in d['meshes'] for p in m['primitives']});mm={i:j for j,i in enumerate(used)};d['materials']=[d['materials'][i] for i in used]
for m in d['meshes']:
 for p in m['primitives']:p['material']=mm[p['material']]
textures=[]
def visit(o):
 if isinstance(o,dict):
  for k,v in o.items():
   if k.endswith('Texture') and isinstance(v,dict) and 'index' in v:textures.append(v)
   else:visit(v)
 elif isinstance(o,list):
  for v in o:visit(v)
visit(d['materials']);used=sorted({v['index'] for v in textures});tm={i:j for j,i in enumerate(used)};d['textures']=[d['textures'][i] for i in used]
for t in textures:t['index']=tm[t['index']]
ims=[]
for t in d['textures']:
 source=t.get('extensions',{}).get('EXT_texture_webp',t);im=d['images'][source['source']]
 if im not in ims:ims.append(im)
 source['source']=ims.index(im)
d['images']=ims
compressed=zstd.ZstdCompressor(level=19).compress(raw);(OUT/'cockpit-flight.bin.zst.part00').write_bytes(compressed);(OUT/'cockpit-flight.gltf').write_text(json.dumps(d,separators=(',',':')))
manifest['models']['fullDetailInterior']=original
manifest['models']['interior']=[{'path':'/data/cockpit-flight.gltf','resources':{'cockpit-flight.bin':{'parts':['/data/cockpit-flight.bin.zst.part00'],'encoding':'zstd'}},'sourceLOD':0,'animationSummary':{'clips':len(d['animations']),'source':'Existing debranded original LOD0; byte-exact active control subset'}}]+[e for e in original if e.get('optional')]
manifest['cockpitFlightPolicy']='Full original LOD0 controls and geometry except zero-opacity material primitives and exact opaque ENVIRONMENT_OCCLUDER helper; inactive simulation-only clips excluded from flight payload.';(OUT/'manifest.json').write_text(json.dumps(manifest,separators=(',',':')))
report={'sourceGltfSha256':sha((OUT/'cockpit.gltf').read_bytes()),'sourceBuffers':[{'uri':b['uri'],'sha256':sha(data)} for b,data in zip(src['buffers'],rawbuffers)],'sourceNodesPreserved':d['nodes']==src['nodes'],'nodeTransformsPreserved':all(all(n.get(k)==sn.get(k) for k in ['name','translation','rotation','scale','matrix','children']) for n,sn in zip(d['nodes'],src['nodes'])),'activeClips':[a['name'] for a in d['animations']],'inactiveClipsNotShipped':len(src['animations'])-len(d['animations']),'zeroContributionPrimitivesRemoved':removed,'rawBytesBefore':sum(len(x) for x in rawbuffers),'rawBytesAfter':len(raw),'compressedBytesAfter':len(compressed),'imagesBefore':len(src['images']),'imagesAfter':len(ims),'accessorChecks':proof,'files':[{'file':p.name,'bytes':p.stat().st_size,'sha256':sha(p.read_bytes())} for p in OUT.glob('cockpit-flight*')]}
Path('/home/earthwing-sr71-integration/asset-build/cockpit-subset-proof.json').write_text(json.dumps(report,indent=2));print(json.dumps({k:v for k,v in report.items() if k not in ['accessorChecks','sourceBuffers']}))
