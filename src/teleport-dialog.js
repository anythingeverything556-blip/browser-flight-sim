// Native modality makes the rest of the simulator inert, including explicit
// background focus attempts. Keep flight input disabled until focus is restored.
export function createTeleportDialog({ dialog, initialFocus, controls, isStarted, returnFocus }) {
  let opener = null, wasEnabled = false;
  function open() {
    if (dialog.open) return;
    opener = dialog.ownerDocument.activeElement;
    wasEnabled = controls.enabled;
    controls.enabled = false;
    dialog.hidden = false;
    dialog.showModal();
    initialFocus.focus({ preventScroll: true });
  }
  function close() {
    if (!dialog.open) return;
    dialog.close();
    dialog.hidden = true;
    if (opener?.isConnected && opener !== dialog.ownerDocument.body && opener.getClientRects().length) opener.focus({ preventScroll: true });
    else returnFocus();
    opener = null;
    controls.enabled = wasEnabled && isStarted();
  }
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  // Do not let flight/menu handlers observe editing keys, Tab or Escape.
  dialog.addEventListener('keydown', event => { event.stopPropagation(); });
  dialog.addEventListener('pointerdown', event => { if (event.target === dialog) { event.preventDefault(); close(); } });
  return { open, close };
}
