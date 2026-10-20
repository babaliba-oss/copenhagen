import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createKnockables} from '../src/knockables.js';

const part=()=>[{geometry:new THREE.BoxGeometry(1,1,1),material:new THREE.MeshBasicMaterial()}];
test('upright knockables block walkers as boxes; knocked ones do not',()=>{
 const k=createKnockables([{id:'a',x:0,z:0,yaw:0},{id:'b',x:50,z:0,yaw:0}],part(),{radius:.5,footprint:[.9,.3],range:100});
 const near=k.near(1,1,10);assert.equal(near.length,1);assert.deepEqual([near[0].halfWidth,near[0].halfLength],[.9,.3]);
 const car={x:2.2,z:0,heading:Math.PI/2,speed:12};for(let i=0;i<10;i++){car.x-=12/60;k.step(1/60,car,null);}
 assert.equal(k.bodies[0].knocked,true,'the car kicks it');assert.equal(k.near(1,1,10).length,0,'a knocked bench is no longer a wall');
});
test('packing runs only when the player moves 25 m or something moves',()=>{
 const k=createKnockables([{id:'a',x:0,z:0,yaw:0}],part(),{radius:.5,range:100});
 const m=k.group.children[0];k.update({x:0,z:0});m.instanceMatrix.version=0;
 k.step(1/60,{x:500,z:0,heading:0,speed:0},null);k.update({x:5,z:0});assert.equal(m.instanceMatrix.version,0,'nothing moved: not repacked');
 k.update({x:40,z:0});assert.ok(m.instanceMatrix.version>0,'moved 40 m: repacked');
});
