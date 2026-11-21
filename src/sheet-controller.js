// DOM-only panel state; aircraft, map and airport behavior stays with the caller.
export function createSheetController({ document, buttons, onOpen }) {
  return (id, force) => {
    const el = id && document.getElementById('sheet-' + id);
    const open = el ? (force ?? !el.classList.contains('open')) : false;
    document.querySelectorAll('.sheet').forEach(p => p.classList.remove('open'));
    buttons.forEach(b => b.classList.remove('on'));
    document.body.classList.toggle('sheet-open', !!open);
    document.body.classList.toggle('sheet-wide', !!open && el.classList.contains('wide'));
    if (!open) return;
    el.classList.add('open');
    buttons.find(b => b.dataset.sheet === id).classList.add('on');
    onOpen(id);
  };
}
