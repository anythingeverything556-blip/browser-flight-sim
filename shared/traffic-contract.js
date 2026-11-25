// Shared simulator traffic contract. All acquisition timestamps are Unix milliseconds;
// replaying a cached response must never reset the age of its observations.
export const RELAY_BUDGET_MS = 3000, PAGES_BUDGET_MS = 6500, CLIENT_BUDGET_MS = 9000;
export const TRAFFIC_KEEP_SECONDS = 90;
export function acquiredAt(body, now = Date.now()) {
  let value = body?.acquiredAt;
  if (value == null) {
    value = body?.now ?? body?.time;
    if (value != null) value = Number(value) < 1e12 ? Number(value) * 1000 : Number(value);
  }
  if (value == null) return body?.stale ? null : now;
  value = Number(value);
  return Number.isFinite(value) && value > 0 && value <= now + 5000 ? Math.min(now, value) : null;
}
export function observationAge(record) {
  const age = Number(record.seen_pos ?? record.seen ?? 0);
  return Number.isFinite(age) && age >= 0 ? age : Infinity;
}
// Bound fetch AND body consumption, even if an upstream ignores cancellation.
export async function withinDeadline(deadline, attempts, operation) {
  const ms = Math.max(1, Math.floor((deadline - Date.now()) / Math.max(1, attempts)));
  const controller = new AbortController(); let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => { if (Date.now() >= deadline) throw new Error('timeout'); return operation(controller.signal); }),
      new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('timeout')); }, ms); }),
    ]);
  } finally { clearTimeout(timer); }
}
