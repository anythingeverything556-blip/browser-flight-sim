import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runScripts } from '../tools/test-runner.mjs';
const cwd = fs.mkdtempSync(path.join(os.tmpdir(),'earthwing-runner-'));
try {
  fs.writeFileSync(path.join(cwd,'fail.mjs'), "console.error('Controlled fixture failure');process.exitCode=7;");
  fs.writeFileSync(path.join(cwd,'later.mjs'), "import fs from 'node:fs';fs.writeFileSync('ran','yes');");
  fs.writeFileSync(path.join(cwd,'hang.mjs'), 'setInterval(()=>{},1000)');
  const results=runScripts(['fail.mjs','later.mjs','hang.mjs','later.mjs'],{cwd,timeout:300,log:()=>{}});
  assert.deepEqual(results.map(r=>r.ok),[false,true,false,true]);assert.equal(results[0].exit,7);assert.equal(results[2].error,'ETIMEDOUT');assert.equal(fs.readFileSync(path.join(cwd,'ran'),'utf8'),'yes');
  const manifest=JSON.parse(fs.readFileSync('test/scripts.json','utf8'));
  assert.equal(new Set(manifest).size,manifest.length);assert.ok(manifest.includes('test/terrain-bench.mjs'));
  console.log('PASS failing fixture preserved exit 7; later scripts ran; timeout bounded; terrain-bench retained');
} finally { fs.rmSync(cwd,{recursive:true,force:true}); }
