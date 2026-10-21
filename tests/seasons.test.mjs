import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
const {pumpkinPools,PUMPKIN_NEAR,PUMPKIN_FAR,currentSeason}=await import('../src/copenhagen/seasons.js');

const part=()=>new THREE.BoxGeometry(.4,.4,.4);
const models=Object.fromEntries(['A','B','C'].map(k=>[k,{0:{body:part(),glow:part()},1:{body:part(),glow:part()}}]));
const spots=[];for(let i=0;i<600;i++)spots.push([(i%30)*12-180,Math.floor(i/30)*12-120,i*.3]);
const sum=(pools,re)=>Object.entries(pools.counts()).filter(([n])=>re.test(n)).reduce((a,[,c])=>a+c,0);

test('every pumpkin within reach is drawn once: the detailed model near the player, the shrink-wrapped one further out', () => {
 const pools=pumpkinPools(models,spots,()=>1,new THREE.MeshBasicMaterial());
 pools.update(0,{x:0,z:0});
 const near=spots.filter(p=>Math.hypot(p[0],p[1])<PUMPKIN_NEAR).length,far=spots.filter(p=>{const d=Math.hypot(p[0],p[1]);return d>=PUMPKIN_NEAR&&d<PUMPKIN_FAR;}).length;
 assert.equal(sum(pools,/[ABC]0 body/),near);assert.equal(sum(pools,/[ABC]0 glow/),near);
 assert.equal(sum(pools,/[ABC]1 body/),far);assert.equal(sum(pools,/[ABC]1 glow/),far);
 for(const k of 'ABC')assert.ok(sum(pools,new RegExp(k+'[01] body'))>near/10,`model ${k} is used`);
 pools.update(.1,{x:150,z:0});assert.equal(sum(pools,/[ABC]0 body/),near,'refilled four times a second, not every frame');
 pools.update(.2,{x:150,z:0});assert.notEqual(sum(pools,/[ABC]0 body/),near);
 pools.update(.3,{x:5000,z:0});assert.equal(sum(pools,/body/),0,'none beyond reach');
 for(const im of pools.group.children)assert.equal(im.visible,false);
});

test('a model without its parts is left out, and no models leaves the procedural pumpkin', () => {
 assert.equal(pumpkinPools({},spots,()=>1,new THREE.MeshBasicMaterial()),null);
 const pools=pumpkinPools({A:models.A,B:{0:{body:part()}}},spots,()=>1,new THREE.MeshBasicMaterial());
 assert.ok(pools.group.children.every(im=>/\(A[01] /.test(im.name)));
});

test('Halloween runs from 10 October to 2 November', () => {
 assert.equal(currentSeason(new Date(2026,9,19),''),'halloween');
 assert.equal(currentSeason(new Date(2026,10,3),''),null);
 assert.equal(currentSeason(new Date(2026,9,19),'?season=none'),null);
});

test('no pumpkin within half a metre of a drawn wall, whether the tile came before the decorations or after', async () => {
 const {createSeasonalDecor,noteDrawnWalls,clearDrawnWalls,nearDrawnWall}=await import('../src/copenhagen/seasons.js');const {SpatialIndex}=await import('../src/geo.js');
 clearDrawnWalls();
 const house={rings:[[[0,0],[40,0],[40,10],[0,10]]],bbox:[0,0,40,10]},world={buildings:new SpatialIndex([house]),roads:new SpatialIndex([]),pavement:new SpatialIndex([]),water:[]};
 // the city model's walls stand 0.6 m out from the map's footprint: each an upright quad from (x0,z0) to (x1,z1), 5 m high
 const wall=(x0,z0,x1,z1)=>new Float32Array([x0,0,z0,0,0, x1,0,z1,0,0, x1,5,z1,0,0, x0,0,z0,0,0, x1,5,z1,0,0, x0,5,z0,0,0]),one=[{start:0,count:6}];
 noteDrawnWalls(wall(-.6,-.6,20,-.6),one);assert.ok(nearDrawnWall(10,-.9));assert.ok(!nearDrawnWall(10,-1.2));
 const decor=createSeasonalDecor('halloween',{buildings:[house],world,places:[{name:'Nyhavn',x:20,z:5}],pumpkins:models});
 const shown=()=>{decor.update(1,{x:20,z:5});let n=0;decor.group.traverse(m=>{if(m.isInstancedMesh&&/body/.test(m.name))n+=m.count;});return n;};
 const before=shown();assert.ok(before>0,'pumpkins along the house');
 noteDrawnWalls(wall(20,-.6,40.6,-.6),one);noteDrawnWalls(wall(40.6,-.6,40.6,10.6),one);noteDrawnWalls(wall(40.6,10.6,-.6,10.6),one);noteDrawnWalls(wall(-.6,10.6,-.6,-.6),one);
 assert.ok(shown()<before,'a tile arriving later hides the pumpkins its walls stand on');assert.equal(shown(),0);
 decor.dispose();clearDrawnWalls();
});
