import assert from 'node:assert/strict';import {FlightLogbook,MAX_FLIGHTS,cleanSetup} from '../src/logbook.js';
let text=null;const store={getItem:()=>text,setItem:(k,v)=>text=v};const b=new FlightLogbook(()=>store),setup={aircraft:'c172',airport:'KBAB',rwy:0,end:1,mode:'runway',mission:'free',weather:'clear',hour:15};
assert.equal(cleanSetup({...setup,end:9}),null);assert.equal(cleanSetup({...setup,airport:'<img>'}),null);
for(let i=0;i<MAX_FLIGHTS+10;i++){b.begin(setup);b.tick(121);assert.ok(b.land('KSQL',1));assert.equal(b.land('KSQL',1),false);}
assert.equal(b.read().entries.length,MAX_FLIGHTS);assert.equal(b.read().entries[0].quality,'Soft');assert.deepEqual(b.read().last,setup);
text='not JSON';assert.deepEqual(b.read(),{entries:[],last:null});text='null';assert.deepEqual(b.read(),{entries:[],last:null});
const denied=new FlightLogbook(()=>{throw Error('denied')});assert.doesNotThrow(()=>{denied.begin(setup);denied.tick(5);denied.land('KBAB',2)});assert.equal(denied.persisted,false);
const quota=new FlightLogbook(()=>({getItem:()=>null,setItem:()=>{throw Error('quota')}}));quota.begin(setup);quota.tick(3);assert.doesNotThrow(()=>quota.land('Unknown',3));
b.begin(setup);b.cancel();assert.equal(b.land('KBAB',2),false);
text=JSON.stringify({entries:[{id:'bad',aircraft:'c172',departure:'<script>',arrival:'KBAB',duration:2,sinkFpm:2}],last:{}});assert.equal(b.read().entries.length,0);
console.log('Logbook bounds, duplicate landing guard, setup validation, malformed data, missing/quota storage and teleport cancellation pass');
