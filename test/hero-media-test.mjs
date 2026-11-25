import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const code=fs.readFileSync('src/hero-media.js','utf8');
async function setup({width=1920,dpr=1,reduce=false,desktop=true,connection={}}={}){
 const listeners={},queries=[],events={};let intro=true,observer;const classes=new Set();
 const video={src:'',muted:false,paused:true,classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)},hasAttribute(){return !!this.src},removeAttribute(){this.src=''},load(){},pause(){this.paused=true},async play(){this.paused=false},addEventListener:(k,fn)=>events[k]=fn};
 const toggle={hidden:true,textContent:'Pause background',addEventListener:(k,fn)=>listeners[k]=fn};
 const document={hidden:false,getElementById:id=>id==='hero-video'?video:toggle,body:{classList:{contains:()=>intro}},addEventListener:(k,fn)=>listeners[k]=fn};
 vm.runInNewContext(code,{document,navigator:{connection},innerWidth:width,devicePixelRatio:dpr,matchMedia:q=>{const m={matches:q.includes('reduce')?reduce:desktop,addEventListener:(k,fn)=>m.change=fn};queries.push(m);return m},MutationObserver:class{constructor(fn){observer=fn}observe(){}}});
 await new Promise(setImmediate);return {video,toggle,classes,listeners,queries,events,recheck(){observer()},exit(){intro=false;observer()}};
}
for(const opts of [{reduce:true},{desktop:false},{connection:{saveData:true}},{connection:{effectiveType:'3g'}}]){const s=await setup(opts);assert.equal(s.video.src,'','excluded setup must not assign any video URL');assert.ok(s.toggle.hidden);}
const ordinary=await setup();assert.match(ordinary.video.src,/1080.mp4$/);assert.equal(ordinary.video.paused,false);assert.equal(ordinary.video.muted,true);
const wide=await setup({width:3840});assert.match(wide.video.src,/4k.mp4$/);const retina=await setup({width:1920,dpr:2});assert.match(retina.video.src,/4k.mp4$/);
ordinary.listeners.click();assert.equal(ordinary.video.paused,true);ordinary.listeners.click();await new Promise(setImmediate);assert.equal(ordinary.video.paused,false);
wide.queries[0].matches=true;wide.queries[0].change();assert.equal(wide.video.src,'');assert.ok(wide.toggle.hidden);
retina.exit();assert.equal(retina.video.src,'');ordinary.events.error();assert.equal(ordinary.video.src,'');assert.ok(!ordinary.classes.has('playing'));ordinary.recheck();await new Promise(setImmediate);assert.equal(ordinary.video.src,'','ordinary menu class changes must not re-download a failed movie');
console.log('PASS decorative media download gating, 4K selection, mute, pause/resume, runtime reduced motion, flight exit and failure fallback');
