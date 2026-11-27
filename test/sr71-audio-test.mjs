import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SR71Audio,sourceCurve,engineProducing,engineParameters,originalClipState} from '../src/sr71audio.js';
const manifest=JSON.parse(await readFile(new URL('../public/models/sr71/audio/manifest.json',import.meta.url)));
const nodes=new Map(manifest.nodes.map(n=>[n.id,n]));let count=0;
function test(name,f){f();count++;console.log('PASS',name);}
const e={dry:1,ab:.35,abLit:true,thrust:120000},s={started:true,gs:0,camDist:40};
test('afterburner cannot sound before actual ignition, irrespective of command/timer',()=>{
 for(const a of [0,.35,1])assert.equal(engineParameters({...e,ab:a,abLit:false,abTimer:.9},s,null,0).ab,0);
 assert.equal(engineParameters(e,s,null,0).ab,.35);
});
test('each engine needs lit/producing evidence; stale dry/ab cannot survive cutoff',()=>{
 for(const x of [{...e,thrust:0},{...e,lit:false},{...e,producing:false},{...e,combustion:false},{...e,fail:true},{dry:1,ab:1,abLit:true}])assert.equal(engineProducing(x),false);
 assert.equal(engineProducing(e),true);assert.equal(engineProducing(e,false),false);
 assert.equal(engineParameters({...e,unstart:2},s,null,0).ab,0);
});
test('dry spool is mapped explicitly to idle..military N2, not used as normalized N2',()=>{
 assert.equal(engineParameters({...e,dry:0},s,null,0).n2,55);
 assert.equal(engineParameters(e,s,null,0).n2,100);
 assert.equal(engineParameters({...e,n2:78},s,null,0).n2,78);
});
test('original low-N2-only aft source is absent at military, not louder there',()=>{
 const clip=manifest.clips.find(c=>c.sound===129354236);
 assert(originalClipState(clip,nodes,engineParameters({...e,dry:0,ab:0},s,null,0)).gain>0);
 assert.equal(originalClipState(clip,nodes,engineParameters(e,s,null,0)).gain,0);
});
test('original afterburner source recovers its +27dB relative authored source gain',()=>{
 const dry=manifest.clips.find(c=>c.sound===129354236),ab=manifest.clips.find(c=>c.sound===142956878);
 const db=c=>c.path.reduce((sum,id)=>sum+(nodes.get(id)?.props[0]||0),0);
 assert.equal(db(ab)-db(dry),27);
 const off=originalClipState(ab,nodes,engineParameters({...e,abLit:false},s,null,0));
 const on=originalClipState(ab,nodes,engineParameters(e,s,null,0));assert.equal(off.gain,0);assert(on.gain>0);
});
test('cockpit is an identified interior event with separate original media',()=>{
 assert(manifest.clips.some(c=>c.view==='inside'&&c.media===811099034));
 assert(manifest.clips.some(c=>c.view==='outside'&&c.media===848078417));
 assert(manifest.samples.every(x=>x.pcmMatches));assert(manifest.skipped.length>0);
});
test('Wwise interpolation and exact endpoint hold semantics',()=>{
 assert.equal(sourceCurve([[0,3,9],[1,5,4]],.9),3);
 assert.equal(sourceCurve([[0,3,9],[1,5,4]],1),5);
 assert(Math.abs(sourceCurve([[0,0,1],[1,1,4]],.5)-Math.SQRT1_2)<1e-12);
 assert(Math.abs(sourceCurve([[0,0,7],[1,1,4]],.5)-(1-Math.SQRT1_2))<1e-12);
});
test('no context or sound/manifest fetch on home, loading or before gesture',()=>{
 const a=new SR71Audio();a.update({...s,engines:[e,e]});assert.equal(a.ctx,null);assert.equal(a.manifestPending,undefined);
});
console.log(count+' original SR-71 audio checks passed');
