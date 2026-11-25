import assert from 'node:assert/strict';
import { airData, toKnots } from '../src/airdata.js';

const t = (n, f) => { f(); console.log('PASS ', n); };
const isa = (h) => {
  if (h < 11000) { const T = 288.15 - 0.0065 * h; return { T, p: 101325 * Math.pow(T / 288.15, 5.2559) }; }
  if (h < 20000) return { T: 216.65, p: 22632 * Math.exp(-(h - 11000) / 6341.6) };
  const T = 216.65 + 0.001 * (h - 20000); return { T, p: 5474.9 * Math.pow(T / 216.65, -34.163) };
};
const at = (ft, M) => { const h = ft * 0.3048, { T, p } = isa(h), rho = p / (287.05 * T), V = M * Math.sqrt(1.4 * 287.05 * T); return airData({ V, M, rho, T }); };

t('at sea level and low Mach calibrated, equivalent and true airspeed agree', () => {
  const a = at(0, 0.3); assert.ok(Math.abs(a.cas - a.tas) < 1.5 && Math.abs(a.eas - a.tas) < 0.1);
});
t('Mach 0.8 at 10 000 ft: about 449 kt calibrated, 511 kt true', () => {
  const a = at(10000, 0.8); assert.ok(Math.abs(toKnots(a.cas) - 449) < 4, toKnots(a.cas)); assert.ok(Math.abs(toKnots(a.tas) - 511) < 4);
});
t('Mach 1.5 at 35 000 ft: about 548 kt calibrated, 865 kt true (supersonic pitot)', () => {
  const a = at(35000, 1.5); assert.ok(Math.abs(toKnots(a.cas) - 548) < 8, toKnots(a.cas)); assert.ok(Math.abs(toKnots(a.tas) - 865) < 8);
});
t('Mach 3.2 at 80 000 ft: true airspeed is about 1 850 kt, calibrated about 440 kt, equivalent about 349 kt', () => {
  const a = at(80000, 3.2); assert.ok(Math.abs(toKnots(a.tas) - 1854) < 25, toKnots(a.tas)); assert.ok(Math.abs(toKnots(a.cas) - 440) < 10, toKnots(a.cas)); assert.ok(Math.abs(toKnots(a.eas) - 349) < 8);
});
t('calibrated airspeed is continuous through Mach 1', () => {
  const lo = at(30000, 0.995).cas, hi = at(30000, 1.005).cas; assert.ok(Math.abs(hi - lo) < 3, `${lo} ${hi}`);
});
console.log('all air data tests passed');
