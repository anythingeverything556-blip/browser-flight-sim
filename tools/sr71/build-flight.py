"""Original source LOD2 flight assembly; no decimator or source edits."""
from pathlib import Path
import json,copy,sys,hashlib
sys.path.insert(0,'/home/sr71-viewer/build-assets/py')
import zstandard as zstd
HERE=Path(__file__).resolve().parent
GAME=HERE.parents[1]
OUT=GAME/'public/models/sr71/exterior'
WORK=Path('/home/earthwing-sr71-integration/asset-build');WORK.mkdir(exist_ok=True)
ROOT=Path('/home/Downloads/SR-71-BLACKBIRD/milviz-aircraft-sr71/SimObjects/Airplanes/BlackbirdSims_SR71')
sha=lambda b:hashlib.sha256(b).hexdigest()
from source_normalizer import convert, reports
def texture(uri):
 import re
 name=uri.replace('\\','/').split('/')[-1].lower()
 target='textures/'+re.sub(r'[^a-z0-9_-]','_',name.removesuffix('.png.ktx2'))+'.webp'
 assert (OUT/target).is_file(),target
 return target
SOURCES={
 'exterior-flight':'common/model/SR71_Exterior_LOD2.gltf',
 'nose-asars-flight':'attachments/blackbird/Part_Exterior_Nose_ASARS/model/Exterior_Nose_ASARS_LOD1.gltf',
 'nose-gear-flight':'attachments/blackbird/Part_Exterior_NoseGear/model/NoseGear_LOD2.gltf',
 'gear-left-flight':'attachments/blackbird/Part_Gear_L/model/Part_Gear_L_LOD2.gltf',
 'gear-right-flight':'attachments/blackbird/Part_Gear_R/model/Part_Gear_R_LOD2.gltf'}
report={'models':[],'sourceNormalizerSha256':sha((HERE/'source_normalizer.py').read_bytes()),'texturePolicy':'Existing v4 debranded converted bytes only','geometryPolicy':'Original authored LODs, no simplification or animation quantization'}
entries=[]
DROP={'Ground_Equipment_Animation','NODE_RBF_EXT','RBF_ENGINES','FUEL_SPILL_BODY','FUEL_SPILL_PORT','AB_R_HEAT','AB_L_HEAT'}
for label,rel in SOURCES.items():
 entry=convert(label,rel,ROOT,OUT,WORK,texture);srcpath=ROOT/rel;src=json.loads(srcpath.read_text());outpath=OUT/(label+'.gltf');d=json.loads(outpath.read_text());buffers=[(srcpath.parent/b['uri']).read_bytes() for b in src['buffers']]
 drop=set()
 def mark(i):
  if i in drop:return
  drop.add(i)
  for c in src['nodes'][i].get('children',[]):mark(c)
 if label=='exterior-flight':
  for i,n in enumerate(src['nodes']):
   if n.get('name') in DROP:mark(i)
 keep=set()
 def walk(i):
  if i in drop:return
  keep.add(i)
  for c in src['nodes'][i].get('children',[]):walk(c)
 for i in src['scenes'][src.get('scene',0)]['nodes']:walk(i)
 ndmap={i:j for j,i in enumerate(sorted(keep))};assert len(ndmap)==len(d['nodes'])
 for i,j in ndmap.items():assert src['nodes'][i].get('name')==d['nodes'][j].get('name')
 raw=bytearray();am={};checks=[];bi=len(d['buffers'])
 def accessor(ai):
  if ai in am:return am[ai]
  a=copy.deepcopy(src['accessors'][ai]);v=src['bufferViews'][a['bufferView']];nc={'SCALAR':1,'VEC3':3,'VEC4':4}[a['type']];assert a['componentType']==5126
  st=v.get('byteOffset',0)+a.get('byteOffset',0);stride=v.get('byteStride',nc*4)
  data=b''.join(buffers[v['buffer']][st+i*stride:st+i*stride+nc*4] for i in range(a['count']))
  while len(raw)%4:raw.append(0)
  a.pop('byteOffset',None);a['bufferView']=len(d['bufferViews']);d['bufferViews'].append({'buffer':bi,'byteOffset':len(raw),'byteLength':len(data)});raw.extend(data)
  oi=len(d['accessors']);d['accessors'].append(a);am[ai]=oi;checks.append({'sourceAccessor':ai,'outputAccessor':oi,'sha256':sha(data),'bytes':len(data),'sourceBytesExact':True});return oi
 animations=[]
 for a in src.get('animations',[]):
  dest={k:copy.deepcopy(v) for k,v in a.items() if k not in ['channels','samplers']};dest.update(channels=[],samplers=[]);sm={}
  for c in a['channels']:
   if c['target'].get('node') not in ndmap:continue
   si=c['sampler']
   if si not in sm:
    sa=copy.deepcopy(a['samplers'][si]);sa['input']=accessor(sa['input']);sa['output']=accessor(sa['output']);sm[si]=len(dest['samplers']);dest['samplers'].append(sa)
   cc=copy.deepcopy(c);cc['target']['node']=ndmap[c['target']['node']];cc['sampler']=sm[si];dest['channels'].append(cc)
  if dest['channels']:animations.append(dest)
 if raw:
  uri=label+'.animations.bin';d['buffers'].append({'uri':uri,'byteLength':len(raw)});comp=zstd.ZstdCompressor(level=19).compress(raw);p=uri+'.zst.part00';(OUT/p).write_bytes(comp);entry['resources'][uri]={'parts':['/data/'+p],'encoding':'zstd'};d['animations']=animations
 removed=0
 for mesh in d['meshes']:
  before=len(mesh['primitives']);mesh['primitives']=[p for p in mesh['primitives'] if d['materials'][p['material']].get('pbrMetallicRoughness',{}).get('baseColorFactor',[1,1,1,1])[3]>0];removed+=before-len(mesh['primitives'])
 for n in d['nodes']:
  if 'mesh' in n and not d['meshes'][n['mesh']]['primitives']:n.pop('mesh')
 mm={i:j for j,i in enumerate(i for i,m in enumerate(d['meshes']) if m['primitives'])}
 d['meshes']=[m for m in d['meshes'] if m['primitives']]
 for n in d['nodes']:
  if 'mesh' in n:n['mesh']=mm[n['mesh']]
 for m in d['meshes']:
  for p in m['primitives']:
   for ai in p['attributes'].values():d['bufferViews'][d['accessors'][ai]['bufferView']]['target']=34962
   d['bufferViews'][d['accessors'][p['indices']]['bufferView']]['target']=34963
 outpath.write_text(json.dumps(d,separators=(',',':')))
 entry['sourceLOD']=int(rel.split('_LOD')[-1].split('.')[0]);entry['animationSummary']={'clips':len(animations),'channels':sum(len(a['channels']) for a in animations),'source':rel,'keyframes':'source float32 bytes unchanged'};entries.append(entry)
 report['models'].append({'label':label,'source':rel,'sourceSha256':sha(srcpath.read_bytes()),'sourceBuffers':[{'uri':b['uri'],'sha256':sha(buf)} for b,buf in zip(src['buffers'],buffers)],'converted':reports[-1],'animationChecks':checks,'zeroAlphaPrimitivesRemoved':removed})
manifest=json.loads((OUT/'manifest.json').read_text());manifest['models']['highDetailExterior']=manifest['models'].get('highDetailExterior',manifest['models']['exterior']);manifest['models']['exterior']=entries;manifest['flightLODPolicy']='Original source LOD2 main/gear, LOD1 ASARS nose; LOD0 retained as highDetailExterior, not fetched for ordinary flight.';(OUT/'manifest.json').write_text(json.dumps(manifest,separators=(',',':')))
report['files']=[{'path':p.name,'bytes':p.stat().st_size,'sha256':sha(p.read_bytes())} for p in sorted(OUT.glob('*flight*')) if p.is_file()];(WORK/'flight-source-proof.json').write_text(json.dumps(report,indent=2));print('DONE')
