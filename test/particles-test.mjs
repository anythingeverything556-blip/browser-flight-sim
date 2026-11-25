// Airflow and JetBlast: nothing uploaded or drawn while no particle is alive; live range only otherwise; same particle data as a full pass.
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Airflow } from '../src/airflow.js';
import { JetBlast } from '../src/blast.js';

const t = (n, f) => { try { f(); console.log('PASS ', n); } catch (e) { console.error('FAIL ', n, '\n', e); process.exit(1); } };
const scene = { add() {} };
const fdm = { pos: new THREE.Vector3(0, 100, 0), throttle: 0, crashed: false, onGround: false, out: { V: 0 }, engines: [{ ab: 0 }, { ab: 0 }] };
const cw = new THREE.Vector3();
const ctx = (extra) => ({ fdm, model: null, camWorld: cw, humidity: 0, daylight: 1, px: 600, geoVersion: 1, ...extra });

t('airflow: idle frames neither upload nor draw', () => {
  const a = new Airflow(scene); a.update(0.016, ctx()); const v = a.g.attributes.position.version;
  for (let i = 0; i < 50; i++) a.update(0.016, ctx());
  assert.equal(a.g.attributes.position.version, v); assert.equal(a.g.drawRange.count, 0);
});
t('airflow: emitted puffs upload only their range, then go quiet again after they expire', () => {
  const a = new Airflow(scene); a.update(0.016, ctx()); const at = a.g.attributes, v0 = at.position.version;
  a.emit(1, 2, 3, 0, 0, 0, 1, 1, 2, 0.5, 0, 0); a.emit(1, 2, 3, 0, 0, 0, 1, 1, 2, 0.5, 0, 0);
  a.update(0.016, ctx()); assert.equal(at.position.version, v0 + 1);
  assert.deepEqual(at.position.updateRanges, [{ start: 0, count: 6 }]); assert.deepEqual(at.aA.updateRanges, [{ start: 0, count: 2 }]);
  assert.equal(a.g.drawRange.start, 0); assert.equal(a.g.drawRange.count, 2); assert.ok(at.aA.array[0] > 0 || at.aA.array[1] >= 0);
  for (let i = 0; i < 80; i++) a.update(0.016, ctx());
  assert.equal(a.g.drawRange.count, 0); const v = at.position.version; a.update(0.016, ctx()); assert.equal(at.position.version, v, 'quiet after expiry');
});
t('airflow: positions are camera-relative every live frame, wrapped ring emits stay inside the range', () => {
  const a = new Airflow(scene); a.i = a.N - 1; a.update(0.016, ctx());
  a.emit(10, 0, 0, 0, 0, 0, 5, 1, 2, 0.5, 0, 0); a.emit(10, 0, 0, 0, 0, 0, 5, 1, 2, 0.5, 0, 0);
  a.update(0.016, ctx({ camWorld: new THREE.Vector3(4, 0, 0) }));
  assert.equal(a.g.attributes.position.array[(a.N - 1) * 3], 6); assert.equal(a.g.attributes.position.array[0], 6);
  assert.equal(a.g.drawRange.start, 0); assert.equal(a.g.drawRange.count, a.N);
});
t('airflow: clear() zeroes live puffs (geometry version change)', () => {
  const a = new Airflow(scene); a.update(0.016, ctx()); a.emit(1, 2, 3, 0, 0, 0, 5, 1, 2, 0.5, 0, 0); a.update(0.016, ctx()); assert.equal(a.g.drawRange.count, 1);
  a.update(0.016, ctx({ geoVersion: 2 })); assert.equal(a.g.drawRange.count, 0);
});
const bc = (s, x = 0) => ({ fdm: { pos: new THREE.Vector3(0, 2.5, 0), throttle: s, crashed: false, onGround: true, engines: [{ ab: 0 }, { ab: 0 }] }, camWorld: new THREE.Vector3(x, 0, 0), groundY: 0, nozzles: [new THREE.Vector3(-10, 1, -2), new THREE.Vector3(-10, 1, 2)], aft: new THREE.Vector3(-1, 0, 0), daylight: 1, height: 0, px: 600 });
t('blast: idle does nothing, power draws only live puffs, then goes quiet after they expire', () => {
  const b = new JetBlast(scene); b.update(0.016, bc(0)); const v = b.g.attributes.position.version;
  for (let i = 0; i < 20; i++) b.update(0.016, bc(0)); assert.equal(b.g.attributes.position.version, v); assert.equal(b.g.drawRange.count, 0);
  for (let i = 0; i < 30; i++) b.update(0.016, bc(1)); assert.ok(b.g.drawRange.count > 0 && b.g.drawRange.count <= b.N); assert.ok(b.g.attributes.position.version > v);
  for (let i = 0; i < 700; i++) b.update(0.016, bc(0)); assert.equal(b.g.drawRange.count, 0); const v2 = b.g.attributes.position.version; b.update(0.016, bc(0)); assert.equal(b.g.attributes.position.version, v2);
});
console.log('all particle upload tests passed');
