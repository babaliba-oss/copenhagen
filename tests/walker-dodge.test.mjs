import test from 'node:test';import assert from 'node:assert/strict';
import {Mobility} from '../src/mobility.js';
// Two walkers meeting head on, each 20 cm right of the path's line: the lower id used to walk on through the other while it
// waited (people merging into each other on the 1760 riding ground). In view, both step aside, keeping right.
function meeting(){
 const n=[[-20,0],[20,0],[0,-20],[0,20]],e=(a,b)=>({from:a,to:b,points:[n[a],n[b]],lane:0,signal:-1,crossing:false});
 const sim=new Mobility({roads:{nodes:[],edges:[]},walks:{nodes:n,edges:[e(0,1),e(1,0),e(2,3),e(3,2)]},signals:[]},{roads:{at:()=>false},pavement:{at:()=>true},buildings:{at:()=>false}},{cars:0,people:2});
 const [a,b]=sim.people;Object.assign(a,{edge:sim.walks.edges[0],s:14,cruise:1.2,side:.2});Object.assign(b,{edge:sim.walks.edges[1],s:14,cruise:1.2,side:.2});
 for(const p of [a,b])Object.assign(p,sim.position(p),{speed:1.2});
 return [sim,a,b];
}
test('walkers meeting head on in view step round each other',()=>{
 const [sim,a,b]=meeting(),player={x:30,z:30,heading:0,speed:0,travelMode:'walk'};let min=Infinity;
 for(let i=0;i<60*12;i++){sim.step(1/60,player);if(a.edge&&b.edge)min=Math.min(min,Math.hypot(a.x-b.x,a.z-b.z));}
 assert.ok(min>.5,`closest ${min.toFixed(2)} m`);assert.ok(a.x>5&&b.x<-5,'both walked on past each other');
});
// A footway mapped down the carriageway with a stub of pavement at one end (a spur to a doorway, 510,-303 today): walkers
// spawned on the stub could never leave it, turned at the kerb every few seconds and stood in one another there.
test('walkers are not spawned on a stub of pavement they could not walk off',()=>{
 const n=[[-40,0],[40,0],[1,4],[1,14]],e=(a,b)=>({from:a,to:b,points:[n[a],n[b]],lane:0,signal:-1,crossing:false});
 const pave=(x,z)=>z<2||z>=12&&x>=0&&x<=2;
 const sim=new Mobility({roads:{nodes:[],edges:[]},walks:{nodes:n,edges:[e(0,1),e(1,0),e(2,3),e(3,2)]},signals:[]},{roads:{at:(x,z)=>!pave(x,z)},pavement:{at:pave},buildings:{at:()=>false}},{cars:0,people:14,random:(s=>()=>(s=s*16807%2147483647)/2147483647)(7)});
 sim.reset({x:0,z:-30,heading:0,speed:0});
 const placed=sim.people.filter(a=>a.edge);assert.ok(placed.length>=10,`${placed.length} placed`);
 assert.equal(placed.filter(a=>a.edge.from>=2).length,0,'none on the stub');
});
// A footway running on into the carriageway (no crossing) ends at the kerb: walkers turn there promptly and walk back,
// rather than standing 3 s each while those behind queue into them.
test('walkers reaching a kerb turn back and do not stand in one another there',()=>{
 const n=[[-30,0],[10,10]],e=(a,b)=>({from:a,to:b,points:[n[a],n[b]],lane:0,signal:-1,crossing:false});
 const pave=(x,z)=>x+z<0; /* a diagonal kerb across the path */
 const sim=new Mobility({roads:{nodes:[],edges:[]},walks:{nodes:n,edges:[e(0,1),e(1,0)]},signals:[]},{roads:{at:(x,z)=>!pave(x,z)},pavement:{at:pave},buildings:{at:()=>false}},{cars:0,people:3});
 sim.people.forEach((a,i)=>{Object.assign(a,{edge:sim.walks.edges[0],s:14-i*1.6,cruise:1.3,side:.25});Object.assign(a,sim.position(a),{speed:1.3});});
 const player={x:-20,z:20,heading:0,speed:0,travelMode:'walk'};let close=0;
 for(let i=0;i<60*20;i++){sim.step(1/60,player);const P=sim.people;for(let p=0;p<3;p++)for(let q=p+1;q<3;q++)if(Math.hypot(P[p].x-P[q].x,P[p].z-P[q].z)<.5)close+=1/60;}
 for(const a of sim.people)assert.ok(a.x<-12,`walked back from the kerb (x ${a.x.toFixed(1)})`);
 assert.ok(close<1.5,`${close.toFixed(1)} pair-seconds within 50 cm`);
});
// Your car standing on the footway: walkers coming to it stood in front of it for good, everyone behind them queued
// (seven stood over 20 s at -90,360). They wait a moment and turn back, as at a dead end.
test('walkers held up by the player\'s standing car turn back',()=>{
 const n=[[-30,0],[30,0]],e=(a,b)=>({from:a,to:b,points:[n[a],n[b]],lane:0,signal:-1,crossing:false});
 const sim=new Mobility({roads:{nodes:[],edges:[]},walks:{nodes:n,edges:[e(0,1),e(1,0)]},signals:[]},{roads:{at:()=>false},pavement:{at:()=>true},buildings:{at:()=>false}},{cars:0,people:1});
 const [a]=sim.people;Object.assign(a,{edge:sim.walks.edges[0],s:20,cruise:1.2,side:0});Object.assign(a,sim.position(a),{speed:1.2});
 const player={x:0,z:0,heading:Math.PI/2,speed:0,travelMode:'car'};let held=0;
 for(let i=0;i<60*20;i++){sim.step(1/60,player);if(a.edge&&a.speed<.05)held+=1/60;}
 assert.ok(a.x<-6,`walked back from the car (x ${a.x.toFixed(1)})`);assert.ok(held<5,`stood ${held.toFixed(1)} s`);
});
