import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareGraph} from '../src/mobility.js';
import {createCineDrive,placeOnRoads,rigPose} from '../src/cine-drive.js';
import {pickShots,SHOTS} from '../src/cinematic.js';

// A plus-shaped junction: a road west-east through (0,0) and one north-south, both ways.
function cross(){
 const nodes=[[-100,0],[0,0],[100,0],[0,-100],[0,100]],edges=[];
 const two=(a,b)=>{edges.push({from:a,to:b,points:[nodes[a],nodes[b]],lane:1.6});edges.push({from:b,to:a,points:[nodes[b],nodes[a]],lane:1.6});};
 two(0,1);two(1,2);two(3,1);two(1,4);
 return prepareGraph({nodes,edges});
}

test('the hero car starts on the lane heading towards its target and keeps the right-hand lane',()=>{
 const roads=cross(),p=placeOnRoads(roads,[-60,0],[100,0]);
 assert.equal(p.edge.from,0);assert.equal(p.edge.to,1); // eastbound, not the westbound lane at the same spot
 const d=createCineDrive(roads,{from:[-60,0],toward:[100,0],speed:10}),q=d.pose();
 assert.ok(Math.abs(q.x+60)<1e-6);assert.ok(q.z>1,'right of an eastbound road is south (+z)');
 assert.ok(Math.abs(Math.sin(q.heading)+1)<1e-6,'facing east: forward (-sin h, -cos h) = (1, 0)');
});

test('it drives on through the junction towards the target, at its speed on the straight',()=>{
 const roads=cross(),d=createCineDrive(roads,{from:[-60,0],toward:[100,0],speed:10});
 for(let i=0;i<90;i++)d.step(1/30);
 const p=d.pose();assert.ok(Math.abs(p.x+30)<.5,`x ${p.x}`);
 for(let i=0;i<180;i++)d.step(1/30);
 assert.ok(d.pose().x>20,'carried straight on east');assert.ok(Math.abs(d.pose().z-1.6)<.01);
});

test('it turns at a junction when the target lies down the side road, slowing for the corner',()=>{
 const roads=cross(),d=createCineDrive(roads,{from:[-60,0],toward:[0,100],speed:12});let slowest=12;
 for(let i=0;i<300;i++){d.step(1/30);slowest=Math.min(slowest,d.speed);}
 const p=d.pose();assert.ok(p.z>30,`went south down the side road: ${p.x},${p.z}`);assert.ok(slowest<9,`slowed to ${slowest}`);
});

test('camera rigs sit where their names say',()=>{
 const car={x:0,z:0,heading:0}; // facing -z
 assert.ok(rigPose('chase',car).eye[2]>5,'chase: behind (+z)');
 assert.ok(rigPose('front',car).eye[2]<-5,'front: ahead (-z)');
 assert.ok(rigPose('heli',car).eye[1]>15,'heli: high');
 assert.ok(Math.abs(rigPose('side',car,0,{side:1}).eye[0]-6.5)<1e-6,'side: to the right (+x)');
});

test('each era gets its own shots, and ?shots= picks some by name or index',()=>{
 const today=pickShots(null),old=pickShots(1760);
 assert.ok(today.some(s=>s.name==='H.C. Andersen'));assert.ok(!old.some(s=>/Andersen/.test(s.name)),'no Andersen in 1760: he was born in 1805');
 assert.ok(!old.some(s=>s.season||s.hud==='radio'),'no radio or Christmas lights in 1760');assert.ok(today.some(s=>s.season==='christmas')&&today.some(s=>s.hud==='radio'));
 assert.equal(old.find(s=>s.hud==='quest').saga,'eye');assert.equal(today.find(s=>s.hud==='quest').saga,'hca');
 assert.ok(!SHOTS.some(s=>/Ramparts|Gorm/.test(s.name)),'the cannon shots are gone');
 assert.deepEqual(pickShots(null,'?cinematic&shots=nyhavn%20b,radio').map(s=>s.name),['Nyhavn bumper','Radio']);
 assert.deepEqual(pickShots(1760,'?shots=0%2C1').map(s=>s.name),[old[0].name,old[1].name],'the page writes the comma as %2C');
 assert.ok(SHOTS.filter(s=>s.drive).length>=8,'mostly driving shots');
 assert.ok(today.findIndex(s=>s.season==='christmas')>today.findIndex(s=>s.name==='The city from above'),'Christmas comes last: the snow stays');
});

test('only the seasonal shots carry a season: the others switch the date\'s decorations off',async()=>{
 const {createCinematic}=await import('../src/cinematic.js');
 const el=()=>({style:{},classList:{add(){},remove(){}},append(){}}),doc={createElement:el,head:el(),body:el()},calls=[];
 const still={eye:[[0,2,0],[1,2,0]],target:[[9,1,0],[9,1,1]],dur:1};
 const c=createCinematic({doc,ground:()=>0,teleport(){},setCamera(){},loaded:()=>true,wait:[0,0],setSeason:n=>calls.push(n),
  shots:[{name:'a',...still},{name:'b',season:'halloween',...still},{name:'c',...still}]});
 c.start();for(let k=0;k<200&&c.phase!=='done';k++)c.update(.05);
 assert.deepEqual(calls,[null,'halloween',null]);
});

test('the camera stays out of houses: it stops short of a wall between it and the subject, with room around the lens',async()=>{
 const {clearEye}=await import('../src/cinematic.js');
 const wall=(x,z,y)=>x>=5&&x<=8&&y<20; // a house from x=5 to 8
 const e=clearEye([10,2,0],[0,1,0],wall);assert.ok(e[0]<5-.9&&e[0]>2,`pulled in before the wall: ${e[0].toFixed(2)}`);
 const free=clearEye([4,2,0],[0,1,0],()=>false);assert.deepEqual(free,[4,2,0],'nothing in the way: unchanged');
 const over=clearEye([10,60,0],[0,1,0],wall);assert.ok(over[0]>9,'high above the roof the view is clear');
});

test('the hero car follows a slower car ahead in its lane instead of driving through it',async()=>{
 const {leadCar}=await import('../src/cine-drive.js');
 const roads=cross(),d=createCineDrive(roads,{from:[-90,0],toward:[100,0],speed:14});
 const slow={x:-60,z:1.6,heading:d.pose().heading,speed:5,edge:{}};
 for(let i=0;i<150;i++){slow.x+=slow.speed/30;d.step(1/30,[slow]);}
 const gap=slow.x-d.pose().x;assert.ok(gap>6,`kept back: gap ${gap.toFixed(1)} m`);assert.ok(Math.abs(d.speed-5)<1.5,`matched its speed: ${d.speed.toFixed(1)}`);
 assert.equal(leadCar(d.pose(),[{x:d.pose().x+20,z:-1.6,heading:d.pose().heading+Math.PI,speed:9,edge:{}}]),null,'oncoming traffic in the other lane is not a lead');
});
