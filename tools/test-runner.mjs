import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Fixed manifest/order, no shell expansion, bounded subprocess lifetime and output.
export function runScripts(scripts, { cwd = process.cwd(), timeout = 120000, log = console.log } = {}) {
  const results = [];
  for (const script of scripts) {
    const before = performance.now();
    const child = spawnSync(process.execPath, [script], { cwd, timeout, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8', killSignal: 'SIGKILL' });
    const ok = child.status === 0 && !child.error && !child.signal;
    log(`\n--- ${script} ---`);
    if (child.stdout) log(child.stdout.trimEnd());
    if (child.stderr) log(child.stderr.trimEnd());
    if (child.error) log(`RUNNER ERROR: ${child.error.code || 'spawn error'}`);
    const row = { script, ok, exit: child.status, signal: child.signal, error: child.error?.code || null, seconds: +((performance.now()-before)/1000).toFixed(2) };
    results.push(row);
  }
  log('\nTest script summary');
  log('Result  Seconds  Script');
  for (const r of results) log(`${r.ok ? 'PASS' : 'FAIL'}    ${r.seconds.toFixed(2).padStart(6)}  ${r.script}`);
  log(`${results.length} scripts: ${results.filter(r=>r.ok).length} passed, ${results.filter(r=>!r.ok).length} failed`);
  return results;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const scripts = JSON.parse(fs.readFileSync(new URL('../test/scripts.json', import.meta.url), 'utf8'));
  const results = runScripts(scripts);
  if (process.env.TEST_REPORT_PATH) fs.writeFileSync(process.env.TEST_REPORT_PATH, JSON.stringify(results, null, 2)+'\n');
  process.exitCode = results.every(r=>r.ok) ? 0 : 1;
}
