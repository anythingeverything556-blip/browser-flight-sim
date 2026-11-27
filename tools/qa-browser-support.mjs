// Shared fixture support; no browser, HTTP listener or external service starts on import.
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

export function chromeExecutable({ env = process.env, exists = existsSync } = {}) {
  const candidates = env.CHROME_PATH ? [env.CHROME_PATH] : [
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ...[env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean)
      .map(base => path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe')),
  ];
  const executable = candidates.find(candidate => exists(candidate));
  if (!executable) throw new Error('Chrome/Chromium not found. Set CHROME_PATH to an installed browser executable.');
  return executable;
}
export { puppeteer };
export async function createPage(browser, { viewport } = {}) {
  const page = await browser.newPage();
  if (viewport) await page.setViewport(viewport);
  return page;
}
export function fixtureURL(relative, base = process.env.SR71_TEST_BASE || 'http://127.0.0.1:5173') {
  const url = new URL(base);
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) || url.username || url.password)
    throw new Error('SR71_TEST_BASE must be a local HTTP loopback fixture, not a live service.');
  const target = new URL(relative, url.origin);
  if (target.origin !== url.origin) throw new Error('Fixture paths must remain on the local loopback origin.');
  return target.href;
}
export async function evidenceDirectory(name = '') {
  const directory = path.resolve(process.env.SR71_TEST_OUTPUT || '.scratch/sr71', name);
  await mkdir(directory, { recursive: true });
  return directory;
}
export const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
export async function waitForEvidence(predicate, { timeout = 20000, interval = 50, label = 'fixture condition' } = {}) {
  const deadline = performance.now() + timeout;
  do {
    if (await predicate()) return;
    const remaining = deadline - performance.now();
    if (remaining <= 0) throw new Error(`${label} not observed within ${timeout} ms`);
    await delay(Math.min(interval, remaining));
  } while (true);
}
export function isSR71ModelRequest(input) {
  // Current delivery tree includes manifests, geometry, animation and texture payloads.
  return new URL(input).pathname.startsWith('/models/sr71/');
}
// Reject bind errors instead of leaving an unresolved listen promise/uncaught error.
export function listenLoopback(server) {
  return new Promise((resolve, reject) => {
    const onError = error => { server.off('listening', onListening); reject(error); };
    const onListening = () => { server.off('error', onError); resolve(`http://127.0.0.1:${server.address().port}`); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });
}
export async function writeCheckpointAround(file, snapshot, operation) {
  const save = () => writeFile(file, JSON.stringify(snapshot(), null, 2) + '\n');
  await save();
  try { return await operation(); }
  finally { await save(); }
}
