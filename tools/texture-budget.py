#!/usr/bin/env python3
"""Texture-only GLB budget pass. No geometry, names, pivots, extras or scene changes.
Requires ImageMagick convert/identify; usage: texture-budget.py input.glb output.glb manifest.json
"""
import sys,json,struct,subprocess,tempfile,hashlib,copy,pathlib
src,out,report=map(pathlib.Path,sys.argv[1:]);raw=src.read_bytes();jl=struct.unpack_from('<I',raw,12)[0];doc=json.loads(raw[20:20+jl]);binary=raw[28+jl:]
sha=lambda b:hashlib.sha256(b).hexdigest()
def canon(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
sem=copy.deepcopy(doc);sem.pop('bufferViews',None);sem.pop('buffers',None)
images={im['bufferView']:im for im in doc.get('images',[])};parts=[];size=0;textures=[];geometry=[]
with tempfile.TemporaryDirectory() as td:
 for idx,v in enumerate(doc['bufferViews']):
  start=v.get('byteOffset',0);data=binary[start:start+v['byteLength']]
  if idx in images:
   im=images[idx];pin=pathlib.Path(td)/'in.webp';pout=pathlib.Path(td)/'out.webp';pin.write_bytes(data)
   w,h=map(int,subprocess.check_output(['identify','-format','%w %h',str(pin)]).split());name=im.get('name','');limit=512 if 'ORM' in name else 2048 if name=='G3_Livery_BaseColor_4k' or name in ['I76_ART_A','I76_ART_B','I76_ART_C','I76_ART_D','I76_ART_E'] else 1024
   if max(w,h)>limit:
    subprocess.run(['convert',str(pin),'-resize',f'{limit}x{limit}>','-quality','92',str(pout)],check=True);data=pout.read_bytes()
   nw,nh=map(int,subprocess.check_output(['identify','-format','%w %h',str(pout if pout.exists() else pin)]).split()) if max(w,h)>limit else (w,h)
   textures.append({'name':im.get('name'),'before':[w,h],'after':[nw,nh],'bytesBefore':v['byteLength'],'bytesAfter':len(data)})
  else:geometry.append({'view':idx,'sha256':sha(data),'bytes':len(data)})
  pad=(-size)%4
  if pad:parts.append(b'\0'*pad);size+=pad
  v['byteOffset']=size;v['byteLength']=len(data);parts.append(data);size+=len(data)
body=b''.join(parts);body+=b'\0'*((-len(body))%4);doc['buffers'][0]['byteLength']=len(body)
j=canon(doc);j+=b' '*((-len(j))%4);result=struct.pack('<III',0x46546c67,2,12+8+len(j)+8+len(body))+struct.pack('<II',len(j),0x4e4f534a)+j+struct.pack('<II',len(body),0x004e4942)+body;out.write_bytes(result)
tri=sum(doc['accessors'][p['indices']]['count']//3 for m in doc['meshes'] for p in m['primitives'] if 'indices'in p)
manifest={'sourceSha256':sha(raw),'resultSha256':sha(result),'bytesBefore':len(raw),'bytesAfter':len(result),'triangles':tri,'semanticSha256':sha(canon(sem)),'geometry':geometry,'textures':textures,'estimatedTextureRGBAWithMipsBefore':round(sum(t['before'][0]*t['before'][1]*4*4/3 for t in textures)),'estimatedTextureRGBAWithMipsAfter':round(sum(t['after'][0]*t['after'][1]*4*4/3 for t in textures))}
report.write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps({k:v for k,v in manifest.items() if k not in ['geometry','textures']}))
