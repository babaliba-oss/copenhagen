#!/usr/bin/env node
// Second pass over parked.json (after scripts/parked-cars.py): drops the parked cars that stand in a traffic lane of
// any road edge (parked-cars.py only kept clear of the lane of the edge it was placing along, so on multi-edge and
// one-way streets some sat in the next lane: traffic drove through them and the player got stuck behind rows of them)
// and the second of two parked cars that overlap.
//   node scripts/parked-lanes.mjs copenhagen
import {readFileSync,writeFileSync} from 'fs';
import {expandMobility} from '../src/mobility-pack.js';
import {prepareGraph,routePoint} from '../src/mobility.js';

const id=process.argv[2]||'copenhagen',dir=`public/cities/${id}`;
const roads=prepareGraph(expandMobility(JSON.parse(readFileSync(`${dir}/mobility.json`,'utf8'))).roads);
const parked=JSON.parse(readFileSync(`${dir}/parked.json`,'utf8'));
// A parked car's box (half 0.9 x 2.15 m) next to a moving car's (half width 0.98 m): any lane centre closer than this to its axis touches it.
const HW=.9,HL=2.15,CLEAR=HW+.98,C=10,grid=new Map(),cell=(x,z)=>Math.floor(x/C)+','+Math.floor(z/C);
const add=(map,k,v)=>{let l=map.get(k);if(!l)map.set(k,l=[]);l.push(v);};
for(const e of roads.edges){if(e.crossing)continue;for(const off of new Set([e.lane,...(e.laneOffsets||[])]))for(let s=0;s<=e.length;s+=1){const p=routePoint(e,s,off);add(grid,cell(p.x,p.z),[p.x,p.z]);}}
const near=(map,x,z)=>{const gx=Math.floor(x/C),gz=Math.floor(z/C),out=[];for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++)out.push(...(map.get((gx+i)+','+(gz+j))||[]));return out;};
const inLane=([x,z,yaw])=>{const ux=Math.sin(yaw),uz=Math.cos(yaw);return near(grid,x,z).some(([px,pz])=>{const dx=px-x,dz=pz-z;return Math.abs(dx*ux+dz*uz)<HL+.3&&Math.abs(dz*ux-dx*uz)<CLEAR;});};
// Two boxes overlap (separating axes on both cars' axes).
const overlap=(a,b)=>{const axes=[a[2],b[2]].flatMap(y=>[[Math.sin(y),Math.cos(y)],[Math.cos(y),-Math.sin(y)]]),dx=b[0]-a[0],dz=b[1]-a[1];
 const r=(c,[ux,uz])=>HL*Math.abs(Math.sin(c[2])*ux+Math.cos(c[2])*uz)+HW*Math.abs(Math.cos(c[2])*ux-Math.sin(c[2])*uz);
 return axes.every(ax=>Math.abs(dx*ax[0]+dz*ax[1])<r(a,ax)+r(b,ax)+.1);};
const before=parked.cars.length,kept=[],placed=new Map();let lanes=0,pairs=0;
for(const c of parked.cars){
 if(inLane(c)){lanes++;continue;}
 if(near(placed,c[0],c[1]).some(o=>overlap(o,c))){pairs++;continue;}
 kept.push(c);add(placed,cell(c[0],c[1]),c);
}
parked.cars=kept;writeFileSync(`${dir}/parked.json`,JSON.stringify(parked));
console.log(`parked cars: ${before} -> ${kept.length} (${lanes} in a traffic lane, ${pairs} overlapping another)`);
