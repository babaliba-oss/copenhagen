import test from 'node:test';
import assert from 'node:assert/strict';
import {loadCity,seeded} from '../scripts/traffic-harness.mjs';
import {Mobility} from '../src/mobility.js';

// Christianshavn (today's Copenhagen): narrow two-way streets by the canals, where cars used to stop across a
// junction for good beside the player, with the cars giving way to them and queued behind them stopped too.
// Each case places the cars exactly as a seeded flow run left them (scripts/traffic-harness.mjs) and steps
// only those cars, beside a player close enough that nothing is recycled.
const c=loadCity('copenhagen');
function scene(cars,player){
 const m=new Mobility(structuredClone(c.mobility),c.world,{random:seeded(1),cars:cars.length,people:0});
 m.time=10;m.visibilityTest=()=>true; // no spawning (start-up only) and everything in view: nothing is recycled
 const edge=(from,to)=>{const e=m.roads.edges.find(e=>e.from===from&&e.to===to);assert.ok(e,`edge ${from}>${to}`);return e;};
 cars.forEach(([route,s],i)=>{const a=m.cars[i],[first,...rest]=route.map(([f,t])=>edge(f,t));Object.assign(a,{edge:first,s,plan:rest,cruise:8,speed:0});Object.assign(a,m.position(a));});
 return {m,player:{x:player[0],z:player[1],heading:0,speed:0,edge:undefined}};
}
const run=({m,player},seconds)=>{const from=m.cars.map(a=>({x:a.x,z:a.z}));for(let t=0;t<seconds;t+=1/30)m.step(1/30,player);return m.cars.map((a,i)=>Math.hypot(a.x-from[i].x,a.z-from[i].z));};

test('a car whose turn clips the kerb at a narrow corner gets through, and so do the cars waiting on it (Mikkel Vibes Gade / Dronningensgade)',()=>{
 // Car 0 is in the box, turning; its next step put a footprint corner a few centimetres off the mapped
 // carriageway, so every step was undone and it stood there; car 1 gave way to it, car 2 queued behind it.
 const sim=scene([[[[2055,10117],[10117,10118]],56],[[[18126,10117],[10117,2055]],7.6],[[[2055,10117],[10117,18126]],50.8]],[1076,858]);
 const moved=run(sim,20);
 for(const [i,d] of moved.entries())assert.ok(d>12,`car ${i} moved only ${d.toFixed(1)} m (${sim.m.cars[i].hold})`);
});

