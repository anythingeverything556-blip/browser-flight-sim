import assert from 'node:assert/strict';
import {sourcePose,SR71_ACTIONS,wheelPhase} from '../src/sr71bindings.js';
import {KEY_ACTIONS,resolveKeys,assignKey} from '../src/controls.js';
let tests=0;const check=(name,f)=>{f();tests++;console.log('PASS',name);};
const cockpit={sealed:true,goal:0,open:0,walt:0,clipboard:0};
const state={surf:{de:0,da:0,dr:0},ctrl:{de:0,da:0,dr:0},gearPos:1,gearDown:true,engines:[{spike:.2,ab:1},{spike:.8,ab:0}],throttle:.5,leverTrim:[-.2,.2],out:{M:2}};
check('original gear has separate deployment and compression half',()=>{
 const p=sourcePose(state,cockpit);assert.equal(p.GEAR_Left,.5);assert.equal(p.GEAR_Center,.5);assert.equal(p.GEAR_HANDLE,1);
 const q=sourcePose({...state,gearPos:.4,gearDown:false},cockpit);assert.equal(q.GEAR_Left,.2);assert.equal(q.GEAR_HANDLE,0);
});
check('all four neutral elevons and rudders are source midpoint',()=>{const p=sourcePose(state,cockpit);for(const [n,v]of Object.entries(p))if(/Elevon|Rudder$/.test(n))assert.equal(v,.5);});
check('actual solver surfaces mix pitch and differential roll',()=>{const p=sourcePose({...state,surf:{de:.3,da:.6,dr:-1}},cockpit);assert.equal(p.HANDLING_Inboard_L_Elevon,.45);assert.equal(p.HANDLING_Inboard_R_Elevon,.85);assert.equal(p.HANDLING_L_Rudder,0);});
check('independent original throttle levers retain engine trim',()=>{const p=sourcePose(state,cockpit);assert.equal(p.ENGINE_LEVER_THROTTLE_1,.3);assert.equal(p.ENGINE_LEVER_THROTTLE_2,.7);});
check('cockpit yoke follows pilot axes not geared surface display exaggeration',()=>{const p=sourcePose(state,cockpit,{pitch:1,roll:-1,yaw:1});assert.equal(p.HANDLING_YOKE_Lever_StickForeAft,1);assert.equal(p.HANDLING_YOKE_Lever_StickLR,0);assert.equal(p.HANDLING_RudderPedals,1);});
check('canopy seal polarity and independent WALT controls match source',()=>{const p=sourcePose(state,{...cockpit,walt:1});assert.equal(p.canopy_pressure_seal,0);assert.equal(p.WALT_Open_Close,1);assert.equal(p.Clipboard_Use_Stow,0);});
check('ejector geometry uses source Mach and burner condition, not fake flame',()=>{const p=sourcePose(state,cockpit);assert.equal(p.ENGINE_L_Ejector_Flaps,.5);assert.equal(p.ENGINE_R_Ejector_Flaps,0);});
check('tertiary doors follow their separate original Mach schedule',()=>{
 const at=M=>sourcePose({...state,out:{M}},cockpit).ENGINE_L_Tertiary_Doors;
 assert.equal(at(0),1);assert.equal(at(.5),1);assert.equal(at(1.05),.5);assert.equal(at(1.6),0);assert.equal(at(3),0);
 assert.equal(sourcePose({...state,engines:[{ab:0}],out:{M:2.5}},cockpit).ENGINE_L_Ejector_Flaps,0);
 assert.equal(sourcePose({...state,out:{M:2.5}},cockpit).ENGINE_L_Ejector_Flaps,1);
});
check('new defaults have no same-context conflict; rebind uses existing conflict resolver',()=>{
 const table=resolveKeys({});for(const a of SR71_ACTIONS)for(const key of a.keys)assert.equal(KEY_ACTIONS.filter(b=>(b.ctx||'main')==='main'&&table[b.id].includes(key)).length,1);
 const result=assignKey(table,'sr71Seal','KeyG');assert(result.moved.includes('gear'));assert(!table.gear.includes('KeyG'));
});
check('wheel phase respects solver angular speed, reverse and pause',()=>{assert(Math.abs(wheelPhase(0,Math.PI, .5)-.25)<1e-12);assert(Math.abs(wheelPhase(.1,-Math.PI,.4)-.9)<1e-12);assert.equal(wheelPhase(.3,10,0),.30000000000000004);assert.equal(wheelPhase(.3,NaN,1),.30000000000000004);});
console.log(tests+' SR-71 binding tests passed');
