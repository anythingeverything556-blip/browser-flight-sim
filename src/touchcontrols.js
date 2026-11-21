export const touchOnly = (nav = navigator, media = matchMedia) => nav.maxTouchPoints > 0 && media('(pointer: coarse)').matches && !media('(any-pointer: fine)').matches;
const clamp = n => Math.max(-1, Math.min(1, n));
export function mountTouchControls(controls, parent = document.body) {
  if (!touchOnly()) return null;
  const root = document.createElement('section'); root.id = 'touch-controls'; root.setAttribute('aria-label', 'Touch flight controls');
  root.innerHTML = `<p class="touch-hint">Drag stick down to climb · sideways to roll · release to centre</p><div class="touch-stick" aria-label="Pitch and roll: drag down to pull up, sideways to roll" role="group"><span aria-hidden="true">Stick</span><i aria-hidden="true"></i></div>
    <div class="touch-levers"><label>Throttle<input class="touch-throttle" aria-label="Touch throttle" type="range" min="0" max="100" value="0"></label><label>Rudder<input class="touch-rudder" aria-label="Touch rudder; release to centre" type="range" min="-100" max="100" value="0"></label></div>
    <div class="touch-buttons"><button type="button" data-action="gear">Gear</button><button type="button" data-action="flapsDown">Flaps +</button><button type="button" data-action="flapsUp">Flaps −</button><button type="button" class="touch-brake">Brakes</button><button type="button" data-action="nextView">Camera</button></div>
    <div class="touch-access"><label>Pitch<input aria-label="Touch pitch" data-axis="pitch" type="range" min="-100" max="100" value="0"></label><label>Roll<input aria-label="Touch roll" data-axis="roll" type="range" min="-100" max="100" value="0"></label></div>`;
  parent.append(root);
  document.body.classList.add('touch-mode');
  // Native sliders and buttons retain their own keyboard semantics without also flying the aircraft.
  for (const event of ['keydown', 'keyup']) root.addEventListener(event, e => { if (e.target.matches('input, button')) e.stopPropagation(); });
  const active = () => controls.enabled && !controls.locked;
  const stick = root.querySelector('.touch-stick'); let pointer = null;
  const move = e => { if (pointer !== e.pointerId || !active()) return; const r = stick.getBoundingClientRect(); const x = clamp((e.clientX - r.left - r.width / 2) / (r.width * .4)), y = clamp((e.clientY - r.top - r.height / 2) / (r.height * .4)); controls.touch.roll = x; controls.touch.pitch = y; stick.style.setProperty('--stick-x', x * 32 + 'px'); stick.style.setProperty('--stick-y', y * 32 + 'px'); };
  const releaseStick = e => { if (e && e.pointerId !== pointer) return; pointer = null; controls.touch.pitch = controls.touch.roll = null; stick.style.setProperty('--stick-x', '0px'); stick.style.setProperty('--stick-y', '0px'); };
  stick.addEventListener('pointerdown', e => { if (!active() || pointer !== null) return; pointer = e.pointerId; stick.setPointerCapture(pointer); move(e); e.preventDefault(); });
  stick.addEventListener('pointermove', move);
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) stick.addEventListener(event, releaseStick);
  const throttle = root.querySelector('.touch-throttle');
  throttle.addEventListener('input', () => { if (active()) { controls.throttle = +throttle.value / 100; controls.touched = true; } });
  const rudder = root.querySelector('.touch-rudder');
  rudder.addEventListener('input', () => { if (active()) controls.touch.yaw = +rudder.value / 100; });
  const resetRudder = () => { controls.touch.yaw = null; rudder.value = '0'; };
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) rudder.addEventListener(event, resetRudder);
  const brake = root.querySelector('.touch-brake'); let brakePointer = null;
  brake.addEventListener('pointerdown', e => { if (!active() || brakePointer !== null) return; brakePointer = e.pointerId; brake.setPointerCapture(brakePointer); controls.touch.brake = true; e.preventDefault(); });
  const releaseBrake = e => { if (e && e.pointerId !== brakePointer) return; brakePointer = null; controls.touch.brake = false; };
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) brake.addEventListener(event, releaseBrake);
  brake.addEventListener('keydown', e => { if (active() && (e.key === ' ' || e.key === 'Enter')) { controls.touch.brake = true; e.preventDefault(); } });
  brake.addEventListener('keyup', () => { controls.touch.brake = false; });
  brake.addEventListener('blur', () => { controls.touch.brake = false; });
  for (const button of root.querySelectorAll('[data-action]')) button.addEventListener('click', () => { const action = button.dataset.action; if (controls.enabled && (!controls.locked || action === 'nextView')) controls.handlers[action]?.(); });
  for (const input of root.querySelectorAll('[data-axis]')) {
    input.addEventListener('input', () => { if (active()) controls.touch[input.dataset.axis] = +input.value / 100; });
    for (const event of ['pointerup', 'pointercancel', 'blur']) input.addEventListener(event, () => { controls.touch[input.dataset.axis] = null; input.value = '0'; });
  }
  const reset = () => { releaseStick(); releaseBrake(); resetRudder(); for (const input of root.querySelectorAll('[data-axis]')) { controls.touch[input.dataset.axis] = null; input.value = '0'; } };
  window.addEventListener('blur', reset);
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });
  new MutationObserver(() => { if (document.body.classList.contains('sheet-open') || document.body.classList.contains('intro')) reset(); }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  return { root, reset };
}
