// Saved runway indices are untrusted. The database orders the longest runway first;
// use the same resolved selection for labels, setup, scenery and actual starts.
export function resolveRunwaySelection(apt, rwy, end) {
  if (!Array.isArray(apt?.runways) || !apt.runways.length) return null;
  const usable = runway => Array.isArray(runway?.ends) && runway.ends.length > 0 && typeof runway.spawn === 'function';
  if (!Number.isInteger(rwy) || rwy < 0 || !usable(apt.runways[rwy])) {
    const longest = apt.runways.indexOf(apt.longest);
    rwy = longest >= 0 && usable(apt.runways[longest]) ? longest : apt.runways.findIndex(usable);
  }
  if (rwy < 0) return null;
  const runway = apt.runways[rwy];
  if (!Number.isInteger(end) || end < 0 || !runway.ends[end]) end = 0;
  if (!runway.ends[end]) return null;
  return { apt, rwy, end, runway, runwayEnd: runway.ends[end] };
}

export function resolveHomeRunway(db, saved) {
  const home = saved && typeof saved.ident === 'string' ? saved : { ident: 'KBAB', rwy: 0, end: 1 };
  return resolveRunwaySelection(db.get(home.ident), home.rwy, home.end)
    || resolveRunwaySelection(db.get('KBAB'), home.rwy, home.end);
}
