// Normal streaming and startup deadlines are not evidence of an imagery outage.
// `failed` comes from current uncovered tiles, not cumulative diagnostics counters.
export function imageryNotice({ failed, pending }) {
  if (!failed) return '';
  return pending ? 'Some imagery failed or lacks coverage; retrying. Terrain is still loading.' : 'Some imagery failed or lacks coverage; retrying with shaded terrain.';
}
