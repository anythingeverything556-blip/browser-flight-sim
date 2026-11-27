import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { decompress } from './vendor/fzstd.mjs';
import { GEAR } from './flight.js';
import { sourcePose, clamp01, wheelPhase } from './sr71bindings.js';
import { SR71Cockpit, SR71_COCKPIT_CLIPS } from './sr71cockpit.js';
import { SR71AfterburnerFX } from './sr71-afterburner-fx.js';

// Source +Z forward/+X port -> Earthwing +X forward/+Z starboard.
// Rigid datum registration retains the solver's existing CG/contact frame.
// Derived from original main gear/airframe dimensions; no geometry rescaling.
export const SR71_OFFSET=new THREE.Vector3(.6,-.2,0);
export const SR71_EYE=new THREE.Vector3(13.6074912,1.2240768,0).add(SR71_OFFSET);
// Only simulator channels driven by Earthwing are parsed; source files stay intact.
const ACTIVE_CLIPS=new Set([...Object.keys(sourcePose({}, {}, {})),...SR71_COCKPIT_CLIPS, 'GEAR_Center_Tire','GEAR_Left_Tire','GEAR_Right_Tire']);
function limitConcurrency(limit) {
  let active=0;const queue=[];
  const pump=()=>{while(active<limit&&queue.length){active++;const {fn,resolve,reject}=queue.shift();Promise.resolve().then(fn).then(resolve,reject).finally(()=>{active--;pump();});}};
  return fn=>new Promise((resolve,reject)=>{queue.push({fn,resolve,reject});pump();});
}
const base=()=>new URL(import.meta.env.BASE_URL+'models/sr71/',location.origin).href;
async function getJSON(url) { const r=await fetch(url);if(!r.ok)throw Error('SR-71 model file unavailable: '+r.status);return r.json(); }
export class SR71Visual {
  constructor(scene) {
    this.scene=scene; this.root=new THREE.Group();this.root.name='Original SR-71';scene.add(this.root);
    this.model=new THREE.Group();this.model.name='Debranded original SR-71 model';this.model.position.copy(SR71_OFFSET);this.root.add(this.model);
    this.wheelPhases=[0,0,0];this.eye=SR71_EYE.clone();this.parts=[];this.cockpit=[];this.casters=[];
    this.shadow={visible:false};this.castsWorldShadow=true;this.lateReady=Promise.resolve([]);
    this.controls={sealed:true,goal:0,open:0,walt:0,clipboard:0};
    this.cabinDoor={cmd:0,pos:0};this.status={exterior:'idle',cockpit:'idle',walt:'idle'};
    this.hotspots=new Map();this.real=null;this.view='chase';
    this.afterburnerFX=new SR71AfterburnerFX(this.root);
    this.fetchSlot=limitConcurrency(4);this.textureSlot=limitConcurrency(8);this.textureCache=new Map();this.timings=[];
  }
  async decode(data) {
    // Large cockpit decompression must not block flight/input on the main thread.
    if(typeof Worker==='undefined')return decompress(data);
    try {
      const worker=new Worker(new URL('./sr71decode-worker.js',import.meta.url),{type:'module'});
      return await new Promise((resolve,reject)=>{
        worker.onmessage=({data:result})=>{worker.terminate();result.error?reject(Error(result.error)):resolve(new Uint8Array(result.buffer,result.byteOffset,result.byteLength));};
        worker.onerror=e=>{worker.terminate();reject(Error(e.message));};
        worker.postMessage(data.buffer,[data.buffer]);
      });
    }catch(e){throw Error('Original SR-71 decompression failed: '+e.message);}
  }
  cockpitTextures(){return [];}
  registerOccluders(){return 0;}
  attachSelfShadow(){return true;}
  event(id){return typeof id==='string'&&!!this.cockpitController?.event(id);}
  async loadPart(entry,kind) {
    const lane=(kind==='exterior'||kind==='exterior-cabin')?'exterior':'cockpit', assetBase=base()+lane+'/';
    const resolve=path=>assetBase+path.replace(/^\/data\//,'');
    const started=performance.now(), jobPromises=[];
    try {
      const jsonPromise=this.fetchSlot(()=>getJSON(resolve(entry.path)));jobPromises.push(jsonPromise);
      const resources=new Map(Object.entries(entry.resources||{}).map(([uri,spec])=>{
        const job=(async()=>{
          const chunks=await Promise.all(spec.parts.map(path=>this.fetchSlot(async()=>{
            const r=await fetch(resolve(path));if(!r.ok)throw Error('SR-71 resource unavailable: '+r.status);
            return new Uint8Array(await r.arrayBuffer());
          })));
          let data=chunks[0];
          if(chunks.length>1){
            data=new Uint8Array(chunks.reduce((n,c)=>n+c.length,0));let offset=0;
            for(const c of chunks){data.set(c,offset);offset+=c.length;}
          }
          const bytes=spec.encoding==='zstd'?await this.decode(data):data;
          return bytes.byteOffset===0&&bytes.byteLength===bytes.buffer.byteLength?bytes.buffer:bytes.slice().buffer;
        })();
        job.catch(()=>{});jobPromises.push(job);return [uri,job];
      }));
      const json=await jsonPromise;
      const sourceClipCount=json.animations?.length||0;
      json.animations=(json.animations||[]).filter(a=>ACTIVE_CLIPS.has(a.name));
      // Eliminate duplicate image descriptors before GLTFLoader creates GPU textures.
      const imageMap=new Map(),images=[],remap=[];
      for(const im of json.images||[]){const key=JSON.stringify(im);if(!imageMap.has(key)){imageMap.set(key,images.length);images.push(im);}remap.push(imageMap.get(key));}
      if(json.images)json.images=images;
      for(const t of json.textures||[]){if(t.source!==undefined)t.source=remap[t.source];if(t.extensions?.EXT_texture_webp)t.extensions.EXT_texture_webp.source=remap[t.extensions.EXT_texture_webp.source];}
      const loader=new GLTFLoader();
      loader.register(parser=>{
        // Texture decode starts as soon as metadata arrives, in parallel with
        // compressed geometry. No blob URL or redundant FileLoader fetch.
        const loadBuffer=parser.loadBuffer.bind(parser);
        parser.loadBuffer=index=>{
          const def=parser.json.buffers[index],pending=resources.get(def.uri);
          return pending?pending.then(buffer=>{
            if(buffer.byteLength!==def.byteLength)throw Error('Original SR-71 buffer size mismatch: '+def.uri);
            return buffer;
          }):loadBuffer(index);
        };
        const loadImage=parser.loadTextureImage.bind(parser);
        parser.loadTextureImage=(index,source,textureLoader)=>{
          const def=parser.json.textures[index],im=parser.json.images[source];
          const key=JSON.stringify([new URL(im.uri,assetBase).href,parser.json.samplers?.[def.sampler]||{}]);
          if(!this.textureCache.has(key))this.textureCache.set(key,this.textureSlot(()=>loadImage(index,source,textureLoader)).then(texture=>{if(!texture)throw Error('Original SR-71 texture unavailable: '+im.uri);texture.userData.sr71URL=new URL(im.uri,assetBase).href;return texture;}).catch(e=>{this.textureCache.delete(key);throw e;}));
          return this.textureCache.get(key);
        };
        return {name:'SR71_SHARED_TEXTURES'};
      });
      const parseStarted=performance.now();
      const gltf=await loader.parseAsync(JSON.stringify(json),assetBase);
      this.timings.push({path:entry.path,totalMs:performance.now()-started,parseMs:performance.now()-parseStarted,sourceClips:sourceClipCount,activeClips:json.animations.length});
      const root=gltf.scene;root.rotation.y=Math.PI/2;root.visible=false;
      // Source rear tires are intentionally silver/light gray (aluminum-filled
      // rubber), not missing textures. This is the user's explicit dark-rubber
      // paint exception. Clone only the two tire mesh materials, never the shared
      // chassis atlas/material used by metal hubs, struts or gear-door interiors.
      if(kind==='exterior'&&/gear-(left|right)/.test(entry.path))root.traverse(o=>{
        if(!o.isMesh||!['L_TIRE','L_TIRE002','TIRE_R','TIRE_R002'].includes(o.name))return;
        const paint=m=>{const clone=m.clone();clone.color.multiplyScalar(.045);clone.userData.sr71RearRubber=true;return clone;};
        o.material=Array.isArray(o.material)?o.material.map(paint):paint(o.material);
      });
      root.getObjectByName('Ground_Equipment_Animation')?.removeFromParent();
      const occluder=kind==='cockpit'&&root.getObjectByName('ENVIRONMENT_OCCLUDER');
      if(occluder&&!occluder.isMesh&&occluder.children.length===0)occluder.visible=false;
      root.traverse(o=>{
        if(!o.isMesh)return;
        const mats=Array.isArray(o.material)?o.material:[o.material];
        // Source renderer helper, not windshield geometry. Plain glTF loads this
        // as an opaque white shell behind the glazing and blocks terrain/sky.
        if(kind==='cockpit'&&o.name==='ENVIRONMENT_OCCLUDER'&&mats.every(m=>m.name==='OCCLUDER')){
          o.visible=false;return;
        }
        // Zero-opacity MSFS normal-only decals have no visible contribution here.
        if(mats.every(m=>m.opacity===0)){o.visible=false;return;}
        o.castShadow=kind==='exterior'&&o.geometry.attributes.position.count>=1200&&mats.every(m=>!m.transparent);o.receiveShadow=kind==='exterior';
        if(o.castShadow)this.casters.push(o);
        for(const m of mats){if(m.map)m.map.anisotropy=4;if(m.transparent)m.depthWrite=false;}
      });
      // Bind original tracks directly. No mixer owns unimplemented simulator-only
      // animations, and repeated cockpit loads cannot attach duplicate actions.
      const clips=new Map((gltf.animations||[]).map(clip=>[clip.name,{
        clip, start:Math.min(...clip.tracks.map(t=>t.times[0])),
        end:Math.max(...clip.tracks.map(t=>t.times.at(-1))),
        tracks:clip.tracks.map(t=>({interpolant:t.createInterpolant(),binding:THREE.PropertyBinding.create(root,t.name)}))
      }]));
      if(kind==='cockpit'||kind==='walt') {
        const defs={GEAR_HANDLE:['gear','Landing gear · existing gear binding'],CANOPY_LEVER_F:['doors','Canopy handle · unseal first'],canopy_pressure_seal:['sr71Seal','Canopy pressure seal · simplified interlock'],ENGINE_LEVER_THROTTLE_1:[null,'Left throttle · drag independently',0],ENGINE_LEVER_THROTTLE_2:[null,'Right throttle · drag independently',1],WALT_Open_Close:['sr71Walt','WALT · geometry only, no live display'],Clipboard_Use_Stow:['sr71Clipboard','Clipboard · geometry only']};
        for(const [name,[action,label,engineIndex]] of Object.entries(defs)) {
          for(const track of clips.get(name)?.tracks||[]) {
            track.binding.bind();const node=track.binding.node;
            if(node)this.hotspots.set(node,{kind:engineIndex===undefined?'sr71':'throttle',action,label,engineIndex});
          }
        }
      }
      // Static local matrices need no per-frame composition. Only driven targets move.
      root.traverse(o=>{o.updateMatrix();o.matrixAutoUpdate=false;});root.matrixAutoUpdate=true;
      for(const c of clips.values())for(const t of c.tracks){t.binding.bind();if(t.binding.node)t.binding.node.matrixAutoUpdate=true;}
      // Only memoize clips that don't write the same target property.
      const owners=new Map();
      for(const c of clips.values())for(const track of c.clip.tracks){
        const previous=owners.get(track.name);
        if(previous&&previous!==c){c.overlaps=true;previous.overlaps=true;}
        owners.set(track.name,c);
      }
      const part={root,kind,clips,path:entry.path,lastValues:new Map(),detail:entry.path.includes('-flight')?'flight':'high'};
      if(kind==='cockpit')this.cockpitController=new SR71Cockpit({root,clips,hotspots:this.hotspots});
      const gearSpec=entry.path.includes('nose-gear')?[0,'GEAR_Center','FRONT_WHEELS']:entry.path.includes('gear-left')?[1,'GEAR_Left',entry.path.includes('-flight')?'L_TIRE002':'L_TIRE']:entry.path.includes('gear-right')?[2,'GEAR_Right',entry.path.includes('-flight')?'TIRE_R002':'TIRE_R']:null;
      if(gearSpec) {
        const [index,name,tireName]=gearSpec,tire=root.getObjectByName(tireName),point=new THREE.Vector3();
        // Detached calibration is independent of aircraft banking and rebasing.
        const bottom=()=>{root.updateWorldMatrix(false,true);let y=Infinity;tire?.traverse(o=>{const positions=o.geometry?.attributes.position;if(positions)for(let i=0;i<positions.count;i++)y=Math.min(y,point.fromBufferAttribute(positions,i).applyMatrix4(o.matrixWorld).y);});return y+SR71_OFFSET.y;};
        this.scrub(part,'GEAR_Steering',.5);this.scrub(part,name+'_Tire',0);
        this.scrub(part,name,.5);const down=bottom();this.scrub(part,name,1);const compressed=bottom();this.scrub(part,name,.5);
        // Per-attachment registration follows F27's rendered-tire calibration,
        // preserving the flight model's existing contact points and pilot datum.
        if(!Number.isFinite(down)||!Number.isFinite(compressed))throw Error('Original SR-71 gear contact mesh unavailable: '+tireName);
        part.gear={index,name,tireClip:name+'_Tire',phase:0,base:root.position.clone(),offset:GEAR[index].p.y-down,travel:Math.max(0,compressed-down),down,compressed};
        if(index===0){
          // Solver-contact registration must not lower the airframe-attached
          // original bay and covers with the wheel. That made the bay protrude
          // below the fuselage and hide the small front cover in the report.
          // Identity wrappers preserve each authored door transform/keyframe;
          // they only cancel the existing root/contact datum translation.
          root.updateWorldMatrix(false,true);const inverseRoot=root.matrixWorld.clone().invert();
          part.gear.fixed=[];
          for(const nodeName of ['SR-71_NOSE_GEAR_BOX','NLG_R_DOOR_ANIM','NLG_L_DOOR_ANIM','Door_Front_010','Door_Front_00','SR-71_chassis_F307']){
            const node=root.getObjectByName(nodeName);if(!node?.parent)continue;
            const parent=node.parent,parentInRoot=inverseRoot.clone().multiply(parent.matrixWorld);
            const direction=new THREE.Vector3(0,1,0).applyMatrix3(new THREE.Matrix3().setFromMatrix4(parentInRoot).invert());
            const wrapper=new THREE.Group();wrapper.name='Contact datum cancellation '+nodeName;
            parent.add(wrapper);wrapper.add(node);wrapper.matrixAutoUpdate=false;
            part.gear.fixed.push({wrapper,direction});
          }
        }
      }
      return part;
    } catch(error){await Promise.allSettled(jobPromises);throw error;}
  }
  pick(ray) {
    const targets=[...this.hotspots.keys()].filter(o=>{for(let p=o;p;p=p.parent)if(!p.visible)return false;return true;});
    for(const hit of ray.intersectObjects(targets,true)) {
      for(let node=hit.object;node;node=node.parent)if(this.hotspots.has(node))return this.hotspots.get(node);
    }return null;
  }
  async load(_ignored,onProgress) {
    this.status.exterior='loading';
    try{
      const [manifest,parity]=await Promise.all([getJSON(base()+'exterior/manifest.json'),getJSON(base()+'exterior/visual-parity-manifest.json')]);this.manifest=manifest;
      const cabinPromise=this.loadPart(parity.exteriorCabin,'exterior-cabin');
      // Start structural cabin data with the exterior, not the heavyweight live
      // cockpit. The authored LOD2 floor/walls close the view to the ground.
      cabinPromise.catch(()=>{});
      const parseSlot=limitConcurrency(2);let complete=0;
      const parts=await Promise.all(manifest.models.exterior.map(entry=>parseSlot(async()=>{
        const part=await this.loadPart(entry,'exterior');onProgress?.(++complete/manifest.models.exterior.length);return part;
      })));
      const cabin=await cabinPromise;this.exteriorCabin=cabin;parts.push(cabin);
      const airframe=parts.find(p=>p.root.getObjectByName('FX_afterburner_left'));
      if(airframe)this.afterburnerFX.bind(airframe.root,SR71_OFFSET);
      this.parts.push(...parts);for(const part of parts){part.root.visible=true;this.model.add(part.root);}
      this.real={interior:this.interior?.root??null,pick:{panels:[],throttles:[]}};this.status.exterior='ready';
    }catch(e){this.status.exterior='error';throw e;}
  }
  async preloadCockpit() {
    if(this.interior)return this.interior;
    if(this.cockpitPromise)return this.cockpitPromise;
    this.status.cockpit='loading';this.onStatus?.('Loading original cockpit… Exterior flight remains available.');
    this.cockpitPromise=(async()=>{
      const manifest=await getJSON(base()+'cockpit/manifest.json');this.cockpitManifest=manifest;
      const part=await this.loadPart(manifest.models.interior.find(e=>!e.optional),'cockpit');
      this.interior=part;this.parts.push(part);if(this.real)this.real.interior=part.root;this.cockpit=[part.root];this.status.cockpit='ready';this.onStatus?.('Original cockpit ready. Source-calibrated attitude, TDI digits, heading and lighting are active; unsupported simulator systems remain unported.');
      return part;
    })().catch(e=>{this.cockpitPromise=null;this.status.cockpit='error';this.onStatus?.('Cockpit could not load; exterior flight is still available. Switch view to retry.');throw e;});
    return this.cockpitPromise;
  }
  async ensureWalt() {
    if(this.walt)return this.walt;
    if(this.waltPromise)return this.waltPromise;
    this.status.walt='loading';
    this.waltPromise=this.preloadCockpit().then(async()=>{
      const part=await this.loadPart(this.cockpitManifest.models.interior.find(e=>e.optional),'walt');
      this.walt=part;this.parts.push(part);this.cockpit.push(part.root);this.status.walt='ready';return part;
    }).catch(e=>{this.waltPromise=null;this.status.walt='error';throw e;});return this.waltPromise;
  }
  // Explicit opt-in original LOD0 inspection; ordinary view switching never fetches it.
  async setDetail(detail='flight') {
    this.requestedDetail=detail;
    if(detail==='high'&&!this.highParts){
      if(!this.highPromise){
        const parseSlot=limitConcurrency(2);
        this.highPromise=Promise.all(this.manifest.models.highDetailExterior.map(e=>parseSlot(()=>this.loadPart(e,'exterior')))).then(parts=>{this.highParts=parts;this.parts.push(...parts);}).catch(e=>{this.highPromise=null;throw e;});
      }
      await this.highPromise;
    }
    if(this.requestedDetail===detail)this.detail=detail==='high'?'high':'flight';
  }
  async setCockpitTextureDetail(detail='flight') {
    this.requestedCockpitTextureDetail=detail;
    if(!this.interior)return;
    const textures=new Set();this.interior.root.traverse(o=>{if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material])if(m.map)textures.add(m.map);});
    await Promise.all([...textures].map(async texture=>{
      const uri=texture.userData.sr71URL;if(!uri?.includes('/flight-mips/'))return;
      if(detail==='full'){
        if(!texture.userData.fullImagePromise)texture.userData.fullImagePromise=this.fetchSlot(()=>new THREE.TextureLoader().loadAsync(uri.replace('/flight-mips/','/'))).then(full=>full.image).catch(e=>{delete texture.userData.fullImagePromise;throw e;});
        const image=await texture.userData.fullImagePromise;
        if(this.requestedCockpitTextureDetail!==detail)return;
        texture.userData.flightImage??=texture.image;texture.image=image;
      }else if(texture.userData.flightImage)texture.image=texture.userData.flightImage;
      texture.needsUpdate=true;
    }));
  }
  ensureView(view){this.view=view;return view==='cockpit'?this.preloadCockpit():Promise.resolve();}
  setDoors(open){
    if(this.controls.sealed && open)return false;
    this.controls.goal=open?1:0;this.cabinDoor.cmd=this.controls.goal;return true;
  }
  toggleSeal(){
    if(this.controls.open>.001||this.controls.goal)return false;
    this.controls.sealed=!this.controls.sealed;return true;
  }
  async toggleEquipment(key){
    await this.ensureWalt();this.controls[key]=this.controls[key]?0:1;
  }
  scrub(part,name,value){
    const c=part.clips.get(name);if(!c)return false;
    const t=c.start+(c.end-c.start)*clamp01(value);
    if(!c.overlaps&&part.lastValues?.get(name)===t)return true;
    for(const track of c.tracks)track.binding.setValue(track.interpolant.evaluate(t),0);
    part.lastValues?.set(name,t);
    return true;
  }
  update(dt,fdm,camWorld,view,_env,_ground,_feed,pilotAxes){
    this.view=view;this.root.position.copy(fdm.pos).sub(camWorld);this.root.quaternion.copy(fdm.quat);
    this.afterburnerFX.update(dt,fdm,camWorld,_ground);
    const stopped=fdm.onGround&&fdm.vel.length()<1;
    if(!stopped)this.setDoors(false);
    this.controls.open+=Math.max(-Math.max(0,dt)/4,Math.min(Math.max(0,dt)/4,this.controls.goal-this.controls.open));
    this.cabinDoor.pos=this.controls.open;
    const pose=sourcePose(fdm,this.controls,pilotAxes);this.lastPose=pose;
    for(let i=0;i<3;i++)this.wheelPhases[i]=wheelPhase(this.wheelPhases[i],fdm.wheel?.[i],dt);
    for(const part of this.parts){
      // The cockpit is additive: source interior contains no replacement airframe.
      part.root.visible=part.kind==='exterior'?(part.detail===(this.detail||'flight')):part.kind==='exterior-cabin'?view!=='cockpit':view==='cockpit';
      if(part.kind==='walt')part.root.visible=view==='cockpit'&&!!(this.controls.walt||this.controls.clipboard);
      // Detached inactive detail/cockpit trees incur no renderer world-matrix walk.
      if(!part.root.visible){if(part.root.parent)this.model.remove(part.root);continue;}
      if(!part.root.parent)this.model.add(part.root);
      for(const name of Object.keys(pose))if(name!==part.gear?.name)this.scrub(part,name,pose[name]);
      if(part.kind==='cockpit')this.cockpitController?.update(fdm,dt);
      if(part.gear){
        const g=part.gear,down=clamp01((fdm.gearPos-.9)/.1),compression=clamp01((fdm.compress?.[g.index]||0)/g.travel);
        // The source's second half is driven only by actual solver compression,
        // normalized by the measured original tire travel, not an invented range.
        this.scrub(part,g.name,clamp01(fdm.gearPos)*.5+(g.travel>.001?compression*down*.5:0));
        // Solver wheel is angular velocity in radians/second. Preserve reverse and
        // braking, and don't advance when the game is paused or awaiting spawn.
        g.phase=this.wheelPhases[g.index];
        this.scrub(part,g.tireClip,g.phase);
        part.root.position.copy(g.base);part.root.position.y+=g.offset*down;
        for(const fixed of g.fixed||[]){fixed.wrapper.position.copy(fixed.direction).multiplyScalar(-g.offset*down);fixed.wrapper.updateMatrix();}
      }
      // Scene render owns the one world update, not a second forced full-tree walk.
    }
  }
}
