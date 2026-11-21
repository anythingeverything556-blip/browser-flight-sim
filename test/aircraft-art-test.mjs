import assert from 'node:assert/strict';import fs from 'node:fs';
const h=fs.readFileSync('index.html','utf8');
for(const ac of ['sr71','c172','sf50','il76']){assert.ok(fs.statSync(`public/images/aircraft-${ac}.webp`).size>1000);assert.match(h,new RegExp(`images/aircraft-${ac}\\.webp`));}
assert.ok(fs.statSync('public/images/mach3-hero.jpg').size>1000);console.log('Four repository-model render cards and approved hero assets present');
