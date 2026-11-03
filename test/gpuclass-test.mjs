import assert from 'node:assert/strict';
import { gpuClass, firstRunGfx } from '../src/gpuclass.js';

let fails = 0;
const check = (name, fn) => { try { fn(); console.log('PASS ', name); } catch (e) { fails++; console.log('FAIL ', name, '-', e.message); } };
// renderer strings as Chrome/ANGLE, Firefox and Safari report them
const cases = [
  ['ANGLE (AMD, AMD Radeon(TM) Graphics (0x00001681) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated'], // the owner's 680M
  ['ANGLE (AMD, AMD Radeon 680M (0x00001681) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated'],
  ['ANGLE (AMD, AMD Radeon(TM) 780M Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated'],
  ['ANGLE (AMD, AMD Radeon(TM) Vega 8 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated'],
  ['ANGLE (Intel, Intel(R) UHD Graphics 620 (0x00005917) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated'],
  ['ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x00009A49) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'integrated'],
  ['Intel(R) HD Graphics, or similar', 'integrated'],
  ['ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)', 'integrated'],
  ['Apple GPU', 'integrated'],
  ['Mali-G78 MP14', 'integrated'], ['Adreno (TM) 650', 'integrated'],
  ['ANGLE (NVIDIA, NVIDIA GeForce RTX 3050 Laptop GPU (0x000025A2) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'discrete'], // the owner's dGPU
  ['ANGLE (AMD, AMD Radeon RX 6800 XT (0x000073BF) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'discrete'],
  ['ANGLE (AMD, AMD Radeon(TM) RX 7600 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'discrete'],
  ['AMD Radeon Pro 5500M OpenGL Engine', 'discrete'],
  ['Radeon R9 200 Series, or similar', 'discrete'],
  ['ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'discrete'],
  ['ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Max, Unspecified Version)', 'discrete'],
  ['NVIDIA GeForce GTX 1060/PCIe/SSE2', 'discrete'],
  ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', 'software'],
  ['llvmpipe (LLVM 15.0.7, 256 bits)', 'software'],
  ['', 'unknown'],
];
for (const [s, want] of cases) check(`gpuClass ${want}: ${s.slice(0, 70)}`, () => assert.equal(gpuClass(s), want));
check('first run preset: Normal on integrated, High on discrete/unknown, Low on software', () => {
  assert.equal(firstRunGfx(cases[0][0]), 'normal'); assert.equal(firstRunGfx(cases[11][0]), 'high'); assert.equal(firstRunGfx(''), 'high'); assert.equal(firstRunGfx('llvmpipe'), 'low');
});
if (fails) { console.log(`${fails} failed`); process.exit(1); }
console.log('gpuclass OK');
