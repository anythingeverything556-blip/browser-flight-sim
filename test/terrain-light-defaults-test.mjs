import assert from 'node:assert/strict';
import {TERRAIN_UNIFORMS as u} from '../src/terrain-shader.js';
for (const beam of u.uF27Beam.value) assert.deepEqual(beam.toArray(),[0,0,0,0]);
assert.equal(u.uF27Contact.value.w,0);
assert.deepEqual(u.uF27Tires.value.map(v=>v.w),[0,0,0]);
assert.equal(u.uF27RunwayStyle.value.z,0);
assert.notEqual(u.uF27Beam.value[0],u.uF27Beam.value[1],'Each actual F27 light needs its own channel');
console.log('PASS: inactive aircraft light and contact inputs cannot light ground from the camera');
