// Own the ordered mission start/stop boundary without taking over HUD or rendering.
export function stopMissionSession({ tour, tutorial, resetCoach, clearBeacons, hideMission }) {
  tour.stop(); tutorial.stop(); resetCoach(); clearBeacons(); hideMission();
}
export function beginMissionSession({ kind, spawn, tour, tutorial, tutorialCtx, createMission }) {
  if (!spawn) return null;
  if (kind === 'tour') { tour.start(spawn.hdg); return null; }
  if (kind === 'tutorial') { tutorial.start(tutorialCtx()); return null; }
  return createMission(kind, { lat: spawn.lat, lon: spawn.lon, hdg: spawn.hdg });
}
