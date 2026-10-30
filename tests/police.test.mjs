import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {PoliceSimulation,sweptContact,wantedLevel,incidentHeat,escapeTime,CONTACT,ON_FOOT,FOOT_CHASE,closingSpeed,CRASH_MIN_SPEED,RECKLESS,INCIDENT_WINDOW,recklessDriving} from '../src/police.js';
import {prepareGraph,routePoint} from '../src/mobility.js';
import {correctHarbourLanes,vehicleFitsRoad,trafficFootprintsOverlap} from '../src/road-safety.js';
import {SpatialIndex} from '../src/geo.js';
import {HARBOUR_START} from '../src/demo-route.js';
import {annotateJunctions} from '../src/lane-model.js';

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
 p.step(1/30,car);assert.equal(p.seen,true);assert.equal(p.intercept,null,'not in the step that planned the chase field');
 p.step(1/30,car);assert.ok(p.intercept?.target,'intercept field planned the step after');assert.ok(p.predicted.z<car.z-60,'lead point is ahead of the car');
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
 for(let i=0;i<30*30;i++)moving.step(1/30,fleeing);assert.equal(moving.units[0].officer,null,'nobody gets out while the player is moving');assert.equal(moving.busted,false);
});
test('no officer walks over the water: a unit stuck across a canal from a stopped player stays in its car',()=>{
 const canal={rings:[[[-50,-14],[50,-14],[50,15],[-50,15]]]},wetWorld={roads:{at:(x,z)=>z>=20||z<-15},buildings:{at:()=>false},water:[canal]}; // the unit's road ends at the quay; the player stands on the far one
 const p=new PoliceSimulation(graph(),wetWorld),car=player();p.report('pedestrian',1);p.dispatch=1e9;
 p.units=[p.newUnit({edge:p.graph.edges[0],s:40,x:0,z:60,heading:0},'chase',false)];
 for(let i=0;i<40*30&&!p.busted;i++)p.step(1/30,car);
 assert.equal(p.units[0].officer,null,'nobody got out to walk across the canal');assert.equal(p.busted,false);
});
// Strøget in miniature: a road along z=0, a house between it and a pedestrian street at z=50 that runs east, footways
// (both ways) from the kerb round the house's west end and along the street. The car can get no nearer than the road.
const footStreet=()=>{
 const roads=prepareGraph({nodes:[[-200,0],[200,0]],edges:[{from:0,to:1,lane:0,points:[[-200,0],[200,0]]}]}),house=(x,z)=>x>-10&&x<10&&z>8&&z<40;
 const walk=[[-20,5],[-20,50],[20,50],[400,50]],edges=[];for(let i=1;i<walk.length;i++)edges.push({from:i-1,to:i,points:[walk[i-1],walk[i]]},{from:i,to:i-1,points:[walk[i],walk[i-1]]});
 const p=new PoliceSimulation(roads,{roads:{at:(x,z)=>Math.abs(z)<4},buildings:{at:house}});p.setWalks({nodes:walk,edges});p.relaxed=true;p.escalate({level:2});p.dispatch=1e9;
 p.units=[0,25,-60].map(x=>p.newUnit({edge:roads.edges[0],s:200+x,x,z:0,heading:-Math.PI/2},'chase',false));return {p,house};
};
test('foot chase: off the roads an officer parks, gets out and follows the player along the footways, round the houses',()=>{
 const {p,house}=footStreet(),me={x:0,z:50,heading:0,speed:0,walking:true,travelMode:'walk'};let t=0,round=false,most=0;
 for(;t<40&&!p.busted;t+=1/30){p.step(1/30,me);const out=p.units.filter(u=>u.officer);most=Math.max(most,out.length);
  for(const u of out){assert.ok(!house(u.officer.x,u.officer.z),'never through the house');round||=u.officer.x<-15&&u.officer.z>20;}
  for(const u of p.units)if(!u.officer)assert.ok(Math.abs(u.z)<4,'the cars stay on the road');}
 assert.equal(p.busted,true,'a player standing in the pedestrian street is arrested');assert.ok(round,'the officer went round the house on the footway (the straight line goes through it)');
 assert.ok(most>=1&&most<=FOOT_CHASE.max,`at most ${FOOT_CHASE.max} officers out (${most})`);assert.ok(t<30,`arrested after ${t.toFixed(1)} s`);
});
test('foot chase: two officers from units parked together keep a step apart, also at the arrest',()=>{
 const {p,house}=footStreet(),me={x:0,z:50,heading:0,speed:0,walking:true,travelMode:'walk'};p.units=[-30,-24].map(x=>p.newUnit({edge:p.graph.edges[0],s:200+x,x,z:0,heading:-Math.PI/2},'chase',false));
 let apart=Infinity,two=0;for(let t=0;t<40&&!p.busted;t+=1/30){p.step(1/30,me);const out=p.units.filter(u=>u.officer);
  if(out.length>1){two++;apart=Math.min(apart,Math.hypot(out[0].officer.x-out[1].officer.x,out[0].officer.z-out[1].officer.z));for(const u of out)assert.ok(!house(u.officer.x,u.officer.z));}}
 assert.equal(p.busted,true);assert.ok(two>30,'both officers out');assert.ok(apart>=FOOT_CHASE.apart-.01,`never in one another (${apart.toFixed(2)} m apart)`);
});
test('foot chase: running gets away from the officer, walking does not; driving off on a road calls them back',()=>{
 const {p,house}=footStreet(),me={x:0,z:50,heading:-Math.PI/2,speed:0,walking:true,travelMode:'walk'};
 let t=0;for(;t<8;t+=1/30)p.step(1/30,me);assert.ok(p.units.some(u=>u.officer&&!u.officer.back),'an officer is out');
 const gap=()=>Math.min(...p.units.filter(u=>u.officer&&!u.officer.back).map(u=>me.x-u.officer.x));let far=0,first=null;
 for(let i=0;i<40*30;i++){me.speed=4.8;me.x+=4.8/30;p.step(1/30,me);for(const u of p.units)if(u.officer){assert.ok(!house(u.officer.x,u.officer.z));if(!u.officer.back){far=Math.max(far,u.officer.x);assert.ok(u.officer.x<me.x-1,'never catches up');}}if(i===15*30)first=gap();}
 assert.equal(p.busted,false,'running at 4.8 m/s, nobody catches up');assert.ok(far>100,`the officer ran after the player along the street (to x=${far.toFixed(0)})`);
 assert.ok(gap()>first+5,`and falls behind (${first.toFixed(1)} -> ${gap().toFixed(1)} m): out of sight round a corner, the escape clock runs`);
 const w=footStreet().p,walker={x:0,z:50,heading:-Math.PI/2,speed:0,walking:true,travelMode:'walk'};for(let i=0;i<8*30;i++)w.step(1/30,walker);
 for(let i=0;i<40*30&&!w.busted;i++){walker.speed=2;walker.x+=2/30;w.step(1/30,walker);}
 assert.equal(w.busted,true,'walking (2 m/s), the officer catches up and takes hold');
 const q=footStreet().p,car={x:0,z:50,heading:0,speed:0,walking:true,travelMode:'walk'};for(let i=0;i<8*30;i++)q.step(1/30,car);
 const sent=q.units.filter(u=>u.officer);assert.ok(sent.length>=1);
 Object.assign(car,{x:150,z:0,speed:12,walking:false,travelMode:'car'});q.step(1/30,car);assert.ok(sent.every(u=>!u.officer||u.officer.back),'back to the car once the player drives off on the road');
 for(let i=0;i<20*30;i++){car.x+=12/30;q.step(1/30,car);}assert.ok(sent.every(u=>!u.officer),'and gone (back in, or out of view)');
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
test('a unit whose road route to the player is longer than the route field\'s reach keeps driving on a coarse field instead of standing at the end of its street',()=>{
 /* a one-way loop: the unit 100 m from the player as the crow flies, 3.75 km away by road */
 const g=prepareGraph({nodes:[[100,100],[100,0],[100,-1800],[0,-1800],[0,0],[0,100]],edges:[[0,1],[1,2],[2,3],[3,4],[4,5]].map(([from,to],i,a)=>({from,to,lane:0,points:[[100,100],[100,0],[100,-1800],[0,-1800],[0,0],[0,100]].slice(from,to+1)}))});
 const p=new PoliceSimulation(g,world),car={x:0,z:50,heading:0,speed:0};p.escalate({level:3});p.dispatch=1e9;p.plan(car);
 const start=g.edges[0];assert.ok(!Number.isFinite(p.costs[start.to]),'out of the ordinary field\'s reach');
 const unit=p.newUnit({edge:start,s:50,x:100,z:50,heading:0},'chase',false);p.units=[unit];
 for(let i=0;i<5*30;i++)p.step(1/30,car);
 assert.notEqual(unit.edge,start,'it drove on past the end of its street');assert.ok(unit.z<-40&&unit.speed>5,`on its way round (z ${unit.z.toFixed(0)}, ${unit.speed.toFixed(1)} m/s)`);
 const q=new PoliceSimulation(g,world);q.escalate({level:3});q.plan(car);const a={edge:g.edges[0],role:'chase'},b={edge:g.edges[1],role:'chase'};
 for(const u of [a,b,a,b])assert.ok(q.next(u.edge,q.fieldFor(u)),'each of two units beyond reach keeps a route (the search heads for its own unit)');
});
test('a unit taking the kerb-side passing offset does not go into the kerb-parked cars there (main.js gives it those within 8 m)',()=>{
 const run=listed=>{const p=new PoliceSimulation(graph(),world),walker={x:6,z:-150,heading:0,speed:0,walking:true,halfLength:.3};p.report('pedestrian',1);
  const e=p.graph.edges[1],stopped={id:1,edge:e,x:0,z:-5,heading:0,speed:0,halfLength:2.36,halfWidth:.98};
  const kerb=[0,5,10,15].map(s=>{const q=routePoint(e,s,e.lane+2.7);return {x:q.x,z:q.z,heading:q.heading,halfLength:2.15,halfWidth:.9};});
  p.units=[{id:'unit',edge:e,s:.6,x:0,z:-.6,heading:0,speed:0,stuck:0}];p.dispatch=100;let overlap=0; // a car has pulled in just ahead of it
  for(let i=0;i<300;i++){const u=p.units[0];p.step(1/30,walker,[stopped,...listed?kerb.filter(k=>u&&Math.hypot(k.x-u.x,k.z-u.z)<8):[]]);if(p.units[0]&&kerb.some(k=>trafficFootprintsOverlap(p.units[0],k)))overlap++;}
  return overlap;};
 assert.ok(run(false)>0,'unlisted, it moves over into them');
 assert.equal(run(true),0,'listed: never inside one');
});
// A crossroads at the origin (one-way arms: north up the z axis from the south, on to the north, and west to east), with
// traffic's junction boxes (lane-model.js stopGap/startGap).
const crossroads=()=>{const g=prepareGraph({nodes:[[0,100],[0,0],[0,-100],[-100,0],[100,0]],edges:[{from:0,to:1,lane:0,points:[[0,100],[0,0]]},{from:1,to:2,lane:0,points:[[0,0],[0,-100]]},{from:3,to:1,lane:0,points:[[-100,0],[0,0]]},{from:1,to:4,lane:0,points:[[0,0],[100,0]]}]});annotateJunctions(g,[]);return g;};
test('a unit stops at the stop line, not in the junction box, behind a car standing just past the junction; one standing in the box backs out of it while its officer is out',()=>{
 const g=crossroads(),e=g.edges[0],line=e.length-e.stopGap,walker={x:6,z:-150,heading:0,speed:0,walking:true,halfLength:.3};
 const p=new PoliceSimulation(g,world);p.report('pedestrian',1);p.dispatch=100;
 const q=routePoint(g.edges[1],3,0),stopped={id:1,edge:g.edges[1],x:q.x,z:q.z,heading:q.heading,speed:0,halfLength:2.36,halfWidth:.98};
 const a=routePoint(e,60,0);p.units=[p.newUnit({edge:e,s:60,...a},'chase',false)];
 for(let i=0;i<300;i++)p.step(1/30,walker,[stopped]);
 const u=p.units[0];assert.equal(u.edge,e);assert.ok(u.s<=line+.3&&u.s>line-3,`waits at the stop line (${u.s.toFixed(2)} of ${e.length}, box from ${line.toFixed(2)})`);
 const b=routePoint(e,98.5,0);u.s=98.5;u.x=b.x;u.z=b.z;u.speed=0;u.officer={x:b.x+1.3,z:b.z,heading:0,speed:0,back:false,path:null,k:0,plan:0,gx:NaN,gz:NaN};
 for(let i=0;i<90;i++)p.step(1/30,walker,[stopped]);
 assert.ok(u.officer,'the officer is still out');assert.ok(u.s<=line-.4,`backed out behind the stop line (${u.s.toFixed(2)})`);
});
test('a unit turning at a junction is not held by a car standing straight on from its nose, off its way (at another approach\'s stop line, or on past the junction)',()=>{
 // The room ahead was measured straight on from the unit's nose: one turning out of a junction box stood 15-20 s for a car waiting across the box from it, and held the cars behind it.
 const g=crossroads(),e=g.edges[0],walker={x:90,z:-6,heading:0,speed:0,walking:true,halfLength:.3},p=new PoliceSimulation(g,world);p.report('pedestrian',1);p.dispatch=100;
 const q=routePoint(g.edges[1],4,0),stopped={id:1,edge:g.edges[1],x:q.x,z:q.z,heading:q.heading,speed:0,halfLength:2.36,halfWidth:.98};
 const a=routePoint(e,70,0);p.units=[p.newUnit({edge:e,s:70,...a},'chase',false)];let overlap=0;
 for(let i=0;i<240;i++){p.step(1/30,walker,[stopped]);if(trafficFootprintsOverlap(p.units[0],stopped))overlap++;}
 const u=p.units[0];assert.equal(u.edge,g.edges[3],'turned east');assert.ok(u.x>15,`on its way (${u.x.toFixed(1)})`);assert.equal(overlap,0);
});
test('a unit stuck beside a car that waits on it does not drive on through it where no passing offset is clear',()=>{
 // After 2 s held by a car that is itself waiting on it, the unit drove on through that car (17-28 unit-steps overlapping a seed).
 const g=graph(),e=g.edges[1],walker={x:6,z:-180,heading:0,speed:0,walking:true,halfLength:.3},p=new PoliceSimulation(g,world);p.report('pedestrian',1);p.dispatch=100;
 const a=routePoint(e,40,0);p.units=[p.newUnit({edge:e,s:40,...a},'chase',false)];const u=p.units[0],q=routePoint(e,46.5,-2.4),k=routePoint(e,46.5,2.7);
 const car={id:7,edge:e,s:46.5,x:q.x,z:q.z,heading:q.heading+.7,speed:0,halfLength:2.36,halfWidth:.98,holdBy:u},kerb={id:8,x:k.x,z:k.z,heading:k.heading,speed:0,halfLength:2.15,halfWidth:.9}; // its nose across the lane; the passing offset taken by a car at the kerb
 let overlap=0;for(let i=0;i<300;i++){p.step(1/30,walker,[car,kerb]);if(trafficFootprintsOverlap(u,car)||trafficFootprintsOverlap(u,kerb))overlap++;}
 assert.equal(overlap,0,'never inside either');
});
test('a unit stuck beside a car that waits on it, on a narrow street, passes it at a nearer offset clear of it',()=>{
 // The kerb-side passing offset (lane + 2.7 m) is off a narrow carriageway: the unit stood, or drove through the car.
 const g=prepareGraph({nodes:[[0,0],[0,-200]],edges:[{from:0,to:1,lane:.35,points:[[0,0],[0,-200]]}]}),e=g.edges[0],walker={x:6,z:-190,heading:0,speed:0,walking:true,halfLength:.3};
 const p=new PoliceSimulation(g,{roads:{at:x=>Math.abs(x)<2.8},buildings:{at:()=>false},trafficForbidden:{at:()=>false}});p.report('pedestrian',1);p.dispatch=100;
 const a=routePoint(e,40),q=routePoint(e,47,-2.05);p.units=[p.newUnit({edge:e,s:40,...a},'chase',false)];const u=p.units[0];
 const car={id:7,edge:e,s:47,x:q.x,z:q.z,heading:q.heading+.6,speed:0,halfLength:2.36,halfWidth:.98,holdBy:u}; // beside its lane, its nose turned across it
 let overlap=0;for(let i=0;i<300;i++){p.step(1/30,walker,[car]);if(trafficFootprintsOverlap(u,car))overlap++;}
 assert.equal(overlap,0,'never inside it');assert.ok(u.z<-52,`got past (${u.z.toFixed(1)})`);
});
test('a unit is never sent in on an edge inside a signal cluster (all junction box)',()=>{
 // One that appeared there stood in the cluster behind a car at the red light out of it and held the cars behind it 15-30 s.
 const spawn=inside=>{const g=crossroads();if(inside>=0)g.edges[inside].inside=true;const p=new PoliceSimulation(g,world),pl={x:0,z:-60,heading:0,speed:0};p.report('pedestrian',1);p.plan(pl);p.spawn(pl,[]);return g.edges.indexOf(p.units[0]?.edge);};
 const first=spawn(-1);assert.ok(first>=0);assert.notEqual(spawn(first),first,'another way in');
});
test('a unit backs off from a car standing in its way that is itself waiting on the unit (each held by the other)',()=>{
 const g=graph(),e=g.edges[1],walker={x:6,z:-180,heading:0,speed:0,walking:true,halfLength:.3},p=new PoliceSimulation(g,world);p.report('pedestrian',1);p.dispatch=100;
 const a=routePoint(e,40,0);p.units=[p.newUnit({edge:e,s:40,...a},'chase',false)];const u=p.units[0],q=routePoint(e,46,0);
 const car={id:7,edge:e,s:46,x:q.x,z:q.z,heading:q.heading,speed:0,halfLength:2.36,halfWidth:.98,holdBy:null};
 for(let i=0;i<60;i++)p.step(1/30,walker,[car]);const at=u.s;
 car.holdBy=u;for(let i=0;i<150;i++)p.step(1/30,walker,[car]);
 assert.ok(u.s<at-1,`backed off (${at.toFixed(2)} -> ${u.s.toFixed(2)})`);assert.ok(!trafficFootprintsOverlap(u,car));
});
test('a unit does not drive through a car standing in its lane (the player\'s parked car, given in the traffic list): it stops or steers round',()=>{
 const run=listed=>{const p=new PoliceSimulation(graph(),world),walker={x:6,z:-150,heading:0,speed:0,walking:true,halfLength:.3};p.report('pedestrian',1);
  const parked={id:'player-car',x:0,z:-5,heading:0,speed:0,halfLength:2.36,halfWidth:.98,travelMode:'car'};
  p.units=[{id:'unit',edge:p.graph.edges[0],s:70,x:0,z:30,heading:0,speed:12,stuck:0}];p.dispatch=100;let overlap=0;
  for(let i=0;i<300;i++){p.step(1/30,walker,listed?[parked]:[]);const u=p.units[0];if(u&&Math.abs(u.x-parked.x)<1.96&&Math.abs(u.z-parked.z)<4.72)overlap++;}
  return {overlap,unit:p.units[0]};};
 assert.ok(run(false).overlap>0,'unlisted, the unit drives through it');
 const {overlap,unit}=run(true);assert.equal(overlap,0,'listed: never inside it');assert.ok(unit.z<-10||unit.z>0,`stopped short or got past (${unit.z.toFixed(1)})`);
});
test('a unit a traffic car has driven into backs or creeps out of it instead of both standing locked together',()=>{
 const p=new PoliceSimulation(graph(),world),walker={x:6,z:-150,heading:0,speed:0,walking:true,halfLength:.3};p.report('pedestrian',1);
 const car={id:7,edge:{},x:0,z:-13,heading:Math.PI/2,speed:0,halfLength:2.36,halfWidth:.98}; // across the unit's nose
 p.units=[{id:'unit',edge:p.graph.edges[1],s:10,x:0,z:-10,heading:0,speed:0,stuck:0}];p.dispatch=100;assert.ok(trafficFootprintsOverlap(p.units[0],car));
 let deeper=false;for(let i=0;i<60;i++){const z=p.units[0].z;p.step(1/30,walker,[car]);if(p.units[0].z<z-1e-9)deeper=true;}
 assert.ok(!trafficFootprintsOverlap(p.units[0],car),`out of it (unit at z ${p.units[0].z.toFixed(2)})`);assert.ok(!deeper,'never further in');
});
test('a stuck unit whose car corner would clip the kerb takes the step while its centre stays on the road, never into a house or far over the kerb',()=>{
 // A kerb bite into a narrow carriageway (on a bend in the city: safeVehicleSegment refused the next 0.3-1 m while 3 m on
 // was fine, and the unit stood there 30-45 s, holding the cars behind it until it was retired).
 const run=(edge,house)=>{const bite=(x,z)=>z<-43&&z>-50&&x>edge,w={roads:{at:(x,z)=>Math.abs(x)<2&&!bite(x,z)},buildings:{at:(x,z)=>house&&bite(x,z)},trafficForbidden:{at:()=>false}};
  const g=graph(),e=g.edges[1],p=new PoliceSimulation(g,w),walker={x:6,z:-180,heading:0,speed:0,walking:true,halfLength:.3};p.report('pedestrian',1);p.dispatch=100;
  p.units=[p.newUnit({edge:e,s:30,...routePoint(e,30,0)},'chase',false)];const u=p.units[0];let inHouse=false;
  for(let i=0;i<30*8;i++){p.step(1/30,walker,[]);if(u.edge===e /* the footprint the strict test reads (road-safety.js), the drawn body's side */&&[[.9,2.15],[.9,-2.15],[.98,0]].some(([lx,lz])=>w.buildings.at(u.x+lx*Math.cos(u.heading)+lz*Math.sin(u.heading),u.z-lx*Math.sin(u.heading)+lz*Math.cos(u.heading))))inHouse=true;}
  assert.ok(!inHouse,'body never in the house');return u.z;};
 assert.ok(run(.7,false)<-60,'0.3 m over the kerb: on past it');
 assert.ok(run(.7,true)>-45,'a house there: it stops short');assert.ok(run(.3,false)>-45,'0.7 m over: it stops short');
});
