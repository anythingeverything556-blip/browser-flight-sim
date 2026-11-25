// Browser assertions for actual FlightGear-derived moving geometry. No
// replacement fixtures, model state is reached through game keyboard actions.
const fields = {
  flap:'surface-positions/flap-pos-norm', aileron:'surface-positions/left-aileron-pos-norm',
  rudder:'surface-positions/rudder-pos-norm', elevator:'surface-positions/elevator-pos-norm',
  canopy:'da40/canopy-norm', door:'da40/door-left-norm', prop:'engines/engine[0]/rpm',
};
const different = (a,b) => a && b && a.some((q,i)=>Math.abs(q-b[i])>0.001);
export async function verifyDA40Motion(page) {
 const notes=[];
 async function read() { return await page.evaluate((keys)=>{
  const {fdm:f,visual:v,renderer:r}=window.__sim;
  const values={};for(const [k,prop] of Object.entries(keys)){
   const rule=v.bindings.find(b=>b.rule?.details?.property===prop && (k!=='prop'||b.object.userData?.name==='prop'));
   values[k]=rule?rule.group.quaternion.toArray():null;
  }
  return {values,flaps:f.flaps,ground:f.onGround,gs:Math.hypot(f.vel.x,f.vel.z),rpm:f.rpm,disc:v.propDisc?.visible,propVisible:v.prop?.visible,door:v.cabinDoor?.pos,doorCmd:v.cabinDoor?.cmd,axes:{...__sim.controls.axes},surf:{...f.surf},running:f.magnetos,frame:r.info.render.frame,bindings:v.bindings.length};
 },fields); }
 const gesture=async(key)=>{await page.keyboard.down('Shift');try{await page.keyboard.press(key);}finally{await page.keyboard.up('Shift');}};
 const paint=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const stepVisual=async(seconds)=>page.evaluate(dt=>{const x=__sim;x.visual.update(dt,x.fdm,x.rig.world?.isVector3?x.rig.world:new x.THREE.Vector3(),x.rig.view,x.env,x.state.lastGround||0,()=>x.visual.lastDisplayState||{});},seconds);
 const advance=async(seconds)=>{await page.evaluate(s=>__sim.advance(s),seconds);await stepVisual(0.08);await paint();};
 const record=(name,passed,details={})=>notes.push({name,passed:!!passed,...details});
 // Ground tests actively apply the built-in parking brake to minimize movement.
 await page.evaluate(()=>{window.__sim.controls.throttle=0;window.__sim.fdm.parkingBrake=true;});
 await page.keyboard.press('0');
 const initial=await read();
 await page.keyboard.press('f'); await advance(1.2);
 const flap=await read();record('source flap meshes move with F',flap.flaps>initial.flaps&&different(initial.values.flap,flap.values.flap),{before:initial.flaps,after:flap.flaps});
 await gesture('f'); await advance(0.8);
 const neutral=await read();
 await page.keyboard.down('ArrowRight');await page.keyboard.down('s');await page.keyboard.down('x');await advance(0.35);
 const deflected=await read();
 for(const axis of ['aileron','elevator','rudder'])record(`source ${axis} responds to control input`,different(neutral.values[axis],deflected.values[axis]),{axes:deflected.axes,surf:deflected.surf});
 await page.keyboard.up('x');await page.keyboard.up('s');await page.keyboard.up('ArrowRight');await advance(0.4);
 await page.evaluate(()=>{__sim.fdm.vel.set(0,0,0);});await stepVisual(0.05);
 const stationary=await read();
 await gesture('n');
 await stepVisual(2.2);await paint();
 const opened=await read();
 record('canopy and rear door open on the ground',opened.door>0.7&&different(stationary.values.canopy,opened.values.canopy)&&different(stationary.values.door,opened.values.door),{groundBefore:stationary.ground,groundSpeed:stationary.gs,door:opened.door,command:opened.doorCmd});
 if(opened.door>0.01){await gesture('n');await stepVisual(2.2);await paint();}
 const closed=await read();record('doors close on second toggle',opened.door>0.7&&closed.door<0.03,{door:closed.door});
 await page.keyboard.press('9');await advance(1.1);
 const powering=await read();record('source propeller animation switches to the spin disc as RPM rises',powering.rpm>750&&powering.disc===true&&powering.propVisible===false&&different(initial.values.prop,powering.values.prop),{before:initial.rpm,after:powering.rpm,disc:powering.disc,propVisible:powering.propVisible});
 await page.keyboard.press('0');
 await gesture('i');await advance(4.2);const stopped=await read();
 await gesture('i');await advance(0.8);const restarted=await read();
 record('engine stop and start controls',stopped.running===false&&restarted.running===true&&restarted.rpm>stopped.rpm,{stoppedRPM:stopped.rpm,restartedRPM:restarted.rpm});
 return {checks:notes,initial,final:restarted};
}
