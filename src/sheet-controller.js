// DOM-only panel state; aircraft, map and airport behavior stays with the caller.
export function createSheetController({ document, buttons, onOpen, returnFocus = () => document.activeElement?.blur() }) {
  buttons.forEach(b => {
    b.setAttribute('aria-controls', 'sheet-' + b.dataset.sheet);
    b.setAttribute('aria-expanded', String(!!document.getElementById('sheet-' + b.dataset.sheet)?.classList.contains('open')));
  });
  return (id, force) => {
    const el = id && document.getElementById('sheet-' + id);
    const open = el ? (force ?? !el.classList.contains('open')) : false;
    const active = document.activeElement;
    const panels = [...document.querySelectorAll('.sheet')];
    const closing = panels.filter(p => p.classList.contains('open') && (!open || p !== el));
    const hiddenFocus = closing.some(p => p.contains(active));
    const triggerFocus = buttons.some(b => b === active && closing.some(p => p.id === 'sheet-' + b.dataset.sheet));
    panels.forEach(p => p.classList.remove('open'));
    buttons.forEach(b => {
      const selected = !!open && b.dataset.sheet === id;
      b.classList.toggle('on', selected);
      b.setAttribute('aria-expanded', String(selected));
    });
    document.body.classList.toggle('sheet-open', !!open);
    document.body.classList.toggle('sheet-wide', !!open && el.classList.contains('wide'));
    if (!open) {
      if (hiddenFocus || triggerFocus) returnFocus();
      return;
    }
    el.classList.add('open');
    onOpen(id);
    // A programmatic panel switch must not leave focus in its hidden predecessor.
    if (hiddenFocus) buttons.find(b => b.dataset.sheet === id)?.focus();
  };
}
