// Renderer-independent setup UI: credits must work even when WebGL cannot start.
export function mountSetupAccessibility(aircraft) {
  const terms = document.getElementById('terms');
  let returnTo = null;
  const close = () => terms.close();
  document.querySelectorAll('.js-terms').forEach(button => button.addEventListener('click', () => {
    if (terms.open) return;
    returnTo = document.activeElement; terms.hidden = false; terms.showModal();
    document.getElementById('terms-close').focus();
  }));
  document.getElementById('terms-close').addEventListener('click', close);
  terms.addEventListener('click', e => { if (e.target === terms) close(); });
  terms.addEventListener('close', () => { terms.hidden = true; returnTo?.focus(); returnTo = null; });
  // Native dialog owns Tab, Escape and focused control keys, not the flight shortcuts.
  for (const type of ['keydown', 'keyup']) window.addEventListener(type, e => {
    if (terms.open) e.stopImmediatePropagation();
  }, true);
  const picker = document.getElementById('ac-pick');
  picker.addEventListener('focusout', e => {
    if (e.relatedTarget) return;
    const focused = e.target, parent = picker.parentElement;
    requestAnimationFrame(() => {
      if (picker.parentElement !== parent && document.activeElement === document.body && focused.isConnected) focused.focus();
    });
  });
  const cards = [...document.querySelectorAll('#ac-cards .ac-card')];
  const select = card => cards.forEach(c => {
    const on = c === card; c.tabIndex = on ? 0 : -1;
    c.setAttribute('aria-checked', String(on)); c.classList.toggle('on', on);
  });
  select(cards.find(c => c.dataset.v === aircraft) || cards[0]);
  for (const card of cards) {
    card.addEventListener('click', () => select(card));
    card.addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault(); e.stopPropagation();
      const index = cards.indexOf(card), back = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
      const next = cards[e.key === 'Home' ? 0 : e.key === 'End' ? cards.length - 1 : (index + (back ? -1 : 1) + cards.length) % cards.length];
      next.focus(); next.click();
    });
  }
}
