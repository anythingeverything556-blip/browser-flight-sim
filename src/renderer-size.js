// Keep stored settings, the range control and renderer on the same supported scale.
// Reject coercion of booleans/null/empty strings; older numeric strings are harmless.
export function normalizeRenderScale(value) {
  const n = typeof value === 'number' || (typeof value === 'string' && value.trim() !== '') ? Number(value) : NaN;
  if (!Number.isFinite(n)) return 1;
  return Math.round(Math.min(2.5, Math.max(0.75, n)) * 20) / 20;
}

export function effectiveRenderRatio(base, scale, adaptive, native, cockpit, isF27) {
  const scaled = base * (adaptive ? scale : 1);
  return !isF27 && cockpit ? Math.max(scaled, Math.min(base, native)) : scaled;
}

export function syncRendererSize(renderer, ratio, width, height) {
  const size = renderer.getSize({ set(x, y) { this.x = x; this.y = y; return this; } });
  if (renderer.getPixelRatio() !== ratio) renderer.setPixelRatio(ratio);
  if (size.x !== width || size.y !== height) renderer.setSize(width, height, false);
}
