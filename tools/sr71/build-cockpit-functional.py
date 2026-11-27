"""Restore selected source functionality without changing geometry or sample bytes.
Run after build-cockpit.py/build-cockpit-mips.py. Only restored original emissive
maps are new imagery; exact authored 1024 mip pixels, lossless WebP encoding.
"""
from pathlib import Path
import json,sys,struct,hashlib
sys.path.insert(0,'/home/sr71-viewer/build-assets/py')
import zstandard as zstd
import texture2ddecoder as td
from PIL import Image
ROOT=Path('/home/Downloads/SR-71-BLACKBIRD/milviz-aircraft-sr71/SimObjects/Airplanes/BlackbirdSims_SR71')
OUT=Path(__file__).resolve().parents[2]/'public/models/sr71/cockpit'
SRC=ROOT/'attachments/blackbird/Part_Interior_Cockpit/model/SR71_Interior_LOD0.gltf'
src=json.loads(SRC.read_text());d=json.loads((OUT/'cockpit-flight.gltf').read_text());proof=[]
sha=lambda b:hashlib.sha256(b).hexdigest()
allowed={'SR-71_Decals_int_01','SR-71_Decals_int_02_Standard','SR-71_Decals_int_02','SR-71_Decals_int_01_Standard','SR-71_Decals_int_01_draw_Order3','SR-71_Decals_int_02_Ball','Decals_int_01_behind','LIGHTS'}
byname={m['name']:m for m in src['materials']};sourcefiles={p.name.lower():p for folder in [ROOT/'common/texture',ROOT/'attachments/blackbird/Part_Interior_Cockpit/texture'] for p in folder.glob('*.KTX2')}
cache={}
for m in d['materials']:
 if m['name'] not in allowed:continue
 sm=byname[m['name']];t=src['textures'][sm['emissiveTexture']['index']];im=t.get('source',t.get('extensions',{}).get('MSFT_texture_dds',{}).get('source'));name=src['images'][im]['uri'].replace('\\','/').split('/')[-1].lower();p=sourcefiles[name]
 if name not in cache:
  b=p.read_bytes();fmt,_,w,h,_,_,_,levels,scheme=struct.unpack_from('<9I',b,12);level=0
  while max(w>>level,h>>level)>1024 and level+1<levels:level+=1
  ww,hh=max(1,w>>level),max(1,h>>level);off,ln,rawlen=struct.unpack_from('<3Q',b,80+24*level);raw=b[off:off+ln]
  if scheme==2:raw=zstd.ZstdDecompressor().decompress(raw,max_output_size=rawlen)
  assert scheme in [0,2]
  decode=td.decode_bc1 if fmt in [131,132,133,134] else td.decode_bc3 if fmt in [137,138] else td.decode_bc7 if fmt in [145,146] else None
  pixels=Image.frombytes('RGBA',(ww,hh),decode(raw,ww,hh) if decode else raw,'raw','BGRA' if decode else 'RGBA')
  dest=OUT/'textures'/'functional-emission'/name.replace('.png.ktx2','.webp');dest.parent.mkdir(exist_ok=True);pixels.save(dest,'WEBP',lossless=True,exact=True,method=6)
  assert Image.open(dest).convert('RGBA').tobytes()==pixels.tobytes()
  ii=len(d['images']);d['images'].append({'uri':str(dest.relative_to(OUT)),'mimeType':'image/webp'});ti=len(d['textures']);d['textures'].append({'sampler':0,'extensions':{'EXT_texture_webp':{'source':ii}}});cache[name]=ti
  proof.append({'source':str(p.relative_to(ROOT)),'sourceSha256':sha(b),'mip':level,'dimensions':[ww,hh],'decodedRgbaSha256':sha(pixels.tobytes()),'losslessWebpPixelsVerified':True,'bytes':dest.stat().st_size})
 m['emissiveTexture']={'index':cache[name]};m['emissiveFactor']=[0,0,0]
 if m['name']!='LIGHTS':m.setdefault('extras',{})['sr71InstrumentBacklight']=True
(OUT/'cockpit-flight.gltf').write_text(json.dumps(d,separators=(',',':')))
manifest=json.loads((OUT/'manifest.json').read_text());manifest['cockpitFunctionality']={'version':1,'clips':json.loads((Path(__file__).parent/'cockpit-active-clips.json').read_text()),'telemetry':['TDI KEAS whole digits','TDI Earthwing MSL altitude whole digits','TDI Mach hundredths whole digits','Primary and standby ADI pitch/bank','Primary and standby bank pointers','HSI and standby compass with Earthwing true heading'],'lighting':'Nine original dimmers/switch with original sampled control motion, authored fixture helpers, effect color/range/cone, independently controlled fixture emission; restored authored instrument emission masks. Photometry/electrical logic approximate.','unsupported':['Analog IAS/Mach/IVSI needle transfer functions and traditional barometric altimeter remain compiled-WASM-only','Military/navigation/electrical/oxygen systems not emulated']};(OUT/'manifest.json').write_text(json.dumps(manifest,separators=(',',':')))
report={'sourceModel':str(SRC.relative_to(ROOT)),'sourceSha256':sha(SRC.read_bytes()),'textures':proof,'sourceMaterialMasks':[m['name']for m in d['materials'] if m.get('emissiveTexture')],'totalEmissionTextureBytes':sum(p['bytes']for p in proof)}
Path('/home/earthwing-sr71-integration/asset-build/cockpit-emission-proof.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
