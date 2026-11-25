import { spawnSync } from 'node:child_process';
const result=spawnSync(process.execPath,['tools/browser-smoke.mjs','--inject-failure'],{encoding:'utf8',timeout:240000,maxBuffer:2*1024*1024,env:process.env});
if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);
let report;try{report=JSON.parse(result.stdout);}catch{}
const expected=error=>error.kind==='console'
  ? error.detail==='Controlled smoke console failure' || (error.detail.startsWith('THREE.WebGLProgram: Shader Error') && error.detail.includes('definitely_missing'))
  : error.kind==='page' ? ['Controlled smoke page failure','Uncaught Error: Controlled smoke page failure'].includes(error.detail)
  : error.kind==='shader' && error.detail==='Shader/program diagnostics failed';
const detected=result.status===1 && report?.injected===true && report.errors.length>=3
  && ['console','page','shader'].every(kind=>report.errors.some(error=>error.kind===kind))
  && report.errors.every(expected) && !report.missingLocal.length
  && report.report?.failedPrograms>0;
console.log(detected?'PASS only controlled console/page/GLSL failures rejected with exit 1; no unrelated errors':'FAIL negative control missing expected failure or observed unrelated error');
process.exitCode=detected?0:1;
