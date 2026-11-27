// Isolated local WebGL fixture; never imports the game entrypoint or app state.
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {decompress} from '../src/vendor/fzstd.mjs';
const baseline=new URLSearchParams(location.search).has('baseline');
const {SR71Cockpit,SR71_COCKPIT_LIGHTS}=await import(/* @vite-ignore */ baseline?'/__sr71cockpit-before.js':'/src/sr71cockpit.js');
try{
const canvas=document.querySelector('canvas'),gl=canvas.getContext('webgl2',{antialias:false,preserveDrawingBuffer:true});
if(!gl)throw Error('WebGL2 unavailable');
let creates=0;const create=gl.createProgram.bind(gl);gl.createProgram=()=>{creates++;return create();};
const renderer=new THREE.WebGLRenderer({canvas,context:gl,antialias:false});renderer.setPixelRatio(1);renderer.setSize(960,640);renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.8;
const scene=new THREE.Scene();scene.background=new THREE.Color('#060b12');
const ambient=new THREE.HemisphereLight(0xc3d7ed,0x303640,.025);scene.add(ambient);
const camera=new THREE.PerspectiveCamera(75,960/640,.02,100);camera.position.set(0,1.224,13.607);camera.lookAt(0,.9,14.4);
const base='/models/sr71/cockpit/';const json=await (await fetch(base+'cockpit-flight.gltf')).json();
const bytes=decompress(new Uint8Array(await (await fetch(base+'cockpit-flight.bin.zst.part00')).arrayBuffer()));
const loader=new GLTFLoader();loader.register(parser=>{parser.loadBuffer=async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);return {name:'LOCAL_TEST_BUFFER'};});
const gltf=await loader.parseAsync(JSON.stringify(json),base);const root=gltf.scene;
root.traverse(o=>{if(o.name==='ENVIRONMENT_OCCLUDER')o.visible=false;});scene.add(root);
const cockpit=new SR71Cockpit({root,animations:gltf.animations});
const debug=gl.getExtension('WEBGL_debug_renderer_info');
const report={baseline,renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),samples:[],missing:cockpit.missing};
function draw(label){
 const old=creates;renderer.render(scene,camera);gl.finish();
 const s={label,newPrograms:creates-old,totalProgramsCreated:creates,cachedPrograms:renderer.info.programs.length,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles};report.samples.push(s);return s;
}
function pixels(){const p=new Uint8Array(960*640*4);gl.readPixels(0,0,960,640,gl.RGBA,gl.UNSIGNED_BYTE,p);return p;}
function difference(a,b){let count=0,max=0,sum=0;for(let i=0;i<a.length;i+=4){let changed=false;for(let c=0;c<3;c++){const d=Math.abs(a[i+c]-b[i+c]);if(d)changed=true;max=Math.max(max,d);sum+=d;}if(changed)count++;}return {changedPixels:count,maxChannelDelta:max,totalChannelDelta:sum};}
const initial=draw('initial all off'),offPixels=pixels();
window.qa={report,cockpit,renderer,scene,camera,draw,pixels,offPixels,difference,SR71_COCKPIT_LIGHTS,ready:true};
const materialSet=new Set();root.traverse(o=>{if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material])materialSet.add(m);});report.materials=materialSet.size;
function caption(stage,sample){document.querySelector('h1').textContent='SR-71 cockpit · '+(baseline?'BEFORE: visibility switching':'AFTER: fixed lights + zero-radiance gate');document.querySelector('#status').textContent=stage+' | new shader programs: '+sample.newPrograms+' | cache: '+sample.cachedPrograms;}
caption('Initial lights off',initial);qa.caption=caption;
}catch(e){window.failure=e.stack;document.querySelector('#status').textContent=e.message;}
