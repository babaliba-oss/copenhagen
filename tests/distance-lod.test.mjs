import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {stableShadowTarget,shadowFrame} from '../src/render-stability.js';
import {createTrafficRenderer} from '../src/traffic-renderer.js';
import {createPersonBatch,personLook,PERSON_LOD,limbGeometry,limbLowGeometry,torsoGeometry,torsoLowGeometry,headGeometry,headLowGeometry} from '../src/person-model.js';
import {detailedTreeLevel,TREE_LOD} from '../src/tile-lod.js';

const tris=g=>(g.index?.count??g.attributes.position.count)/3;

test('shadow target snaps to the texel grid of the current sun, not only the midday basis',()=>{
 const golden=new THREE.Vector3(-208,118,-250);
 const basis=new THREE.Matrix4().lookAt(golden,new THREE.Vector3(),new THREE.Vector3(0,1,0)).invert();
 const size={width:400,height:220},tx=size.width/2048,ty=size.height/2048;
 for(let i=0;i<20;i++){const p=stableShadowTarget({x:i*.37,z:i*.59},size,2048,new THREE.Vector3(),golden).applyMatrix4(basis);
  assert.ok(Math.abs(p.x/tx-Math.round(p.x/tx))<1e-9);assert.ok(Math.abs(p.y/ty-Math.round(p.y/ty))<1e-9);}
 // A sub-micron move of the focus never changes the snapped target: no swim between frames.
 const a=stableShadowTarget({x:100.03,z:100.07},size,2048,new THREE.Vector3(),golden),b=stableShadowTarget({x:100.03+1e-7,z:100.07-1e-7},size,2048,new THREE.Vector3(),golden);
 const la=a.clone().applyMatrix4(basis),lb=b.clone().applyMatrix4(basis);assert.ok(Math.abs(la.x-lb.x)<1e-9&&Math.abs(la.y-lb.y)<1e-9,'same light-space texel; only the depth along the light moves');
});

test('shadow box shrinks along the azimuth for a low sun and keeps near shadows sharp',()=>{
 const midday=shadowFrame(new THREE.Vector3(-160,260,160)),golden=shadowFrame(new THREE.Vector3(-208,118,-250)),night=shadowFrame(new THREE.Vector3(-59,42,-338));
 assert.ok(midday.halfHeight>170&&midday.halfHeight<=200);
 assert.ok(golden.halfHeight<midday.halfHeight&&golden.halfHeight>=110);
 assert.ok(night.halfHeight===110,'never thinner than the minimum');
 assert.ok(golden.normalBias>midday.normalBias&&golden.normalBias<.8);
 assert.ok(golden.groundTexel.along<.4,`golden ground texel ${golden.groundTexel.along.toFixed(2)} m along the sun`);
});

test('traffic batches keep full detail near the player, boxes beyond and nothing past the fog',()=>{
 const actors=[0,120,300,900].map((x,id)=>({id,x,z:0,heading:0,speed:0,edge:{}}));
 const r=createTrafficRenderer(actors,{types:['hatchback']});
 const near=r.group.children.filter(m=>!m.userData.lod),low=r.group.children.filter(m=>m.userData.lod==='far');
 assert.equal(low.length,2);assert.ok(low.every(m=>!m.castShadow&&m.geometry.type==='BoxGeometry'));
 r.update(0,{x:0,z:0});
 assert.ok(near.every(m=>m.count===2*m.userData.parts.length),'two cars within 150 m keep every part');assert.ok(low.every(m=>m.count===1),'one car is a box pair');
 r.update(0,null);assert.ok(near.every(m=>m.count===4*m.userData.parts.length),'no viewer: everything detailed');
 r.update(0,{x:5000,z:0});assert.ok(near.every(m=>m.count===0)&&low.every(m=>m.count===0));
});

test('people switch to the cheap body beyond the detail distance and vanish past the hide distance',()=>{
 assert.ok(tris(limbLowGeometry())*9+tris(torsoLowGeometry())*2+tris(headLowGeometry())<(15*tris(limbGeometry())+tris(torsoGeometry())+tris(headGeometry()))/3,'far body is under a third of the near body');
 const batch=createPersonBatch(3,{luggage:true});
 const person=(x,extra={})=>({...personLook(4),x,z:0,heading:0,speed:1.2,pose:'walk',coat:.8,bagType:'backpack',hairStyle:'long',accessory:null,scarf:null,outer:'coat',...extra});
 batch.begin({x:0,z:0});
 assert.equal(batch.draw(person(10)),true);assert.equal(batch.draw(person(PERSON_LOD.detail+30)),true);assert.equal(batch.draw(person(PERSON_LOD.hide+10)),false);
 batch.end();
 const {torso,head,hair,seg,coat,bag,lowTorso,lowHead,lowSeg}=batch.meshes;
 assert.deepEqual([torso.count,head.count,hair.count,coat.count,bag.count],[1,1,1,1,1]);assert.equal(seg.count,14,'near person: six leg, six arm and one pelvis segment plus long hair');
 assert.deepEqual([lowTorso.count,lowHead.count,lowSeg.count],[2,1,9],'far person: torso + coat, head, nine limbs');
 assert.ok([lowTorso,lowHead,lowSeg].every(m=>!m.castShadow));
 // Without a viewer every person is drawn in full (crowd snapshots, tests).
 batch.begin();batch.draw(person(500));batch.end();assert.equal(torso.count,1);assert.equal(lowTorso.count,0);
 // Knocked-down far people keep the impact pose.
 batch.begin({x:0,z:0});batch.draw(person(100,{knockdown:{elapsed:1,duration:6.5,side:1},speed:0}));batch.end();
 const m=new THREE.Matrix4();lowTorso.getMatrixAt(0,m);const up=new THREE.Vector3(m.elements[4],m.elements[5],m.elements[6]).normalize();assert.ok(Math.abs(up.y)<.2,'fallen far torso lies on its side');
});

test('detailed tree level has hysteresis at both handovers',()=>{
 let level=null;
 level=detailedTreeLevel(level,100);assert.equal(level,'near');
 level=detailedTreeLevel(level,TREE_LOD.detailFar-5);assert.equal(level,'near');
 level=detailedTreeLevel(level,TREE_LOD.detailFar+5);assert.equal(level,'mid');
 level=detailedTreeLevel(level,TREE_LOD.detailNear+5);assert.equal(level,'mid','stays mid inside the band');
 level=detailedTreeLevel(level,TREE_LOD.midFar+5);assert.equal(level,'far');
 level=detailedTreeLevel(level,TREE_LOD.midNear+5);assert.equal(level,'far','stays far inside the band');
 level=detailedTreeLevel(level,TREE_LOD.midNear-5);assert.equal(level,'mid');
 level=detailedTreeLevel(level,TREE_LOD.detailNear-5);assert.equal(level,'near');
});
