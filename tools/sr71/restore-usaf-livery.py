"""Restore an original USAF livery atlas; never synthesize or repaint markings.

Only the shared decal texture is replaced: no mesh/material/animation JSON changes.
The output name deliberately stays stable for LOD0, LOD2, nose and gear consumers.
"""
import argparse, hashlib, json, pathlib, struct, sys

PARSER = argparse.ArgumentParser(description=__doc__)
PARSER.add_argument('--source-root', type=pathlib.Path, default=pathlib.Path('/home/Downloads/SR-71-BLACKBIRD/milviz-aircraft-sr71/SimObjects/Airplanes/BlackbirdSims_SR71'))
PARSER.add_argument('--decoder-path', type=pathlib.Path, default=pathlib.Path('/home/sr71-viewer/build-assets/py'))
args = PARSER.parse_args()
sys.path.insert(0, str(args.decoder_path))
from PIL import Image
import texture2ddecoder as td
import zstandard as zstd

GAME = pathlib.Path(__file__).resolve().parents[2]
OUT = GAME / 'public/models/sr71/exterior'
PROOF = GAME.parent / 'livery-proof'
PROOF.mkdir(parents=True, exist_ok=True)
REL = pathlib.Path('liveries/milviz/61-7950_2001/texture.exterior/SR-71_EXT_DECALS_ALBD.PNG.KTX2')
src = args.source_root / REL
blob = src.read_bytes()
assert blob[:12] == b'\xabKTX 20\xbb\r\n\x1a\n'
fmt, _, width, height, _, _, _, levels, scheme = struct.unpack_from('<9I', blob, 12)
assert fmt in (137,138,145,146), ('Unexpected source atlas format', fmt)
level = 0
while max(width >> level, height >> level) > 4096 and level + 1 < levels:
    level += 1
w,h = max(1,width >> level),max(1,height >> level)
offset,length,raw_length = struct.unpack_from('<3Q',blob,80 + 24*level)
data = blob[offset:offset+length]
assert scheme in (0,2)
if scheme == 2:
    data = zstd.ZstdDecompressor().decompress(data,max_output_size=raw_length)
decode = td.decode_bc3 if fmt in (137,138) else td.decode_bc7
image = Image.frombytes('RGBA',(w,h),decode(data,w,h),'raw','BGRA')
# Same maintained BCn decoder and BGRA interpretation as build-assets/convert.py.
# Use an authored mip with no resampling or compositing.
target = OUT / 'textures/sr-71_ext_decals_albd.webp'
old = target.read_bytes()
backup = PROOF/'before-sr-71_ext_decals_albd.webp'
if not backup.exists():
    backup.write_bytes(old)
image.save(target,'WEBP',lossless=True,exact=True,method=6)
with Image.open(target) as result:
    assert result.convert('RGBA').tobytes() == image.tobytes()
sha = lambda b: hashlib.sha256(b).hexdigest()
rgba_sha = sha(image.tobytes())
proof = {
    'livery':'61-7950 (2001)',
    'reference':'Latest user 3-image.png: white U.S. AIR FORCE, outlined stars-and-bars on fuselage/wing and native stencils. Serial/tail not legible; exact airframe cannot be identified from the crop.',
    'selection':'Unembellished original USAF family matching visible reference markings; chosen among all 38 supplied atlas variants. Blackbird/EVH vendor-display atlases rejected.',
    'source':str(REL), 'sourceSha256':sha(blob),'sourceFormat':fmt,
    'sourceSize':[width,height],'authoredMip':level,'deliveredSize':[w,h],
    'output':'textures/sr-71_ext_decals_albd.webp','outputSha256':sha(target.read_bytes()),
    'rgbaSha256':rgba_sha,'outputBytes':target.stat().st_size,
    'encoding':'WebP lossless exact RGBA; original authored mip; no synthetic markings, erasing, repainting, UV changes or geometry changes',
    'previousTextureSha256':sha(backup.read_bytes()),
    'decoder':'texture2ddecoder BCn and Pillow, matching original viewer build-assets/convert.py',
    'unchanged':['All glTF material and mesh references','All geometry and animation binary files','Existing source stencil atlases','src/main.js','src/sr71visual.js']
}
(PROOF/'usaf-livery-source-proof.json').write_text(json.dumps(proof,indent=2)+'\n')
print(json.dumps(proof,indent=2))
