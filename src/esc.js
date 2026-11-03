// Text from third parties (live traffic callsigns, types, hex ids) goes into HTML strings that Leaflet inserts with innerHTML: escape it first.
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
