import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { Autopilot, attitude, SR71_AP } from '../src/autopilot.js';
import { C172_AP, DA40_AP, F27_AP, supportsApMode } from '../src/propap.js';
import { configurePropApUi } from '../src/propap-ui.js';
import { SF50_AP } from '../src/sf50ap.js';
import { IL76_AP } from '../src/il76ap.js';
import { A380X_AP } from '../src/a380xap.js';
const src=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
function fakeDocument(){
 const nodes=new Map();
 function node(id) {
  if(nodes.has(id))return nodes.get(id);
  const n={id,style:{},dataset:{},value:'',classList:{toggle(){}},querySelector(selector){return node(id+selector);},closest(){return node(id+'-dial');}};
  n.parentElement={style:{},querySelector(){return node(id+'-label');}};
  nodes.set(id,n);return n;
 }
 const modes=['hdg','nav','appr','flch','alt','vs','spd','mach'].map(m=>Object.assign(node('mode-'+m),{dataset:{m}}));
 node('ap-modes').querySelectorAll=()=>modes;
 return {getElementById:node,nodes,modes};
}
for(const cfg of [C172_AP,DA40_AP,F27_AP]){
 const doc=fakeDocument();configurePropApUi(doc,cfg);
 assert.equal(doc.getElementById('ap-heading').textContent,cfg.label);
 for(const b of doc.modes)assert.equal(b.disabled,!supportsApMode(cfg,b.dataset.m));
 for(const k of ['spd','mach'])assert.equal(doc.getElementById('ap-'+k).disabled,true);
 for(const k of ['ap-takeoff','ap-cruise','ap-goaround']){assert.equal(doc.getElementById(k).disabled,true);assert.equal(doc.getElementById(k).hidden,true);}
 assert.match(doc.getElementById('tp-ap-label').textContent,/manual throttle/);
 const ap=new Autopilot(cfg);
 const fdm={onGround:false,crashed:false,pos:{y:1800},ctrl:{de:0,da:0,dr:0},throttle:0.41,mass:cfg===F27_AP?17000:1100,flaps:0,w:{x:0,z:0},out:{M:0.2,V:80,T:280,alpha:0,beta:0,pitchPower:2,rollPower:2,dePerG:0.2}};
 let speed=80;
 const messages=[];
 const context=vm.createContext({ap,fdm,state:{lastGround:0},CG_H:1,apIas:()=>speed,takeoff:{stop(){}},syncApTargets(){},apEdited:new Set(),approachSpeedFloor(){},syncAp(){},toast:m=>messages.push(m)});
 vm.runInContext(src.slice(src.indexOf('function engageAp() {'),src.indexOf('let lastApProt')),context);
 vm.runInContext(src.slice(src.indexOf('function toggleAp() {'),src.indexOf("$('ap-master').addEventListener")),context);
 assert.equal(vm.runInContext('engageAp()',context),true);
 assert.equal(ap.on,true);assert.equal(fdm.throttle,0.41);assert.equal(ap.modes.spd,false);assert.equal(ap.modes.mach,false);
 vm.runInContext('toggleAp()',context);assert.equal(ap.on,false);
 fdm.onGround=true;assert.equal(vm.runInContext('engageAp()',context),false);fdm.onGround=false;
 fdm.crashed=true;assert.equal(vm.runInContext('engageAp()',context),false);fdm.crashed=false;
 fdm.pos.y=40;assert.equal(vm.runInContext('engageAp()',context),false);fdm.pos.y=1800;
 speed=20;assert.equal(vm.runInContext('engageAp()',context),false);
 speed=cfg.iasLimit+1;assert.equal(vm.runInContext('engageAp()',context),false);speed=80;
 // The actual production panel callback rejects unavailable modes and selects available ones.
 const apInputs={vs:{value:'0'}};const nav={wps:[],arrival:null};
 Object.assign(context,{apInputs,nav,supportsApMode,MODE_GROUPS:{hdg:['hdg','nav'],nav:['hdg','nav']},readAp(){},approachSpeedFloor(){}});
 const begin=src.indexOf("document.querySelectorAll('#ap-modes button').forEach");
 const callback=src.slice(begin,src.indexOf('function syncApTargets',begin));
 let handler;
 context.document={querySelectorAll:()=>[{addEventListener:(_,f)=>{handler=f;}}]};
 context.b={dataset:{m:'spd'}};context.document.querySelectorAll=()=>[context.b];context.b.addEventListener=(_,f)=>{handler=f;};
 vm.runInContext(callback,context);handler();assert.equal(ap.modes.spd,false);
 context.b.dataset.m='hdg';handler();assert.equal(ap.modes.hdg,false);
 context.b.dataset.m='nav';handler();assert.equal(ap.modes.nav,false);assert.equal(ap.modes.hdg,true);
 for(const [ias,alpha] of [[15,0.5],[cfg.iasLimit+10,0],[80,0]]){
  const c=ap.update(1/60,{fdm,out:{...fdm.out,alpha},att:{bank:0,pitch:0,heading:90},vs:0,alt:1800,ias,nav:{}});
  assert.equal(c.th,0.41);assert.equal(c.thrOverride,false);
 }
 ap.target.alt=1e6;ap.target.vs=1e5;ap.target.vsLimit=1e5;
 ap.update(1/60,{fdm,out:fdm.out,att:{bank:0,pitch:0,heading:90},vs:0,alt:1800,ias:80,nav:{}});
 assert.equal(ap.target.alt,cfg.ceiling);assert.equal(ap.target.vs,cfg.maxVs);assert.equal(ap.target.vsLimit,cfg.maxVs);
 console.log('PASS panel / engage / disconnect / power envelope',cfg.label);
}
assert.match(src,/controls\.on\('autopilot', toggleAp\)/);
assert.match(src,/\$\('ap-master'\)\.addEventListener\('click', toggleAp\)/);
assert.match(src,/const AP0 = new Autopilot\(AP_CONFIG\)/);
assert.match(src,/hold = \$\('tp-ap'\)\.checked;/);
assert.match(src,/\$\('tp-ap'\)\.checked = flying && ap\.on;/);
assert.match(src,/else if \(state\.apAfterSpawn\) \{ state\.apAfterSpawn = false; engageAp\(\); syncAp\(\); \}/);
assert.match(src,/ap\.cfg\.manualThrottle && \(controls\.trimUp \|\| controls\.trimDown\)/);
assert.match(src,/else if \(ap\.cfg\.manualThrottle && !fdm\.onGround\) apTrimServo/);
assert.match(src,/state\.navOut\.agl < \(ap\.cfg\.minApAgl/);
assert.match(src,/settings\.metric \? 1 : FT/);
assert.match(html,/id="ap-vs"[^>]*aria-label="Vertical speed target"/);
assert.match(html,/id="ap-spd-u"/);
console.log('PASS keyboard / teleport / metric-altitude / manual-trim / minimums wiring');

// Run the actual simulate() AP branch, including its update arguments and FDM
// assignments. Calling Autopilot.update with a hand-built rudder field alone
// misses a disconnected production input (B05).
const simulateStart = src.indexOf('function simulate(dt) {');
const apFrameStart = src.indexOf('  if (ap.on) {', simulateStart);
const apFrameEnd = src.indexOf('  // SR-71 elevon display:', apFrameStart);
assert.ok(simulateStart >= 0 && apFrameStart > simulateStart && apFrameEnd > apFrameStart);
const apFrame = src.slice(apFrameStart, apFrameEnd);
for (const cfg of [C172_AP, DA40_AP, F27_AP, SF50_AP, IL76_AP, A380X_AP, SR71_AP]) {
 const ap = new Autopilot(cfg);
 const fdm = {onGround:false, pos:{y:1800}, vel:{y:0}, ctrl:{de:0.1,da:0.2,dr:0.3},
  throttle:0.41, mass:cfg === F27_AP ? 17000 : 1100, flaps:0, gearDown:false,
  w:{x:0.02,z:0.01}, out:{M:0.2,V:80,T:280,alpha:0,beta:0.08,pitchPower:2,rollPower:2,dePerG:0.2}};
 Object.assign(ap.target,{alt:1800,hdg:95});
 ap.engage(fdm);
 const controls = {manual:false,trimUp:false,trimDown:false,axes:{yaw:0},throttle:fdm.throttle};
 let output;
 const update = ap.update.bind(ap);
 ap.update = (...args) => (output = update(...args));
 const context = vm.createContext({ap,fdm,controls,dt:1/60,att:{bank:0,pitch:0,heading:90},
  state:{navOut:{agl:1000},lastGround:0},CG_H:1,apIas:()=>80,
  IS_SF50:cfg === SF50_AP,IS_HEAVY:cfg === IL76_AP || cfg === A380X_AP,
  autoland:{armed:false,disarm(){}},lastApProt:'',apTrimServo(){},sf50ApFrame(){},syncAp(){},toast(){}});
 for (const yaw of [0.75,-0.75,0,2,-2,0.25,0]) {
  controls.axes.yaw = yaw;
  vm.runInContext(apFrame,context);
  const expected = cfg.manualThrottle ? Math.max(-1,Math.min(1,yaw)) : 1.5 * fdm.out.beta;
  assert.equal(fdm.ctrl.dr,expected,`${cfg.label || 'servo AP'}: pilot yaw ${yaw}`);
  assert.equal(ap.on,true,'rudder alone does not disconnect the two-axis autopilot');
  assert.equal(fdm.ctrl.de,output.de,'pitch servo remains authoritative');
  assert.equal(fdm.ctrl.da,output.da,'roll servo remains authoritative');
  if (cfg.manualThrottle) assert.equal(fdm.throttle,0.41,'pilot throttle is untouched');
 }
 console.log('PASS production simulate AP yaw delegation',cfg.label || 'servo AP');
}
