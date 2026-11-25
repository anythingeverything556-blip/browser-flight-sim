// Exercise production main.js handlers with real keyboard dispatch and FDMs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { Controls, KEY_ACTIONS } from '../src/controls.js';
import { C172Model, C172, FLAP_DEG } from '../src/c172.js';
import { DA40Model, DA40, DA40_FLAP_DEG } from '../src/da40.js';
import { SF50Model, SF50 } from '../src/sf50.js';
import { F27Model, F27, F27_FLAP_DEG } from '../src/f27.js';
import { IL76Model, NOTCHES } from '../src/il76.js';
import { makeIl76Controls } from '../src/il76ctl.js';
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const body = main.slice(main.indexOf('// The selector shows the commanded detent'), main.indexOf("controls.on('recover'"));
const listeners = {};
globalThis.window = { addEventListener(type, fn) { (listeners[type] ||= []).push(fn); } };
const ev = (type, code, props = {}) => { for (const fn of listeners[type] || []) fn({ code, key: code, shiftKey: false, target: {}, preventDefault() {}, ...props }); };
const press = (up = false) => { if (up) ev('keydown', 'ShiftLeft', { shiftKey: true }); ev('keydown', 'KeyF', { shiftKey: up }); ev('keyup', 'KeyF'); if (up) ev('keyup', 'ShiftLeft'); };
for(const a of KEY_ACTIONS.filter(a=>/flaps/.test(a.id))) assert.match(a.label,/F27/);
const fixtures=[];
for (const [name, Model, angles] of [['C172',C172Model,[0,10,20,30]],['DA40',DA40Model,DA40_FLAP_DEG],['SF50',SF50Model,[0,15,39]],['F27',F27Model,F27_FLAP_DEG],['Il76',IL76Model,NOTCHES.map(n=>n.flap)]]) {
  for (const key of Object.keys(listeners)) listeners[key] = [];
  const controls = new Controls(), fdm = new Model();
  fdm.reset(new THREE.Vector3(0,3000,0), 90, 70, false); fdm.setFlaps(0);
  const buttons=F27_FLAP_DEG.map((_,i)=>({ dataset:{f27Flap:String(i)}, attrs:{}, handlers:{}, setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,v){this.handlers[k]=v;} }));
  const status={textContent:''}, state={started:true,pending:null};
  const document={querySelectorAll:()=>buttons};
  const toast=()=>{},casMs=()=>70,ias=()=>70;
  const il76c = name==='Il76' ? makeIl76Controls({fdm,toast,casKt:()=>130}) : null;
  const arg={IS_F27:name==='F27',IS_C172:name==='C172',IS_DA40:name==='DA40',IS_SF50:name==='SF50',IS_HEAVY:name==='Il76',F27,F27_FLAP_DEG,C172,FLAP_DEG,DA40,DA40_FLAP_DEG,SF50,HEAVY_NOTCHES:NOTCHES,controls,fdm,document,state,$:()=>status,toast,casMs,ias,KT:1.943844,il76c};
  const sync = new Function(...Object.keys(arg),body+'\nreturn syncF27Flaps;')(...Object.values(arg));
  for(let i=1;i<angles.length;i++){press();assert.equal(fdm.flapCmd,i,name+': one detent per press');}
  if(name==='F27') fdm.flaps=40;
  ev('keydown','KeyF'); ev('keydown','KeyF',{repeat:true}); ev('keyup','KeyF');
  assert.equal(fdm.flapCmd,0,name+': plain F at FULL selects UP and repeat does not re-extend');
  if(name==='F27') {
    assert.equal(fdm.flaps,40,'F commands retraction without teleporting the surface');
    const wind=new THREE.Vector3();
    for(let i=0;i<900;i++) fdm.step(1/60,()=>0,wind);
    assert.ok(Math.abs(fdm.flaps)<1e-8,'F27 actual surface returns to zero after the full travel');
  }
  for(let i=1;i<angles.length;i++) press();
  assert.equal(fdm.flapCmd,angles.length-1,name+': F still reaches FULL after a complete cycle');
  for(let i=angles.length-1;i>0;i--){press(true);assert.equal(fdm.flapCmd,i-1,name+': Shift+F reaches each lower notch');}
  press(true);assert.equal(fdm.flapCmd,0,name+': UP clamps');
  ev('keydown','KeyF');ev('keydown','KeyF',{repeat:true});assert.equal(fdm.flapCmd,1,'held/repeat advances only once');
  ev('keyup','KeyF');ev('keydown','KeyF');assert.equal(fdm.flapCmd,2,'new press advances');ev('keyup','KeyF');
  for(const tagName of ['BUTTON','INPUT','SELECT','TEXTAREA','A']){ev('keydown','KeyF',{target:{tagName},shiftKey:true});ev('keyup','KeyF');assert.equal(fdm.flapCmd,2,name+': focus '+tagName+' does not fly');}
  controls.setLocked(true);press(true);assert.equal(fdm.flapCmd,2,'paused keys ignored');controls.setLocked(false);
  controls.enabled=false;press(true);assert.equal(fdm.flapCmd,2,'disabled keys ignored');controls.enabled=true;
  if(name==='F27'){
    for(const button of buttons){button.handlers.click();assert.equal(fdm.flapCmd,+button.dataset.f27Flap);assert.equal(button.attrs['aria-pressed'],'true');assert.match(status.textContent,/Command/);}
    fdm.flaps=40;buttons[0].handlers.click();assert.equal(fdm.flapCmd,0);assert.equal(fdm.flaps,40,'UP command does not teleport surface');assert.match(status.textContent,/retracting \(15 s remaining\)/);
    fdm.flaps=0;sync();assert.match(status.textContent,/fully UP/);
    state.pending={};buttons[4].handlers.click();assert.equal(fdm.flapCmd,0);state.pending=null;
    state.started=false;buttons[4].handlers.click();assert.equal(fdm.flapCmd,0);state.started=true;
    assert.deepEqual([...html.matchAll(/data-f27-flap="(\d+)"/g)].map(m=>+m[1]),[0,1,2,3,4]);
  }
  fdm.setFlaps(999);assert.equal(fdm.flapCmd,angles.length-1);fdm.setFlaps(-999);assert.equal(fdm.flapCmd,0);
  fixtures.push({name,detents:angles.length,keyboard:true,holdRepeat:true,focus:true,bounded:true});
}
const sr71Controls=new Controls();
new Function('IS_F27','IS_C172','IS_DA40','IS_SF50','IS_HEAVY','controls',body)(false,false,false,false,false,sr71Controls);
assert.equal(sr71Controls.handlers.flapsDown,undefined,'SR71 has no flaps');
assert.equal(sr71Controls.handlers.flapsUp,undefined,'SR71 has no flaps');
const resetBody=main.slice(main.indexOf('  // Free F27 teleports'),main.indexOf('  // SF50.reset intentionally'));
const apply = new Function('IS_F27','s','fdm','F27_FLAP_DEG',resetBody);
for(const notch of [0,1,2,3,4])for(const gearDown of [false,true]){
  const fdm=new F27Model(),s={ground:false,speed:100/1.943844,gamma:0,config:{flapNotch:notch,gearDown}};
  fdm.reset(new THREE.Vector3(0,1000,0),90,s.speed,false);
  apply(true,s,fdm,F27_FLAP_DEG);assert.equal(fdm.flapCmd,notch);assert.equal(fdm.flaps,F27_FLAP_DEG[notch]);assert.equal(fdm.gearDown,gearDown);
}
assert.match(main,/explicitTeleportConfig = \(\) => IS_F27/);
assert.match(main,/const flapLimit = IS_F27 \? \[Infinity, F27.VFE, F27.VFE, F27.VFE, F27.VFE\]/);
console.log('PASS plain F cycles FULL to UP across the fleet; real press/release, Shift chord, repeat, focus, paused/disabled, panel selection/UP and guarded F27 teleport configuration');
console.log(JSON.stringify(fixtures));
