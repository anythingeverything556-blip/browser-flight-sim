import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const main=readFileSync('src/main.js','utf8');
const source=main.slice(main.indexOf('// Flight assets are demand-loaded:'),main.indexOf('// ---------- boot ----------'));
const tick=()=>new Promise(r=>setTimeout(r,10));
function harness(aircraft='sr71') {
  let resolve,reject; const transfer=new Promise((a,b)=>{resolve=a;reject=b});
  let cockpitResolve; const cockpitTransfer=new Promise(a=>{cockpitResolve=a});
  const calls={load:0,cockpit:0,replay:0,frames:0,events:[],prepared:0}; const nodes=new Map(); let capture;
  class Element {constructor(id){this.id=id;this.hidden=true;this.disabled=false;this.style={};this.handlers={};}closest(){return this;}addEventListener(t,fn){this.handlers[t]=fn;}click(){calls.replay++;}focus(){this.focused=true;}}
  const $=id=>{if(!nodes.has(id))nodes.set(id,new Element(id));return nodes.get(id);};
  const context={console:{warn(){}},Promise,Element,$,window:{__simReady:true},location:{reload(){}},
    document:{addEventListener(type,fn){capture=fn;},querySelectorAll:()=>[]},AIRCRAFT:aircraft,quickAircraft:aircraft,IS_F27:aircraft==='f27',IS_A380X:false,IS_IL76:aircraft==='il76',
    logbook:{read:()=>({last:{aircraft}})},flightLoadActions:$('flight-load-actions'),lsEl:$('loadscreen'),loadUi:{},openSheet(){},
    showLoadUi(){context.lsEl.hidden=false;},lsStep:(name,status)=>calls.events.push([name,status]),
    AIRCRAFT_TYPES:{[aircraft]:{short:aircraft}},AC:{model:aircraft+'.glb'},BASE:'/',
    visual:{load(){calls.load++;return transfer;},registerOccluders(){},attachSelfShadow(){}},
    prepareSR71Cockpit(){calls.cockpit++;return cockpitTransfer;},chooseF27Paint:()=>Promise.resolve(),f27SelectedPaint:'x',configureCameraAircraft(){},occlusion:{},env:{sun:{}},
    wreck:{prepare(){calls.prepared++;return this.prepared=Promise.resolve();},warmPieces:()=>Promise.resolve()},
    warm:{finished:1},whenIdle:fn=>fn(),renderer:{},scene:{},camera:{},post:{enabled:false},audio:{play(){}},
    state:{},performance,frame(){},syncHiddenPump(){},withAssetDeadline:p=>p,
    requestAnimationFrame(fn){if(fn===context.frame){calls.frames++;return;}setTimeout(fn,0);},setTimeout};
  vm.createContext(context);vm.runInContext(source,context);
  const click=id=>{let stopped=false;capture({target:$(id),preventDefault(){},stopImmediatePropagation(){stopped=true;}});return stopped;};
  return {calls,nodes,$,context,click,resolve,reject,cockpitResolve};
}
for(const aircraft of ['sr71','da40','c172','sf50','f27','il76']) {
  const h=harness(aircraft);assert.equal(h.calls.load,0,aircraft+' no menu model');
  assert(h.click('just-fly'));assert.equal(h.$('loadscreen').hidden,false,'same-click feedback');
  h.click('start-btn');await tick();assert.equal(h.calls.load,1,'deduplicated model transfer');
  assert.equal(h.calls.replay,0,'no spawn before required assets');assert.equal(h.calls.frames,0);
  assert.equal(h.calls.cockpit,aircraft==='sr71'?1:0,'cockpit preflight is scoped to SR-71');
  h.resolve();await tick();
  if(aircraft==='sr71'){assert.equal(h.calls.replay,0,'exterior alone must not launch the SR-71');h.cockpitResolve({root:{}});await tick();}
  assert.equal(h.calls.replay,1,aircraft+' replay');assert.equal(h.calls.frames,1,aircraft+' frame');assert.equal(h.context.window.__flightAssetsReady,true);
  h.click('start-btn');assert.equal(h.calls.frames,1,'only one frame loop');
}
{
  const h=harness();h.click('start-btn');await tick();
  h.$('flight-load-back').handlers.click();assert.equal(h.$('loadscreen').hidden,true);
  h.resolve();h.cockpitResolve({root:{}});await tick();assert.equal(h.calls.replay,0,'cancelled start not replayed');assert.equal(h.calls.frames,0,'no unsolicited home rendering');
  h.click('just-fly');assert.equal(h.calls.frames,1,'prepared aircraft starts later without another transfer');assert.equal(h.calls.load,1);
}
{
  const h=harness();h.click('start-btn');await tick();h.reject(Error('Model offline'));await tick();
  assert.match(h.$('ls-sub').textContent,/Model offline/);assert.equal(h.$('flight-load-retry').hidden,false);
  h.$('flight-load-back').handlers.click();assert.equal(h.$('loadscreen').hidden,true);assert.equal(h.$('start-btn').disabled,false);
  assert.equal(h.calls.replay,0);assert.equal(h.calls.frames,0);
}
{
  const h=harness();h.context.quickAircraft='sr71';h.context.AIRCRAFT='sf50';assert.equal(h.click('just-fly'),false,'cross-aircraft quick selection redirects before loading');
}
console.log('PASS demand startup: six aircraft, immediate feedback, transfer single-flight, required-asset gate, cancellation/resume, failure recovery, cross-aircraft redirect');

const cockpitSource=main.slice(main.indexOf('let sr71RequestedView'),main.indexOf('let flightExtrasScheduled'));
{
  const nodes=new Map();const $=id=>{if(!nodes.has(id))nodes.set(id,{hidden:true,addEventListener(){}});return nodes.get(id);};
  let resolve,reject,count=0;let transfer=new Promise((a,b)=>{resolve=a;reject=b});
  const context={$,AIRCRAFT:'sr71',flightAssetsReady:true,Promise,console:{warn(){}},rig:{view:'orbit'},setView(){},
    visual:{preloadCockpit(){count++;return transfer;},cockpitTextures:()=>[],cockpit:[]},
    setTimeout,clearTimeout,withAssetDeadline:p=>p,warmTextures:()=>Promise.resolve(),warmLate:()=>Promise.resolve(),revealCockpit:()=>()=>{},renderer:{},scene:{},camera:{},post:{},
    applyView:view=>{context.rig.view=view;}};
  vm.createContext(context);vm.runInContext(cockpitSource,context);
  const first=context.requestSR71View('cockpit');await tick();assert.equal(context.rig.view,'orbit');assert.equal($('sr71-view-feedback').hidden,false);
  await context.requestSR71View('chase');resolve({root:{traverse(){}}});await first;
  assert.equal(context.rig.view,'chase','late cockpit completion cannot overwrite chosen exterior');
  await context.requestSR71View('cockpit');assert.equal(context.rig.view,'cockpit');assert.equal(count,1,'background/explicit view reuse same prep');
  vm.runInContext('sr71CockpitReady=null;sr71CockpitPrepared=false',context);context.rig.view='orbit';transfer=Promise.reject(Error('Cockpit offline'));
  await context.requestSR71View('cockpit');assert.equal(context.rig.view,'orbit');assert.equal($('sr71-view-retry').hidden,false);
  transfer=Promise.resolve({root:{traverse(){}}});await context.requestSR71View('cockpit');assert.equal(context.rig.view,'cockpit');
}
console.log('PASS cockpit: exterior retained during transfer/failure, explicit retry, deduplicated preparation, stale request cancellation');
