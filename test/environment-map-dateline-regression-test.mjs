import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

// Exercise MapPanel.drawAirports itself; record the exact inputs passed to
// Leaflet, without tiles, network, a browser or a second projection algorithm.
const stub = `
class Bounds {
  constructor(w, e, s, n) { Object.assign(this, {w, e, s, n}); }
  contains(p) {
    return p instanceof Bounds
      ? p.w >= this.w && p.e <= this.e && p.s >= this.s && p.n <= this.n
      : p[0] >= this.s && p[0] <= this.n && p[1] >= this.w && p[1] <= this.e;
  }
  pad(k) { const x=(this.e-this.w)*k, y=(this.n-this.s)*k; return new Bounds(this.w-x,this.e+x,this.s-y,this.n+y); }
}
class Layer {
  constructor(kind, points, options) { Object.assign(this,{kind,points,options,handlers:{},items:new Set()}); }
  addTo(parent) { parent.addLayer(this); return this; }
  addLayer(layer) { this.items.add(layer); return this; }
  removeLayer(layer) { this.items.delete(layer); return this; }
  clearLayers() { this.items.clear(); return this; }
  on(event, handler) { this.handlers[event]=handler; return this; }
  bindTooltip(text, options) { this.tooltip={text,options}; return this; }
}
const make=(kind)=>(points,options)=>new Layer(kind,points,options);
const map=()=>Object.assign(new Layer('map'), {
  center:{lat:-16.4667,lng:179.34}, z:7,
  setView(){return this;}, getCenter(){return this.center;}, getZoom(){return this.z;},
  getBounds(){return this.bounds || new Bounds(this.center.lng-this.span/2,this.center.lng+this.span/2,this.center.lat-1,this.center.lat+1);},
  span:614/(256*2**7)*360,
  getContainer(){return {addEventListener(){}};}
});
export default {map, Bounds, control:{zoom:make('control'),layers:make('control')},tileLayer:make('tiles'),
  canvas:()=>({}),layerGroup:make('group'),polyline:make('runway'),circleMarker:make('airport'),marker:make('label'),divIcon:o=>o,
  Control:{extend:()=>class {addTo(){return this;}}},DomEvent:{stop(e){e.stopped=true;}}
};`;
const hooks = `export async function resolve(s,c,n) {
  if(s==='leaflet') return {url:'data:text/javascript,'+encodeURIComponent(${JSON.stringify(stub)}),shortCircuit:true};
  if(s.endsWith('.css')) return {url:'data:text/javascript,export default 0',shortCircuit:true};
  return n(s,c);
}`;
register('data:text/javascript,' + encodeURIComponent(hooks));
const { MapPanel } = await import('../src/map.js');
const { default: L } = await import('leaflet');
const rows = JSON.parse(readFileSync(new URL('../public/data/airports.json', import.meta.url), 'utf8'));
const row = rows.find(r => r[0] === 'NFNL');
assert.ok(row, 'use the shipped Labasa airport, not an invented coordinate');
const labasa = {ident:row[0], name:row[2], type:row[5]&3, mil:!!(row[5]&4), lat:row[6], lon:row[7], rawRunways:row[9]};
const airport = (ident, lat, lon, extra={}) => ({ident, name:ident, lat, lon, type:0, rawRunways:[], ...extra});
let clicked;
function panelFor(list) {
  return new MapPanel({}, {ready:true,list}, {wps:[],onChange(){}}, {onAirport:a=>{clicked=a;}});
}
function view(panel, lon, zoom=7, span=614/(256*2**zoom)*360, lat=-16.4667) {
  Object.assign(panel.map, {center:{lat,lng:lon},z:zoom,span,bounds:null});
  panel.drawAirports();
}
const children = (panel, a, kind) => [...panel.aptMarks.get(a).items].filter(l => l.kind === kind);
const circle = (panel, a) => children(panel,a,'airport')[0];
const label = (panel, a) => children(panel,a,'label')[0];
const x = (lon, center, zoom) => 307 + (lon-center)/360*256*2**zoom;

// ENV-08: actual 614px, zoom-7 repro. Canonical x is ~33010, nearest x ~242.
const panel = panelFor([labasa,airport('OUTSIDE',-16.4667,0)]);
view(panel,179.34);
assert.equal(circle(panel,labasa).points[1],179.34);
view(panel,-179.95);
assert.equal(panel.aptMarks.size,1,'filter using wrapped coordinates, not canonical longitude');
assert.ok(Math.abs(circle(panel,labasa).points[1]+180.66)<1e-10);
assert.ok(x(circle(panel,labasa).points[1],-179.95,7)>240 && x(circle(panel,labasa).points[1],-179.95,7)<244);
assert.ok(x(labasa.lon,-179.95,7)>33000);
for (const center of [179.95,-179.95,539.95,-539.95,179.34]) {
  view(panel,center);
  assert.ok(Math.abs(circle(panel,labasa).points[1]-center)<1,'NFNL visible in either side and repeated world copies');
  assert.equal(panel.aptLayer.items.size,1,'obsolete copy removed rather than duplicated');
  assert.ok(panel.aptLayer.items.has(panel.aptMarks.get(labasa)));
}
const event={};
view(panel,-179.95);
circle(panel,labasa).handlers.click(event);
assert.equal(event.stopped,true);
assert.equal(clicked,labasa,'wrapped click retains the original airport object');
assert.equal(circle(panel,labasa).tooltip.text,'NFNL Labasa Airport');
assert.equal(labasa.lon,179.34,'rendering does not mutate navigation/database longitude');
console.log('PASS ENV-08: real NFNL bounds/marker repro, both sides and repeated worlds, click and tooltip');

const seam = airport('SEAM<&',0,179.999,{name:'Runway <test>',rawRunways:[['09','27',0,179.995,0,-179.995]]});
const seamPanel = panelFor([seam]);
for (const center of [179.99,-179.99,539.99,-539.99]) {
  view(seamPanel,center,10,1,0);
  const marker=circle(seamPanel,seam), text=label(seamPanel,seam), runway=children(seamPanel,seam,'runway')[0];
  assert.deepEqual(marker.points,text.points,'label and marker use the identical world copy');
  assert.ok(Math.abs(marker.points[1]-center)<0.03);
  assert.ok(Math.abs(runway.points[0][1]-marker.points[1])<0.01);
  assert.ok(Math.abs(runway.points[1][1]-marker.points[1])<0.01);
  assert.ok(Math.abs(runway.points[1][1]-runway.points[0][1]-0.01)<1e-10,'seam-crossing runway stays short');
  assert.equal(runway.options.interactive,false);
  assert.equal(text.options.interactive,false);
  assert.equal(text.options.icon.html,'SEAM&lt;&amp;');
  assert.equal(marker.tooltip.text,'SEAM&lt;&amp; Runway &lt;test&gt;');
}
console.log('PASS ENV-08: runway seam geometry and escaped labels stay attached in both world copies');

// A large view can contain its previous bounds while an airport's nearest copy
// changes. This forces a cache refresh even when the bounds fast path could win.
const far = airport('FAR',0,179.34,{rawRunways:[['09','27',0,179.33,0,179.35]]});
const stable = airport('STABLE',0,0);
const wide = panelFor([far,stable]);
wide.map.z=10; wide.map.bounds=new L.Bounds(-190,190,-1,1);
wide.map.center={lat:0,lng:-0.65}; wide.drawAirports();
const oldGroup=wide.aptMarks.get(far), stableGroup=wide.aptMarks.get(stable), oldBounds=wide.drawn.b;
wide.map.center.lng=-0.67;
assert.ok(oldBounds.contains(wide.map.getBounds()),'copy-change scenario would hit the old bounds fast path');
wide.drawAirports();
assert.notEqual(wide.aptMarks.get(far),oldGroup,'nearest-copy change refreshes a cached airport');
assert.equal(wide.aptLayer.items.has(oldGroup),false);
assert.equal(wide.aptMarks.get(stable),stableGroup,'unchanged airport group retained');
assert.ok(Math.abs(circle(wide,far).points[1]+180.66)<1e-10);
assert.deepEqual(label(wide,far).points,circle(wide,far).points);
assert.ok(children(wide,far,'runway')[0].points.every(p=>Math.abs(p[1]+180.66)<0.02));
wide.map.center.lng=-0.65; wide.drawAirports();
assert.equal(circle(wide,far).points[1],179.34,'return across copy boundary refreshes again');
assert.equal(wide.aptLayer.items.size,2);
console.log('PASS ENV-08: contained-bounds copy change invalidates fast path and only replaces changed airport');

// Normal pan stays O(1) inside the padded cache: not even a database scan.
const local=airport('LOCAL',38.5,-121.5,{rawRunways:[['01','19',38.49,-121.5,38.51,-121.5]]});
const list=[local]; let scans=0;
const iterate=list[Symbol.iterator].bind(list);
list[Symbol.iterator]=()=>{scans++;return iterate();};
const normal=panelFor(list);
view(normal,-121.5,10,1,38.5);
const group=normal.aptMarks.get(local), initialScans=scans;
assert.deepEqual(circle(normal,local).points,[38.5,-121.5]);
assert.deepEqual(children(normal,local,'runway')[0].points,[[38.49,-121.5],[38.51,-121.5]]);
for (let i=1;i<=20;i++) view(normal,-121.5+i*0.001,10,1,38.5);
assert.equal(scans,initialScans,'ordinary small pans do not scan the database');
assert.equal(normal.aptMarks.get(local),group,'ordinary small pans do not recreate layers');
normal.drawAirports(true);
assert.equal(normal.aptMarks.get(local),group,'forced redraw still reuses an unchanged group');
const added=airport('ADDED',38.5,-121.4);
list.push(added); normal.drawAirports();
assert.ok(normal.aptMarks.has(added),'database count changes invalidate padded-bounds cache');
view(normal,-122.1,10,1,38.5);
assert.equal(normal.aptMarks.has(local),true,'airport within padding retained on a larger pan');
assert.equal(normal.aptMarks.has(added),false,'airport outside padding dropped');
assert.equal(normal.aptLons.has(added),false,'copy cache pruned with the layer cache');
view(normal,0,10,1,0);
assert.equal(normal.aptMarks.size,0);
assert.equal(normal.aptLayer.items.size,0);
assert.equal(normal.aptLons.size,0);
console.log('PASS ENV-08: normal-map geometry, scan-free small pans, cache reuse, database refresh and cleanup');
