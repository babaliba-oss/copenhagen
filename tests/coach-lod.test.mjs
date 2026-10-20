import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
const {MeshoptSimplifier}=await import('meshoptimizer');await MeshoptSimplifier.ready;
const {farCoachGeometry}=await import('../src/copenhagen/carriage.js');
test('the far coach keeps its material groups and gait data at about a quarter of the triangles',async()=>{
 await new Promise(r=>setTimeout(r,0)); // carriage.js picks the simplifier up once it is ready
 const parts=[new THREE.SphereGeometry(1,48,32),new THREE.SphereGeometry(.6,40,24).translate(3,0,0)].map(g=>g.toNonIndexed());
 for(const g of parts){const n=g.attributes.position.count;g.setAttribute('color',new THREE.BufferAttribute(new Float32Array(n*3).fill(.5),3));g.setAttribute('anim',new THREE.BufferAttribute(new Float32Array(n*2).fill(1),2));g.setAttribute('pivot',new THREE.BufferAttribute(new Float32Array(n*3),3));}
 const {mergeGeometries}=await import('three/addons/utils/BufferGeometryUtils.js');const g=mergeGeometries(parts,true);
 const far=farCoachGeometry(g);assert.ok(far,'made');
 const before=g.attributes.position.count/3,after=far.index.count/3;
 assert.ok(after<before*.35,`${after} of ${before} triangles`);assert.equal(far.groups.length,2);
 for(const k of ['position','color','anim','pivot'])assert.ok(far.attributes[k],k);
 assert.ok(far.groups.every(gr=>gr.count>0));
});
