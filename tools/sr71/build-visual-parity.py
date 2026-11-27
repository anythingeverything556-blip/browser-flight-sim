"""Scoped original-only visual repairs; existing exterior livery files are untouched."""
from pathlib import Path
import sys,json,copy,hashlib
sys.path.insert(0,'/home/sr71-viewer/build-assets/py')
import numpy as np
import zstandard as zstd
from PIL import Image,ImageDraw
from source_normalizer import convert
GAME=Path(__file__).resolve().parents[2];OUT=GAME/'public/models/sr71/exterior';COCKPIT=OUT.parent/'cockpit'
WORK=Path('/home/earthwing-sr71-integration/asset-build/visual-parity');WORK.mkdir(exist_ok=True)
ROOT=Path('/home/Downloads/SR-71-BLACKBIRD/milviz-aircraft-sr71/SimObjects/Airplanes/BlackbirdSims_SR71')
sha=lambda x:hashlib.sha256(x).hexdigest()
def texture(uri):
 import re
 name=re.sub(r'[^a-z0-9_-]','_',uri.replace('\\','/').split('/')[-1].lower().removesuffix('.png.ktx2'))+'.webp'
 path='textures/flight-mips/'+name
 if not (COCKPIT/path).exists():path='textures/'+name
 assert (COCKPIT/path).exists(),name
 return '../cockpit/'+path
entry=convert('cabin-flight','attachments/blackbird/Part_Interior_Cockpit/model/SR71_Interior_LOD2.gltf',ROOT,WORK,WORK,texture)
src=json.loads((WORK/'cabin-flight.gltf').read_text());d=copy.deepcopy(src)
KEEP={'Static_Front_Dash','MAIN-INSTR-PANEL-SIDES','MAIN-INSTR-PANEL','Front_Right_Static','Static_Cockpit_Back','Front_Floor_Static','Front_Cockpit_Static','Front_Cockpit_Static001','Static_Cockpit_Back001','VC_4_R','VC_5_R','VC_6_R','VC_15_R','VC_1_R'}
parents={c:i for i,n in enumerate(d['nodes']) for c in n.get('children',[])}
keep={i for i,n in enumerate(d['nodes']) if n['name'] in KEEP}
for i in list(keep):
 while i in parents:i=parents[i];keep.add(i)
nm={i:k for k,i in enumerate(sorted(keep))};d['nodes']=[n for i,n in enumerate(d['nodes']) if i in keep]
for n in d['nodes']:
 if 'children' in n:n['children']=[nm[i] for i in n['children'] if i in nm]
d['scenes']=[{'nodes':[nm[i] for i in src['scenes'][0]['nodes'] if i in nm]}]
mm={i:k for k,i in enumerate(sorted({n['mesh'] for n in d['nodes'] if 'mesh'in n}))};d['meshes']=[src['meshes'][i] for i in mm]
for n in d['nodes']:
 if 'mesh'in n:n['mesh']=mm[n['mesh']]
rawbuf=(WORK/'cabin-flight.bin').read_bytes();raw=bytearray();aa=[];vv=[];am={};proof=[]
def acc(i):
 if i in am:return am[i]
 a=copy.deepcopy(src['accessors'][i]);v=src['bufferViews'][a['bufferView']];payload=rawbuf[v['byteOffset']:v['byteOffset']+v['byteLength']]
 while len(raw)%4:raw.append(0)
 v=copy.deepcopy(v);v['byteOffset']=len(raw);raw.extend(payload);a['bufferView']=len(vv);vv.append(v);am[i]=len(aa);aa.append(a);proof.append({'accessor':i,'bytes':len(payload),'sha256':sha(payload)});return am[i]
for m in d['meshes']:
 for p in m['primitives']:p['attributes']={k:acc(i) for k,i in p['attributes'].items()};p['indices']=acc(p['indices'])
used=sorted({p['material'] for m in d['meshes'] for p in m['primitives']});mm={i:k for k,i in enumerate(used)};d['materials']=[src['materials'][i] for i in used]
for m in d['meshes']:
 for p in m['primitives']:p['material']=mm[p['material']]
used=sorted({m['pbrMetallicRoughness']['baseColorTexture']['index'] for m in d['materials'] if 'baseColorTexture'in m['pbrMetallicRoughness']});tm={i:k for k,i in enumerate(used)};d['textures']=[src['textures'][i] for i in used];d['images']=[]
for m in d['materials']:
 if 'baseColorTexture'in m['pbrMetallicRoughness']:t=m['pbrMetallicRoughness']['baseColorTexture'];t['index']=tm[t['index']]
for t in d['textures']:
 s=t['extensions']['EXT_texture_webp'];im=src['images'][s['source']];s['source']=len(d['images']);d['images'].append(im)
d['accessors']=aa;d['bufferViews']=vv;d['buffers']=[{'uri':'cabin-flight.bin','byteLength':len(raw)}]
# Rear structural bulkhead is absent in authored LOD2. Restore the exact small
# original rigid LOD0 piece, with its source ancestor and untouched vertex bytes.
full=json.loads((COCKPIT/'cockpit.gltf').read_text());manifest=json.loads((COCKPIT/'manifest.json').read_text())
fullentry=next(e for e in manifest['models']['fullDetailInterior'] if not e.get('optional'))
fullbuffers=[]
for b in full['buffers']:
 spec=fullentry['resources'][b['uri']];data=b''.join((COCKPIT/p.removeprefix('/data/')).read_bytes() for p in spec['parts']);fullbuffers.append(zstd.ZstdDecompressor().decompress(data) if spec['encoding']=='zstd' else data)
node=next(n for n in full['nodes'] if n['name']=='canopy_rear_bulkhead');rear=copy.deepcopy(full['meshes'][node['mesh']]);rearmats={};reara={}
def rearacc(i):
 if i in reara:return reara[i]
 a=copy.deepcopy(full['accessors'][i]);v=full['bufferViews'][a['bufferView']];size={5123:2,5125:4,5126:4}[a['componentType']]*{'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4}[a['type']];stride=v.get('byteStride',size);start=v.get('byteOffset',0)+a.get('byteOffset',0);buf=fullbuffers[v['buffer']];data=b''.join(buf[start+k*stride:start+k*stride+size] for k in range(a['count']))
 while len(raw)%4:raw.append(0)
 a.pop('byteOffset',None);a['bufferView']=len(vv);vv.append({'buffer':0,'byteOffset':len(raw),'byteLength':len(data)});raw.extend(data);reara[i]=len(aa);aa.append(a);proof.append({'rearSourceAccessor':i,'bytes':len(data),'sha256':sha(data)});return reara[i]
for primitive in rear['primitives']:
 primitive['attributes']={k:rearacc(i) for k,i in primitive['attributes'].items()};primitive['indices']=rearacc(primitive['indices']);mi=primitive['material']
 if mi not in rearmats:
  m=copy.deepcopy(full['materials'][mi]);t=m.get('pbrMetallicRoughness',{}).get('baseColorTexture')
  if t:
   tex=copy.deepcopy(full['textures'][t['index']]);im=copy.deepcopy(full['images'][tex['extensions']['EXT_texture_webp']['source']]);im['uri']='../cockpit/'+im['uri'];tex['extensions']['EXT_texture_webp']['source']=len(d['images']);d['images'].append(im);t['index']=len(d['textures']);d['textures'].append(tex)
  rearmats[mi]=len(d['materials']);d['materials'].append(m)
 primitive['material']=rearmats[mi]
parent=next(n for n in full['nodes'] if n['name']=='NODE_cockpit_high');root={k:copy.deepcopy(parent[k]) for k in ['name','rotation','translation','scale','matrix'] if k in parent};root['name']='Original rear cabin structure';root['children']=[len(d['nodes'])+1];d['scenes'][0]['nodes'].append(len(d['nodes']));d['nodes'].append(root)
leaf={k:copy.deepcopy(v) for k,v in node.items() if k not in ['mesh','children']};leaf['mesh']=len(d['meshes']);d['meshes'].append(rear);d['nodes'].append(leaf)
d['buffers'][0]['byteLength']=len(raw)
(OUT/'cabin-flight.gltf').write_text(json.dumps(d,separators=(',',':')));comp=zstd.ZstdCompressor(level=19).compress(raw);(OUT/'cabin-flight.bin.zst.part00').write_bytes(comp)
entry={'path':'/data/cabin-flight.gltf','resources':{'cabin-flight.bin':{'parts':['/data/cabin-flight.bin.zst.part00'],'encoding':'zstd'}},'sourceLOD':2,'source':'attachments/blackbird/Part_Interior_Cockpit/model/SR71_Interior_LOD2.gltf'}
entry['additionalSource']={'source': 'attachments/blackbird/Part_Interior_Cockpit/model/SR71_Interior_LOD0.gltf', 'node': 'canopy_rear_bulkhead', 'sourceLOD': 0, 'triangles': 700, 'topology': 'Exact original accessor bytes, no simplification'}
(OUT/'visual-parity-manifest.json').write_text(json.dumps({'exteriorCabin':entry},separators=(',',':')))
# Rasterize only wheel triangles outside the source rim onto a wheel-only atlas.
tex=OUT/'textures/sr-71_chassis_b01_albd.webp';image=Image.open(tex).convert('RGB');mask=Image.new('L',image.size);draw=ImageDraw.Draw(mask)
wheelproof=[]
for file,node in [('gear-left-flight.gltf','L_TIRE002'),('gear-right-flight.gltf','TIRE_R002')]:
 j=json.loads((OUT/file).read_text());buffers=[]
 for b in j['buffers']:buffers.append(zstd.ZstdDecompressor().decompress((OUT/(b['uri']+'.zst.part00')).read_bytes()))
 def array(i):
  a=j['accessors'][i];v=j['bufferViews'][a['bufferView']];dt={5123:'<u2',5125:'<u4',5126:'<f4'}[a['componentType']];nc={'SCALAR':1,'VEC2':2,'VEC3':3}[a['type']];return np.frombuffer(buffers[v['buffer']],dtype=dt,count=a['count']*nc,offset=v.get('byteOffset',0)+a.get('byteOffset',0)).reshape((-1,nc))
 n=next(n for n in j['nodes'] if n['name']==node);p=j['meshes'][n['mesh']]['primitives'][0];pos=array(p['attributes']['POSITION']);uv=array(p['attributes']['TEXCOORD_0']);indices=array(p['indices']).reshape((-1,3));radius=np.linalg.norm(pos[:,1:3],axis=1)
 selected=0
 for tri in indices:
  if min(radius[tri])<.245:continue
  draw.polygon([(float(uv[i,0])*image.width,float(uv[i,1])*image.height) for i in tri],fill=255);selected+=1
 wheelproof.append({'mesh':node,'rubberTriangles':selected,'totalTriangles':len(indices),'rimCutoffMeters':.245})
dark=image.point(lambda x:round(x*.14));painted=Image.composite(dark,image,mask);painted.save(WORK/'sr71-main-rubber-dark-diagnostic.webp','WEBP',quality=94,method=6)
mask.resize((1024,1024)).save(WORK/'rear-rubber-mask.png')
report={'cabin':{'source':entry['source'],'nodes':[n['name']for n in d['nodes']],'triangles':sum(d['accessors'][p['indices']]['count']//3 for m in d['meshes']for p in m['primitives']),'compressedBytes':len(comp),'sourceNormalizedBytesUnchanged':True,'rearStructureSource':'Exact canopy_rear_bulkhead from original normalized LOD0','accessorProof':proof},'rubber':{'source':str(tex),'sourceSha256':sha(tex.read_bytes()),'exception':'User-requested dark rear rubber; original light gray/silver tire texture is source coloring, not absent material. Original atlas is unmodified.','runtimePaint':'Only tire mesh material clones multiply linear base color by .045; no extra texture fetched. Hubs and chassis keep their source material.','wheelMeshes':wheelproof}}
(WORK/'source-proof.json').write_text(json.dumps(report,indent=2));print(json.dumps({'cabin':{k:v for k,v in report['cabin'].items()if k!='accessorProof'},'rubber':report['rubber']},indent=2))
