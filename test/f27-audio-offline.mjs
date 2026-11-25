// Browser-only engineering check. Open via the existing Vite server; no speaker
// playback, credentials, integrations or network services beyond local assets.
import { F27SampleAudio, bankCurve } from '../src/f27audio.js';
const manifest = await (await fetch('/models/f27/audio/manifest.json')).json();
const bytes = await Promise.all(manifest.samples.map(async m => [m.id, await (await fetch('/models/f27/audio/' + m.file)).arrayBuffer()]));
const decode = new OfflineAudioContext(2,1,44100), buffers = new Map();
for (const [id, bytes_] of bytes) buffers.set(id,await decode.decodeAudioData(bytes_.slice(0)));
const state = (rpm, cockpit = true, lit = true) => ({cockpit,engineRunning:lit,camDist:40,ias:0,gs:0,onGround:true,electrical:false,
  turboprop:[0,1].map(()=>({turbineRpm:rpm,lit,starting:false,thr:Math.max(0,(rpm-7000)/8000)}))});
const metrics = (buffer, from = 1, to = buffer.duration) => {
  let sum=0, peak=0, n=0;
  for (let c=0;c<buffer.numberOfChannels;c++) {
    const d=buffer.getChannelData(c);
    for (let i=Math.floor(from*buffer.sampleRate);i<Math.floor(to*buffer.sampleRate);i++) {sum+=d[i]*d[i];peak=Math.max(peak,Math.abs(d[i]));n++;}
  }
  return {rms:Math.sqrt(sum/n),peak};
};
function fixture(seconds) {
  const context = new OfflineAudioContext(2, Math.ceil(seconds*44100),44100); let t=0;
  const C={state:'running',sampleRate:44100,get currentTime(){return t;}};
  for(const name of ['createBuffer','createBufferSource','createGain','createStereoPanner','createBiquadFilter']) C[name]=context[name].bind(context);
  const f=new F27SampleAudio(C,context.destination,{set:(p,v,tc)=>p.setTargetAtTime(v,t,tc)});
  f.manifest=manifest;f.status='ready';f.buffers=buffers;
  return {context,f,at(time,s){t=time;f.update(s,{near:1,dens:1,dop:1});}};
}
async function original(rpm,cockpit) {
  const ctx=new OfflineAudioContext(2,2*44100,44100), r=rpm/15000;
  for(const g of manifest.groups.filter(g=>g.view===(cockpit?'inside':'outside'))) {
    const filter=ctx.createBiquadFilter();filter.frequency.value=cockpit?18000:16000/(1+40/900);filter.Q.value=.5;
    const pan=ctx.createStereoPanner();pan.pan.value=g.engine===1?-.32:.32;filter.connect(pan);pan.connect(ctx.destination);
    for(const c of g.clips) {
      const src=ctx.createBufferSource(),gain=ctx.createGain(),b=buffers.get(c.id),fade=Math.floor(b.sampleRate*.035),n=b.length-fade;
      const loop=ctx.createBuffer(b.numberOfChannels,n,b.sampleRate);
      for(let ch=0;ch<b.numberOfChannels;ch++){const d=loop.getChannelData(ch),s=b.getChannelData(ch);d.set(s.subarray(0,n));for(let i=0;i<fade;i++)d[i]=s[n+i]*(1-i/fade)+s[i]*i/fade;}
      src.buffer=loop;src.loop=true;src.playbackRate.value=2**((bankCurve(g.pitch,r)+c.cents)/1200);
      gain.gain.setTargetAtTime((cockpit?.65:1)*bankCurve(c.curve,r)*10**((c.volumeDb+(rpm-7000)/8000*3.15)/20)*.22,0,.08);
      src.connect(gain);gain.connect(filter);src.start(0,g.engine===1?0:.37*src.buffer.duration);
    }
  }
  return metrics(await ctx.startRendering());
}
const report={browser:navigator.userAgent,decoded:buffers.size,errors:[],levels:[],checks:[]};
const check=(condition,name)=>{report.checks.push({name,pass:!!condition});if(!condition)report.errors.push(name);};
for(const cockpit of [true,false])for(const rpm of [7000,9000,11000,13000,15000]) {
  const h=fixture(2);h.at(0,state(rpm,cockpit));const actual=metrics(await h.context.startRendering());
  const baseline=await original(rpm,cockpit);
  report.levels.push({view:cockpit?'inside':'outside',rpm,...actual,baselineRms:baseline.rms,reductionDb:20*Math.log10(actual.rms/baseline.rms)});
  check(Number.isFinite(actual.rms)&&actual.rms>0.002&&actual.peak<0.5,`finite quiet original mix ${cockpit}/${rpm}`);
}
for(const view of ['inside','outside']) {
  const rms=report.levels.filter(l=>l.view===view).map(l=>l.rms),span=20*Math.log10(Math.max(...rms)/Math.min(...rms));
  check(span<5,`${view}: calibrated throttle level range <5 dB (${span.toFixed(2)})`);
}
// Run through every bank boundary with actual per-frame scheduling.
const sweep=fixture(10);
for(let t=0;t<10;t+=1/60)sweep.at(t,state(7000+8000*Math.min(1,t/8)));
const swept=await sweep.context.startRendering();report.sweep=[];
for(let t=1;t<9;t+=.1)report.sweep.push(metrics(swept,t,t+.1).rms);
const jump=Math.max(...report.sweep.slice(1).map((v,i)=>Math.abs(20*Math.log10(v/report.sweep[i]))));
report.maxSweepWindowJumpDb=jump;check(jump<5,'no abrupt throttle loudness/sample-join step across 100ms windows');
// A single engine stops, coasts audibly and restarts; no fake combustion needed.
const coast=fixture(17);
for(let t=0;t<17;t+=1/60){const rpm=t<2?7000:t<12?7000*Math.exp(-(t-2)/3.2):7000-(7000-7000*Math.exp(-10/3.2))*Math.exp(-(t-12)/2.8);
  const s=state(rpm,true,t<2||t>=12);s.turboprop[1]={turbineRpm:0,lit:false,starting:false};coast.at(t,s);}
const coasted=await coast.context.startRendering();report.coast=[1,2,3,5,8,11,13,16].map(t=>({time:t,...metrics(coasted,t,t+.5)}));
check(report.coast[3].rms>0.001,'shutdown remains audible after 3 seconds');
check(report.coast[5].rms<report.coast[1].rms*.1,'unlit shutdown decays rather than sticking at idle');
check(report.coast.at(-1).rms>report.coast[5].rms*5,'same independent engine restarts smoothly');
report.pass=report.errors.length===0;document.getElementById('results').textContent=JSON.stringify(report,null,2);
window.f27AudioOfflineReport=report;
// A downloadable JSON report is an explicit local test deliverable, not a deployment.
const a=document.createElement('a');a.textContent='Download test report';a.download='f27-v3-audio-offline.json';a.href=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));document.body.append(a);
