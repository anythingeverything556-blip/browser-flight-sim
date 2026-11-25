// F27 camera offsets relative to the original model's converted pilot eye.
// V2 was only 8 cm below the source; V3 lowers the seated eye by another 16 cm.
export const F27_SEAT_RANGE = Object.freeze({ min: -25, max: 18 });
export const F27_FLIGHT_LOOK = Object.freeze({ y: -0.16, pitch: -0.25, yaw: 0, fov: 74 });
export const F27_INSTRUMENT_LOOK = Object.freeze({ y: -0.20, pitch: -0.50, yaw: -0.03, fov: 67 });

export function f27SeatCm(raw) {
  const n=typeof raw==='number'||typeof raw==='string' ? Number(raw) : 0;
  return Number.isFinite(n) ? Math.max(F27_SEAT_RANGE.min,Math.min(F27_SEAT_RANGE.max,Math.round(n))) : 0;
}
export function f27CameraPose(v2Eye, raw, panel=false) {
  const look=panel ? F27_INSTRUMENT_LOOK : F27_FLIGHT_LOOK, seatCm=f27SeatCm(raw);
  const eye=v2Eye.clone(); eye.y+=look.y+seatCm/100;
  return { eye, pitch:look.pitch, yaw:look.yaw, fov:look.fov, seatCm };
}
