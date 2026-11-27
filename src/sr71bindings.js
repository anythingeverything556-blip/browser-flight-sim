// Source: common/model/exterior_2020.xml and attachments/blackbird/Function_Interior/model/SR71_Interior.xml.
// Adapt the existing Earthwing solver, not MSFS systems. Original keyframes remain untouched.
export const clamp01 = n => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
export const centered = n => clamp01(.5 + n * .5);
// Original tire clips encode one revolution; signed solver angular velocity
// advances their loop in turns. A non-positive dt leaves the visual frozen.
export function wheelPhase(phase, angularSpeed, dt) {
  const current=Number.isFinite(phase)?phase:0, speed=Number.isFinite(angularSpeed)?angularSpeed:0;
  const turns=current+speed*(Number.isFinite(dt)?Math.max(0,dt):0)/(2*Math.PI);
  return ((turns%1)+1)%1;
}
export const SR71_ACTIONS = [
  { id:'sr71Seal', label:'SR-71 canopy pressure seal (unseal before opening; simplified interlock)', group:'SR-71 original cockpit', keys:['Shift+KeyS'] },
  { id:'sr71Walt', label:'SR-71 original WALT open / stow (geometry only; no live tablet)', group:'SR-71 original cockpit', keys:['Shift+KeyW'] },
  { id:'sr71Clipboard', label:'SR-71 original clipboard use / stow (geometry only)', group:'SR-71 original cockpit', keys:['Shift+KeyC'] },
];
export function sourcePose(fdm, cockpit, pilot) {
  const surf=fdm.surf || {}, axes=pilot || {}, ctrl=fdm.ctrl || {};
  // Source INVERT_ANIM makes positive pitch increase clip time; right-positive roll
  // lowers the left trailing edge and raises the right. Same mixer as the existing solver.
  const pitch=Math.max(-1,Math.min(1,(surf.de||0)+(fdm.trim||0))), roll=surf.da||0;
  const pose={
    HANDLING_Inboard_L_Elevon:centered(pitch-roll*12/18),
    HANDLING_Outboard_L_Elevon:centered(pitch-roll*12/18),
    HANDLING_Inboard_R_Elevon:centered(pitch+roll*12/18),
    HANDLING_Outboard_R_Elevon:centered(pitch+roll*12/18),
    HANDLING_L_Rudder:centered(surf.dr||0), HANDLING_R_Rudder:centered(surf.dr||0),
    // The second half of these original timelines is compression, not deployment.
    GEAR_Left:clamp01(fdm.gearPos)*.5, GEAR_Right:clamp01(fdm.gearPos)*.5, GEAR_Center:clamp01(fdm.gearPos)*.5,
    GEAR_Steering:centered((ctrl.dr||0)*clamp01(fdm.gearPos)),
    CANOPY:cockpit.open, CANOPY_Front:cockpit.open,
    CANOPY_LEVER_F:cockpit.goal, canopy_pressure_seal:cockpit.sealed?0:1,
    GEAR_HANDLE:fdm.gearDown?1:0,
    HANDLING_YOKE_Lever_StickLR:centered(axes.roll??ctrl.da??0),
    HANDLING_YOKE_Lever_StickForeAft:centered(axes.pitch??ctrl.de??0),
    HANDLING_RudderPedals:centered(axes.yaw??ctrl.dr??0),
    HANDLING_RudderPedals_Brake_L:clamp01(fdm.brakes),
    HANDLING_RudderPedals_Brake_R:clamp01(fdm.brakes),
    DRAG_CHUTE_PULL_HANDLE:fdm.chute==='stowed'?0:1,
    WALT_Open_Close:cockpit.walt, Clipboard_Use_Stow:cockpit.clipboard,
  };
  for(let i=0;i<2;i++) {
    const side=i?'R':'L', engine=fdm.engines?.[i]||{};
    pose['ENGINE_LEVER_THROTTLE_'+(i+1)]=clamp01((fdm.throttle||0)+(fdm.leverTrim?.[i]||0));
    // exterior_2020.xml 92–118: ejector flaps schedule only while A/B is lit.
    pose['ENGINE_'+side+'_Ejector_Flaps']=engine.ab>0?clamp01((fdm.out?.M||0)-1.5):0;
    pose['ENGINE_'+side+'_Inlet_Spike']=clamp01(engine.spike);
    // exterior_2020.xml 142–180: these are the separate tertiary intake doors
    // around the exhaust shroud, NOT the ejector petals and NOT burner flame.
    // Original fully-open/half/closed poses at M<=.5 / 1.05 / >=1.6.
    pose['ENGINE_'+side+'_Tertiary_Doors']=clamp01((1.6-(fdm.out?.M||0))/1.1);
  }
  return pose;
}
