// Shared with Settings / Help: camera keys use the same saved binding table as flight controls.
export const CAMERA_ACTIONS = [
  { id: 'cameraLeft', label: 'Look / pan left (hold)', group: 'Camera', hold: true, keys: ['Delete', 'Numpad7'] },
  { id: 'cameraRight', label: 'Look / pan right (hold)', group: 'Camera', hold: true, keys: ['Insert', 'Numpad9'] },
  { id: 'cameraUp', label: 'Look / pan up (hold)', group: 'Camera', hold: true, keys: ['Home', 'Numpad8'] },
  { id: 'cameraDown', label: 'Look / pan down (hold)', group: 'Camera', hold: true, keys: ['End', 'Numpad2'] },
  { id: 'cameraZoomIn', label: 'Zoom in (hold)', group: 'Camera', hold: true, keys: ['Digit8', 'NumpadMultiply'] },
  { id: 'cameraZoomOut', label: 'Zoom out (hold)', group: 'Camera', hold: true, keys: ['Digit7', 'NumpadDivide'] },
  { id: 'cameraRecenter', label: 'Recenter view and reset zoom', group: 'Camera', keys: ['Digit1', 'NumpadDecimal'] },
];
const INTERACTIVE = 'input, textarea, select, button, a[href], [role="slider"], [role="radio"], [role="combobox"], .leaflet-container, [contenteditable]:not([contenteditable="false"])';

export function bindCameraControls({ rig, controls, document, active = () => true }) {
  const allowed = () => {
    if (!controls.enabled || !active() || document.hidden || document.hasFocus?.() === false) return false;
    if (document.body.classList.contains('sheet-open') || document.body.classList.contains('intro')) return false;
    const focus = document.activeElement;
    if (focus?.isContentEditable || focus?.closest?.(INTERACTIVE)) return false;
    // Check visibility, not only aria-modal: the crash overlay remains in the DOM when closed.
    return ![...document.querySelectorAll('dialog[open], [aria-modal="true"]')]
      .some(el => !el.hidden && el.getClientRects().length > 0);
  };
  rig.inputEnabled = allowed;
  controls.on('cameraRecenter', () => { if (allowed()) rig.recenter(); });
  return {
    update(dt) {
      if (!allowed()) { rig.cancelDrag(); return; }
      const held = id => Number(controls.held(id));
      const yaw = held('cameraLeft') - held('cameraRight');
      const pitch = held('cameraUp') - held('cameraDown');
      const zoom = held('cameraZoomOut') - held('cameraZoomIn');
      const step = Math.max(0, Math.min(dt, 0.1));
      if (yaw || pitch) rig.pan(yaw * step, pitch * step);
      if (zoom) rig.zoom(Math.exp(zoom * step));
    },
  };
}
