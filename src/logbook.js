// Account-free, bounded local log. Storage failures never interrupt the simulation.
const AIRCRAFT = new Set(['sr71','c172','sf50','il76']);
const MODES = new Set(['runway','approach','final','cruise']);
const ident = v => typeof v === 'string' && /^[A-Z0-9-]{1,12}$/.test(v) ? v : null;
export const MAX_FLIGHTS = 50;
export function cleanSetup(v) {
  if (!v || !AIRCRAFT.has(v.aircraft) || !ident(v.airport) || !MODES.has(v.mode)) return null;
  const integer = (n,max) => Number.isInteger(n) && n >= 0 && n <= max;
  if (!integer(v.rwy,100) || !integer(v.end,1)) return null;
  return {aircraft:v.aircraft,airport:v.airport,rwy:v.rwy,end:v.end,mode:v.mode,
    mission:typeof v.mission==='string' && /^[a-z0-9]{1,24}$/.test(v.mission)?v.mission:'free',
    weather:['clear','few','scattered','overcast','rain','storm','fog','windy'].includes(v.weather)?v.weather:'few',
    hour:Number.isFinite(v.hour)&&v.hour>=0&&v.hour<=24?v.hour:15};
}
export class FlightLogbook {
  constructor(storage = () => localStorage) { this.storage = storage; this.key='earthwing.logbook.v1'; this.active=null; this.persisted=true; }
  read() {
    try {
      const text=this.storage().getItem(this.key);if(!text||text.length>131072)return {entries:[],last:null};
      const d=JSON.parse(text); const seen=new Set();const entries=[];
      for(const e of Array.isArray(d?.entries)?d.entries.slice(0,MAX_FLIGHTS*2):[]) {
        if(!e || typeof e.id!=='string'||e.id.length>80||seen.has(e.id)||!AIRCRAFT.has(e.aircraft)||!ident(e.departure)||!(e.arrival==='Unknown'||ident(e.arrival))||!Number.isFinite(e.duration)||e.duration<0||e.duration>604800||!Number.isFinite(e.sinkFpm)||e.sinkFpm<0||e.sinkFpm>100000)continue;
        entries.push({id:e.id,aircraft:e.aircraft,departure:e.departure,arrival:e.arrival,duration:Math.round(e.duration),sinkFpm:Math.round(e.sinkFpm),quality:e.sinkFpm<200?'Soft':e.sinkFpm<600?'Firm':'Hard'});seen.add(e.id);if(entries.length===MAX_FLIGHTS)break;
      }
      return {entries,last:cleanSetup(d?.last)};
    } catch { return {entries:[],last:null}; }
  }
  write(d) {try {this.storage().setItem(this.key,JSON.stringify(d));this.persisted=true;return true;}catch {this.persisted=false;return false;} }
  begin(setup) {
    const last=cleanSetup(setup);if(!last){this.active=null;return;}
    this.active={...last,id:`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`,duration:0,recorded:false};
    const d=this.read();d.last=last;this.write(d);
  }
  tick(dt) {if(this.active&&Number.isFinite(dt)&&dt>0)this.active.duration=Math.min(604800,this.active.duration+dt);}
  land(arrival,sink) {
    const a=this.active;if(!a||a.recorded||a.duration<1.5||!Number.isFinite(sink)||sink<0)return false;
    a.recorded=true;const sinkFpm=Math.min(100000,Math.round(sink*196.85));
    const entry={id:a.id,aircraft:a.aircraft,departure:a.airport,arrival:ident(arrival)||'Unknown',duration:Math.round(a.duration),sinkFpm,quality:sinkFpm<200?'Soft':sinkFpm<600?'Firm':'Hard'};
    const d=this.read();d.entries=[entry,...d.entries.filter(e=>e.id!==entry.id)].slice(0,MAX_FLIGHTS);this.write(d);return true;
  }
  cancel(){this.active=null;}
}
