// The added delivery jobs (data.js) and the rank rewards (game.js): the data's shape, both ends on a road of that era's
// map, and what a rank gives. The jobs' lines, clocks and pay are played with the others in copenhagen-game.test.mjs.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {register} from 'node:module';import proj4 from 'proj4';
register('data:text/javascript,'+encodeURIComponent("export async function load(u,c,n){return u.endsWith('.css')?{format:'module',source:'',shortCircuit:true}:n(u,c);}"));
const {expandMobility}=await import('../src/mobility-pack.js'),{JOBS,JOBS_1760}=await import('../src/copenhagen/data.js'),{PAINTS,PURSES,rankReward,nextUp}=await import('../src/copenhagen/game.js');
const cities=JSON.parse(fs.readFileSync('public/cities/index.json','utf8')).cities;
const RANKS=[['Newcomer',0],['Bike courier',2],['Cargo rider',5],['Street regular',9],['Harbour hand',14],['City fixer',20],['Copenhagen legend',30]];
test('twenty jobs today and thirteen in 1760, in the shape and the pay of the first ones',()=>{
 assert.equal(JOBS.length,20);assert.equal(JOBS_1760.length,13);
 for(const [list,lo,hi] of [[JOBS,260,560],[JOBS_1760,96,288]]){assert.equal(new Set(list.map(j=>j.t)).size,list.length,'no title twice');
  for(const j of list){assert.deepEqual(Object.keys(j),['t','d','a','b','pay'],j.t);assert.ok(j.pay>=lo&&j.pay<=hi&&Number.isInteger(j.pay),`${j.t}: ${j.pay}`);
   for(const p of [j.a,j.b]){assert.equal(p.length,3,j.t);assert.ok(p[0]>55.63&&p[0]<55.73&&p[1]>12.5&&p[1]<12.65&&typeof p[2]==='string'&&p[2],`${j.t}: ${p}`);}
   assert.ok(j.t.length<=34&&j.d.length<=170,`${j.t}: short`);assert.doesNotMatch(j.t+j.d,/[—–]|\s-\s/,`${j.t}: no dashes`);assert.notDeepEqual(j.a.slice(0,2),j.b.slice(0,2),j.t);}}
 for(const j of JOBS_1760)assert.equal(j.pay%48,0,`${j.t}: skilling in halves of a mark`);
});
test('the added jobs start and end on a road of their own map',()=>{  // Gammel Strand is the first jobs' spot on the quay, 13 m off
 for(const [id,list] of [['copenhagen',JOBS.slice(10)],['copenhagen-1760',JOBS_1760.slice(7)]]){
  const proj=proj4('EPSG:4326',cities.find(c=>c.id===id).projection),edges=expandMobility(JSON.parse(fs.readFileSync(`public/cities/${id}/mobility.json`,'utf8'))).roads.edges;
  const off=([lat,lon])=>{const [x,y]=proj.forward([lon,lat]),z=-y;let best=Infinity;for(const e of edges)for(let i=1;i<e.points.length;i++){const a=e.points[i-1],b=e.points[i],dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));best=Math.min(best,Math.hypot(a[0]+dx*t-x,a[1]+dz*t-z));}return best;};
  for(const j of list)for(const p of [j.a,j.b])assert.ok(off(p)<(p[2]==='Gammel Strand'?15:3),`${id} ${j.t}: ${p[2]} is ${off(p).toFixed(1)} m from a road`);}
});
test('rank rewards: a paint at five of today\'s ranks, a purse at three in 1760',()=>{
 assert.deepEqual(PAINTS.map(p=>p[2]),[1,2,3,4,6]);for(const [name,hex,at] of PAINTS){assert.match(hex,/^#[0-9a-f]{6}$/);assert.ok(RANKS[at],name);assert.equal(rankReward('m',at),`${name} paint`);}
 assert.equal(new Set(PAINTS.map(p=>p[0])).size,PAINTS.length);assert.equal(rankReward('m',0),'');assert.equal(rankReward('m',5),'');
 assert.deepEqual(Object.keys(PURSES),['2','4','6']);assert.equal(rankReward('h',2),'a purse of 96 sk.');assert.equal(rankReward('h',1),'');
});
test('what\'s next: the next rank, the deliveries to go and what it gives; at the top there is nothing',()=>{
 assert.equal(nextUp(RANKS,0,'m'),'Next: Bike courier in 2 deliveries · Postbox red paint');
 assert.equal(nextUp(RANKS,4,'m'),'Next: Cargo rider in 1 delivery · Bus yellow paint');
 assert.equal(nextUp(RANKS,14,'m'),'Next: City fixer in 6 deliveries');
 assert.equal(nextUp(RANKS,29,'m'),'Next: Copenhagen legend in 1 delivery · Gold paint');
 assert.equal(nextUp(RANKS,3,'h'),'Next: Cargo rider in 2 deliveries · a purse of 96 sk.');
 assert.match(nextUp(RANKS,30,'m'),/^Top rank/);assert.match(nextUp(RANKS,400,'h'),/^Top rank/);
});
