// Original SR-71 file-backed components, with their documented Wwise volume,
// pitch and N2 layer curves. NOT the complete Wwise/MSFS mix: no generated
// tones, missing shared buses/effects, or invented replacement recordings.
// Reproduction/provenance: test/sr71-audio-extract.py and audio/manifest.json.
const EVENTS={
  gearTravelA:'gear-travel-state-1551306158.flac',gearTravelB:'gear-travel-state-2280510569.flac',
  canopyLock:'canopy-lock-forward.flac',canopyRearLock:'canopy-lock-aft.flac',
  sealOn:'canopy-seal-on.flac',sealOff:'canopy-seal-off.flac',
  militaryStop:'throttle-military-stop.flac',pttPress:'throttle-ptt-press.flac',pttRelease:'throttle-ptt-release.flac'
};
const clamp=(v,lo=0,hi=1)=>Math.max(lo,Math.min(hi,Number.isFinite(v)?v:lo));
const base=()=>import.meta.env?.BASE_URL||'/';
const FLOOR=1e-5;
// Wwise interpolation enum, as documented by maintained wwiser bnode_rtpc.py.
// Work on the raw curve ordinate BEFORE converting version-145 dB scaling.
export function sourceCurve(points,x){
  if(!points?.length)return 0;
  if(x<=points[0][0])return points[0][1];
  for(let i=0;i<points.length-1;i++){
    const [a,y,shape]=points[i],[b,z]=points[i+1];if(x>=b)continue;
    const t=(x-a)/(b-a);let f;
    switch(shape){
      case 0:f=1-(1-t)**3;break;
      case 1:f=Math.sin(t*Math.PI/2);break;
      case 2:f=t*(3-t)/2;break;
      case 3:f=t<.5?Math.sin(t*Math.PI)/2:1-Math.sin((1-t)*Math.PI)/2;break;
      case 4:f=t;break;
      case 5:f=(1-Math.cos(t*Math.PI))/2;break;
      case 6:f=t*(t+1)/2;break;
      case 7:f=1-Math.cos(t*Math.PI/2);break;
      case 8:f=t**3;break;
      case 9:f=0;break;
      default:throw Error('Unsupported original SR-71 curve '+shape);
    }return y+(z-y)*f;
  }return points.at(-1)[1];
}
export function engineProducing(e,globalRunning){
  // SR-71's current solver has no `lit`: its actual thrust is the authoritative
  // fallback (including fuel exhaustion/CIT cut). Explicit combustion state
  // takes precedence when provided; residual spool/ab alone are NEVER proof.
  if(globalRunning===false||e.lit===false||e.producing===false||e.combustion===false||e.fail)return false;
  if(Number.isFinite(e.thrust))return e.thrust>0;
  return e.lit===true||e.producing===true||e.combustion===true;
}
export function engineParameters(e,s,previous,time){
  const producing=engineProducing(e,s.engineRunning);
  // Earthwing dry is idle..military, NOT measured N2 percent. Keep this explicit
  // adapter rather than misusing the low-N2 component at every power setting.
  const n2=Number.isFinite(e.n2)?(e.n2<=1?e.n2*100:e.n2):producing?55+45*clamp(e.dry):0;
  const dt=previous?time-previous.time:0;
  const ab=producing&&e.abLit&&!(e.unstart>0)?clamp(e.ab):0;
  return {producing,n2,ab,time,
    SIMVAR_TURB_ENG_N2:n2,SIMVAR_TURB_ENG_AFTERBURNER:ab,
    SIMVAR_TURB_ENG_N2_DERIVED:dt>0&&dt<.5?(n2-previous.n2)/dt:0,
    SIMVAR_GENERAL_ENG_COMBUSTION:producing?1:0,SIMVAR_GENERAL_ENG_STARTER:e.starting?1:0,
    // gs is the available game velocity, not claimed original simulator TAS.
    SIMVAR_AIRSPEED_TRUE:Math.max(0,s.tasKt??(s.gs||0)*1.94384449),
    SIMVAR_PLANE_ALT_ABOVE_GROUND:Math.max(0,s.callout?.aglFt??s.aglFt??0),
    SIMVAR_CANOPY_OPEN:clamp(s.canopyOpen||0)};
}
export function originalClipState(clip,nodes,p){
  let gain=1,cents=0;
  for(let i=0;i<clip.path.length;i++){
    const n=nodes.get(clip.path[i]);if(!n)continue;
    gain*=10**((n.props[0]||0)/20);cents+=n.props[2]||0;
    for(const r of n.rtpc){
      // Unknown simulator parameters, filters and shared effects are not guessed.
      if(!r.name||p[r.name]===undefined)continue;
      const raw=sourceCurve(r.points,p[r.name]);
      if(r.param===0){
        // Wwise v145 scaling 2: raw -1 is mute; otherwise 20log10(raw+1).
        // Multiplying linear gains is identical to summing those authored dB.
        gain*=r.scaling===2?Math.max(0,Math.min(1,raw)+1):10**(raw/20);
      }else if(r.param===2)cents+=raw;
    }
    for(const a of n.layers)if(a.child===clip.path[i+1]){
      // Layer crossfade control is N2 for the extracted engine graphs.
      if(a.id===2750389327)gain*=clamp(sourceCurve(a.points,p.n2));
    }
  }
  return {gain:p.producing?gain:0,rate:2**(cents/1200)};
}
export class SR71Audio {
  constructor(){this.enabled=true;this.volume=.7;this.ctx=null;this.buffers=new Map();this.loops={};this.oneShots=new Set();this.held=false;this.status='waiting-for-interaction';this.previous={};this.telemetry={engines:[],voices:[]};}
  configure(){}
  setVoice(){} // No synthesized original warning substitutes.
  setCallouts(){}
  previewVoice(){}
  async init(){
    if(!navigator.userActivation?.hasBeenActive&&!navigator.userActivation?.isActive)return;
    if(!this.ctx){this.ctx=new (globalThis.AudioContext||globalThis.webkitAudioContext)();this.mix=this.ctx.createGain();this.mix.gain.value=0;this.mix.connect(this.ctx.destination);this.status='original-components';}
    // Gesture unlock creates/resumes the context only: no media or manifest fetch.
    if(!this.held&&this.ctx.state==='suspended')await this.ctx.resume().catch(()=>{});
  }
  async load(key){
    if(!this.ctx)return null;
    const file=EVENTS[key],url=file?base()+'models/sr71/exterior/sounds/'+file:base()+'models/sr71/audio/'+key;
    if(!this.buffers.has(key)){
      const promise=(async()=>{const r=await fetch(url);if(!r.ok)throw Error('Original SR-71 audio unavailable: '+r.status);return this.ctx.decodeAudioData(await r.arrayBuffer());})();
      this.buffers.set(key,promise);promise.catch(()=>this.buffers.delete(key));
    }return this.buffers.get(key);
  }
  loadManifest(){
    if(this.manifest||this.manifestPending||this.manifestFailed)return;
    this.manifestPending=fetch(base()+'models/sr71/audio/manifest.json').then(r=>{if(!r.ok)throw Error('Original SR-71 sound manifest unavailable: '+r.status);return r.json();}).then(m=>{this.manifest=m;this.nodes=new Map(m.nodes.map(n=>[n.id,n]));this.prepareClips();this.status='original-file-layers';}).catch(e=>{this.manifestFailed=true;this.report(e);}).finally(()=>{this.manifestPending=null;});
  }
  prepareClips(){
    this.clipBanks={inside:[],outside:[]};
    for(const clip of this.manifest.clips){
      const abOnly=clip.path.some(id=>this.nodes.get(id)?.rtpc.some(r=>r.name==='SIMVAR_TURB_ENG_AFTERBURNER'&&r.param===0&&sourceCurve(r.points,0)<=-.999));
      this.clipBanks[clip.view].push({...clip,abOnly});
    }
  }
  report(e){this.status='component-unavailable';console.warn(e.message);}
  async playOriginal(key){
    if(!this.ctx||this.held||!this.enabled||!this.flightActive)return;
    const generation=this.generation||0;
    try{
      const buffer=await this.load(key);
      if(!buffer||this.held||!this.enabled||!this.flightActive||generation!==(this.generation||0))return;
      const source=this.ctx.createBufferSource();source.buffer=buffer;source.connect(this.mix);
      const release=()=>{this.oneShots.delete(source);source.disconnect();};
      source.onended=release;this.oneShots.add(source);
      try{source.start();}catch(e){release();throw e;}
    }catch(e){this.report(e);}
  }
  play(name){
    if(name==='sr71-canopy-lock')void this.playOriginal('canopyLock');
    if(name==='sr71-seal-on')void this.playOriginal('sealOn');
    if(name==='sr71-seal-off')void this.playOriginal('sealOff');
  }
  suspend(){this.held=true;if(this.ctx?.state==='running')void this.ctx.suspend();}
  resume(){this.held=false;if(this.ctx?.state==='suspended')void this.ctx.resume().catch(()=>{});}
  resetForSpawn(){
    this.previous={};this.manifestFailed=false;this.generation=(this.generation||0)+1;this.flightActive=false;
    // One-shots share the master bus across flights, just like engine loops.
    // End their old voices, not only pending decodes, before a new flight unmutes.
    for(const source of this.oneShots){source.onended=null;try{source.stop();}catch{}source.disconnect();}
    this.oneShots.clear();
    for(const slot of Object.values(this.loops)){try{slot.source?.stop();}catch{}slot.source?.disconnect();slot.gain?.disconnect();}this.loops={};
  }
  loop(id,key,level,rate=1,prefetch=false,engine=0){
    let slot=this.loops[id];
    if(!slot){
      if(!(level>FLOOR||prefetch))return;
      slot=this.loops[id]={level:0,rate};
      void this.load(key).then(buffer=>{slot.buffer=buffer;}).catch(e=>this.report(e));
    }
    slot.level=level;slot.rate=rate;
    if(!slot.gain&&slot.buffer&&level>FLOOR){
      slot.gain=this.ctx.createGain();slot.gain.gain.value=0;slot.gain.connect(this.mix);
      slot.source=this.ctx.createBufferSource();slot.source.buffer=slot.buffer;slot.source.loop=true;
      slot.source.playbackRate.value=rate;slot.source.connect(slot.gain);
      // Different original-engine event instances must not add the same PCM in
      // phase (+6dB). Offset playback only; never alter the decoded source PCM.
      slot.source.start(this.ctx.currentTime,engine?slot.buffer.duration*.371:0);
    }
    // Short gain ramps remove discontinuities on actual cutoff/view changes.
    slot.gain?.gain.setTargetAtTime(level,this.ctx.currentTime,level>0?.06:.025);
    slot.source?.playbackRate.setTargetAtTime(rate,this.ctx.currentTime,.08);
  }
  update(s){
    if(!this.ctx)return;
    // Main pauses for its pending spawn; the loading overlay then fades out
    // separately. Never start a new sound request until it is actually hidden.
    const loading=s.loading??(globalThis.document?.getElementById('loadscreen')?.hidden===false);
    const active=!!(this.enabled&&!this.held&&!s.paused&&!s.crashed&&s.started&&!loading);
    this.flightActive=active;
    this.mix.gain.setTargetAtTime(active?clamp(this.volume):0,this.ctx.currentTime,.04);
    const engines=s.engines||[],time=this.ctx.currentTime;
    const parameters=engines.map((e,i)=>engineParameters(e,s,this.previous.engines?.[i],time));
    const producing=parameters.some(e=>e.producing);
    if(active&&producing)this.loadManifest();
    const voices=[],wanted=new Set(),view=s.cockpit?'inside':'outside';
    // Headroom and listener-distance adaptation, not an original Wwise bus claim.
    const distance=s.cockpit?1:1/(1+Math.max(0,s.camDist||0)/80);
    const listener=(!s.cockpit&&s.inMachConeAhead)?0:distance;
    const headroom=.12/Math.max(2,engines.length);
    if(this.manifest&&!this.clipBanks)this.prepareClips();
    if(active&&this.clipBanks)engines.forEach((e,i)=>{
      const p=parameters[i];
      for(const clip of this.clipBanks[view]){
        const state=originalClipState(clip,this.nodes,p);
        const {abOnly}=clip;
        // Before light-off, the real ignition timer may prefetch burner media,
        // but cannot start a burner voice. Never infer ignition from throttle.
        const prefetch=active&&p.producing&&abOnly&&(e.abTimer>0||p.ab>0);
        const level=active&&(!abOnly||p.ab>0)?state.gain*listener*headroom:0;
        const id=i+':'+clip.sound;wanted.add(id);
        this.loop(id,clip.file,level,state.rate,prefetch,i);
        if(level>FLOOR)voices.push({engine:i,sound:clip.sound,media:clip.media,level,rate:state.rate,abOnly});
      }
    });
    for(const [id,slot]of Object.entries(this.loops))if(!wanted.has(id)){slot.level=0;slot.gain?.gain.setTargetAtTime(0,time,.025);}
    if(active&&s.gearMoving&&!this.previous.gearMoving)void this.playOriginal('gearTravelA');
    this.previous={gearMoving:s.gearMoving,engines:parameters};
    this.telemetry={active,view,engines:parameters.map(({producing,n2,ab})=>({producing,n2,ab})),voices,status:this.status};
  }
}
