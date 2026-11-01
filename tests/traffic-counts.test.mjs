import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Mobility,prepareGraph,attachTraffic,trafficWeight,weightedPick} from '../src/mobility.js';

// Copenhagen's measured traffic (scripts/traffic-counts.py, Københavns Kommune Trafiktal): mobility.json traffic per road edge.
const data=JSON.parse(readFileSync(new URL('../public/cities/copenhagen/mobility.json',import.meta.url)));
const roads=prepareGraph(data.roads);attachTraffic(roads.edges,data);
const dist=(e,x,z)=>{let b=Infinity;for(let i=1;i<e.points.length;i++){const [ax,az]=e.points[i-1],[bx,bz]=e.points[i],dx=bx-ax,dz=bz-az,l=dx*dx+dz*dz,t=l?Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/l)):0;b=Math.min(b,Math.hypot(ax+dx*t-x,az+dz*t-z));}return b;};
const near=(x,z,r=8)=>roads.edges.filter(e=>dist(e,x,z)<r);
const seeded=(n=7)=>()=>(n=(n*16807)%2147483647)/2147483647;
// Cars per km an edge gets from spawning: its share of the picks over its length.
function perKm(list,trials=40000){
 const sim={random:seeded()},hits=new Map();
 for(let i=0;i<trials;i++){const e=Mobility.prototype.spawnPick.call(sim,list);hits.set(e,(hits.get(e)||0)+1);}
 return e=>(hits.get(e)||0)/e.length*1000;
}

test('the counted main roads carry far more traffic weight than a quiet side street',()=>{
 assert.equal(data.traffic.length,data.roads.edges.length);
 const hca=near(-661,227),aa=near(-1262,-379),side=near(-21.7,397.1,3); // H.C. Andersens Boulevard by Jarmers Plads, Åboulevard, Magstræde
 assert.ok(hca.length&&aa.length&&side.length);
 const w=l=>Math.max(...l.map(trafficWeight));
 assert.ok(w(hca)>4&&w(aa)>4,`main roads ${w(hca)} ${w(aa)}`); // ~48000 and ~44000 vehicles a day
 assert.ok(w(hca)>20*w(side)&&w(aa)>20*w(side),`side street ${w(side)}`);
});

test('spawning puts many more cars per km on H.C. Andersens Boulevard and Åboulevard than on a side street',()=>{
 const hca=near(-661,227)[0],aa=near(-1262,-379)[0],side=near(-21.7,397.1,3)[0],k=perKm([hca,aa,side]);
 assert.ok(k(hca)>15*k(side),`${k(hca)} vs ${k(side)} per km`);
 assert.ok(k(aa)>15*k(side),`${k(aa)} vs ${k(side)} per km`);
});

test('at a junction cars mostly turn onto the busier street, and maps without counts keep the even pick',()=>{
 const busy={traffic:4.8},quiet={traffic:.15},random=seeded();let n=0;
 for(let i=0;i<10000;i++)if(weightedPick([quiet,busy],trafficWeight,random)===busy)n++;
 assert.ok(n>9500,`${n} of 10000 took the busy street`);
 const plain=prepareGraph({nodes:[[0,0],[10,0]],edges:[{from:0,to:1,points:[[0,0],[10,0]],lane:1.6}]});
 assert.equal(attachTraffic(plain.edges,{roads:plain}),false);
 assert.equal(plain.edges[0].traffic,undefined);
});
