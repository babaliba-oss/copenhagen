import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Finale,FINALE_ZONE,FINALE_TRIGGERS,FINALE_BUILDINGS,CINEMATIC_SECONDS,CONTACT_WINDOW,TRAM_NOSE,TRAM_TAIL,inFinaleZone,finaleArea,finaleBuilding,tramAt,tramLabel,buildingAhead,formatStats,formatDuration,formatDistance,renderEndScreen} from '../src/finale.js';
import {TRAM_DIMENSIONS,TRAM_HOTSPOTS,TramSimulation,playerLeaving} from '../src/tram-simulation.js';
import {PoliceSimulation,SURGE,BUST_TIME,CONTACT_BUST,heatForLevel} from '../src/police.js';
import {prepareGraph} from '../src/mobility.js';
import {HARBOUR_START} from '../src/demo-route.js';
import {displayedSpeedKmh} from '../src/physics.js';

const kmh=v=>v/3.6;
// Zone centre: the station stops on Kaivokatu.
const centre=()=>({x:FINALE_ZONE.x,z:FINALE_ZONE.z,heading:0,speed:0,distance:0});
// A car on Kaivokatu 30 m east of the station stops, facing east (heading −π/2): clear of both platforms, looking away from them.
const station=()=>({x:-590,z:-20,heading:-Math.PI/2,speed:0,distance:0});
const tramData=()=>JSON.parse(readFileSync(new URL('../public/data/trams.json',import.meta.url)));
// Police double: records escalations the way main.js's PoliceSimulation would receive them.
const mockPolice=()=>{const p=new PoliceSimulation(graph(),world);p.calls=[];const report=p.report.bind(p);p.report=(kind,id,speed)=>{const accepted=report(kind,id,speed);if(accepted)p.calls.push({kind,id,speed,level:p.level,message:p.message});return accepted;};return p;};
const tram=(over={})=>({id:7,line:'4',destination:'Munkkiniemi',x:0,z:0,heading:0,speed:0,wait:5,...over});
const sokos={ratu:405,name:'Asema-aukio'},lasipalatsi={ratu:944,name:'Mannerheimintie'},other={ratu:12,name:'Kaivokatu'};
const worldWith=record=>({buildings:{at:(x,z)=>z<-2?record:undefined}}); // a wall just north of the origin (car forward is -z at heading 0)
function armed(police=mockPolice(),car=centre()){const f=new Finale();f.step(1/60,car,{police,started:true});return {f,police,car};}

test('zone detection: the station district is inside (station, Lasipalatsi, Mikonkatu and Forum stops), the harbour start and Ylioppilastalo are not',()=>{
 assert.equal(FINALE_ZONE.name,'Rautatientori');assert.equal(FINALE_ZONE.label,undefined,'no HUD label for the zone');
 const stops=tramData().stops,stop=(name,i=0)=>stops.filter(s=>s.name===name)[i];
 for(const [name,i] of [['Päärautatieasema',0],['Päärautatieasema',1],['Lasipalatsi',0],['Lasipalatsi',1],['Mikonkatu',0],['Mikonkatu',1],['Rautatientori',0]])assert.equal(inFinaleZone(stop(name,i)),true,`${name} ${i} (${stop(name,i).x}, ${stop(name,i).z})`);
 assert.equal(finaleArea(stop('Päärautatieasema')).name,'Rautatieasema');assert.equal(finaleArea(stop('Lasipalatsi')).name,'Lasipalatsi');assert.equal(finaleArea(stop('Mikonkatu')).name,'Mikonkatu');
 assert.equal(inFinaleZone({x:-750,z:30}),true,'Simonkatu / Mannerheimintie corner (Forum)');assert.equal(inFinaleZone({x:-697,z:187}),true,'Forum front, Mannerheimintie 14');
 assert.equal(inFinaleZone({x:-824,z:-112}),true,'Postitalo south-west corner');assert.equal(inFinaleZone({x:-490,z:-67}),true,'the Central Station start point');
 assert.equal(inFinaleZone({x:-700,z:-20}),true,'Kaivokatu between Lasipalatsi and the station');assert.equal(inFinaleZone({x:-540,z:-35}),true,'Kaivokatu between the station and Mikonkatu');
 assert.equal(inFinaleZone({x:-626,z:-160}),false,'just outside the station circle, behind the station');
 assert.equal(inFinaleZone(stop('Ylioppilastalo')),false,'Ylioppilastalo stops are outside');
 assert.equal(inFinaleZone(HARBOUR_START),false);assert.equal(inFinaleZone({x:-3.55,z:117.7}),false,'Senate Square');assert.equal(inFinaleZone(null),false);assert.equal(finaleArea(null),null);
 assert.equal(inFinaleZone({x:5,z:5},{x:0,z:0,radius:10}),true,'a plain single-circle zone still works');assert.equal(inFinaleZone({x:15,z:5},{x:0,z:0,radius:10}),false);
 assert.ok(FINALE_ZONE.areas.every(a=>TRAM_HOTSPOTS.some(h=>Math.hypot(h.x-a.x,h.z-a.z)<a.radius+150)||a.name==='Mikonkatu'||a.name==='Forum'),'each stop area has a tram hotspot nearby');
 assert.deepEqual(FINALE_BUILDINGS.map(b=>b.ratu),[405,944]);
 assert.equal(finaleBuilding(sokos),'Sokos');assert.equal(finaleBuilding(lasipalatsi),'Lasipalatsi');assert.equal(finaleBuilding(other),null);assert.equal(finaleBuilding(undefined),null);
});
test('tramAt finds the articulated body from nose to tail around the front-section centre, not the track beside it',()=>{
 const t=tram();
 assert.equal(TRAM_NOSE,4.85);assert.equal(TRAM_TAIL,22.75);assert.equal(TRAM_NOSE+TRAM_TAIL,TRAM_DIMENSIONS.length);
 assert.equal(tramAt({x:0,z:5},[t])?.id,7,'inside the body, 5 m behind the position');
 assert.equal(tramAt({x:0,z:-TRAM_NOSE-2.5},[t])?.id,7,'a car nose-on against the tram nose (the natural crash at a stop)');
 assert.equal(tramAt({x:0,z:TRAM_TAIL+2},[t])?.id,7,'just behind the tail (within the contact margin)');
 assert.equal(tramAt({x:0,z:-TRAM_NOSE-4},[t]),null,'4 m ahead of the nose');
 assert.equal(tramAt({x:0,z:TRAM_TAIL+4},[t]),null,'4 m behind the tail');
 assert.equal(tramAt({x:6,z:10},[t]),null,'a parallel lane 6 m away');
 // Agrees with the simulation's own solid footprint: every obstacle offset it publishes is inside the body.
 for(const offset of [3,0,-4,-8.95,-13,-17.9,-21.5])assert.equal(tramAt({x:0,z:-offset},[t],0.01)?.id,7,`obstacle offset ${offset}`);
 const hit=tramAt({x:0,z:12},[tram({id:1,x:40,z:40}),t,tram({id:2,x:-0.5,z:30,heading:Math.PI/2})]);
 assert.equal(hit.id,7);assert.equal(hit.line,'4');assert.equal(hit.destination,'Munkkiniemi');assert.equal(hit.waiting,true);
 assert.equal(tramAt({x:0,z:5},[{id:3,path:{line:'10',destination:'Pikku Huopalahti'},x:0,z:0,heading:0}]).line,'10','falls back to the HSL path when the tram carries no line');
 assert.equal(tramAt({x:0,z:5},[]),null);assert.equal(tramAt({x:0,z:5},undefined),null);
});
test('buildingAhead probes the nose, or the tail when reversing',()=>{
 const car={x:0,z:0,heading:0,speed:5},world=worldWith(sokos);
 assert.equal(buildingAhead(car,world)?.ratu,405);
 assert.equal(buildingAhead({...car,speed:-3},world),null,'reversing: the wall is ahead, the probe looks behind');
 assert.equal(buildingAhead({...car,heading:Math.PI},world),null,'facing away from the wall');
 assert.equal(buildingAhead({...car,heading:Math.PI,speed:-3},world)?.ratu,405,'reversing into the wall');
 assert.equal(buildingAhead(car,{buildings:{at:()=>({name:'kerb'})}}).name,'kerb','solid street obstacles without a municipal building ID count too');
 assert.equal(buildingAhead(car,{}),null);
});
test('a tram collision starts at two stars in every city; light taps only log a bump',()=>{
 for(const zone of [FINALE_ZONE,null]){
  const f=new Finale({zone}),police=mockPolice(),car={x:0,z:5,heading:0,speed:0};
  f.step(1/60,car,{police});assert.equal(police.pressure,false);
  const tap=f.transitImpact(car,2.5,[tram()],police);assert.equal(tap.big,false);assert.equal(police.level,0);
  const crash=f.transitImpact(car,9,[tram({id:8})],police);assert.equal(crash.big,true);assert.equal(police.level,2);
  assert.equal(police.calls.length,1);assert.equal(police.calls[0].id,'tram:8');assert.equal(f.triggered,false);
 }
});
test('bus fallback reports the transit collision exactly once without a tram',()=>{
 const f=new Finale({zone:null}),police=mockPolice(),car={x:0,z:0,heading:0,speed:0};
 assert.equal(f.transitImpact(car,9,[],police).tram,null);assert.equal(police.level,2);
 assert.equal(f.transitImpact(car,9,[],police),null);assert.equal(police.calls.length,1);
 assert.deepEqual([...f.offences.values()],[{text:'Crashed into a bus',count:1}]);
});
test('ordinary buildings and street obstacles earn the same collision response as named landmarks',()=>{
 for(const record of [sokos,lasipalatsi,other,{name:'Lamp post'}]){
  const f=new Finale({zone:null}),police=mockPolice(),car={x:0,z:0,heading:0,speed:8};
  const hit=f.buildingImpact(car,9,worldWith(record),police);assert.equal(hit.big,true);
  assert.equal(police.level,2);assert.equal(police.calls.length,1);assert.equal(police.calls[0].kind,'building');
 }
});
test('mixed incidents escalate identically inside and outside the old station area',()=>{
 for(const zone of [FINALE_ZONE,null]){
  const f=new Finale({zone}),police=mockPolice(),car={x:0,z:0,heading:0,speed:9};police.onIncident=(...i)=>f.incident(...i);
  f.transitImpact({...car,z:5},9,[tram()],police);assert.equal(police.level,2);
  police.time=1;f.buildingImpact(car,9,worldWith(sokos),police);assert.equal(police.level,3);
  police.time=2;police.report('property','bin',9);assert.equal(police.level,4);
  police.time=3;police.report('vehicle','car',9);assert.equal(police.level,5);
  assert.equal(f.triggered,true);assert.equal(f.stats.maxLevel,5);
 }
});
test('a wall held at walking pace or a tram pushing back is one offence, not hundreds',()=>{
 const {f,police}=armed(),car={x:0,z:0,heading:0,speed:0};
 for(let i=0;i<120;i++){f.buildingImpact(car,.4,worldWith(sokos),police);f.step(1/60,car,{police});}
 assert.equal(f.offences.size,0);
 for(let i=0;i<600;i++){f.buildingImpact(car,9,worldWith(sokos),police);f.transitImpact({...car,z:5},9,[tram()],police);police.time+=1/60;f.step(1/60,car,{police});}
 assert.equal(police.calls.length,2);assert.equal(police.level,3);
 assert.deepEqual([...f.offences.values()].map(o=>o.count),[1,1]);
 police.time+=CONTACT_WINDOW+.1;f.step(CONTACT_WINDOW+.1,car,{police});
 f.transitImpact({...car,z:5},9,[tram()],police);assert.equal(police.calls.length,3);
});
test('newly knocked furniture on the player path reports one collision; old and distant bodies do not',()=>{
 const f=new Finale({zone:null}),police=mockPolice();police.onIncident=(...i)=>f.incident(...i);
 const old={x:0,z:0,knocked:true},hit={x:0,z:0,home:{x:0,z:0},knocked:false},other={x:30,z:0,knocked:false};
 const bodies=[old,hit,other],knockables={bodies,snapshot:()=>({knocked:bodies.filter(b=>b.knocked).length})};
 f.step(.01,{x:0,z:5,heading:0,speed:9},{police,knockables});
 hit.knocked=other.knocked=true;
 f.step(.2,{x:0,z:2,heading:0,speed:9},{police,knockables});assert.equal(police.level,2);assert.equal(police.calls.length,1);
 f.step(.2,{x:0,z:-1,heading:0,speed:9},{police,knockables});assert.equal(police.calls.length,1);
 assert.deepEqual([...f.offences.values()],[{text:'Damaged street furniture',count:1}]);
 const hidden={x:0,z:-4,knocked:false};bodies.push(hidden);hidden.knocked=true;
 f.step(.2,{x:0,z:-4,heading:0,speed:9},{police,knockables,started:false});assert.equal(police.calls.length,1,'walking or an inactive game cannot report damage');
});
test('a high wanted incident is recorded before an immediate arrest clears police heat',()=>{
 const f=new Finale({zone:null}),p=mockPolice();p.onIncident=(...i)=>f.incident(...i);
 for(let i=0;i<4;i++){p.time=i;p.report('vehicle',i,9);}assert.equal(p.level,5);
 p.arrestNow();assert.equal(p.level,0);assert.equal(f.arrest({car:centre(),police:p}).raw.maxLevel,5);
 assert.equal(f.summary.kicker,'POLICE');assert.equal(f.snapshot().zone,null);
});
test('offence text uses the real HSL line and destination of the tram that was hit',()=>{
 const data=tramData();
 assert.ok(data.paths.every(p=>/^\d+B?$/.test(p.line)&&p.destination.length>2),'HSL line numbers (10B is the service running through Lasipalatsi on the snapshot date)');
 const world={buildings:{at:()=>undefined},roads:{at:()=>true},pavement:{at:()=>true}};
 const sim=new TramSimulation(data,world,()=>.5);sim.reset(station());
 const dwelling=sim.trams.find(t=>t.wait>0&&Math.hypot(t.x-FINALE_ZONE.x,t.z-FINALE_ZONE.z)<60);
 assert.ok(dwelling,'a tram dwells at a station platform from the start');
 assert.ok(sim.trams.some(t=>t.wait>0&&Math.hypot(t.x+800,t.z+28)<60),'and at a Lasipalatsi platform (both hotspots are active from the station)');
 const h=dwelling.heading,car={x:dwelling.x+Math.sin(h)*6,z:dwelling.z+Math.cos(h)*6,heading:h,speed:0};
 const hit=tramAt(car,sim.trams);assert.equal(hit.id,dwelling.id);
 assert.equal(tramLabel(hit),`tram ${dwelling.path.line} to ${dwelling.path.destination}`);
 assert.match(tramLabel(hit),/^tram \d+ to \S/);assert.equal(tramLabel(null),'a tram');assert.equal(tramLabel({}),'a tram');
 const {f,police}=armed(mockPolice(),centre());
 f.transitImpact(car,kmh(16),sim.trams,police);
 assert.equal(police.calls[0].id,`tram:${dwelling.id}`);assert.ok([...f.offences.values()].some(o=>o.text===`Crashed into tram ${dwelling.path.line} to ${dwelling.path.destination}`));
 assert.ok(sim.guarantee(station(),FINALE_TRIGGERS.presence)>=FINALE_TRIGGERS.presence.min,'the stretch is kept busy');
 // The guarantee works on the hotspot nearest the player, so the Lasipalatsi side is kept busy too.
 // A player on Kaivokatu 80 m east of the Lasipalatsi stops, facing east (away from them, so a dweller may appear behind).
 const west={x:-720,z:-5,heading:-Math.PI/2,speed:0};sim.trams=sim.trams.filter(t=>Math.hypot(t.x+800,t.z+28)>150);
 assert.ok(sim.guarantee(west,FINALE_TRIGGERS.presence)>=1,'a dweller is placed at Lasipalatsi for a player there');
 assert.ok(sim.trams.some(t=>t.wait>0&&Math.hypot(t.x+800,t.z+28)<60));
 assert.equal(sim.nearestHotspot(west).name,'Lasipalatsi');assert.equal(sim.nearestHotspot(station()).name,'Rautatieasema');
});
test('tram spawns never pop into view: dwellers are not placed in front of a player within 120 m, and Continue clears the tram the car is against',()=>{
 const data=tramData(),world={buildings:{at:()=>undefined},roads:{at:()=>true},pavement:{at:()=>true}};
 const sim=new TramSimulation(data,world,()=>.5);
 const stop={x:-621.28,z:-28.02};
 assert.equal(sim.inView({x:-560,z:-25,heading:-Math.PI/2},stop),false,'facing east, the stop 60 m behind is out of view');
 assert.equal(sim.inView({x:-560,z:-25,heading:Math.PI/2},stop),true,'facing west, the stop 60 m ahead is in view');
 assert.equal(sim.inView({x:-400,z:-25,heading:Math.PI/2},stop),false,'beyond 120 m it may appear');
 sim.reset({x:-900,z:400,heading:0,speed:0});sim.trams=[];
 const looking={x:-560,z:-25,heading:Math.PI/2,speed:0};sim.guarantee(looking,{min:3,radius:150});
 assert.ok(sim.trams.every(t=>t.wait===0),'nothing dwells at a platform the player is looking at');
 assert.ok(sim.trams.length>=1&&sim.trams.length<=2,`instead one approaching tram per direction is staged (${sim.trams.length})`);
 assert.ok(sim.trams.every(t=>!sim.inView(looking,t)&&Math.hypot(t.x-stop.x,t.z-stop.z)>80),'staged out of view, well short of the platform');
 const staged=sim.trams.length;sim.guarantee(looking,{min:3,radius:150});assert.equal(sim.trams.length,staged,'a second call stages nothing more while those are still approaching');
 sim.trams=[];
 const away={x:-560,z:-25,heading:-Math.PI/2,speed:0};assert.ok(sim.guarantee(away,{min:3,radius:150})>=1,'a dweller appears behind the player');
 // Continue: the tram the car is nose-on against goes, trams further away stay.
 const t=sim.trams.find(t=>t.wait>0),h=t.heading,nose={x:t.x-Math.sin(h)*(TRAM_NOSE+1.5),z:t.z-Math.cos(h)*(TRAM_NOSE+1.5),heading:h+Math.PI,speed:0};
 sim.add(sim.paths[0],300);const before=sim.trams.length;
 assert.equal(sim.clearAround(nose),1);assert.equal(sim.trams.length,before-1);assert.ok(!sim.trams.includes(t));assert.equal(sim.obstacles.length,sim.trams.length*7);
 assert.equal(sim.clearAround({x:5000,z:5000}),0);
 // Reset never seeds a tram on top of the player, even when the player stands on the stop itself.
 const onStop={x:stop.x,z:stop.z,heading:0,speed:0};sim.reset(onStop);
 assert.ok(sim.trams.every(t=>!sim.bodyNear(t.path,t.s,onStop,8)),'no tram body within 8 m of a player standing at the stop');
 assert.ok(sim.trams.length>=4,'the rest of the stretch is still seeded');
});
test('a car nose-on against a tram can still back away (Continue after the arrest must not deadlock)',()=>{
 const data=tramData();
 const world={buildings:{at:()=>({name:'platform'})},roads:{at:()=>true},pavement:{at:()=>true}}; // every sideways nudge is blocked
 const sim=new TramSimulation(data,world,()=>.5);sim.reset(station());
 const t=sim.trams.find(t=>t.wait>0&&Math.hypot(t.x-FINALE_ZONE.x,t.z-FINALE_ZONE.z)<60),h=t.heading,f=[-Math.sin(h),-Math.cos(h)];
 const nose={x:t.x+f[0]*(TRAM_NOSE+1.5),z:t.z+f[1]*(TRAM_NOSE+1.5)}; // car centre 1.5 m past the nose, facing the tram
 const facing=Math.atan2(f[0],f[1]); // car forward is (-sin h,-cos h) = -f: looking at the tram
 const into={...nose,heading:facing,speed:5,edge:true};sim.step(1/60,into);assert.equal(into.speed,0,'driving into the tram stops the car');
 const stuck={...nose,heading:facing,speed:0,edge:true};sim.step(1/60,stuck);assert.equal(stuck.speed,0);
 const backing={...nose,heading:facing,speed:-3,edge:true};sim.step(1/60,backing);assert.equal(backing.speed,-3,'reversing away keeps its speed');
 const turned={...nose,heading:facing+Math.PI,speed:3,edge:true};sim.step(1/60,turned);assert.equal(turned.speed,3,'driving off forwards after turning around keeps its speed');
 assert.equal(playerLeaving({x:0,z:0,heading:0,speed:0},{x:0,z:-5}),false);
 assert.equal(playerLeaving({x:0,z:0,heading:0,speed:2},{x:0,z:-5}),false,'forward (-z) toward a point at -z');
 assert.equal(playerLeaving({x:0,z:0,heading:0,speed:-2},{x:0,z:-5}),true,'reversing away');
 assert.equal(playerLeaving({x:0,z:0,heading:Math.PI/2,speed:2},{x:0,z:-5}),false,'sliding past sideways is not leaving');
});
test('stats formatting',()=>{
 assert.equal(formatDuration(0),'0 s');assert.equal(formatDuration(59.4),'59 s');assert.equal(formatDuration(61),'1 min 01 s');assert.equal(formatDuration(3725),'1 h 2 min');assert.equal(formatDuration(-3),'0 s');
 assert.equal(formatDistance(999),'999 m');assert.equal(formatDistance(1000),'1.00 km');assert.equal(formatDistance(12345),'12.35 km');assert.equal(formatDistance(0),'0 m');
 const stats=formatStats({distance:2500,elapsed:125,topSpeed:20,damage:.456,maxLevel:4});
 assert.deepEqual(stats.map(s=>s.label),['Distance','Time','Top speed','Damage','Wanted']);
 assert.deepEqual(stats.map(s=>s.value),['2.50 km','2 min 05 s',`${displayedSpeedKmh(20)} km/h`,'46 %','★★★★☆']);
 assert.deepEqual(formatStats({}).map(s=>s.value),['0 m','0 s','0 km/h','0 %','☆☆☆☆☆']);
});
test('run stats accumulate while driving and the arrest summary lists offences, knockables and stats',()=>{
 const police=mockPolice(),f=new Finale(),car={...centre(),speed:20,distance:0,damage:.2};
 const knockables={snapshot:()=>({count:9,knocked:3})};
 for(let i=0;i<120;i++){car.distance+=20/60;f.step(1/60,car,{police,knockables,started:true});}
 assert.ok(Math.abs(f.stats.elapsed-2)<1e-6);assert.equal(f.stats.topSpeed,20);assert.equal(f.stats.knocked,3);assert.ok(f.stats.distance>39);
 f.step(1,car,{police,started:false});assert.ok(Math.abs(f.stats.elapsed-2)<1e-6,'nothing accrues before the drive starts');
 f.transitImpact({...car,x:0,z:5},kmh(40),[tram()],police);f.incident('pedestrian','cyclist-3');f.incident('police','police-0',8,4);f.incident('vehicle','transit');f.incident('vehicle','car-1');
 const summary=f.arrest({car,police:{level:4},knockables});
 assert.equal(f.arrested,true);assert.equal(summary.finale,true);assert.equal(summary.title,'BUSTED');assert.equal(summary.kicker,'POLICE');
 assert.equal(summary.subtitle,'Pursuit over.');assert.doesNotMatch(JSON.stringify(summary),/demo|end of (the )?route|kiitos/i,'no demo-is-over framing anywhere on the card');
 assert.deepEqual(summary.offences,['Crashed into tram 4 to Munkkiniemi','Knocked down a cyclist','Rammed a police car','Crashed into another car','Knocked over 3 bollards, bins and scooters']);
 assert.equal(summary.stats.find(s=>s.label==='Wanted').value,'★★★★☆');assert.equal(summary.stats.find(s=>s.label==='Damage').value,'20 %');
 assert.equal(f.arrest({car,police,knockables}),summary,'arresting twice returns the same summary');
 {const c=new Finale();c.coach=true;c.incident('police','police-0',8,4);c.incident('vehicle','car-1');c.stats.knocked=2;assert.deepEqual(c.arrest({car,police:{level:2}}).offences,['Rammed a police coach','Crashed into another coach','Knocked over 2 things in the street'],'1760 has no cars');}
 assert.match(readFileSync(new URL('../src/main.js',import.meta.url),'utf8'),/finale\.coach=city\.era===1760;.*coach mended/,'the 1760 BUSTED note says coach, not car');
 const west=new Finale();west.arrest({car:{x:-797,z:-15},police:{level:4}});assert.equal(west.summary.kicker,'POLICE','the police label works in any city');
 const plain=new Finale();plain.arrest({car:{...HARBOUR_START},police:{level:1}});
 assert.equal(plain.summary.finale,false);assert.deepEqual(plain.summary.offences,['Failed to stop for the police']);assert.equal(plain.summary.kicker,'POLICE');assert.equal(plain.summary.subtitle,'Pursuit over.');
});
test('cinematic: camera stays behind the stopped car, the end screen fires exactly once, Drive again and Continue clear state',()=>{
 const {f,police,car}=armed();car.heading=1.2;
 f.transitImpact({...car,x:0,z:5},kmh(40),[tram()],police);
 assert.equal(f.cameraPose(car),null,'no cinematic before the arrest');
 f.arrest({car,police});
 let fired=0;for(let i=0;i<60;i++)if(f.cinematicStep(.1))fired++;
 assert.equal(fired,1);assert.equal(f.ended,true);
 const pose=f.cameraPose(car),dx=pose.position[0]-car.x,dz=pose.position[2]-car.z;
 assert.ok(-dx*Math.sin(car.heading)-dz*Math.cos(car.heading)<0,'camera is behind the car, not through the crashed-into front');
 assert.ok(pose.position[1]>3&&Math.hypot(dx,dz)>11);assert.deepEqual(pose.target.map(Math.round),[Math.round(car.x),1,Math.round(car.z)]);
 f.step(1,car,{police,started:true});assert.equal(f.stats.elapsed.toFixed(3),f.stats.elapsed.toFixed(3),'no stats accrue while arrested');
 const elapsed=f.stats.elapsed;f.step(1,car,{police,started:true});assert.equal(f.stats.elapsed,elapsed);
 // Continue (respawn on the spot): same run, offences, contacts and trigger armed again; the zone flag survives.
 f.resume();assert.equal(f.arrested,false);assert.equal(f.cinematic,null);assert.equal(f.cameraPose(car),null);assert.equal(f.triggered,false);assert.equal(f.bigCrashes,0);assert.equal(f.offences.size,0);assert.equal(f.inZone,true);assert.equal(f.contacts.size,0);
 const police2=mockPolice();f.step(1/60,car,{police:police2,started:true});
 f.transitImpact({...car,x:0,z:5},kmh(40),[tram()],police2);assert.equal(police2.level,2,'a new pursuit after Continue starts with the normal collision tier');
 // Restart: a full reset.
 f.arrest({car,police:police2});f.reset();
 assert.deepEqual(f.snapshot(),{zone:'Rautatientori',inZone:false,triggered:false,bigCrashes:0,tramHits:0,arrested:false,ended:false,offences:[],stats:{elapsed:0,distance:0,topSpeed:0,damage:0,maxLevel:0,knocked:0}});
 assert.equal(f.summary,null);assert.equal(f.cinematic,null);assert.equal(f.time,0);assert.equal(f.contacts.size,0);
 assert.equal(f.takeMessage,undefined,'no entry cue: nothing in the HUD announces the zone or the trams');f.step(1/60,centre(),{started:true});assert.equal(f.inZone,true);
});
test('end screen DOM is filled from the summary as text, never markup',()=>{
 const nodes={};const make=(id,tag='div')=>nodes[id]={id,tag,textContent:'',children:[],classes:new Set(),replaceChildren(...c){this.children=c;},append(...c){this.children.push(...c);},classList:{toggle(name,on){on?nodes[id].classes.add(name):nodes[id].classes.delete(name);}}};
 for(const id of ['busted-overlay','busted-kicker','busted-title','busted-subtitle','busted-offences','busted-stats'])make(id);
 const doc={getElementById:id=>nodes[id],createElement:tag=>({tag,textContent:'',children:[],append(...c){this.children.push(...c);}})};
 const f=new Finale();f.offence('x','<b>Crashed into tram 4 to Munkkiniemi</b>');const summary=f.arrest({car:{...centre()},police:{level:4}});
 renderEndScreen(doc,summary);
 assert.equal(nodes['busted-kicker'].textContent,'POLICE');assert.equal(nodes['busted-title'].textContent,'BUSTED');assert.equal(nodes['busted-subtitle'].textContent,'Pursuit over.');
 assert.deepEqual(nodes['busted-offences'].children.map(li=>[li.tag,li.textContent]),[['li','<b>Crashed into tram 4 to Munkkiniemi</b>']]);
 assert.equal(nodes['busted-stats'].children.length,5);assert.deepEqual(nodes['busted-stats'].children[0].children.map(c=>c.tag),['strong','span']);
 assert.equal(nodes['busted-overlay'].classes.has('finale'),false);
 renderEndScreen(doc,{...summary,finale:true});assert.equal(nodes['busted-overlay'].classes.has('finale'),true);
 assert.doesNotThrow(()=>renderEndScreen({getElementById:()=>null},summary));
});

// Police: high wanted levels strengthen pursuit everywhere; normal response and arrest geometry stay intact.
const world={roads:{at:()=>true},buildings:{at:()=>false}};
const graph=()=>prepareGraph({nodes:[[0,100],[0,0],[0,-100],[0,-200]],edges:[{from:0,to:1,lane:0,points:[[0,100],[0,0]]},{from:1,to:2,lane:0,points:[[0,0],[0,-100]]},{from:2,to:3,lane:0,points:[[0,0],[0,-100]]}]});
test('police: stronger response follows four or five stars without any location trigger',()=>{
 const p=new PoliceSimulation(graph(),world),car={x:0,z:-25,heading:0,speed:0};
 p.setPressure(true);p.step(1/30,car);assert.equal(p.level,0);assert.equal(p.surging,false,'being in a former hot zone is harmless');
 p.report('vehicle',1,9);assert.equal(p.surging,false);assert.equal(p.bustTime,BUST_TIME);
 p.escalate({level:4,message:'hit'});p.setPressure(false);assert.equal(p.surging,true,'leaving the old zone does not end a serious pursuit');
 assert.equal(p.bustTime,SURGE.bustTime);assert.equal(p.message,'hit');assert.equal(p.heat,heatForLevel(4));
 p.escalate({level:5});p.escalate({level:4});assert.equal(p.level,5);
 p.busted=true;assert.equal(p.escalate({level:5}),false);
 p.reset();assert.equal(p.surging,false);assert.equal(p.level,0);assert.equal(p.recentIncidents.length,0);
});
test('police: platform furniture is no cover under the surge, but ordinary pursuit sight is unchanged',()=>{
 // A tram platform (street furniture in world.buildings) between the lane and the track; no mapped building anywhere.
 const furnished={roads:{at:()=>true},buildings:{at:(x,z)=>z>0&&z<4?{name:'Lasipalatsi tram platform',rings:[]}:undefined},sightBuildings:{at:()=>undefined}};
 const p=new PoliceSimulation(graph(),furnished),car={x:0,z:-6,heading:0,speed:0},unit={id:'u',edge:p.graph.edges[0],s:60,x:0,z:12,heading:0,speed:0,stuck:0};
 p.report('vehicle',1,9);assert.equal(p.clearSight(unit,car),false,'ordinary pursuit: the obstacle index blocks the view as before');
 p.setPressure(true);p.escalate({level:4});assert.equal(p.surging,true);
 assert.equal(p.clearSight(unit,car),true);assert.equal(p.canSee(unit,car),true);
 p.units=[unit];p.dispatch=1e9;let arrestedAt=0;for(let i=1;i<8*30&&!p.busted;i++){p.step(1/30,car);arrestedAt=i/30;}
 assert.equal(p.busted,true,'arrested from the lane beside the platform');assert.ok(arrestedAt<6,`arrest took ${arrestedAt}s`);
 const walled=new PoliceSimulation(graph(),{...furnished,sightBuildings:{at:(x,z)=>z>0&&z<4}});walled.setPressure(true);walled.escalate({level:4});
 assert.equal(walled.clearSight(unit,car),false,'a real building still blocks the surge view');
 const plain=new PoliceSimulation(graph(),{roads:{at:()=>true},buildings:{at:(x,z)=>z>0&&z<4}});plain.setPressure(true);plain.escalate({level:4});
 assert.equal(plain.clearSight(unit,car),false,'without a sight index the obstacle index is used');
});
test('police: under the surge a unit holds where it first has the stopped player in range; ordinary units still close in',()=>{
 // A unit arriving at town speed from 35 m; the lane target is 5 m short of the car.
 const car={x:0,z:-25,heading:0,speed:0},unit=p=>({id:'u',role:'chase',edge:p.graph.edges[0],s:90,x:0,z:10,heading:0,speed:9,stuck:0});
 const surge=new PoliceSimulation(graph(),world);surge.setPressure(true);surge.escalate({level:4});surge.units=[unit(surge)];surge.dispatch=1e9;
 let t=0;while(!surge.busted&&t<20){surge.step(1/30,car);t+=1/30;}
 const held=Math.hypot(surge.units[0].x-car.x,surge.units[0].z-car.z);
 assert.equal(surge.busted,true);assert.ok(t<SURGE.bustTime+3,`arrested after ${t.toFixed(1)}s`);
 assert.ok(held>=8&&held<=SURGE.arrestRange,`crept to ${held.toFixed(1)} m, inside the ${SURGE.arrestRange} m range, without ramming the car`);
 const plain=new PoliceSimulation(graph(),world);plain.report('vehicle',1,9);plain.units=[unit(plain)];plain.dispatch=1e9;
 t=0;while(!plain.busted&&t<20){plain.step(1/30,car);t+=1/30;}
 assert.equal(plain.busted,true);assert.ok(Math.hypot(plain.units[0].x-car.x,plain.units[0].z-car.z)<10,'ordinary pursuit closes to the 10 m arrest range as before');
});
test('police: the surge expires on its own and arrests a stopped car within range',()=>{
 const p=new PoliceSimulation(graph(),world),car={x:0,z:-25,heading:0,speed:0};
 p.setPressure(true);p.escalate({level:4});p.step(1/30,car);assert.equal(p.surging,true);assert.equal(p.snapshot().surging,true);
 assert.ok(p.units.length>=1,'a unit is dispatched at once');
 assert.deepEqual(SURGE.spawn,[60,110]);for(const u of p.units){const d=Math.hypot(u.x-car.x,u.z-car.z);assert.ok(d>=60&&d<=110,`surge unit spawned ${d.toFixed(0)} m away`);}
 let busted=0;for(let i=1;i<60*30&&!p.busted;i++){p.step(1/30,car);busted=i/30;}
 assert.equal(p.busted,true);assert.ok(busted<30,`arrested in ${busted}s`);assert.equal(p.snapshot().status,'BUSTED');
 const q=new PoliceSimulation(graph(),world);q.setPressure(true);q.escalate({level:4});q.dispatch=1e9;q.backupAt=Infinity;q.sighted=true; // no units at all: does the surge itself keep the level up?
 for(let i=0;i<(SURGE.duration-1)*30;i++)q.step(1/30,car);assert.equal(q.surging,true);assert.equal(q.level,4,'under the surge the unseen player is not let go after the ordinary 30 s');
 for(let i=0;i<2*30;i++)q.step(1/30,car);assert.equal(q.surging,false,'surge rules lapse after SURGE.duration');
 assert.equal(q.level,0,'then the ordinary escape rule applies and clears the level');assert.match(q.message,/Escaped/);
});
test('police: a unit at the car arrests a stopped or crawling player within a second, in any pursuit, even boxed in by traffic',()=>{
 assert.deepEqual(CONTACT_BUST,{range:7,speed:8/3.6,time:1});
 // Units boxed in: nothing fits the road, so no unit moves; a wall across z −21…−17 hides a unit off the nose from the car at z −16.
 const walled={roads:{at:()=>false},buildings:{at:(x,z)=>z>-21&&z<-17}};
 const arrest=(unit,speed,surge=false)=>{const p=new PoliceSimulation(graph(),walled);if(surge){p.setPressure(true);p.escalate({level:4});}else p.report('vehicle',1,9);
  p.units=[{id:'u',role:'chase',edge:p.graph.edges[1],s:16,heading:0,speed:0,stuck:0,...unit}];p.dispatch=1e9;p.backupAt=Infinity;const car={x:0,z:-16,heading:0,speed};
  let t=0;while(!p.busted&&t<10){p.step(1/60,car);t+=1/60;}return {busted:p.busted,t:+t.toFixed(2),level:p.level,moved:Math.hypot(p.units[0].x-unit.x,p.units[0].z-unit.z)};};
 const beside=arrest({x:2.5,z:-16},0);assert.equal(beside.busted,true);assert.ok(beside.t>=.95&&beside.t<=1.1,`stopped, unit alongside 2.5 m away: busted after ${beside.t}s`);assert.equal(beside.moved,0,'the boxed-in unit never moved');
 const nose=arrest({x:0,z:-21.5},1.5);assert.equal(nose.busted,true);assert.ok(nose.t<=1.1,`crawling at 5 km/h, unit 5.5 m off the nose, behind a wall: ${nose.t}s`);
 const behind=arrest({x:0,z:-9.5},0,true);assert.equal(behind.busted,true);assert.ok(behind.t<=1.1,`surge, unit 6.5 m behind: ${behind.t}s`);
 const far=arrest({x:0,z:-24},0);assert.equal(far.busted,false,'8 m away behind a wall is not at the car; the ordinary rules apply');
 const moving=arrest({x:2.5,z:-16},3);assert.equal(moving.busted,false,'a player still driving at 11 km/h is not arrested by contact');
 assert.equal(arrest({x:2.5,z:-16},0).level,0,'the arrest clears the heat');
 // Contact must be continuous: pulling away resets the one-second count.
 const p=new PoliceSimulation(graph(),walled);p.report('vehicle',1,9);p.units=[{id:'u',role:'chase',edge:p.graph.edges[1],s:16,x:2.5,z:-16,heading:0,speed:0,stuck:0}];p.dispatch=1e9;
 const car={x:0,z:-16,heading:0,speed:0};for(let i=0;i<30;i++)p.step(1/60,car);assert.ok(p.contact>.45&&!p.busted);car.speed=4;p.step(1/60,car);assert.equal(p.contact,0);
 assert.ok(p.snapshot().bustProgress<=1);
});
test('police: surge backup – when the first wave is boxed in, one unit pulls up close and out of view and the arrest follows within seconds',()=>{
 // Units can only spawn on the far edge (cost field reaches it) but the road to the car is blocked for 8 s.
 const p=new PoliceSimulation(graph(),world),car={x:0,z:-25,heading:0,speed:0};
 p.setPressure(true);p.escalate({level:4});p.dispatch=1e9;
 for(let i=0;i<SURGE.backupAfter*30-2;i++)p.step(1/30,car);assert.equal(p.units.length,0,'nothing before backupAfter');
 let t=(SURGE.backupAfter*30-2)/30;while(!p.units.length&&t<4){p.step(1/30,car);t+=1/30;}
 assert.equal(p.units.length,1,'one backup unit');const u=p.units[0];assert.equal(u.backup,true);
 const d=Math.hypot(u.x-car.x,u.z-car.z),ahead=-(u.x-car.x)*Math.sin(car.heading)-(u.z-car.z)*Math.cos(car.heading);
 assert.ok(d>=SURGE.backupSpawn[0]&&d<=SURGE.backupSpawn[1],`backup ${d.toFixed(0)} m away`);assert.ok(ahead<0,'behind the player, out of view');
 while(!p.busted&&t<12){p.step(1/30,car);t+=1/30;}
 assert.equal(p.busted,true);assert.ok(t<SURGE.backupAfter+SURGE.bustTime+2.5,`arrested ${t.toFixed(1)}s after the car stopped`);
 assert.ok(p.units.length<=2,'no second backup while the first is there');
 const plain=new PoliceSimulation(graph(),world);plain.report('vehicle',1,9);plain.dispatch=1e9;
 for(let i=0;i<10*30;i++)plain.step(1/30,car);assert.equal(plain.units.length,0,'no backup outside the surge');
});
