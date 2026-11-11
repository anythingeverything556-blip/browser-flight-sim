// The aircraft the simulator can fly. The choice is read once at load (settings.aircraft, or ?aircraft= in the address) and the page reloads on
// a switch: the flight model, the 3D model, the cockpit and the sounds are built for one aircraft at a time.
export const AIRCRAFT_TYPES = {
  sr71: {
    id: 'sr71', name: 'Lockheed SR-71A Blackbird', short: 'SR-71A', model: 'SR71_sim.glb',
    blurb: 'Mach 3.2 strategic reconnaissance jet. Two J58 turbo-ramjets with afterburner, 85,000 ft.',
    stats: [['Cruise', 'Mach 3.2'], ['Ceiling', '85,000 ft'], ['Crew', '2']],
  },
  c172: {
    id: 'c172', name: 'Cessna 172SP Skyhawk', short: 'C172SP', model: 'C172.glb',
    blurb: 'Four-seat high-wing trainer. 180 hp Lycoming IO-360, fixed-pitch propeller, flaps 0-30°, fixed gear.',
    stats: [['Cruise', '122 KTAS'], ['Stall', '48 KIAS'], ['Ceiling', '14,000 ft']],
  },
  sf50: {
    id: 'sf50', name: 'Cirrus Vision Jet SF50 G3', short: 'SF50', model: 'SF50.glb',
    blurb: 'Seven-seat single-engine personal jet. One Williams FJ33-5A turbofan, V-tail, retractable gear, flaps 0-15-39°, Perspective Touch+ flight displays.',
    stats: [['Cruise', '311-317 KTAS'], ['Ceiling', 'FL310'], ['Seats', '7 · 1 × FJ33-5A']],
  },
  il76: {
    id: 'il76', name: 'Ilyushin Il-76MD-90A', short: 'Il-76', model: 'IL76_v6.glb',
    blurb: 'Four-engine heavy military transport. Four PS-90A-76 turbofans, slats and double-slotted flaps, spoilers, thrust reversers, 20-wheel gear and a rear cargo ramp.',
    stats: [['Cruise', '770 km/h'], ['Payload', '60 t'], ['Ceiling', '12,200 m']],
  },
};
export function aircraftChoice(settings, search = '') {
  let q = null; try { q = new URLSearchParams(search).get('aircraft'); } catch { /* no URL */ }
  const id = (q || (settings && settings.aircraft) || 'sr71').toLowerCase();
  return AIRCRAFT_TYPES[id] ? id : 'sr71';
}
