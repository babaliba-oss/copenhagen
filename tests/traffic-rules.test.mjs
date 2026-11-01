import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareGraph} from '../src/mobility.js';
import {annotateJunctions} from '../src/lane-model.js';

// Copenhagen's traffic rules on the road graph (scripts/traffic-rules.py, Københavns Kommune map data): one-way
// streets.
const data=JSON.parse(readFileSync(new URL('../public/cities/copenhagen/mobility.json',import.meta.url)));
const roads=prepareGraph(data.roads);annotateJunctions(roads,data.signals);
const dist=(e,x,z)=>{let b=Infinity;for(let i=1;i<e.points.length;i++){const [ax,az]=e.points[i-1],[bx,bz]=e.points[i],dx=bx-ax,dz=bz-az,l=dx*dx+dz*dz,t=l?Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/l)):0;b=Math.min(b,Math.hypot(ax+dx*t-x,az+dz*t-z));}return b;};
const near=(x,z,r=6)=>roads.edges.filter(e=>dist(e,x,z)<r);
// Edges running along the street line a->b (within 6 m of its middle, parallel to it): +1 with it, -1 against it.
function along(a,b){const m=[(a[0]+b[0])/2,(a[1]+b[1])/2],l=Math.hypot(b[0]-a[0],b[1]-a[1]),u=[(b[0]-a[0])/l,(b[1]-a[1])/l];
 return near(m[0],m[1]).map(e=>{let best=null,bd=Infinity;for(let i=1;i<e.points.length;i++){const p=e.points[i-1],q=e.points[i],d=dist({points:[p,q]},m[0],m[1]);if(d<bd){bd=d;best=[p,q];}}const k=Math.hypot(best[1][0]-best[0][0],best[1][1]-best[0][1])||1,c=((best[1][0]-best[0][0])*u[0]+(best[1][1]-best[0][1])*u[1])/k;return Math.abs(c)>.85?Math.sign(c):0;}).filter(Boolean);}

test('one-way streets run the way the city has them, and every street can still be reached and left by car',()=>{
 const korsgade=along([-1221.2,-635.3],[-1332,-709.9]),overgaden=along([862.5,938.7],[818.5,985.5]),vandkunsten=along([-84.2,422.3],[-109.5,439.5]);
 for(const [name,l] of [['Korsgade',korsgade],['Overgaden Oven Vandet',overgaden],['Vandkunsten',vandkunsten]]){assert.ok(l.length,name);assert.ok(l.every(s=>s>0),`${name}: ${l}`);}
 const fwd=Array.from(roads.nodes,()=>[]),back=Array.from(roads.nodes,()=>[]);for(const e of roads.edges){fwd[e.from].push(e.to);back[e.to].push(e.from);}
 const reach=adj=>{const seen=new Uint8Array(adj.length),q=[0];seen[0]=1;let n=1;while(q.length)for(const w of adj[q.pop()])if(!seen[w]){seen[w]=1;n++;q.push(w);}return n;};
 const used=new Set(roads.edges.flatMap(e=>[e.from,e.to])).size;
 assert.equal(reach(fwd),used);assert.equal(reach(back),used);
});
