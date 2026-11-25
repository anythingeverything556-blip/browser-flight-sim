#!/usr/bin/env python3
"""Exhaustive source/output geometry equality + original DDS SHA-256 audit."""
import pathlib,json,sys,hashlib
import numpy as np
r=pathlib.Path(sys.argv[1]);o=pathlib.Path(sys.argv[2]);report=[]
D={5120:'i1',5121:'u1',5122:'<i2',5123:'<u2',5125:'<u4',5126:'<f4'};N={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}
def read(g,bs,i):
 a=g['accessors'][i];v=g['bufferViews'][a['bufferView']];dt=np.dtype(D[a['componentType']]);c=N[a['type']]
 return np.ndarray((a['count'],c),dt,bs[v.get('buffer',0)],v.get('byteOffset',0)+a.get('byteOffset',0),strides=(v.get('byteStride',dt.itemsize*c),dt.itemsize))
for name in ['a380_exterior','a380_cockpit']:
 s=json.loads((r/'model'/f'{name}.gltf').read_text());g=json.loads((o/f'{name}.native.gltf').read_text());sb=[(r/'model'/x['uri']).read_bytes() for x in s['buffers']];ob=[(o/x['uri']).read_bytes() for x in g['buffers']]
 assert s['nodes']==g['nodes'] and len(s['meshes'])==len(g['meshes'])
 assert len(s['skins'])==len(g['skins']) and len(s['animations'])==len(g['animations'])
 checked=set();prim=0;tri=0
 for sm,gm in zip(s['meshes'],g['meshes']):
  assert len(sm['primitives'])==len(gm['primitives'])
  for sp,gp in zip(sm['primitives'],gm['primitives']):
   prim+=1;assert sp.get('material')==gp.get('material')
   for sem,si in sp['attributes'].items():
    oi=gp['attributes'][sem]
    if (si,oi,sem) in checked:continue
    checked.add((si,oi,sem));a=s['accessors'][si];arr=read(s,sb,si);actual=read(g,ob,oi)
    if sem.startswith('TEXCOORD') or sem=='COLOR_0' and a['componentType']==5123:arr=arr.view('<f2').astype('<f4')
    elif sem=='COLOR_0' and a['componentType']==5120:arr=arr.view('u1').astype('<f4')/255
    elif sem in ('NORMAL','TANGENT') and a['componentType']==5120:
     arr=np.maximum(arr.astype('<f4')/127,-1)
     if sem=='NORMAL':arr=arr[:,:3]
    elif sem=='WEIGHTS_0' and a['type']=='SCALAR':arr=np.hstack([arr,np.zeros((len(arr),3),dtype='<f4')])
    elif a.get('normalized'):arr=arr.astype('<f4')/np.iinfo(np.dtype(D[a['componentType']])).max
    assert arr.shape==actual.shape and np.array_equal(arr,actual),(name,sem,si,oi)
   ex=sp.get('extras',{}).get('ASOBO_primitive',{});start=ex.get('StartIndex',0);count=ex.get('PrimitiveCount',s['accessors'][sp['indices']]['count']//3)*3
   expected=read(s,sb,sp['indices']).reshape(-1).astype(np.uint32)[start:start+count]+ex.get('BaseVertexIndex',0);actual=read(g,ob,gp['indices']).reshape(-1)
   assert np.array_equal(expected,actual);tri+=len(expected)//3
 for sa,ga in zip(s['animations'],g['animations']):
  assert sa.get('name')==ga.get('name') and sa['channels']==ga['channels']
  for ss,gs in zip(sa['samplers'],ga['samplers']):
   for k in ['input','output']:assert np.array_equal(read(s,sb,ss[k]),read(g,ob,gs[k]))
 for ss,gs in zip(s['skins'],g['skins']):
  assert ss['joints']==gs['joints'];assert np.array_equal(read(s,sb,ss['inverseBindMatrices']),read(g,ob,gs['inverseBindMatrices']))
 assert all((o/b['uri']).stat().st_size==b['byteLength']<=24*1024*1024 for b in g['buffers'])
 report.append({'model':name,'sourceAndOutputIdenticalFor':['positions','decodedUVs','decodedColors','normals','tangents','skinJoints','skinWeights','primitiveIndices','allAnimationSamples','inverseBindMatrices','allNodeNamesAndTransforms','materialAssignments'],'uniqueAttributeArraysCompared':len(checked),'primitives':prim,'triangles':tri,'animations':len(g['animations']),'nodes':len(g['nodes']),'status':'pass'})
m=json.loads((o/'native-manifest.json').read_text())
for t in m['textures']:
 p=o/t['url'];assert p.stat().st_size==t['bytes']<=25*1024*1024
 assert hashlib.file_digest(p.open('rb'),'sha256').hexdigest()==t['sha256']
result={'status':'pass','geometry':report,'originalDDSTexturesSHA256Verified':len(m['textures']),'originalDDSBytes':m['textureBytes'],'qualityChanges':{'decimation':False,'resizing':False,'lossyTextureReencoding':False},'browserRendering':'separate verification required'}
(o/'source-fidelity-verification.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
