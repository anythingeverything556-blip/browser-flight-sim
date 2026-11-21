import assert from 'node:assert/strict';
const listeners = {};
globalThis.window = {addEventListener(type, fn) { (listeners[type] ||= []).push(fn); }};
globalThis.innerWidth=1000;globalThis.innerHeight=800;
let pads=[];
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{getGamepads:()=>pads}});
const {Controls}=await import('../src/controls.js');
const event=(type, props={})=>(listeners[type]||[]).forEach(fn=>fn({target:{},code:'ArrowLeft',key:'ArrowLeft',preventDefault(){this.prevented=true;},...props}));
const fresh=()=>{for(const list of Object.values(listeners))list.length=0;return new Controls();};
for(const target of [{tagName:'INPUT',type:'range'},{tagName:'INPUT',type:'checkbox'},{tagName:'BUTTON'},{tagName:'SELECT'},{isContentEditable:true},{closest:()=>true}]){
 const c=fresh();let fired=0;c.on('reset',()=>fired++);
 event('keydown',{target});event('keydown',{target,code:'Space',key:' '});event('keydown',{target,code:'KeyR',key:'r'});c.update(.6);
 assert.equal(c.axes.roll,0);assert.equal(c.brake,0);assert.equal(fired,0);assert.equal(c.keys.size,0);
}
{
 const c=fresh();event('keydown');c.update(.6);assert.ok(c.axes.roll<-.9);
 event('focusin',{target:{tagName:'INPUT'}});c.update(.6);assert.equal(c.axes.roll,0);assert.equal(c.keys.size,0);
}
{
 const c=fresh();navigator.getGamepads=()=>{throw new DOMException('Denied','SecurityError');};
 event('keydown');c.update(.6);assert.ok(c.axes.roll<-.9,'EW-35 keyboard advances despite denied pad API');
 c.enabled=false;assert.doesNotThrow(()=>c.update(.1),'EW-35 paused path tolerates denial');
 navigator.getGamepads=()=>pads;
}
const pad=(index,axes,mapping='standard')=>({index,axes,mapping,connected:true,buttons:Array.from({length:16},()=>({value:0,pressed:false}))});
for(const endpoint of [-1,1]){
 pads=[pad(0,[endpoint,endpoint,0])];const c=fresh();c.update(.1);
 assert.equal(c.axes.roll,endpoint,'EW-36 initial standard stick endpoint');assert.equal(c.axes.pitch,endpoint);
}
{
 pads=[pad(0,[-1,-1,0],'')];const ambiguous=fresh();ambiguous.update(.1);assert.equal(ambiguous.axes.roll,0);assert.equal(ambiguous.axes.pitch,0,'unknown initial trigger-like axes remain neutral');
}
{
 pads=[pad(0,[0,0,0],'') ,pad(1,[.8,0,0])];pads[1].buttons[7].value=.7;
 const c=fresh();c.update(.1);assert.ok(c.axes.roll>.7);assert.ok(c.throttle>0,'EW-37 supported active pad beats idle nonstandard');
 pads=[pad(0,[0,0,0]),pad(1,[.8,0,0])];c.update(.1);assert.equal(c.padIndex,1,'idle standard slot zero also cannot mask active pad');
 pads=[pad(0,[-.8,0,0]),pad(1,[0,0,0])];c.update(.1);assert.equal(c.padIndex,0);assert.ok(c.axes.roll<-.7);
 let gear=0;c.on('gear',()=>gear++);c.enabled=false;pads[0].buttons[0].pressed=true;c.update(.1);c.enabled=true;c.update(.1);assert.equal(gear,0,'button held across pause is not re-fired');
 pads=[pad(0,[0,0,0]),pad(1,[.2,0,0])];c.update(.1);assert.equal(c.padIndex,1,'light input outside the dead zone can select the active device');
 pads=[];c.update(.1);assert.equal(c.padIndex,null,'disconnect clears device identity');
}
console.log('PASS EW-01 UI input isolation; EW-35 denied gamepad; EW-36 endpoints; EW-37 active supported controller');
