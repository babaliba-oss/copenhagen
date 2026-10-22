import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {SpatialIndex,pointInPolygon,RADIUS} from '../src/geo.js';
import {makeCar,driveStep,carSamples,simulationSteps,PLAYER_MAX_SPEED,displayedSpeedKmh} from '../src/physics.js';
const rect=(x,z,w,h)=>({rings:[[[x,z],[x+w,z],[x+w,z+h],[x,z+h],[x,z]]],kind:'Ajorata'});
const empty=new SpatialIndex([]);
const world=(buildings=[],water=[],roads=[rect(-2500,-2500,5000,5000)])=>({buildings:new SpatialIndex(buildings),roads:new SpatialIndex(roads),pavement:empty,water});
test('top speed covers the same real-time distance at 10, 20 and 60 FPS',()=>{
 for(const fps of [10,20,60]){const car=makeCar(0,0);car.speed=PLAYER_MAX_SPEED;
  for(let i=0;i<fps*5;i++)for(const dt of simulationSteps(1/fps))driveStep(car,new Set(['KeyW']),dt,world());
  assert.ok(Math.abs(car.distance-PLAYER_MAX_SPEED*5)<.001,`${fps} FPS: ${car.distance}`);
 }
 assert.ok(simulationSteps(20).reduce((a,b)=>a+b,0)<=.251,'suspended-tab catch-up is bounded');
});
test('strong brakes stop from top speed promptly and Space overrides throttle',()=>{
 for(const keys of [new Set(['Space','KeyW']),new Set(['KeyS'])]){const car=makeCar(0,0);car.speed=PLAYER_MAX_SPEED;
  let t=0;while(car.speed>.5&&t<3){driveStep(car,keys,1/120,world());t+=1/120;}
  assert.ok(t<1.6);assert.ok(car.distance<31);
 }
});
test('launch boost improves initial pickup without changing reverse',()=>{
 const car=makeCar(0,0);for(let i=0;i<60;i++)driveStep(car,new Set(['KeyW']),1/60,world());
 assert.ok(car.speed*3.6>32&&car.speed*3.6<35);
 const reverse=makeCar(0,0);for(let i=0;i<60;i++)driveStep(reverse,new Set(['KeyS']),1/60,world());
 assert.ok(reverse.speed<0&&reverse.speed>-4.3);
});
test('arcade readout is lower without falsifying simulation distance; acceleration tapers at speed',()=>{
 assert.equal(displayedSpeedKmh(100/3.6),70);assert.equal(displayedSpeedKmh(-10/3.6),7);
 const car=makeCar(0,0);for(let i=0;i<600;i++)driveStep(car,new Set(['KeyW']),1/60,world());
 assert.ok(car.speed<PLAYER_MAX_SPEED-.5,'not pegged at the maximum after ten seconds');
 const before=car.speed;for(let i=0;i<60;i++)driveStep(car,new Set(),1/60,world());assert.ok(car.speed<before,'releasing throttle permits lower cruising speeds');
});
test('courtyard holes remain empty while surrounding building walls collide',()=>{
 const p=rect(-20,-20,40,40);p.rings.push([[-10,-10],[10,-10],[10,10],[-10,10],[-10,-10]]);
 assert.equal(pointInPolygon(0,0,p.rings),false);assert.equal(pointInPolygon(15,0,p.rings),true);
 const car=makeCar(0,0);for(let i=0;i<120;i++)driveStep(car,new Set(['KeyW']),1/60,world([p]));
 assert(car.z>-10);assert.equal(carSamples(car).some(([x,z])=>pointInPolygon(x,z,p.rings)),false);
});
test('fast movement cannot tunnel through a thin building',()=>{
 const w=world([rect(-10,-7,20,1)]),car=makeCar(0,0);car.speed=30;
 const result=driveStep(car,new Set(['KeyW']),.5,w);assert.equal(result.collision,'building');assert.equal(car.speed,0);assert(car.z>-7);
});
test('pre-existing railing overlap allows reversing and sliding away, but not deeper penetration',()=>{
 const w=world([rect(-3,-2.4,6,.2)]),car=makeCar(0,0);
 for(let i=0;i<60;i++)driveStep(car,new Set(['KeyS']),1/60,w);
 assert.ok(car.z>1&&car.speed< -2);
 const blocked=makeCar(0,0);assert.equal(driveStep(blocked,new Set(['KeyW']),1/60,w).collision,'building');
 const side=world([rect(.95,-20,.2,40)]),parallel=makeCar(0,0);
 for(let i=0;i<60;i++)driveStep(parallel,new Set(['KeyS']),1/60,side);
 assert.ok(parallel.z>1,'can slide alongside a grazing railing');
});
test('water blocks driving but mapped bridges are driveable',()=>{
 const water=[rect(-20,-100,40,97)];let car=makeCar(0,0);car.speed=20;
 const blocked=driveStep(car,new Set(['KeyW']),.2,world([],water,[]));assert.equal(blocked.collision,'water');
 car=makeCar(0,0);car.speed=20;const bridge=driveStep(car,new Set(['KeyW']),.2,world([],water,[rect(-3,-100,6,110)]));assert.equal(bridge.collision,null);assert(car.z<-3);
});
test('two-kilometre boundary blocks exit',()=>{const car=makeCar(0,-RADIUS+5);car.speed=30;const result=driveStep(car,new Set(['KeyW']),.2,world());assert.equal(result.collision,'boundary');assert(Math.hypot(car.x,car.z)<RADIUS);});
test('car collision samples rotate with the rendered car',()=>{const car=makeCar(0,0,Math.PI/2);const front=carSamples(car)[5];assert(front[0]<-2);assert(Math.abs(front[1])<1e-8);});
test('handbrake stops a moving car and reverse works',()=>{const car=makeCar(0,0);car.speed=15;for(let i=0;i<80;i++)driveStep(car,new Set(['Space']),1/60,world());assert.equal(car.speed,0);for(let i=0;i<60;i++)driveStep(car,new Set(['KeyS']),1/60,world());assert(car.speed<0);});
test('all bundled meshes exist and every actual landmark spawns clear of buildings and water',()=>{
 const data=JSON.parse(gunzipSync(readFileSync('public/data/city.pack'))),bs=new SpatialIndex(data.buildings),roads=new SpatialIndex(data.roads),pavement=new SpatialIndex(data.pavement);
 for(const l of data.landmarks){assert(Math.hypot(l.x,l.z)<RADIUS,l.name);assert(roads.at(l.x,l.z),l.name);for(const [x,z] of carSamples(makeCar(l.x,l.z,-Math.PI/2+.17))){assert(!bs.at(x,z),`${l.name}: blocked spawn`);assert(roads.at(x,z)||pavement.at(x,z)||!data.water.some(w=>pointInPolygon(x,z,w.rings)),`${l.name}: in water`);}}
 const index=JSON.parse(readFileSync('public/data/roof-index.json'));assert(index.buildings>5000);assert(data.buildings.length>5000);
 for(const t of index.tiles)assert(existsSync(`public/data/${t.file}.pack`),t.file);
 const cathedral=data.buildings.find(b=>b.ratu===211),model=index.registry.find(r=>r.ratu===211);
 assert(cathedral&&model,'cathedral exists in both official datasets');
 for(let i=0;i<4;i++)assert(Math.abs(cathedral.bbox[i]-model.bbox[i])<.1,'cathedral roof and footprint agree to 10 cm');
});
test('real aerial tiles cover the complete playable area and are valid JPEG assets',()=>{
 const index=JSON.parse(readFileSync('public/data/aerial-index.json'));
 assert.equal(index.year,2025);assert.equal(index.tiles.length,64);
 for(const t of index.tiles){const bytes=readFileSync(`public/data/${t.file}`);assert.equal(bytes[0],255);assert.equal(bytes[1],216);}
 for(let x=-2000;x<=2000;x+=250)for(let z=-2000;z<=2000;z+=250)assert(index.tiles.some(t=>x>=t.x&&x<=t.x+t.size&&z>=t.z&&z<=t.z+t.size),'photographic coverage');
});
test('reverse can launch from rest on pavement at 30, 60 and 120 Hz',()=>{
 for(const hz of [30,60,120]){
  const car=makeCar(0,0,0),world={roads:{at:()=>false},pavement:{at:()=>true},buildings:{at:()=>false},water:[]};
  for(let frame=0;frame<hz*2;frame++)driveStep(car,new Set(['KeyS']),1/hz,world);
  assert.ok(car.z>3,`reverse launch at ${hz} Hz: ${car.z}`);
  assert.ok(car.speed< -3);
 }
});

test('steering turns the car: keys left/right, and analog tilt (keys win over tilt)',()=>{
 const run=(keys,tilt)=>{const car=makeCar(0,0),k=new Set(['KeyW',...keys]);if(tilt!=null)k.tilt=tilt;for(let i=0;i<120;i++)driveStep(car,k,1/60,world());return car.heading;};
 const straight=run([]),left=run(['ArrowLeft']),right=run(['ArrowRight']),tiltLeft=run([],.6),tiltFull=run([],1);
 assert.equal(straight,0);assert.ok(left>.05&&right<-.05,'arrow keys steer both ways');
 assert.ok(tiltLeft>0&&tiltLeft<tiltFull,'tilt steers in proportion');assert.ok(Math.abs(run(['ArrowRight'],1)-right)<1e-9,'a held key overrides tilt');
});
test('phone steering buttons: a short tap is a small correction, a hold builds up; the keyboard is unchanged',()=>{
 const tap=(ms,gentle)=>{const car=makeCar(0,0),k=new Set(['KeyW','ArrowLeft']);k.gentle=gentle;car.speed=50/3.6;let peak=0;for(let t=0;t<2;t+=1/60){if(t>=ms/1000)k.delete('ArrowLeft');driveStep(car,k,1/60,world());peak=Math.max(peak,car.steer);}return peak;};
 assert.ok(tap(100,true)<.25,`100 ms tap: ${tap(100,true)}`);assert.ok(tap(1500,true)>.5,'a held button still turns hard');assert.ok(tap(100,false)>.6,'keyboard steers in as before');
});
test('a car brushing a wall at a shallow angle slides along it instead of sticking',()=>{
 // a long wall along x = 3.2..4, the car heading 15 degrees into it (towards -z, drifting +x)
 const w=world([rect(3.2,-200,.8,200)]),car=makeCar(1.2,0,-.26);car.speed=12;
 for(let i=0;i<120;i++)driveStep(car,new Set(['KeyW']),1/60,w);
 assert.ok(car.z<-12,`it kept going along the wall (z ${car.z.toFixed(1)})`);assert.ok(car.speed>5,`and kept most of its speed (${car.speed.toFixed(1)})`);
 assert.ok(carSamples(car).every(([x])=>x<3.2),'never inside the wall');
});
test('into a wall: slides off below about 35 degrees, stops (a crash) above it, at any speed, never inside',()=>{
 const wall=rect(5,-400,.8,800),w=world([wall]); // a wall along x = 5..5.8
 for(const kmh of [30,60,140])for(const deg of [10,20,30,45,60,75,89]){
  const a=deg*Math.PI/180,car=makeCar(2.6,0,-a);car.speed=kmh/3.6; // heading 0 drives to -z; -a turns it towards +x, into the wall
  let hit=null,scrape=0;for(let i=0;i<90&&!hit;i++){const r=driveStep(car,new Set(['KeyW']),1/60,w);hit=r.collision;scrape=Math.max(scrape,r.scrape||0);}
  assert.ok(carSamples(car).every(([x])=>x<5),`${kmh} km/h at ${deg} degrees: never inside`);
  if(deg<=30)assert.equal(hit,null,`${kmh} km/h at ${deg} degrees slides`);
  else assert.equal(hit,'building',`${kmh} km/h at ${deg} degrees is a crash`);
  if(deg<=30&&kmh>=60)assert.ok(scrape>=2,`${kmh} km/h at ${deg} degrees reports the scrape (${scrape.toFixed(1)} m/s)`);
 }
});
test('a slide never hops a thin wall',()=>{
 const w=world([rect(5,-400,.1,800)]);let through=0;
 for(const kmh of [30,60,100,140])for(let deg=0;deg<90;deg+=3){const a=deg*Math.PI/180,car=makeCar(2.6,0,-a);car.speed=kmh/3.6;
  for(let i=0;i<120;i++)driveStep(car,new Set(['KeyW']),1/60,w);if(carSamples(car).some(([x])=>x>5.1))through++;}
 assert.equal(through,0);
});
