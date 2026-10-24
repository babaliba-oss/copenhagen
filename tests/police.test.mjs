import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {PoliceSimulation,sweptContact,wantedLevel,incidentHeat,escapeTime,CONTACT,ON_FOOT,closingSpeed,CRASH_MIN_SPEED,RECKLESS,INCIDENT_WINDOW,recklessDriving} from '../src/police.js';
import {prepareGraph} from '../src/mobility.js';
import {correctHarbourLanes,vehicleFitsRoad} from '../src/road-safety.js';
import {SpatialIndex} from '../src/geo.js';
import {HARBOUR_START} from '../src/demo-route.js';

const world={roads:{at:()=>true},buildings:{at:()=>false}};
const graph=()=>prepareGraph({nodes:[[0,100],[0,0],[0,-100],[0,-200]],edges:[{from:0,to:1,lane:0,points:[[0,100],[0,0]]},{from:1,to:2,lane:0,points:[[0,0],[0,-100]]},{from:2,to:3,lane:0,points:[[0,-100],[0,-200]]}]});
const player=()=>({x:0,z:-25,heading:0,speed:0});
test('severity: pedestrian > car crash > light tap (nothing)',()=>{
 assert.ok(incidentHeat('pedestrian')>incidentHeat('vehicle',10));assert.ok(incidentHeat('vehicle',10)>0);assert.equal(incidentHeat('vehicle',2),0);
 const tap=new PoliceSimulation(graph(),world);assert.equal(tap.report('vehicle',1,CRASH_MIN_SPEED-.5),false);assert.equal(tap.level,0);assert.equal(tap.heat,0);
 const crash=new PoliceSimulation(graph(),world);assert.equal(crash.report('vehicle',1,9),true);assert.equal(crash.level,2);assert.match(crash.message,/patrol/);
 const person=new PoliceSimulation(graph(),world);person.report('pedestrian',1);assert.equal(person.level,2,'hitting a person is at least two stars immediately');
 assert.ok(person.heat>crash.heat);assert.equal(wantedLevel(0),0);
});
test('four separate crashes close together reach five stars without hurting people',()=>{
 const p=new PoliceSimulation(graph(),world),levels=[];
 for(let i=0;i<4;i++){p.time=i*1.5;p.report('vehicle',i,9);levels.push(p.level);}
 assert.deepEqual(levels,[2,3,4,5]);assert.equal(p.surging,true);
 const cop=new PoliceSimulation(graph(),world);cop.report('police','unit',8);assert.equal(cop.level,2);assert.match(cop.message,/police car/);
});
test('closing speed counts head-on crashes more than rear-end nudges',()=>{
 const me={heading:0,speed:10};
 assert.equal(closingSpeed(me,{heading:0,speed:8}).toFixed(3),'2.000');
 assert.equal(closingSpeed(me,{heading:Math.PI,speed:8}).toFixed(3),'18.000');
 const p=new PoliceSimulation(graph(),world),from={x:0,z:6,heading:0,speed:6};
 p.observe(from,{...from,z:2,speed:6},[{id:1,edge:{},x:0,z:-2,heading:0,speed:5}],[]);assert.equal(p.heat,0,'gentle rear-end nudge in slow traffic is ignored');
 p.observe(from,{...from,z:2,speed:6},[{id:2,edge:{},x:0,z:-2,heading:Math.PI,speed:5}],[]);assert.equal(p.level,2);
});
test('one-star patrol gives up sooner than a pedestrian pursuit; unseen wanted level decays to zero',()=>{
 assert.ok(escapeTime(1)<escapeTime(2)&&escapeTime(2)<escapeTime(5));
 const minor=new PoliceSimulation(graph(),world),serious=new PoliceSimulation(graph(),world),car=player();
 minor.report('reckless','driving');serious.report('pedestrian',1);minor.dispatch=serious.dispatch=1e9;minor.sighted=serious.sighted=true; // units had seen the player
 let minorCleared=0,seriousCleared=0;
 for(let i=1;i<40*30;i++){minor.step(1/30,car);serious.step(1/30,car);if(!minorCleared&&!minor.level)minorCleared=i/30;if(!seriousCleared&&!serious.level)seriousCleared=i/30;}
 assert.ok(minorCleared>0&&seriousCleared>minorCleared,`${minorCleared} < ${seriousCleared}`);
 assert.match(minor.message,/gave up/);assert.equal(minor.snapshot().status,'CLEAR');
});
test('interceptors head for where the player is going, not where they were',()=>{
 const p=new PoliceSimulation(graph(),world),car={x:0,z:0,heading:0,speed:25};p.report('pedestrian',1);p.dispatch=1e9;
 p.units=[{id:'a',role:'chase',edge:p.graph.edges[0],s:30,x:0,z:70,heading:0,speed:0,stuck:0},{id:'b',role:'intercept',edge:p.graph.edges[0],s:25,x:0,z:75,heading:0,speed:0,stuck:0}];
 p.step(1/30,car);assert.equal(p.seen,true);
 assert.ok(p.intercept?.target,'intercept field planned');assert.ok(p.predicted.z<car.z-60,'lead point is ahead of the car');
 assert.equal(p.fieldFor(p.units[1]),p.intercept);assert.equal(p.fieldFor(p.units[0]),p);
});
test('wanted level has five steps and never exceeds five stars',()=>{
 assert.deepEqual([0,3,6,10,16,24,999].map(wantedLevel),[0,1,2,3,4,5,5]);
 const p=new PoliceSimulation(graph(),world);for(let i=0;i<40;i++)p.report('pedestrian',i);
 assert.equal(p.heat,30);assert.equal(p.level,5);
});
test('search remembers the last visible location and cannot see through buildings',()=>{
 const p=new PoliceSimulation(graph(),{...world,buildings:{at:(x,z)=>z>0&&z<10}}),car=player();
 const unit={id:'unit',edge:p.graph.edges[0],s:70,x:0,z:30,heading:0,speed:0,stuck:0};
 assert.equal(p.canSee(unit,car),false);
 p.report('pedestrian','one');p.units=[unit];p.dispatch=100;p.sighted=true;
 p.step(1/30,car);const seen={...p.lastSeen};car.x=70;
 for(let i=0;i<90;i++)p.step(1/30,car);
 assert.deepEqual(p.lastSeen,seen);assert.equal(p.snapshot().status,'SEARCHING');
});
test('sustained contacts do not accumulate heat; distinct victims do',()=>{
 const p=new PoliceSimulation(graph(),world);p.report('vehicle',1);
 for(let i=0;i<600;i++){p.time+=1/30;p.report('vehicle',1);}assert.equal(p.heat,6);
 p.report('vehicle',2);assert.equal(p.level,3);
});
test('swept pedestrian detection catches fast pass-throughs without near-miss penalties',()=>{
 const a={x:0,z:10,heading:0},b={x:0,z:-10,heading:0};
 assert.equal(sweptContact(a,b,{x:0,z:0},true),true);assert.equal(sweptContact(a,b,{x:4,z:0},true),false);
 const p=new PoliceSimulation(graph(),world);p.observe(a,{...a,speed:0},[],[{id:1,edge:{},x:0,z:10}]);assert.equal(p.heat,0);
 p.observe(a,{...b,speed:30},[],[{id:1,edge:{},x:0,z:0}]);assert.equal(p.level,2);
});
test('police spawn at a distance and approach along directed roads',()=>{
 const p=new PoliceSimulation(graph(),world),car=player();p.report('vehicle',1);p.step(1/30,car);
 assert.equal(p.units.length,1);const before=Math.hypot(p.units[0].x-car.x,p.units[0].z-car.z);assert.ok(before>=65);
 for(let i=0;i<150;i++)p.step(1/30,car);
 assert.ok(Math.hypot(p.units[0].x-car.x,p.units[0].z-car.z)<before-15);
 assert.ok(Math.abs(p.units[0].x)<=2.7,'stays on the carriageway, passing only in a safe lane offset');
});
test('stopping beside police ends pursuit; reset clears all state',()=>{
 const p=new PoliceSimulation(graph(),world),car=player();p.report('pedestrian',1);
 p.units=[{id:'unit',edge:p.graph.edges[1],s:18,x:0,z:-18,heading:0,speed:0,stuck:0}];p.dispatch=100;
 for(let i=0;i<130;i++)p.step(1/30,car);
 assert.equal(p.level,0);assert.match(p.message,/Busted/);assert.equal(p.report('pedestrian',2),false);
 assert.equal(p.snapshot().busted,true);assert.equal(p.snapshot().status,'BUSTED');
 const frozen=p.snapshot();p.step(3,car);assert.deepEqual(p.snapshot(),frozen);
 p.reset();assert.equal(p.units.length,0);assert.equal(p.contacts.size,0);assert.equal(p.heat,0);
 assert.equal(p.busted,false);
 assert.equal(p.recentIncidents.length,0);assert.equal(p.recklessSeconds,0);
});
test('escape clears heat only after being separated from pursuers',()=>{
 const p=new PoliceSimulation(graph(),world),car=player();p.report('pedestrian',1);p.dispatch=100;p.sighted=true;
 for(let i=0;i<19*30;i++)p.step(1/30,car);assert.equal(p.level,2);
 for(let i=0;i<10*30;i++)p.step(1/30,car);assert.equal(p.level,0);assert.match(p.message,/Escaped/);
});
test('standing still is no escape: the clock waits until the units have had a fair chance',()=>{
 const idle=new PoliceSimulation(graph(),world),car=player();idle.relaxed=true;idle.escalate({level:1});idle.dispatch=1e9; // no unit is ever dispatched
 for(let i=0;i<(CONTACT.fallback-1)*30;i++)idle.step(1/30,car);assert.equal(idle.level,1,'not cleared before anyone could come');assert.equal(idle.escape,0);
 for(let i=0;i<10*30;i++)idle.step(1/30,car);assert.equal(idle.level,0,'nobody ever came: cleared after the fallback');
 const p=new PoliceSimulation(graph(),world);p.relaxed=true;p.escalate({level:1});p.step(1/30,car);
 assert.equal(p.units.length,1);assert.ok(p.contactBy>p.time+2&&p.contactBy<=p.time+CONTACT.max,'the first unit sets how long the clock waits');
 let cleared=false;for(let i=0;i<40*30&&!p.busted;i++){p.step(1/30,car);cleared||=!p.level&&!p.busted;}
 assert.equal(cleared,false);assert.equal(p.busted,true,'a stopped player is arrested');
});
test('a unit that cannot get closer to a stopped player sends an officer on foot to make the arrest',()=>{
 const gapWorld={roads:{at:(x,z)=>z>=20||z<-15},buildings:{at:()=>false}}; // the road between is too narrow for a car
 const p=new PoliceSimulation(graph(),gapWorld),car=player();p.report('pedestrian',1);p.dispatch=1e9;
 p.units=[p.newUnit({edge:p.graph.edges[0],s:40,x:0,z:60,heading:0},'chase',false)];
 let t=0;for(;t<60&&!p.busted;t+=1/30){p.step(1/30,car);assert.ok(p.units[0].z>=20,'the car itself never crosses the gap');}
 assert.equal(p.busted,true);assert.ok(t>ON_FOOT.after&&t<30,`arrested on foot after ${t.toFixed(1)} s`);
 const moving=new PoliceSimulation(graph(),gapWorld),fleeing={...player(),speed:5};moving.report('pedestrian',1);moving.dispatch=1e9;
 moving.units=[moving.newUnit({edge:moving.graph.edges[0],s:40,x:0,z:60,heading:0},'chase',false)];
 for(let i=0;i<30*30;i++)moving.step(1/30,fleeing);assert.equal(moving.units[0].foot,0,'nobody gets out while the player is moving');assert.equal(moving.busted,false);
});
test('player cannot pass through a police car',()=>{
 const p=new PoliceSimulation(graph(),world);p.units=[{id:'police',x:0,z:0,heading:0}];
 const car={x:0,z:-6,heading:0,speed:30};p.observe({x:0,z:6,heading:0},car,[],[]);assert.equal(car.z,6);assert.equal(car.speed,0);
});
test('backing away from existing police contact neither locks nor adds an offence',()=>{
 const p=new PoliceSimulation(graph(),world);p.units=[{id:'police',x:0,z:0,heading:Math.PI}];
 const from={x:0,z:4.6,heading:0,speed:-3},car={...from,z:4.7};
 p.observe(from,car,[],[]);assert.equal(car.z,4.7);assert.equal(car.speed,-3);assert.equal(p.heat,0);
});
test('police stop before blocked road geometry',()=>{
 const p=new PoliceSimulation(graph(),{roads:{at:()=>true},buildings:{at:(x,z)=>z<20}}),car=player();p.report('pedestrian',1);
 p.units=[{id:'unit',edge:p.graph.edges[0],s:70,x:0,z:30,heading:0,speed:12,stuck:0}];p.dispatch=100;
 for(let i=0;i<120;i++)p.step(1/30,car);assert.ok(p.units[0].z>=20);
});
test('Helsinki harbour dispatch has mapped drivable units and no building crossings',()=>{
 const network=correctHarbourLanes(JSON.parse(readFileSync('public/data/mobility.json'))),city=JSON.parse(gunzipSync(readFileSync('public/data/city.pack')));
 const w={roads:new SpatialIndex(city.roads.filter(r=>!/Koroke/.test(r.kind))),buildings:new SpatialIndex(city.buildings),trafficForbidden:new SpatialIndex(city.roads.filter(r=>/Koroke/.test(r.kind)))};
 const p=new PoliceSimulation(prepareGraph(network.roads),w),car={...HARBOUR_START,speed:0};p.report('pedestrian',1);
 let count=0;for(let i=0;i<240;i++){p.step(1/30,car);count=Math.max(count,p.units.length);for(const u of p.units)assert.ok(vehicleFitsRoad(u,w));}
 assert.ok(count>=1,'must dispatch on real harbour network');
});

test('reckless driving needs sustained risk, earns one star, and does not retrigger each frame',()=>{
 for(const hz of [30,60,144]){
  const p=new PoliceSimulation(graph(),world),car={...player(),travelMode:'car',speed:RECKLESS.speed+1};
  const sample=seconds=>{for(let i=0;i<Math.round(seconds*hz);i++){p.time+=1/hz;p.observeDriving({...car},car,1/hz);}};
  sample(1);assert.equal(p.level,0,'a brief burst is not an offence');
  sample(1);assert.equal(p.level,1,`${hz} Hz reaches one star after two seconds`);
  sample(3);assert.equal(p.level,1,'one prolonged acceleration is debounced');
  sample(6);assert.equal(p.level,2,'continued reckless driving eventually escalates');
 }
});
test('ordinary driving and travel on foot, bicycles and scooters stay clear',()=>{
 const p=new PoliceSimulation(graph(),world),car={...player(),travelMode:'car',speed:12};
 for(let i=0;i<600;i++){p.time+=1/60;p.observeDriving(car,car,1/60);}assert.equal(p.level,0);
 for(const mode of ['walk','bike','scooter'])for(let i=0;i<240;i++){p.time+=1/60;p.observeDriving(car,{...car,travelMode:mode,speed:50},1/60);}assert.equal(p.level,0);
 p.observeDriving(car,{...car,speed:50},1);assert.ok(p.recklessSeconds>0);
 p.observeDriving(car,car,1/60,{driving:false});assert.equal(p.recklessSeconds,0);
 for(let i=0;i<300;i++){p.time+=1/60;p.observeDriving(car,car,1/60);}assert.equal(p.level,0);
});
test('dangerous turns use actual yaw rate and pavement driving uses mapped ground',()=>{
 const from={x:0,z:0,heading:0,speed:12},dt=.1;
 assert.equal(recklessDriving(from,{...from,heading:.05},dt,world),true);
 assert.equal(recklessDriving(from,{...from,heading:0,steer:1},dt,world),false);
 assert.equal(recklessDriving(from,{...from,speed:3,heading:.2},dt,world),false);
 const pavement={roads:{at:()=>false},pavement:{at:()=>true}};
 assert.equal(recklessDriving(from,from,dt,pavement),true);
 assert.equal(recklessDriving(from,from,dt,{roads:{at:()=>false}}),false);
 assert.equal(recklessDriving(from,from,0,world),false);
 const wrapped={...from,heading:Math.PI-.001};assert.equal(recklessDriving(wrapped,{...wrapped,heading:-Math.PI+.001},dt,world),false);
});
test('the repeat bonus expires and a fresh pursuit starts without old incident history',()=>{
 const quick=new PoliceSimulation(graph(),world),spaced=new PoliceSimulation(graph(),world);
 quick.report('vehicle','a',9);quick.time=2;quick.report('vehicle','b',9);
 spaced.report('vehicle','a',9);spaced.time=INCIDENT_WINDOW+1;spaced.report('vehicle','b',9);
 assert.ok(quick.heat>spaced.heat);assert.equal(spaced.heat,12);
 const escaped=new PoliceSimulation(graph(),world);escaped.report('vehicle','a',9);escaped.dispatch=1e9;escaped.sighted=true;
 for(let i=0;i<21*30;i++)escaped.step(1/30,player());assert.equal(escaped.level,0);
 escaped.report('vehicle','a',9);assert.equal(escaped.heat,6,'escape clears the combo and contact history');
 escaped.reset();escaped.report('vehicle','a',9);assert.equal(escaped.heat,6,'restart also clears it');
});
