import { KEY_ACTIONS, RESERVED_KEYS, resolveKeys, keyOverrides, assignKey, keyName } from './controls.js';

// Settings → Keyboard controls: every action with its keys as chips (× removes one), + listens for a new key (Shift chords allowed, Shift alone
// for held controls), ↺ puts an action back to its default, and Reset all. Saved as overrides in settings.keys; the help table and the throttle
// lever's hint are drawn from the same table, so they always show the keys in use.
const GROUP_ORDER = [...new Set(KEY_ACTIONS.map((a) => a.group))];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function mountKeymap({ root, help, leverHint, controls, settings, save, toast }) {
  let table = resolveKeys(settings.keys), listening = null; // { id, el, shift }
  const apply = () => {
    controls.setBindings(table);
    const o = keyOverrides(table);
    if (Object.keys(o).length) settings.keys = o; else delete settings.keys;
    save(); render();
  };
  const keysOf = (id) => table[id].map(keyName).join(' · ') || '—';

  function render() {
    const def = resolveKeys(null);
    root.innerHTML = GROUP_ORDER.map((g) => `<div class="km-group"><div class="km-head">${esc(g)}</div>${KEY_ACTIONS.filter((a) => a.group === g).map((a) => {
      const changed = table[a.id].join('|') !== def[a.id].join('|'), on = listening && listening.id === a.id;
      const chips = table[a.id].map((k) => `<span class="km-key">${esc(keyName(k))}<button type="button" class="km-del" data-id="${a.id}" data-key="${esc(k)}" aria-label="Remove ${esc(keyName(k))} from ${esc(a.label)}">×</button></span>`).join('');
      return `<div class="km-row${on ? ' listening' : ''}${table[a.id].length ? '' : ' empty'}"><span class="km-label">${esc(a.label)}</span><span class="km-keys">${chips || '<span class="km-none">no key</span>'}${on
        ? `<span class="km-wait" role="status">Press a key${a.hold ? ' (or Shift alone)' : ''}… Esc cancels</span>`
        : `<button type="button" class="km-add" data-id="${a.id}" aria-label="Add a key for ${esc(a.label)}">+</button>`}${changed ? `<button type="button" class="km-reset" data-id="${a.id}" title="Back to ${esc(def[a.id].map(keyName).join(' · '))}" aria-label="Reset ${esc(a.label)} to its default keys">↺</button>` : ''}</span></div>`;
    }).join('')}</div>`).join('') + '<div class="km-foot"><button type="button" class="endbtn" id="km-reset-all">Reset all keys to the defaults</button></div>';
    renderHelp();
    // the hint names the first key per direction as a keycap; the full list (up to five aliases each) lives in Help
    const cap = (id) => (table[id].length ? `<kbd>${esc(keyName(table[id][0]))}</kbd>` : '—');
    if (leverHint) leverHint.innerHTML = `<b>Throttle</b><br>Drag the lever, or hold ${cap('throttleUp')} ▲ ${cap('throttleDown')} ▼`;
  }
  function renderHelp() {
    if (!help) return;
    help.innerHTML = GROUP_ORDER.map((g) => `<tr><th colspan="2">${esc(g)}</th></tr>` + KEY_ACTIONS.filter((a) => a.group === g).map((a) => `<tr><td>${esc(keysOf(a.id))}</td><td>${esc(a.label)}</td></tr>`).join('')).join('')
      + '<tr><th colspan="2">Change any of these</th></tr><tr><td>Settings</td><td>Keyboard controls: click + on a row and press the new key</td></tr>';
  }
  function finish(key) {
    const a = KEY_ACTIONS.find((x) => x.id === listening.id); listening = null;
    const r = assignKey(table, a.id, key);
    if (!r.ok) { toast(r.why, true); render(); return; }
    if (r.moved.length) toast(`${keyName(key)} now: ${a.label} (taken from ${r.moved.map((id) => KEY_ACTIONS.find((x) => x.id === id).label).join(', ')})`, true);
    else toast(`${keyName(key)}: ${a.label}`);
    apply();
  }
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (!b.classList.contains('km-add')) listening = null;
    if (b.classList.contains('km-add')) { listening = { id: b.dataset.id, shift: false }; render(); return; }
    if (b.classList.contains('km-del')) { table[b.dataset.id] = table[b.dataset.id].filter((k) => k !== b.dataset.key); apply(); return; }
    if (b.classList.contains('km-reset')) { table[b.dataset.id] = [...resolveKeys(null)[b.dataset.id]]; apply(); return; }
    if (b.id === 'km-reset-all') { table = resolveKeys(null); listening = null; apply(); toast('All keys back to the defaults'); }
  });
  // while listening the key goes to the editor only (capture phase, before the game and the Esc-closes-menu handler)
  addEventListener('keydown', (e) => {
    if (!listening) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.repeat) return;
    if (e.code === 'Escape') { listening = null; render(); return; }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { listening.shift = true; return; }
    if (e.ctrlKey || e.altKey || e.metaKey || RESERVED_KEYS.has(e.code)) { toast('Ctrl, Alt, ⌘, Tab, Caps Lock and Esc belong to the browser — pick another key', true); return; }
    listening.shift = false; finish((e.shiftKey ? 'Shift+' : '') + e.code);
  }, true);
  addEventListener('keyup', (e) => {
    if (!listening) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && listening.shift) finish('Shift');
  }, true);
  // a click outside the list stops listening
  addEventListener('pointerdown', (e) => { if (listening && !root.contains(e.target)) { listening = null; render(); } }, true);
  render();
  controls.setBindings(table);
  return { keysOf, render };
}
