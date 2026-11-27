"""Decode original authored cockpit mips, no resampling or invented texture pixels.
Keep full converted maps for explicit close inspection; only cockpit flight JSON changes.
"""
from pathlib import Path
import json,sys,struct,hashlib,re
sys.path.insert(0,'/home/sr71-viewer/build-assets/py')
import zstandard as zstd
import texture2ddecoder as td
from PIL import Image
ROOT=Path('/home/Downloads/SR-71-BLACKBIRD/milviz-aircraft-sr71/SimObjects/Airplanes/BlackbirdSims_SR71')
OUT=Path(__file__).resolve().parents[2]/'public/models/sr71/cockpit'
d=json.loads((OUT/'cockpit-flight.gltf').read_text());target=OUT/'textures/flight-mips';target.mkdir(exist_ok=True);report=[]
dirs=[ROOT/'attachments/blackbird/Part_Interior_Cockpit/texture',ROOT/'common/texture']
files={re.sub(r'[^a-z0-9_-]','_',p.name.lower().removesuffix('.png.ktx2'))+'.webp':p for dr in reversed(dirs) for p in dr.iterdir() if p.is_file() and p.name.lower().endswith('.ktx2')}
for im in d['images']:
 name=Path(im['uri']).name;src=files.get(name)
 if not src:raise RuntimeError('Missing original cockpit texture '+name)
 b=src.read_bytes();fmt,_,w,h,_,_,_,levels,scheme=struct.unpack_from('<9I',b,12)
 # Main gauge/label/decal atlases retain their established readable 2K/4K size.
 # Body, floor, seat and other surface atlases use authored 1K texture mips.
 full=('decals' in name or 'decal_set' in name or '_ind_' in name or '_m01_' in name or '_m02_' in name or '_m03_' in name)
 maxdim=4096 if full and 'decals' in name else 2048 if full else 1024
 level=0
 while max(w>>level,h>>level)>maxdim and level+1<levels:level+=1
 ww,hh=max(1,w>>level),max(1,h>>level)
 baseline=OUT/'textures'/name
 oldsize=Image.open(baseline).size
 if max(oldsize)<=maxdim:continue
 off,ln,rawlen=struct.unpack_from('<3Q',b,80+24*level);data=b[off:off+ln]
 if scheme==2:data=zstd.ZstdDecompressor().decompress(data,max_output_size=rawlen)
 assert scheme in [0,2]
 if fmt in [131,132,133,134]:rgba=td.decode_bc1(data,ww,hh)
 elif fmt in [137,138]:rgba=td.decode_bc3(data,ww,hh)
 elif fmt in [145,146]:rgba=td.decode_bc7(data,ww,hh)
 elif fmt in [37,43]:rgba=None
 else:raise RuntimeError((src,fmt))
 pixels=Image.frombytes('RGBA',(ww,hh),rgba or data,'raw','BGRA' if rgba else 'RGBA')
 dest=target/name
 # Encoding matches established baseline WebP quality91. Mip selection is authored.
 pixels.save(dest,'WEBP',quality=91,method=6)
 report.append({'source':str(src.relative_to(ROOT)),'sourceSha256':hashlib.sha256(b).hexdigest(),'level':level,'dimensions':[ww,hh],'originalDelivered':list(oldsize),'beforeBytes':baseline.stat().st_size,'afterBytes':dest.stat().st_size,'sha256':hashlib.sha256(dest.read_bytes()).hexdigest()})
 im['uri']='textures/flight-mips/'+name
(OUT/'cockpit-flight.gltf').write_text(json.dumps(d,separators=(',',':')))
Path('/home/earthwing-sr71-integration/asset-build/cockpit-mip-proof.json').write_text(json.dumps({'policy':'Original 1K surface mips; gauge/label/decal atlases retained at existing 2K/4K; existing full texture set retained','textures':report,'savedTransferBytes':sum(x['beforeBytes']-x['afterBytes'] for x in report)},indent=2));print('textures',len(report),'saved MB',sum(x['beforeBytes']-x['afterBytes'] for x in report)/1e6)
