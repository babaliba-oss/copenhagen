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
// A raised deck (Cykelslangen) between two street corners: a cycle-only link along the footways and the deck, never in the car graph.
test('riders cross a raised deck at its height by a cycle-only link the cars do not have',()=>{
 const nodes=[[0,0],[200,0],[200,-100],[0,-100]],edges=[];for(const [i,j] of [[0,3],[3,2],[2,1]])edges.push({from:i,to:j,points:[nodes[i],nodes[j]],lane:1.7},{from:j,to:i,points:[nodes[j],nodes[i]],lane:1.7});
 const roads=prepareGraph({nodes,edges}),heightAt=x=>Math.max(0,Math.min(5,(x-20)*.085,(180-x)*.085));
 const deck={rings:[[[20,-2.5],[180,-2.5],[180,2.5],[20,2.5]]],bbox:[20,-2.5,180,2.5],centre:Array.from({length:81},(_,i)=>[20+i*2,0]),heightAt};
 const wn=[[18,0],[4,0],[182,0],[196,0]],we=[];for(const [i,j] of [[0,1],[2,3],[0,2]])we.push({from:i,to:j,points:[wn[i],wn[j]]},{from:j,to:i,points:[wn[j],wn[i]]});
 let seed=11;const random=()=>(seed=(seed*16807)%2147483647)/2147483647;
 const sim=new CityCyclists(roads,world,8,random,{walks:prepareGraph({nodes:wn,edges:we}),decks:[deck]}),player={x:100,z:-400,heading:0};
 assert.equal(sim.linkList.length,2);assert.equal(roads.edges.length,6);assert.ok(roads.outgoing.flat().every(e=>!e.cycleOnly),'no car can take it');
 sim.visibilityTest=()=>true;let crossed=0,on=0,err=0;const seen=new Map();
 for(let i=0;i<30*600;i++){sim.step(1/30,player);for(const r of sim.riders){const e=r.route?.[r.leg];if(!e?.cycleOnly){assert.equal(r.deckY,null);continue;}
  if(r.s<e.deckFrom+2)seen.set(r.id,e);if(r.s>e.deckTo-1&&seen.get(r.id)===e){crossed++;seen.delete(r.id);}
  if(r.s>e.deckFrom+1&&r.s<e.deckTo-1){on++;err=Math.max(err,Math.abs(r.deckY-heightAt(r.x)));assert.ok(Math.abs(r.z)<2.5,'on the deck');}}}
 assert.ok(crossed>=3,`crossed ${crossed}`);assert.ok(on>100);assert.ok(err<.06,`height error ${err}`);
});
