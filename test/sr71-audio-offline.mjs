import {SR71Audio} from '../src/sr71audio.js';
const report={checks:[],levels:[],errors:[],browser:navigator.userAgent};
const check=(pass,name)=>{report.checks.push({pass:!!pass,name});if(!pass)report.errors.push(name);};
const manifest=await(await fetch('/models/sr71/audio/manifest.json')).json();
const decode=new OfflineAudioContext(1,1,48000),buffers=new Map();
for(const m of manifest.samples)buffers.set(m.file,await decode.decodeAudioData(await(await fetch('/models/sr71/audio/'+m.file)).arrayBuffer()));
const metrics=(b,from=.5,to=b.duration)=>{
 let sum=0,peak=0,n=0;for(let ch=0;ch<b.numberOfChannels;ch++){const d=b.getChannelData(ch);for(let i=Math.floor(from*b.sampleRate);i<Math.min(d.length,Math.floor(to*b.sampleRate));i++){sum+=d[i]**2;peak=Math.max(peak,Math.abs(d[i]));n++;}}
 return {rms:Math.sqrt(sum/Math.max(1,n)),peak};
};
const engine=(ab=0)=>({dry:1,thrust:100000,ab,abLit:ab>0,abTimer:ab>0?1:0});
const state=(ab=0,cockpit=false)=>({started:true,paused:false,cockpit,camDist:40,gs:0,engines:[engine(ab),engine(ab)],callout:{aglFt:0}});
function fixture(seconds){
 const ctx=new OfflineAudioContext(2,Math.ceil(seconds*48000),48000);let time=0;
 const clock={get currentTime(){return time;},state:'running'};
 for(const m of ['createBufferSource','createGain'])clock[m]=ctx[m].bind(ctx);
 const audio=new SR71Audio();audio.ctx=clock;audio.mix=ctx.createGain();audio.mix.gain.value=0;audio.mix.connect(ctx.destination);
 audio.manifest=manifest;audio.nodes=new Map(manifest.nodes.map(n=>[n.id,n]));audio.buffers=new Map([...buffers].map(([k,b])=>[k,Promise.resolve(b)]));
 return {ctx,audio,async at(t,s){time=t;audio.update(s);await Promise.resolve();await Promise.resolve();}};
}
async function constant(ab,cockpit){
 const h=fixture(3);await h.at(0,state(ab,cockpit));await h.at(.005,state(ab,cockpit));
 const b=await h.ctx.startRendering();return {samples:Array.from(b.getChannelData(0).subarray(24000,72000)),...metrics(b),voices:h.audio.telemetry.voices.map(x=>({sound:x.sound,level:x.level,abOnly:x.abOnly}))};
}
for(const cockpit of [false,true])for(const ab of [0,.35,.65,1])report.levels.push({cockpit,ab,...await constant(ab,cockpit)});
for(const cockpit of [false,true]){
 const rows=report.levels.filter(x=>x.cockpit===cockpit),dry=rows[0].rms;
 for(const x of rows){x.relativeToMilitaryDb=20*Math.log10(x.rms/dry);check(x.rms>1e-4&&x.peak<.95,`finite unclipped ${cockpit?'interior':'aft'} ab=${x.ab}`);}
 const ref=rows[0].samples;
  for(const row of rows){let energy=0,reference=0;for(let i=0;i<ref.length;i++){energy+=(row.samples[i]-ref[i])**2;reference+=ref[i]**2;}row.differenceRmsOverDryRms=Math.sqrt(energy/reference);}
  check(cockpit?rows[1].differenceRmsOverDryRms>.5:rows[1].relativeToMilitaryDb>3,`${cockpit?'interior source timbre/pitch has >50% RMS difference':'aft minimum actual burner has >3dB loudness change'}`);
  for(const row of rows)delete row.samples;
}
// Full-volume/zero-distance worst case across several original loop wraps.
report.headroom=[];
for(const cockpit of [false,true]){
 const h=fixture(12),s=state(1,cockpit);s.camDist=0;h.audio.volume=1;
 await h.at(0,s);await h.at(.005,s);const m=metrics(await h.ctx.startRendering());
 report.headroom.push({cockpit,...m});check(m.peak<.98,`12-second full-volume zero-distance ${cockpit?'cockpit':'external'} stays unclipped`);
}
// Deterministic comparison of old exact source components at identical gain.
for(const cockpit of [false,true]){
 const old=[];for(const ab of [0,.35,1]){
  const ctx=new OfflineAudioContext(1,3*48000,48000),distance=cockpit?.25:1/(1+40/80);
  for(const [file,level]of [['776860696.flac',.6],['848078417.flac',ab*.5]]){const src=ctx.createBufferSource(),g=ctx.createGain();src.buffer=buffers.get(file);src.loop=true;g.gain.value=level*distance*.7;src.connect(g);g.connect(ctx.destination);src.start();}
  old.push({ab,...metrics(await ctx.startRendering())});
 }for(const row of old)row.relativeToMilitaryDb=20*Math.log10(row.rms/old[0].rms);
 report[cockpit?'beforeCockpit':'beforeExterior']=old;
}
// End-to-end actual engine states: pre-ignition, one burner, both, cutoff with
// deliberately stale ab/dry, reignition, view change, pause and crash.
const h=fixture(14),timeline=[];
for(let t=0;t<14;t+=1/60){
 let s=state();if(t>=2)s.engines[0]=engine(.35);if(t>=4)s.engines[1]=engine(1);
 if(t>=6&&t<8)s.engines=s.engines.map(e=>({...e,thrust:0}));
 if(t>=8)s.engines=[engine(.65),engine(.65)];if(t>=10)s.cockpit=true;
 if(t>=11&&t<12)s.paused=true;if(t>=13)s.crashed=true;
 await h.at(t,s);if(Math.abs(t-Math.round(t))<.001)timeline.push({time:t,...h.audio.telemetry});
}
const rendered=await h.ctx.startRendering();report.timeline=timeline;report.transitions=[1,3,5,7,9,10.5,11.5,12.5,13.5].map(t=>({time:t,...metrics(rendered,t,t+.3)}));
check(report.transitions[3].rms<1e-7,'actual zero thrust cuts both stale burner/spool voices to silence');
check(report.transitions[4].rms>report.transitions[3].rms*1000,'reignition resumes original sources');
check(report.transitions[6].rms<1e-7,'pause is silent');check(report.transitions[8].rms<1e-7,'crash is silent');
check(timeline.find(x=>x.time>2.9&&x.time<3.1)?.engines[1].ab===0,'independent engine does not inherit the other burner');
// Export this real Chromium OfflineAudioContext render to the harness for audit.
function wav(b){const data=new ArrayBuffer(44+b.length*b.numberOfChannels*2),v=new DataView(data);let pos=0;const str=s=>{for(const c of s)v.setUint8(pos++,c.charCodeAt(0));};str('RIFF');v.setUint32(pos,data.byteLength-8,true);pos+=4;str('WAVEfmt ');v.setUint32(pos,16,true);pos+=4;v.setUint16(pos,1,true);pos+=2;v.setUint16(pos,b.numberOfChannels,true);pos+=2;v.setUint32(pos,b.sampleRate,true);pos+=4;v.setUint32(pos,b.sampleRate*b.numberOfChannels*2,true);pos+=4;v.setUint16(pos,b.numberOfChannels*2,true);pos+=2;v.setUint16(pos,16,true);pos+=2;str('data');v.setUint32(pos,data.byteLength-44,true);pos+=4;for(let i=0;i<b.length;i++)for(let ch=0;ch<b.numberOfChannels;ch++){v.setInt16(pos,Math.round(Math.max(-1,Math.min(1,b.getChannelData(ch)[i]))*32767),true);pos+=2;}return new Uint8Array(data);}
const bytes=wav(rendered);window.sr71AudioRender=Array.from(bytes);
report.decoded=buffers.size;report.pass=report.errors.length===0;window.sr71AudioOfflineReport=report;document.querySelector('#result').textContent=JSON.stringify(report,null,2);
