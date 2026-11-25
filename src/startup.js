import { diagnostics } from './telemetry.js';
// Imagery is optional; aircraft/airport assets are not. Do not leave either on an indefinite loader.
export const IMAGERY_DEADLINE_MS = 12000;
export function withAssetDeadline(promise, ms = 30000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Asset loading timed out')), ms); })]).finally(() => clearTimeout(timer));
}
export function showStartupError(text) {
  diagnostics.record('load_failure', 'startup');
  document.body.classList.add('startup-failed');
  const el = document.getElementById('loadmsg');
  if (el) { el.textContent = text; el.classList.add('err'); }
  document.querySelectorAll('#start-btn, #home-go, #just-fly, #resume-flight, #sheet-flight input, #sheet-flight select, #sheet-flight button:not(.js-terms):not(#startup-retry), #ac-cards button').forEach(b => { b.disabled = true; });
  const ls = document.getElementById('loadscreen'); if (ls) ls.hidden = true;
  const retry = document.getElementById('startup-retry');
  if (retry) { retry.hidden = false; retry.onclick = () => location.reload(); }
}
