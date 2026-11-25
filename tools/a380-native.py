#!/usr/bin/env python3
"""Package byte-for-byte original DDS with converted geometry; all <=25MiB.
No proprietary simulator files/code, only referenced FBW model textures.
Usage: python3 tools/a380-native.py extracted-source public/models/a380x
"""
import pathlib,json,sys,hashlib,os,struct
r=pathlib.Path(sys.argv[1]);o=pathlib.Path(sys.argv[2]);(o/'dds').mkdir(exist_ok=True)
textures={}
for name in ['a380_exterior','a380_cockpit']:
 src=json.loads((r/'model'/f'{name}.gltf').read_text());g=json.loads((o/f'{name}.gltf').read_text())
 assert len(g['images'])==len(src['images'])
 for a,b in zip(g['images'],src['images']):
  uri=b['uri'];p=r/'texture'/uri;q=o/'dds'/uri
  assert p.stat().st_size<=25*1024*1024
  if not q.exists():os.link(p,q)
  a['uri']='dds/'+uri;a.pop('mimeType',None)
  head=p.open('rb').read(148);h,w=struct.unpack_from('<II',head,12);four=head[84:88]
  textures[uri]={'url':'dds/'+uri,'source':str(p.relative_to(r)),'bytes':p.stat().st_size,'sha256':hashlib.file_digest(p.open('rb'),'sha256').hexdigest(),'width':w,'height':h,'fourCC':four.decode(),'dxgiFormat':struct.unpack_from('<I',head,128)[0] if four==b'DX10' else None}
 g['asset']['generator']='Earthwing FBW A380 exact geometry repack + original DDS (A380DDSLoader required)'
 g['asset']['extras']['textureEncoding']='Original DDS, unchanged blocks and mipmaps. Configure A380DDSLoader.'
 text=json.dumps(g,separators=(',',':'))
 (o/f'{name}.native.gltf').write_text(text)
 (o/f'{name}.gltf').write_text(text)
(o/'native-manifest.json').write_text(json.dumps({'version':1,'status':'awaiting-browser-verification','models':['a380_exterior.native.gltf','a380_cockpit.native.gltf'],'textures':sorted(textures.values(),key=lambda x:x['url']),'textureBytes':sum(x['bytes'] for x in textures.values()),'textureFileCount':len(textures),'texturePolicy':'Exact original DDS bytes, all mip levels preserved, no downsampling/re-encoding','maxFileBytes':max(x['bytes'] for x in textures.values())},indent=2))
print('Native DDS:',len(textures),'files',sum(x['bytes'] for x in textures.values()),'bytes')
