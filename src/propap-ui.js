import { supportsApMode } from './propap.js';

// Availability, labels and teleport all use the same hardware/profile contract.
export function configurePropApUi(doc, cfg) {
  if (!cfg.manualThrottle) return;
  const get = id => doc.getElementById(id);
  get('ap-heading').textContent = cfg.label;
  get('sheet-ap').querySelector('.panel-summary').textContent = 'HDG / NAV / APPR and ALT / V/S. Set power yourself (E / Q); this fit has no autothrottle. K or the master button engages/disconnects. Stick or manual trim disconnects.';
  get('sheet-ap').querySelector('.note').textContent = 'Representative two-axis functions through this game panel, not added switches in the original cockpit. NAV follows the Map route; APPR follows the tuned ILS and disconnects at 200 ft AGL. No FLCH, autoland, automatic take-off, go-around or recovery. Low/high-speed pitch relief is a game aid, not certified envelope protection; manage power and disconnect if unable to hold.';
  for (const b of get('ap-modes').querySelectorAll('[data-m]')) {
    b.disabled = !supportsApMode(cfg, b.dataset.m);
    if (b.disabled) b.title = 'Not fitted to this representative autopilot';
  }
  for (const key of ['spd', 'mach']) {
    const input = get('ap-' + key), dial = input.closest('.dial');
    input.disabled = true; dial.hidden = true; dial.style.display = 'none';
  }
  for (const id of ['ap-takeoff', 'ap-cruise', 'ap-goaround']) { get(id).disabled = true; get(id).hidden = true; }
  get('tp-ap').parentElement.style.display = '';
  get('tp-ap').parentElement.querySelector('span').textContent = 'Autopilot holds altitude and heading — manual throttle';
}
