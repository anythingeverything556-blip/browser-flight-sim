// The aircraft the simulator can fly. The choice is read once at load (settings.aircraft, or ?aircraft= in the address) and the page reloads on
// a switch: the flight model, the 3D model, the cockpit and the sounds are built for one aircraft at a time.
export const AIRCRAFT_TYPES = {
  sr71: {
    id: 'sr71', name: 'Lockheed SR-71A Blackbird', short: 'SR-71A', model: 'sr71/exterior/manifest.json',
    blurb: 'Mach 3.2 strategic reconnaissance jet. Two J58 turbo-ramjets with afterburner, 85,000 ft.',
    stats: [['Cruise', 'Mach 3.2'], ['Ceiling', '85,000 ft'], ['Crew', '2']],
  },
  c172: {
    id: 'c172', name: 'Cessna 172SP Skyhawk', short: 'C172SP', model: 'C172.glb',
    blurb: 'Four-seat high-wing trainer. 180 hp Lycoming IO-360, fixed-pitch propeller, flaps 0-30°, fixed gear.',
    stats: [['Cruise', '122 KTAS'], ['Stall', '48 KIAS'], ['Ceiling', '14,000 ft']],
  },
  da40: {
    id: 'da40', name: 'Diamond DA40 NG · G1000', short: 'DA40 NG', model: 'da40/da40-ng.glb',
    blurb: 'Four-seat composite trainer with the Austro AE300 diesel and fixed tricycle gear. Flight dynamics and G1000 displays are simplified, not the original FlightGear systems.',
    stats: [['Cruise', '154 KTAS'], ['Engine', '168 hp diesel'], ['Seats', '4']],
  },
  sf50: {
    id: 'sf50', name: 'Cirrus Vision Jet SF50 G3', short: 'SF50', model: 'SF50_fullres_v1.glb',
    blurb: 'Seven-seat single-engine personal jet. One Williams FJ33-5A turbofan, V-tail, retractable gear, flaps 0-15-39°, Perspective Touch+ flight displays.',
    stats: [['Cruise', '311-317 KTAS'], ['Ceiling', 'FL310'], ['Seats', '7 · 1 × FJ33-5A']],
  },
  f27: {
    id: 'f27', name: 'Fokker F27 Mk500', short: 'F27 Mk500', model: 'f27/f27-white-ext-v3.glb',
    blurb: 'Twin Rolls-Royce Dart turboprop. Original Benoît Gaurant white livery and English cockpit, prepared in the background. Simplified browser flight and systems; private noncommercial prototype only (original manual prohibits commercial/business/payware use).',
    stats: [['Normal cruise', '≈240 KTAS'], ['Engines', '2 × Dart'], ['Seats', '50']],
  },
  il76: {
    id: 'il76', name: 'Ilyushin Il-76MD-90A', short: 'Il-76', model: 'IL76_v6.glb',
    blurb: 'Four-engine heavy military transport. Four PS-90A-76 turbofans, slats and double-slotted flaps, spoilers, thrust reversers, 20-wheel gear and a rear cargo ramp.',
    stats: [['Cruise TAS', '750–780 km/h'], ['Payload', '60 t'], ['Ceiling', '12,200 m']],
  },
};
export function aircraftChoice(settings, search = '') {
  let q = null; try { q = new URLSearchParams(search).get('aircraft'); } catch { /* no URL */ }
  const choice = q || (settings && settings.aircraft);
  const id = typeof choice === 'string' ? choice.toLowerCase() : '';
  return Object.hasOwn(AIRCRAFT_TYPES, id) ? id : 'da40';
}
