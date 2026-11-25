import * as THREE from 'three';

export const F27_PAINT_DEFAULT = 'air-inter-1980';
export const F27_PAINT_LABELS = Object.freeze({ 'air-inter-1980':'Air Inter 1980 · F-BPNB',white:'White Classic' });
export const f27PaintChoice = (query, saved) => [query,saved].find(x => Object.hasOwn(F27_PAINT_LABELS,x)) || F27_PAINT_DEFAULT;
const MATERIAL_TO_ATLAS=Object.freeze(Object.fromEntries([
  ['T2','ext_T2_Details_Int','ext_T2_Details_Int_int'],
  ['T3','ext_T3_WingLeft','ext_T3_WingLeft_int'],
  ['T4','ext_T4_WingRight','ext_T4_WingRight_int'],
  ['T5','ext_T5_Fuselage','ext_T5_Fuselage_int'],
  ['T6','ext_T6_Tail','ext_T6_Tail_int'],
  ['T7','ext_T7_Engines','ext_T7_Engines_int'],
].flatMap(([atlas,...materials])=>materials.map(name=>[name,atlas]))));
const ATLASES = [...new Set(Object.values(MATERIAL_TO_ATLAS))];

// Keep the same GLBs, VAOs, materials and their shader variants. Only the six
// ALBD maps change, synchronously on both representations after all are ready.
export function createF27Livery({ base='/', load=url=>new THREE.TextureLoader().loadAsync(url), warm=()=>{} }={}) {
  const materials=new Map(); let assets=null, chosen='white', requested='white', generation=0;
  function apply(){
    for(const [material,old] of materials){
      const {white,alt}=old;material.map=chosen===F27_PAINT_DEFAULT?(alt||white):white;
    }
  }
  function attach(root) {
    root.traverse(o=>{
      for(const m of (Array.isArray(o.material)?o.material:[o.material])) {
        const atlas=Object.hasOwn(MATERIAL_TO_ATLAS,m?.name)?MATERIAL_TO_ATLAS[m.name]:null;
        if(atlas&&m.map?.name===`f275bgt_${atlas}_albd`&&!materials.has(m)) materials.set(m,{atlas,white:m.map,alt:null});
      }
    });
    apply();
  }
  async function alternate(){
    if(!assets){
      const run=Promise.allSettled(ATLASES.map(async atlas=>{
        const map=await load(`${base}models/f27/liveries/air-inter-1980/f275bgt_${atlas}_albd.webp`);
        map.name=`Air Inter ${atlas}`;map.colorSpace=THREE.SRGBColorSpace;map.flipY=false;
        return [atlas,map];
      })).then(results=>{
        const loaded=results.filter(r=>r.status==='fulfilled').map(r=>r.value);
        if(loaded.length!==ATLASES.length){for(const [,map] of loaded)map.dispose();throw Error('Incomplete Air Inter textures');}
        return new Map(loaded);
      }).catch(e=>{if(assets===run)assets=null;throw e;});
      assets=run;
    }
    return assets;
  }
  async function fillAlternates(tex, id) {
    // Typically each atlas has identical GLTF sampler/UV properties everywhere,
    // but cloning by actual sampler avoids coupling cockpit + exterior settings.
    const copies=new Map();
    for(const data of materials.values()) {
      if(data.alt)continue;
      const {white,atlas}=data;
      const key=JSON.stringify([atlas,white.channel,white.wrapS,white.wrapT,white.magFilter,white.minFilter,white.anisotropy,white.mapping,white.generateMipmaps,white.matrixAutoUpdate,white.offset.toArray(),white.repeat.toArray(),white.center.toArray(),white.rotation,white.matrix.toArray()]);
      let alt=copies.get(key);
      if(!alt){
        alt=tex.get(atlas).clone();alt.channel=white.channel;alt.wrapS=white.wrapS;alt.wrapT=white.wrapT;
        alt.magFilter=white.magFilter;alt.minFilter=white.minFilter;alt.anisotropy=white.anisotropy;
        alt.mapping=white.mapping;alt.generateMipmaps=white.generateMipmaps;alt.matrixAutoUpdate=white.matrixAutoUpdate;
        alt.offset.copy(white.offset);alt.repeat.copy(white.repeat);alt.center.copy(white.center);alt.rotation=white.rotation;alt.matrix.copy(white.matrix);
        alt.needsUpdate=true;copies.set(key,alt);
      }
      data.alt=alt;
    }
    await warm(new Set(copies.values()));
    if(generation===id&&chosen===F27_PAINT_DEFAULT)apply();
  }
  async function set(paint) {
    if(!Object.hasOwn(F27_PAINT_LABELS,paint))throw RangeError('Unknown F27 livery');
    const id=++generation;requested=paint;
    if(paint!== 'white') {
      try { const tex=await alternate();if(id!==generation)return false;await fillAlternates(tex,id); }
      catch(e){if(id!==generation)return false;requested=chosen;throw e;}
    }
    if(id!==generation)return false;
    chosen=paint;apply();return true;
  }
  async function prepare(root) {
    attach(root);
    if(requested!== 'white') {
      const id=generation;
      try{const tex=await alternate();if(requested!== 'white')await fillAlternates(tex,id);}
      catch{/* the current selection path reports any load failure; keep original maps */}
    }
    apply();
  }
  return {set,prepare,get current(){return chosen;},get requested(){return requested;},get bindings(){return materials.size;}};
}
