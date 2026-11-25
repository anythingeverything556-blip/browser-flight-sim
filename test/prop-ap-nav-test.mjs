// Real navigation / ILS coupled to each production FDM (also runs the hold suite).
import assert from 'node:assert/strict';
import { rig } from './prop-autopilot-test.mjs';
import { C172Model } from '../src/c172.js';
import { DA40Model } from '../src/da40.js';
import { F27Model } from '../src/f27.js';
import { C172_AP, DA40_AP, F27_AP } from '../src/propap.js';
import { attitude } from '../src/autopilot.js';
import { airData } from '../src/airdata.js';
import { Navigation } from '../src/nav.js';
import { Runway } from '../src/airportdb.js';
import { Geo, destination } from '../src/geo.js';
const KT=1.943844,FT=3.28084;
const geo=new Geo(39,-121),end=destination(39,-121,90,1800);
const runway=new Runway({ident:'KTST'},['09','27',39,-121,end.lat,end.lon,0,0,30,1,1]);
for(const [Model,cfg,kias] of [[C172Model,C172_AP,105],[DA40Model,DA40_AP,125],[F27Model,F27_AP,180]]){
 const r=rig(Model,cfg,kias),nav=new Navigation();
 nav.directTo(destination(39,-121,135,40000),{lat:39,lon:-121});
 r.navProvider=()=>nav.update(geo.toLatLon(r.fdm.pos.x,r.fdm.pos.z),r.fdm.pos.y,r.fdm.vel.length(),cfg.bank());
 r.ap.modes.nav=true;r.ap.modes.hdg=false;r.run(180);
 console.log(cfg.label,'NAV',{xtk:r.nav.xtkNm,hdg:attitude(r.fdm.quat).heading});
 assert.equal(r.ap.status.lat,'LNAV');assert.ok(Math.abs(r.nav.xtkNm)<0.15);
 const a=rig(Model,cfg,Model===C172Model?80:Model===DA40Model?95:125,{altFt:3000,x:-17400,z:40,notch:Model===F27Model?2:1,gear:true,gamma:-3}),ils=new Navigation();
 ils.setArrival(runway,0);a.navProvider=()=>ils.update(geo.toLatLon(a.fdm.pos.x,a.fdm.pos.z),a.fdm.pos.y,a.fdm.vel.length());
 a.ap.modes.appr=true;
 // Power is manually preset for the -3 degree trim before engagement, not changed by AP.
 const approachThrottle=a.fdm.throttle;
 let captured=false;
 a.run(150,()=>{if(a.ap.status.gs) captured=true;});
 console.log(cfg.label,'ILS',{captured,loc:a.ap.status.loc,gs:a.nav.gsDev,xtk:a.nav.locXtk,kias:airData(a.fdm.out).cas*KT,alt:a.fdm.pos.y*FT});
 assert.ok(captured);assert.ok(a.ap.status.loc);assert.equal(a.ap.status.vert,'G/S');
 assert.ok(Math.abs(a.nav.gsDev)<0.35);assert.ok(Math.abs(a.nav.locXtk)<60);
 assert.equal(a.fdm.throttle,approachThrottle);assert.ok(airData(a.fdm.out).cas<=cfg.speedLimit(a.fdm));
 console.log('PASS NAV / APPR',cfg.label);
}
