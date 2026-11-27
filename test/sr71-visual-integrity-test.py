from pathlib import Path
import json,sys,hashlib
sys.path.insert(0,'/home/sr71-viewer/build-assets/py')
import zstandard as zs
R=Path('/home/earthwing-sr71-integration');D=R/'game/public/models/sr71/exterior';P=R/'asset-build/visual-parity/source-proof.json';proof=json.loads(P.read_text());j=json.loads((D/'cabin-flight.gltf').read_text());raw=zs.ZstdDecompressor().decompress((D/'cabin-flight.bin.zst.part00').read_bytes());assert len(raw)==j['buffers'][0]['byteLength'];assert len(j['accessors'])==len(proof['cabin']['accessorProof'])
for i,(a,p) in enumerate(zip(j['accessors'],proof['cabin']['accessorProof'])):
 v=j['bufferViews'][a['bufferView']];data=raw[v['byteOffset']:v['byteOffset']+v['byteLength']];assert len(data)==p['bytes'];assert hashlib.sha256(data).hexdigest()==p['sha256'],i
for im in j['images']:assert(D/im['uri']).exists(),im['uri']
assert not j.get('animations');assert not j.get('skins');assert all(a['componentType'] in[5123,5125,5126] for a in j['accessors']);assert hashlib.sha256((D/'textures/sr-71_chassis_b01_albd.webp').read_bytes()).hexdigest()==proof['rubber']['sourceSha256'];print('PASS',len(j['accessors']),'exact normalized original cabin accessor byte hashes; all texture references resolve; original chassis atlas unchanged; no animation/skin/procedural plug')
