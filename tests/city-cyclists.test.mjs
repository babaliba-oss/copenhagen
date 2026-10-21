import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareGraph} from '../src/mobility.js';
import {CityCyclists} from '../src/copenhagen/city-cyclists.js';

// A square block of two-way streets, 100 m a side: every route runs out at a junction sooner or later.
const nodes=[[0,0],[100,0],[100,100],[0,100]],edges=[];
for(let i=0;i<4;i++){const j=(i+1)%4;edges.push({from:i,to:j,points:[nodes[i],nodes[j]],lane:1.7},{from:j,to:i,points:[nodes[j],nodes[i]],lane:1.7});}
const open={at:()=>null},road={at:()=>({})},world={buildings:open,roads:road,pavement:road};
test('a cyclist in sight rides on through the junction at the end of its route instead of vanishing',()=>{
 let seed=3;const random=()=>(seed=(seed*16807)%2147483647)/2147483647;
 const sim=new CityCyclists(prepareGraph({nodes,edges}),world,6,random),player={x:50,z:-150,heading:Math.PI};
 sim.visibilityTest=r=>Math.hypot(r.x-50,r.z-50)<200; // the whole block is in view
 for(const r of sim.riders)sim.spawn(r,{x:2000,z:2000}); // spawned while the player was elsewhere
 let jumps=0;
 for(let i=0;i<30*240;i++){const before=sim.riders.map(r=>[r.x,r.z]);sim.step(1/30,player);sim.riders.forEach((r,k)=>{if(before[k][0]<1e5&&Math.hypot(r.x-before[k][0],r.z-before[k][1])>12)jumps++; /* a 90° corner with the 5.6 m kerb offset steps ~8 m */});}
 assert.equal(jumps,0);
 assert.ok(sim.riders.every(r=>r.route&&r.route.length<=12),'routes are trimmed as they grow');
});
test('out of sight, a finished rider is re-spawned',()=>{
 const sim=new CityCyclists(prepareGraph({nodes,edges}),world,1,()=>.5),player={x:50,z:-150,heading:Math.PI};
 sim.visibilityTest=()=>false;assert.ok(sim.spawn(sim.riders[0],{x:50,z:-60}));const r=sim.riders[0];r.route=[r.route[0]];r.s=r.route[0].length-.01;r.x=r.z=50;
 sim.step(.1,player);assert.equal(r.route,null);
});
