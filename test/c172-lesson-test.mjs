import assert from 'node:assert/strict';
import {createMission,missionSpawnMode} from '../src/missions.js';
const start={lat:39,lon:-121,hdg:10};
const base={lat:39,lon:-121,hdg:10,onGround:true,agl:0,gs:0,throttle:0,iasKt:0,pitchDeg:0};
for (const kind of ['c172guide','c172pattern']) {
 const m=createMission(kind,start);assert.equal(missionSpawnMode(kind,'approach'),'runway');
 m.update(2,{...base,crashed:true,throttle:1});assert.equal(m.phase,0);
 const states=kind==='c172guide'?[{throttle:1},{onGround:false,agl:30},{agl:170,iasKt:74},{hdg:50},{pitchDeg:0,iasKt:95}]:[{onGround:false,agl:30},{agl:250},{hdg:280,agl:250},{hdg:190,agl:250},{hdg:100,agl:160},{hdg:10,agl:100,onGround:false},{onGround:true,gs:2}];
 for(const s of states)m.update(2,{...base,...s});
 assert.equal(m.done,true,kind);assert.match(m.coach().hint,/never moves/);
}
assert.equal(createMission('tutorial',start),null,'SR71 tutorial stays on existing path');
console.log('C172 lesson/pattern ordered phases, crash guard, spawn and coach pass');
