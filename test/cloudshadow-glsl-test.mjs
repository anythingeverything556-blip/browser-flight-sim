import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { CloudShadow } from '../src/cloudshadow.js';
const shadow = new CloudShadow();
const glsl = shadow.mat.fragmentShader.replace(/\/\/[^\n]*/g, '');
for (const name of Object.keys(shadow.mat.uniforms)) assert.match(glsl, new RegExp('uniform\\s+\\w+\\s+[^;]*\\b' + name + '\\b'), `active declaration for ${name}`);
// Audit GLSL-bearing JS strings for the same accidentally commented-out declaration.
for (const file of readdirSync('src').filter(f => f.endsWith('.js'))) {
  const source = readFileSync('src/' + file, 'utf8');
  for (const template of source.matchAll(/`([^`]*\b(?:uniform|gl_FragColor|gl_Position)\b[^`]*)`/g)) {
    assert.doesNotMatch(template[1], /\/\/[^\n]*\b(?:uniform|varying|attribute)\s+(?:float|int|bool|[biu]?vec[234]|mat[234]|sampler\w+)\s+\w+\s*[;,]/, file + ': swallowed GLSL declaration');
  }
}
shadow.rt.dispose(); shadow.rtOld.dispose(); shadow.mat.dispose(); shadow.quad.geometry.dispose();
console.log('PASS cloud shadow uniform declarations and GLSL inline-comment audit');
