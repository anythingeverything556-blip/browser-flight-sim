import assert from 'node:assert/strict';import fs from 'node:fs';
const css=fs.readFileSync('src/style.css','utf8'),html=fs.readFileSync('index.html','utf8'),touch=fs.readFileSync('src/touchcontrols.js','utf8');
assert.match(css,/@media \(min-width: 1440px\)/);assert.match(css,/#rail button span \{ position: static/);
assert.match(html,/aria-label="Simulator controls"/);assert.match(html,/aria-label="Airports"/);assert.match(touch,/Drag stick down to climb/);
console.log('Wide rail visible text, accessible names retained and visible touch stick hint');
