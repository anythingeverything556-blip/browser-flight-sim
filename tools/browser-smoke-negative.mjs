import { spawnSync } from 'node:child_process';
const result=spawnSync(process.execPath,['tools/browser-smoke.mjs','--inject-failure'],{encoding:'utf8',timeout:240000,maxBuffer:2*1024*1024,env:process.env});
if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);
const detected=result.status===1 && ['"kind": "console"','"kind": "page"','"kind": "shader"'].every(token=>result.stdout.includes(token));
console.log(detected?'PASS controlled console/page/GLSL failures all rejected with exit 1':'FAIL smoke negative control did not detect all required failures');
process.exitCode=detected?0:1;
