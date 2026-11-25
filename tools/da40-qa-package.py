#!/usr/bin/env python3
"""Produce a private local-preview bundle and overlay from verified files."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib, json
root=Path.cwd(); scratch=root/'.scratch/da40'; dist=scratch/'dist'
qa=json.loads((scratch/'smoke-final/smoke-positive.json').read_text())
assert qa['report']['aircraft']=='da40' and qa['report']['started'] and not qa['errors']
assert qa['transfer']['bytes']==sum((dist/p.lstrip('/')).stat().st_size for p in qa['transfer']['requests'])
assert '125 scripts: 125 passed, 0 failed' in (scratch/'full-regression-final.log').read_text()
assert (dist/'images/aircraft-da40.webp').read_bytes()==(root/'public/images/aircraft-da40.webp').read_bytes()
readme='''EARTHWING - DIAMOND DA40 NG PRIVATE PREVIEW

1. Extract this entire ZIP to a local folder.
2. Open a terminal in that folder and run: node START-DA40.mjs
   Node.js 20 or newer; no npm installation. The server listens only on your computer.
3. Open http://127.0.0.1:4184/?aircraft=da40 in Chrome or another WebGL 2 browser.
4. Click Start flight. V cycles view, F / Shift+F select flaps, Shift+N opens/closes doors while stopped, Shift+I stops/starts the engine, E/Q adjust power.

Press Ctrl+C in the terminal to stop the preview. Online map tiles still require network access. Live traffic and real-time weather feeds are disabled by this preview server. The existing optional A380 pack is not included.

The DA40 uses the original 3D flight deck and airframe, with runtime-driven animation and simplified G1000-style indications. This is not a full port of FlightGear avionics or systems, nor real flight training.

Project update: overlay the project-update/ directory on the existing Earthwing project, then copy dist/models/da40/ to that project's public/models/da40/. There is no need to replace the A380 files. Keep upstream notices and license. See project-update/notes/DA40-NG.md and project-update/tools/da40-README.md for exact corresponding source and conversion instructions. This archive is for private local use, not publication.
'''
files='''index.html NOTICE.md public/NOTICE.txt public/images/aircraft-da40.webp notes/DA40-NG.md src/aircrafts.js src/controls.js src/da40.js src/da40visual.js src/difficulty.js src/logbook.js src/main.js src/slew.js test/da40-assets-test.mjs test/da40-fdm-test.mjs test/da40-visual-test.mjs test/da40-wiring-test.mjs test/ew-guidance-regressions-test.mjs test/existing-aircraft-test.mjs test/il76-wiring-test.mjs test/scripts.json test/sf50-wiring-test.mjs tools/browser-smoke.mjs tools/da40-README.md tools/da40-convert.mjs tools/da40-qa-build.mjs tools/da40-qa-motion.mjs tools/da40-qa-package.py tools/da40-private-preview.mjs tools/da40-scene.py'''.split()
out=Path('../../out/earthwing-diamond-da40-private-preview.zip');out.parent.mkdir(exist_ok=True)
with ZipFile(out,'w',ZIP_DEFLATED,compresslevel=7) as z:
 z.write('tools/da40-private-preview.mjs','START-DA40.mjs')
 z.write('LICENSE','EARTHWING-LICENSE.txt')
 z.writestr('START-HERE.txt',readme)
 for p in sorted(dist.rglob('*')):
  if p.is_file():z.write(p,'dist/'+p.relative_to(dist).as_posix())
 for p in files:z.write(p,'project-update/'+p)
 z.write(scratch/'smoke-final/smoke-positive.json','verification/da40-browser.json')
with ZipFile(out) as z:
 assert z.testzip() is None
 for e in ('dist/models/da40/da40-ng.glb','dist/models/da40/rig.json','dist/models/da40/COPYING','START-DA40.mjs'):
  assert z.getinfo(e).file_size>0
 print('Verified file count:',len(z.namelist()))
assert out.stat().st_size<=25*1024**2
with out.open('rb') as f: print(out,out.stat().st_size,hashlib.file_digest(f,'sha256').hexdigest())
