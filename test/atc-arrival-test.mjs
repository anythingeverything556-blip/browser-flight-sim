// ATC approach / landing / landed calls name the arrival airport and runway, not the departure (report #20).
import assert from 'node:assert/strict';
import { Atc } from '../src/atc.js';
globalThis.window = { AudioContext: function () { return { state: 'running', sampleRate: 8000, destination: {}, createBuffer: (c, n) => ({ getChannelData: () => new Float32Array(n) }),
  createBufferSource: () => ({ connect() {}, disconnect() {}, start() {} }), createBiquadFilter: () => ({ connect() {}, disconnect() {}, frequency: {}, Q: {} }), createGain: () => ({ connect() {}, disconnect() {}, gain: {} }) }; }, speechSynthesis: {} };
const said = []; globalThis.speechSynthesis = { speak: (u) => said.push(u.text), cancel() {} };
globalThis.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
globalThis.document = { createElement: () => ({ classList: { add() {} }, remove() {}, set innerHTML(v) {}, set textContent(v) { said.push(String(v)); }, firstChild: {}, lastChild: {}, append() {}, appendChild() {} }) };
const box = { children: [], appendChild(c) { this.children.push(c); }, prepend(c) { this.children.unshift(c); }, get firstChild() { return { remove() {} }; }, get lastChild() { return { remove() {} }; } };
const atc = new Atc(box, { enabled: true, volume: 0.5 });
const lines = []; atc.say = (station, text) => lines.push(`${station}: ${text}`);
const base = { started: true, crashed: false, gearDown: true, wind: { dir: 270, kt: 8 }, qnhHpa: 1013, apt: { ident: 'KBAB', name: 'Beale Air Force Base' }, rwy: '15',
  arrApt: { ident: 'KEDW', name: 'Edwards Air Force Base' }, arrRwy: '22L' };
atc.s.clr = true; atc.s.dep = true;
atc.update(0.1, { ...base, onGround: false, gsKt: 200, agl: 3000, nav: { ilsValid: true, thrDist: 20000 } });
atc.update(0.1, { ...base, onGround: false, gsKt: 180, agl: 1500, nav: { ilsValid: true, thrDist: 9000 } });
atc.update(0.1, { ...base, onGround: true, gsKt: 40, agl: 0, nav: { ilsValid: true, thrDist: 400 } });
const t = (n, f) => { try { f(); console.log('PASS ', n); } catch (e) { console.error('FAIL ', n, '\n', e, '\n', lines.join('\n')); process.exit(1); } };
t('approach, landing and landed calls happen', () => assert.ok(lines.length >= 3, lines.join(' | ')));
t('they name the arrival airport (Edwards) and runway 22L', () => { for (const l of lines) { assert.match(l, /Edwards/); assert.doesNotMatch(l, /Beale/); } assert.ok(lines.some((l) => /22L|two two left/i.test(l)), lines.join(' | ')); });
console.log('atc arrival tests passed');
