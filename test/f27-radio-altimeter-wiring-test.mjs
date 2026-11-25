// Real browser callback/frame snippets + decoded source GLB AnimationMixer.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import { loadModel } from './_glb-node.mjs';
import { F27Model } from '../src/f27.js';
import { F27RadioAltimeter } from '../src/f27callouts.js';
import { createFokkerAdapter } from '../src/f27adapter.js';
import { radioAltitudeFraction } from '../src/f27instruments.js';
const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8'),html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const update=main.slice(main.indexOf('function updateF27RadioAltimeter('),main.indexOf('function da40State('));
const start=main.indexOf("    $('f27-radio-alt').addEventListener");
const binding=main.slice(start,main.indexOf('\n    });',start)+8);
const marker=main.indexOf('  const groundY = groundAt(fdm.pos.x, fdm.pos.z);',main.indexOf('function frameBody('));
const frame=main.slice(marker,main.indexOf('  const warn =',marker));
assert.ok(marker>0&&frame.includes('if (IS_F27) updateF27RadioAltimeter('),'unconditional view-independent frame hook');
assert.doesNotMatch(frame,/rig.view|cockpit|paused|started|pending|slew/);
const fdm=new F27Model(),FT=1/.3048,CG_H=2;
const button={attrs:{'aria-pressed':'false'},getAttribute(k){return this.attrs[k];},setAttribute(k,v){this.attrs[k]=v;},classList:{toggle(){}},addEventListener(type,fn){this.click=fn;},textContent:'Radio altimeters · OFF'},status={textContent:''};
const c=vm.createContext({fdm,FT,KT:1.943844,D2R:Math.PI/180,CG_H,IS_F27:true,F27RadioAltimeter,groundAt:()=>0,attitude:()=>({pitch:0,bank:0,heading:90}),ias:()=>0,casMs:()=>0,state:{},nav:{},env:{hour:12},settings:{runClock:false},controls:{},visual:{cabinDoor:{pos:0}},audio:{play(){}},clampN:(v,n)=>Math.max(-n,Math.min(n,v)),$:id=>id==='f27-radio-alt'?button:status});
vm.runInContext('const f27RadioAltimeter=new F27RadioAltimeter();let f27RadioAltOn=false,f27RadioAltValid=false;\n'+update+'\n'+binding,c);
const setHeight=ft=>{fdm.pos.y=CG_H+ft/FT;};
const feed=()=>c.f27PanelState({pitch:0,bank:0,heading:90},(fdm.pos.y-CG_H));
const step=()=>vm.runInContext('{'+frame+'}',c);
let passed=0;const test=(name,fn)=>{fn();passed++;console.log('PASS',name);};
test('Actual panel switch defaults OFF; terrain altitude alone is not validity',()=>{setHeight(100);step();assert.equal(button.attrs['aria-pressed'],'false');assert.equal(feed().radioAltValid,false);button.click();assert.equal(button.attrs['aria-pressed'],'true');assert.equal(feed().radioAltValid,true);assert.match(status.textContent,/100 ft AGL/);});
test('0–2500 inclusive valid, 2500–5000 powered but flagged, >5000 returns OFF',()=>{
 for(const [height,valid,on] of [[0,true,true],[2500,true,true],[2500.01,false,true],[5000,false,true],[5000.01,false,false]]) {c.updateF27RadioAltimeter(height);assert.equal(button.attrs['aria-pressed'],String(on));assert.equal(feed().radioAltValid,valid);}
 setHeight(100);step();assert.equal(button.attrs['aria-pressed'],'false','descent cannot auto-restart');button.click();assert.equal(feed().radioAltValid,true,'fresh manual ON restores');
});
test('Radio auto-off/validity updates in external views, pause, slew, loading and menu too',()=>{
 for(const view of ['cockpit','chase','orbit','flyby','tower','cabin']) {
  c.rig={view};c.state.paused=true;c.state.slew=true;c.state.pending={};c.state.started=false;
  setHeight(6000);step();assert.equal(button.attrs['aria-pressed'],'false',view+' auto-off');
  setHeight(150);step();assert.equal(button.attrs['aria-pressed'],'false',view+' descent stays OFF');button.click();assert.equal(feed().radioAltValid,true,view+' manual ON');
 }
});
test('Crash/nonfinite invalidates, exposes OFF, requires deliberate fresh ON',()=>{
 fdm.crashed='test';step();assert.equal(feed().radioAltValid,false);assert.equal(button.attrs['aria-pressed'],'false');fdm.crashed=null;step();assert.equal(feed().radioAltValid,false);button.click();assert.equal(feed().radioAltValid,true);
 c.updateF27RadioAltimeter(NaN);assert.equal(feed().radioAltValid,false);assert.equal(button.attrs['aria-pressed'],'false');
});
const gltf=await loadModel('f27/f27-white-vc-v2');
const adapter=createFokkerAdapter(THREE,gltf,{lighting:JSON.parse(readFileSync(new URL('../src/f27lighting.json',import.meta.url))),model:'cockpit'});
try {
 const instruments=adapter.instruments;
 test('Actual two cockpit needle and flag clips respond to switch/validity/power',()=>{
  const poses=[];
  for(const [radioAltOn,radioAltValid,radioAltFt,powered] of [[false,false,100,true],[true,true,100,true],[true,true,400,true],[true,false,3000,true],[true,true,100,false],[true,true,-1,true],[true,true,NaN,true]]) {
   instruments.update(fdm,{...feed(),radioAltOn,radioAltValid,radioAltFt,powered},0);adapter.evaluatePose();
   const valid=radioAltOn&&radioAltValid&&powered&&Number.isFinite(radioAltFt)&&radioAltFt>=0&&radioAltFt<=2500;
   for(const n of ['01','02']) {assert.equal(instruments.values[`x0_RALT_${n}_Flag`],valid?1:0);assert.equal(instruments.values[`x0_RALT_${n}_Aig`],radioAltitudeFraction(valid?radioAltFt:2500));}
   poses.push(['01','02'].map(n=>({flag:gltf.scene.getObjectByName(`x0_RALT_${n}_Flag`).quaternion.clone(),needle:gltf.scene.getObjectByName(`x0_RALT_${n}_Aig`).quaternion.clone()})));
  }
  for(let i=0;i<2;i++) {assert.ok(poses[0][i].flag.angleTo(poses[1][i].flag)>.1,'real flag moves');assert.ok(poses[1][i].needle.angleTo(poses[2][i].needle)>.1,'real needle moves');assert.ok(poses[0][i].flag.angleTo(poses[3][i].flag)<1e-5,'out-of-range exposes real flag');}
 });
 test('Panel documents switch limits and separate optional spoken-height aid',()=>{
  assert.match(html,/id="f27-radio-alt"/);assert.match(html,/0–2,500 ft AGL/);assert.match(html,/5,000 ft/);assert.match(html,/Optional spoken landing heights in Options are a separate game aid/);
  const speech=main.slice(main.indexOf('      callout: {'),main.indexOf('\n    });',main.indexOf('      callout: {')));assert.doesNotMatch(speech,/f27RadioAltOn|f27RadioAltValid/);
 });
} finally {adapter.dispose();}
console.log(`f27-radio-altimeter-wiring-test: ${passed} passed; real GLB needle and flag motions verified`);
