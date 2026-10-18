import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createPersonBatch,personLook,flushPeople} from '../src/person-model.js';

test('every crowd draws through one shared set of person batches; a batch aboard a moved parent draws itself',()=>{
 const scene=new THREE.Scene(),a=createPersonBatch(4),b=createPersonBatch(4),moved=createPersonBatch(4),carrier=new THREE.Group();
 carrier.position.x=5;carrier.add(moved.group);scene.add(a.group,b.group,carrier);scene.updateMatrixWorld(true);
 for(const [batch,n] of [[a,2],[b,1],[moved,1]]){batch.begin({x:0,z:0});for(let i=0;i<n;i++){const look=personLook(4+i);batch.draw({...look,x:i,z:0,heading:0,speed:1,pose:'walk'},look,{});}batch.end();}
 flushPeople(scene);
 const shared=scene.getObjectByName('People (all crowds)'),torsos=shared.children.find(m=>m.name==='Person torsos and jackets'),limbs=shared.children.find(m=>m.name==='Person limbs, hips, neck and feet');
 assert.equal(torsos.count,a.meshes.torso.count+b.meshes.torso.count);assert.equal(limbs.count,a.meshes.seg.count+b.meshes.seg.count);
 assert.ok(a.list.every(m=>!m.visible)&&b.list.every(m=>!m.visible),'shared batches stay out of the render');
 assert.ok(moved.list.every(m=>m.visible),'the moved batch keeps drawing itself');
 assert.deepEqual([...torsos.instanceMatrix.array.subarray(0,16)],[...a.meshes.torso.instanceMatrix.array.subarray(0,16)],'instances copied in order');
 b.group.visible=false;flushPeople(scene);assert.equal(torsos.count,a.meshes.torso.count,'a hidden crowd leaves the shared batches');
});
