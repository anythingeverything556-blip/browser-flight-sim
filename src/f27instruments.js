import * as THREE from 'three';
import { isa } from './atmosphere.js';

// Native GLB animation sampling, not an MSFS runtime. Scale references:
// F27500v2bgt_INTERIOR.xml (BGT v2.3), English manual pp 7–10, 25, 31–34,
// and the preserved VCgauge01 dial artwork. Missing systems are NOT synthesized.
const FT = 1 / 0.3048, KT = 1.943844492, DEG = 180 / Math.PI;
const finite = Number.isFinite;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const wrap = (x, period) => ((x % period) + period) % period;
export function radioAltitudeFraction(ft) {
  // Printed scale: 0..300 linear half-turn; 500,1000,1500,2000,2500 thereafter.
  const points = [[0,0],[300,.5],[500,.625],[1000,.75],[1500,5/6],[2000,11/12],[2500,1]];
  ft = clamp(ft, 0, 2500);
  for (let i=1;i<points.length;i++) if (ft<=points[i][0]) {
    const [a,u]=points[i-1], [b,v]=points[i]; return u+(v-u)*(ft-a)/(b-a);
  }
  return 1;
}
// Pure, inspectable display feed. fdm values are SI; explicitly named feed values
// are display units. The two tanks share fuel only because the current FDM has a
// single symmetric reservoir, not because two independent tank systems exist.
export function f27InstrumentState(fdm, feed = {}, elapsed = 0) {
  const out=fdm.out||{}, q=fdm.quat||new THREE.Quaternion();
  const fwd=new THREE.Vector3(1,0,0).applyQuaternion(q), up=new THREE.Vector3(0,1,0).applyQuaternion(q), right=new THREE.Vector3(0,0,1).applyQuaternion(q);
  const atm=isa(fdm.pos?.y||0), engines=fdm.engines||[];
  return { ...feed,
    iasKt: feed.iasKt ?? Math.max(0,(out.ias ?? (fdm.vel?.length?.()||0)*Math.sqrt(atm.rho/1.225))*KT),
    altFt: feed.altFt ?? (fdm.pos?.y||0)*FT,
    pitchDeg: feed.pitchDeg ?? Math.asin(clamp(fwd.y,-1,1))*DEG,
    bankDeg: feed.bankDeg ?? Math.atan2(-right.y,up.y)*DEG,
    headingDeg: feed.headingDeg ?? wrap(Math.atan2(fwd.x,-fwd.z)*DEG,360),
    vsFpm: feed.vsFpm ?? (fdm.vel?.y||0)*FT*60,
    oatC: feed.oatC ?? (finite(out.T)?out.T:atm.T)-273.15,
    radioAltFt: feed.radioAltFt ?? (finite(feed.groundM)?Math.max(0,(fdm.pos?.y||0)-feed.groundM)*FT:undefined),
    pneumaticPsi: feed.pneumaticPsi ?? fdm.pneumatic,
    flapFraction: (fdm.flaps||0)/40, trim: fdm.trim||0,
    rudderTrim: feed.rudderTrim ?? (fdm.rudderTrim||0), aileronTrim: feed.aileronTrim ?? (fdm.aileronTrim||0),
    // These are genuine elapsed-time clocks until localTimeSeconds is supplied.
    clockSeconds: feed.localTimeSeconds ?? elapsed,
    engines: engines.map((e,i)=>({...e,...feed.engines?.[i]})),
    gearPos: fdm.gearPos, gearDown: fdm.gearDown, doorOpen: feed.doorOpen ?? false,
    tankFuelKg: feed.tankFuelKg ?? [fdm.fuel/2,fdm.fuel/2],
  };
}

export function f27GaugeFractions(s) {
  const values={}; const put=(n,v)=>{if(finite(v))values[n]=clamp(v);};
  const flag=(n,valid)=>put(n,valid?1:0); // BGT flag animation: 0 exposed, 1 retracted.
  const digits=(prefix,value,places)=>{if(!finite(value))return; for(const [suffix,place] of Object.entries(places))put(prefix+suffix,wrap(Math.floor(Math.abs(value)/place),10)/10);};
  const alt=s.altFt, hdg=wrap(s.headingDeg,360), bank=wrap(s.bankDeg+180,360)/360;
  for (const n of ['01','02']) {
    put(`x0_IAS_${n}_Aig1`,wrap(Math.max(0,s.iasKt),100)/100);
    put(`x0_IAS_${n}_Aig2`,s.iasKt/500);
    put(`x0_VSI_${n}_Aig`,.5+s.vsFpm/12000);
    put(`x0_ADI_${n}_Sphere`,.5+s.pitchDeg/180);
    put(`x0_ADI_${n}_BakSphereSup`,bank);
    // Sphere_Roll is a separate roll scale, not the sphere's parent.
    put(`x0_ADI_${n}_Sphere_Roll`,bank);
    flag(`x0_ADI_${n}_flag_ATT`,s.attitudeValid!==false);
    flag(`x0_ADI_${n}_flag_FD`,false); flag(`x0_ADI_${n}_flag_RWY`,false);
    flag(`x0_ADI_${n}_flag_GSL`,false);
    // Unknown slip/turn acceleration is left unbound, not faked from beta.
    put(`x0_ADI_${n}_Bille`,finite(s.ball)?(.5+s.ball/2):.5);
    put(`x0_ADI_${n}_Turn`,finite(s.turnFraction)?(.5+s.turnFraction/2):.5);
    put(`x0_HSI_${n}_ROSE`,hdg/360); put(`x0_VOR_${n}_Rose`,hdg/360);
    flag(`x0_HSI_${n}_Flag_HDG`,s.attitudeValid!==false);
    flag(`x0_VOR_${n}_Flag`,s.attitudeValid!==false);
    if(finite(s.selectedHeadingDeg))put(`x0_HSI_${n}_HDG`,wrap(s.selectedHeadingDeg-hdg,360)/360);
    put(`x0_Clock_${n}_Aig_Sec`,wrap(s.clockSeconds,60)/60);
    put(`x0_Clock_${n}_Aig_Min`,wrap(s.clockSeconds/60,60)/60);
    put(`x0_Clock_${n}_Aig_Hour`,wrap(s.clockSeconds/3600,12)/12);
    // A terrain height alone is not a powered, switched-on radio altimeter.
    // The source dial ends at 2500 ft, independently of the 5000-ft auto-off.
    const radioValid=s.radioAltValid===true&&s.radioAltOn===true&&s.powered!==false&&s.electrical!==false&&finite(s.radioAltFt)&&s.radioAltFt>=0&&s.radioAltFt<=2500;
    put(`x0_RALT_${n}_Aig`,radioAltitudeFraction(radioValid?s.radioAltFt:2500));
    flag(`x0_RALT_${n}_Flag`,radioValid);
    // No spurious navigation/FD guidance without an explicitly valid receiver.
    const nav=s.nav?.[Number(n)-1]||{};
    flag(`x0_HSI_${n}_Flag_Off`,nav.valid===true);
    flag(`x0_HSI_${n}_Flag_Nav1`,nav.valid===true&&Number(n)===1);
    flag(`x0_HSI_${n}_Flag_Nav2`,nav.valid===true&&Number(n)===2);
    flag(`x0_HSI_${n}_Flag_GS`,nav.gsValid===true);
    flag(`x0_HSI_${n}_Flag_DME`,nav.valid===true&&finite(nav.dmeNm));
    if(nav.valid===true) {
      if(finite(nav.cdi))put(`x0_HSI_${n}_OBI_Dev`,.5+clamp(nav.cdi,-1,1)/2);
      // Course and bearing are absolute bearings; the rose already rotates with heading.
      if(finite(nav.courseDeg))put(`x0_HSI_${n}_Plateau`,wrap(nav.courseDeg-hdg,360)/360);
      if(finite(nav.toFrom))put(`x0_HSI_${n}_ToFrom`,nav.toFrom/2);
      digits(`x0_HSI_${n}_dme_n_`,nav.dmeNm,{Unit:1,Diz:10,Hun:100});
    } else {put(`x0_HSI_${n}_OBI_Dev`,.5);put(`x0_HSI_${n}_ToFrom`,0);}
    if(nav.gsValid&&finite(nav.gs))put(`x0_HSI_${n}_GS_ind`,.5+clamp(nav.gs,-1,1)/2); else put(`x0_HSI_${n}_GS_ind`,.5);
    for(let i=0;i<2;i++) {
      if(finite(s.adfBearingDeg?.[i]))put(`x0_HSI_${n}_ADF${i+1}`,wrap(s.adfBearingDeg[i]-hdg,360)/360);
      if(finite(s.nav?.[i]?.bearingDeg)&&s.nav[i].valid)put(`x0_VOR_${n}_Aig${i+1}`,wrap(s.nav[i].bearingDeg-hdg,360)/360);
    }
    digits(`x0_ALTI_${n}_mb_n_`,s.qnhHpa??1013.25,{Unit:1,Diz:10,Hun:100,Thou:1000});
    const e=s.engines[Number(n)-1]||{}, i=Number(n);
    put(`x0_RPM_${n}_Aig`,e.rpm/20000); put(`x0_RPM_${n}_AigDecim`,wrap(e.rpm,1000)/1000);
    put(`x0_ExhTemp_${n}_Aig`,(e.egt??e.itt)/1000);
    put(`x0_FFFU_${n}_Aig`,e.ff*3600/700);
    put(`x0_FFFU_${n}_Aig_lbs`,e.ff*3600/0.45359237/1600);
    digits(`x0_FFFU_${n}_n_`,e.fuelUsedKg,{Unit:1,Diz:10,Hun:100,Thou:1000});
    // Quantity scale: 50 kg per authored frame (44 frames); imperial 100 lb
    // per frame (50 frames). Both independently match their printed dial faces.
    put(`x0_FuelQtty_${n}_Aig`,s.tankFuelKg?.[i-1]/2200);
    put(`x0_FuelQtty_${n}_Aig_lbs`,s.tankFuelKg?.[i-1]/0.45359237/5000);
    // PSI is NOT shaft torque in N.m. Optional channels require real system data.
    put(`x0_Torq_${n}_Aig`,e.torquePsi/600);
    put(`x0_OilPress_Aig${i}`,e.oilPressurePsi/40);
    put(`x0_OilTemp_Aig${i}`,(e.oilTempC+50)/200);
    put(`x0_FuelPress_Aig${i}`,e.fuelPressurePsi/20);
  }
  put('x0_ALTI_01_Aig',wrap(alt,1000)/1000);
  digits('x0_ALTI_01_alt_n_',alt,{Diz:10,Hun:100,Thou:1000,TenThou:10000});
  flag('x0_ALTI_01_Flag_Neg',alt>=0); flag('x0_ALTI_01_Flag_TenThou',alt>=10000);flag('x0_ALTI_01_Flag_Elec',s.altimeterValid!==false);
  digits('x0_ALTI_01_inhg_n_',(s.qnhHpa??1013.25)*0.029529983*100,{Unit:1,Diz:10,Hun:100,Thou:1000});
  put('x0_ALTI_02_AigHun',wrap(alt,1000)/1000);put('x0_ALTI_02_AigThou',wrap(alt,10000)/10000);put('x0_ALTI_02_AigTenThou',wrap(alt,100000)/100000);
  put('x0_HorizSec_Carre',bank);put('x0_HorizSec_Cylindre',.5+s.pitchDeg/170);flag('x0_HorizSec_Flag',s.attitudeValid!==false);
  put('LANDING_GEAR_Lever_Gear',s.gearDown ? 1 : 0);
  put('x0_Compass_Wheel',hdg/360);put('x0_Flaps_Aig',s.flapFraction);
  put('x0_Trim_Pitch_ind',.5+s.trim/2);put('x0_Trim_Rud_Ind',.5+s.rudderTrim/2);put('x0_Trim_Ail_Aig',.5+s.aileronTrim/2);
  put('x0_PressPneu_Ppl_Aig',s.pneumaticPsi/4000);
  put('x0_PressPneu_Freins_Aig',s.brakePneumaticPsi/4000);put('x0_PressPneu_Sec_Aig',s.emergencyPneumaticPsi/4000);
  put('x0_Temp_Aig',(s.oatC+54)/108);
  // These cabin channels are intentionally opt-in: there is no pressurization FDM.
  put('x0_Pressu_Alti_Aig_A',alt/30000);put('x0_Pressu_Alti_Aig_C',s.cabinAltFt/30000);
  put('x0_Pressu_Vario_Aig',.5+s.cabinVsFpm/12000);
  return values;
}

export function createF27Instruments(gltf, adapter) {
  const available=new Set(gltf.animations.map(c=>c.name)), root=gltf.scene;
  const lampNodes=new Map(), owned=[];
  root.traverse(o=>{
    if (!/^(?:x0_Warn.*_On|x0_GearInd_w_(?:gr|red)_[pcs]_on|x0_Warn_FeatherBtn0[12]_on)$/.test(o.name)) return;
    lampNodes.set(o.name,o); o.visible=false;
    o.traverse(mesh=>{if(!mesh.material)return;
      const mats=Array.isArray(mesh.material)?mesh.material:[mesh.material];
      const copies=mats.map(m=>{const c=m.clone(); if(c.emissive){c.emissive.set('#ffffff');c.emissiveIntensity=1;}owned.push(c);return c;});
      mesh.material=Array.isArray(mesh.material)?copies:copies[0];
    });
  });
  let last={}, lamps={};
  return {
    get values(){return {...last};}, get annunciators(){return {...lamps};},
    get availableClips(){return [...available];},
    update(fdm,feed={},elapsed=0) {
      const s=f27InstrumentState(fdm,feed,elapsed);last=f27GaugeFractions(s);
      for(const [name,value] of Object.entries(last))if(available.has(name))adapter.scrub(name,value,{defer:true});
      const powered=feed.powered!==false;
      lamps={}; const lamp=(name,value)=>{if(lampNodes.has(name)){lamps[name]=!!value&&powered;lampNodes.get(name).visible=lamps[name];}};
      for(const k of ['p','c','s']) {lamp(`x0_GearInd_w_gr_${k}_on`,s.gearPos>=.999);lamp(`x0_GearInd_w_red_${k}_on`,s.gearPos>.001&&s.gearPos<.999);}
      lamp('x0_WarnRect_Door_On',s.doorOpen);
      if(finite(s.cabinAltFt))lamp('x0_WarnRect_PrCab_On',s.cabinAltFt>10000);
      for(let i=0;i<2;i++) {const n='0'+(i+1),e=s.engines[i]||{};
        lamp(`x0_WarnRect_PrPnm${n}_On`,e.rpm<5000);
        lamp(`x0_Warn_FeatherBtn${n}_on`,e.feather===true);
        lamp(`x0_Warn_Fire${n}_On`,e.fire===true);
        if(finite(e.oilPressurePsi)) {lamp(`x0_Warn_OilPress${n}_On`,e.oilPressurePsi<6);lamp(`x0_WarnRect_Rotol${n}_On`,e.oilPressurePsi<9);}
      }
      // Reset all unknown lights on every frame; stale supplied conditions cannot persist.
      for(const [name,node] of lampNodes)if(!Object.hasOwn(lamps,name))node.visible=false;
      return {values:last,annunciators:lamps};
    },
    dispose(){owned.forEach(m=>m.dispose());},
  };
}
