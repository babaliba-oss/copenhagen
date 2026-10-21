import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {SpatialIndex} from '../src/geo.js';
import {crossingPolygons} from '../src/crossing-markings.js';
import {createStreetLife} from '../src/street-life.js';

test('street-life startup triangulates real crossing polygons with installed earcut API',()=>{
 const road={bbox:[990,990,1010,1010],rings:[[[990,990],[1010,990],[1010,1010],[990,1010],[990,990]]]};
 const world={roads:new SpatialIndex([road]),pavement:new SpatialIndex([]),buildings:new SpatialIndex([])};
 const edges=[{from:0,to:1,points:[[1000,991],[1000,1009]],crossing:true}];
 assert.ok(crossingPolygons(edges,world).polygons.length>0,'fixture exercises crossing triangulation');
 const scene=new THREE.Scene(),mobility={cars:[],people:[],walks:{edges},roads:{edges:[]},world};
 const life=createStreetLife(scene,mobility);
 life.update(0,{x:1000,z:1000});
 const markings=[];scene.traverse(m=>{if(m.isMesh&&m.material.polygonOffset)markings.push(m);});
 assert.ok(markings.length>=1); // split into 500 m cells (frustum culling)
 for(const mk of markings){
 assert.ok(mk.geometry.attributes.position.count>0);
 assert.ok(mk.geometry.attributes.position.array.every(Number.isFinite));
 const p=mk.geometry.attributes.position,n=mk.geometry.attributes.normal;
 for(let i=0;i<p.count;i+=3){
  const a=new THREE.Vector3().fromBufferAttribute(p,i),b=new THREE.Vector3().fromBufferAttribute(p,i+1),c=new THREE.Vector3().fromBufferAttribute(p,i+2);
  assert.ok(b.sub(a).cross(c.sub(a)).y>0,'stripe top must be front-facing, not a flipped DoubleSide back face');
  assert.ok(n.getY(i)>.99,'computed lighting normal points upward');
  assert.ok(p.getY(i)>.10,'crossing stays above the market/cycleway surface');
 }}
 scene.traverse(m=>{m.geometry?.dispose();m.material?.dispose();});
});

test('street pedestrians receive and clear conversation expressions through the render proxy',()=>{
 const world={roads:new SpatialIndex([]),pavement:new SpatialIndex([]),buildings:new SpatialIndex([])};
 const actor={id:1,x:0,z:-2,heading:0,speed:0,edge:{},expression:'friendly',speaking:true,mouthOpen:.7};
 const scene=new THREE.Scene(),life=createStreetLife(scene,{cars:[],people:[actor],walks:{edges:[]},roads:{edges:[]},world});
 life.update(.1,{x:0,z:0});
 const head=scene.getObjectByName('Person heads'),state=head.geometry.attributes.faceState;
 assert.equal(head.count,1);assert.ok(Math.abs(state.getX(0)-.7)<1e-6,'the rendered walker receives the speech envelope');
 assert.ok(state.getY(0)>0,'the rendered walker receives the friendly expression');
 delete actor.expression;delete actor.speaking;delete actor.mouthOpen;
 life.update(.1,{x:0,z:0});
 assert.equal(state.getX(0),0,'closing the conversation clears the old speech state');
 assert.equal(state.getY(0),0,'closing restores a neutral face');
 scene.traverse(m=>{m.geometry?.dispose();m.material?.dispose();});
});
