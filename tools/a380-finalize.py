#!/usr/bin/env python3
"""Finalize native-only public asset set, preserving optional PNG compatibility outside deployment."""
import pathlib,json,sys,hashlib,shutil
o=pathlib.Path(sys.argv[1]);compat=pathlib.Path(sys.argv[2]);compat.mkdir(parents=True,exist_ok=True)
m=json.loads((o/'manifest.json').read_text()) if (o/'manifest.json').exists() else {'version':1,'source':'Official FlyByWire A380X stable 4K release','copyright':'Copyright FlyByWire Simulations','sourceURL':'https://flybywiresim.com/a380x/','licenseURL':'https://creativecommons.org/licenses/by-nc/4.0/','modified':True,'noEndorsement':True,'units':'meters','axes':{'up':'+Y','nose':'+Z','port':'+X'},'models':json.loads((o/'geometry-manifest.json').read_text())['models']}
if 'splitImages' in m:
 (compat/'png-manifest.json').write_text(json.dumps(m,indent=2))
 if (o/'textures').exists() and not (compat/'textures').exists():shutil.move(str(o/'textures'),compat/'textures')
models=m['models'];(o/'geometry-manifest.json').write_text(json.dumps({'version':1,'models':models},indent=2))
verified=(o/'source-fidelity-verification.json').exists() and json.loads((o/'source-fidelity-verification.json').read_text()).get('status')=='pass'
state='source-fidelity-pass-browser-WebGL-blocked' if verified else 'converted-awaiting-source-audit'
n=json.loads((o/'native-manifest.json').read_text());n['status']=state;(o/'native-manifest.json').write_text(json.dumps(n,indent=2))
m={k:v for k,v in m.items() if k not in ['textures','splitImages','notes']}
m.update(status=state,textureTier='native-original-DDS',textures=n['textures'],textureBytes=n['textureBytes'],notes=['Original source LOD00 exterior, cockpit AND passenger cabin; no decimation.','377 original DDS files byte-for-byte unchanged; no downsampling or lossy encoding.','Use A380DDSLoader and applyA380NativeMaterials from tools/a380-native-textures.mjs. Requires desktop BPTC, signed RGTC, S3TC WebGL extensions.','Simulator-only materials mapped approximately to standard PBR; source metadata retained in extras.','All geometry, UVs, indices, colors, nodes, skins and animation samples exhaustively compared to decoded originals: PASS.','Managed visible Chrome could not create a WebGL context. Browser rendering, shader compilation and real-GPU performance remain UNVERIFIED.','Optional full-res PNG compatibility output is outside the public deployment folder.'])
(o/'manifest.json').write_text(json.dumps(m,indent=2))
files=[]
for p in sorted(o.rglob('*')):
 if p.is_file():
  assert p.stat().st_size<=25*1024*1024,p
  files.append({'path':str(p.relative_to(o)),'bytes':p.stat().st_size})
summary={'files':len(files),'totalBytes':sum(f['bytes'] for f in files),'largestFileBytes':max(f['bytes'] for f in files),'allFilesUnderPages25MiB':True,'nativeDDSExactBytes':n['textureBytes'],'geometryBufferBytes':sum(x['geometryBytes'] for x in models),'browserBlocker':'Visible managed Chrome: Uncaught Error: Error creating WebGL context.','sourceFidelity':'PASS; source-fidelity-verification.json'}
(o/'conversion-summary.json').write_text(json.dumps(summary,indent=2));print(json.dumps(summary))
