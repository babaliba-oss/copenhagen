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
