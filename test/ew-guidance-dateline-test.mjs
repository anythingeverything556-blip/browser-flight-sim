import assert from 'node:assert/strict';
import { register } from 'node:module';
// Lightweight Leaflet boundary records the actual route/marker/track/trail inputs.
const stub = `
class Layer { constructor(points) { this.points=points;this.handlers={}; } addTo(){return this;} on(k,fn){this.handlers[k]=fn;return this;} setLatLngs(p){this.points=p;return this;} setLatLng(p){this.points=p;return this;} clearLayers(){return this;} getElement(){return null;} }
const container={addEventListener(){}};
const map=()=>({center:{lat:0,lng:179.8},handlers:{},getContainer(){return container;},setView(){return this;},getCenter(){return this.center;},on(k,fn){this.handlers[k]=fn;return this;},getZoom(){return 6;},latLngToLayerPoint(){return {distanceTo:()=>0};},panTo(){}});
export default {map, control:{zoom:()=>new Layer(),layers:()=>new Layer()},tileLayer:()=>new Layer(),canvas:()=>({}),layerGroup:()=>new Layer(),polyline:p=>new Layer(p),marker:p=>new Layer(p),circle:p=>new Layer(p),divIcon:o=>o,Control:{extend:()=>class{addTo(){return this;}}},latLng:()=>({distanceTo:()=>0})};`;
const hooks=`export async function resolve(s,c,n){if(s==='leaflet')return {url:'data:text/javascript,'+encodeURIComponent(${JSON.stringify(stub)}),shortCircuit:true};if(s.endsWith('.css'))return {url:'data:text/javascript,export default 0',shortCircuit:true};return n(s,c);}`;
register('data:text/javascript,'+encodeURIComponent(hooks));
const { MapPanel, unwrapMapPath } = await import('../src/map.js');
for (const center of [179.8,-179.8,539.8,-539.8]) {
  const p=unwrapMapPath([[0,179.8],[0,-179.8],[0,-179.4]],center);
  assert.ok(Math.abs(p[1][1]-p[0][1]-.4)<1e-10);
  assert.ok(Math.abs(p[0][1]-center)<=180);
  // Web Mercator x delta at zoom 6 is ~18px, not almost an entire 16,384px world.
  assert.ok(Math.abs((p[1][1]-p[0][1])/360*256*2**6)<20);
}
assert.deepEqual(unwrapMapPath([[30,-121],[31,-120]],-121),[[30,-121],[31,-120]]);
const nav={wps:[{lat:0,lon:179.8,name:'East'},{lat:0,lon:-179.8,name:'West'}],active:1,onChange(){}};
const panel=new MapPanel({}, {ready:false},nav,{});panel.drawRoute();
assert.ok(Math.abs(panel.routeLine.points[1][1]-panel.routeLine.points[0][1])<1);
panel.update(0,179.8,90,{x:300,z:0},true);panel.update(0,-179.8,90,{x:300,z:0},true);
assert.ok(Math.abs(panel.toActive.points[1][1]-panel.toActive.points[0][1])<1);
assert.ok(Math.abs(panel.track.points[1][1]-panel.track.points[0][1])<1);
assert.ok(Math.abs(panel.trail.points[0][1][1]-panel.trail.points[0][0][1])<1);
assert.ok(Math.abs(panel.marker.points[1]-180.2)<1e-10);
panel.map.center.lng=-179.8;panel.map.handlers['moveend zoomend']();
assert.ok(Math.abs(panel.routeLine.points[0][1]+180.2)<1e-10);
assert.ok(Math.abs(panel.marker.points[1]+179.8)<1e-10);
nav.done=true;panel.update(0,-179.8,90,{x:0,z:0},true);assert.deepEqual(panel.toActive.points,[]);
console.log('PASS EW-25: actual map overlay inputs stay adjacent across date line in either world copy, including route, active leg, marker, trail and track');
