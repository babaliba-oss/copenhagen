import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {createBuildingBatches,batched,batchKey} from '../src/building-batches.js';
import {applyPartLod,LOD,createShellMask} from '../src/tile-lod.js';

const tri=(x)=>new Float32Array([x,0,0, x+1,0,0, x,3,0]);
const mesh=(x,material,extra={})=>({attributes:{position:{array:tri(x),itemSize:3,normalized:false},normal:{array:new Float32Array(9).fill(1),itemSize:3,normalized:false}},shell:true,role:'facade',material:{color:0xffffff,roughness:.8,metalness:0,side:2,vertexColors:false,textured:false,...material},...extra});
const part=(i)=>({id:'p'+i,start:i*3,count:3,bbox:[i*10,0,i*10+8,8],height:12});

test("a tile's buildings share batches per material look and land into them by copy",()=>{
 const buildings=[0,1,2].map(i=>({part:part(i),windows:0,meshes:[mesh(i,{}),mesh(i,{roughness:.49,metalness:.28},{role:'roof'})]}));
 buildings[2].meshes.push(mesh(2,{signs:true},{role:'signs'}));
 const b=createBuildingBatches(buildings,new Map(),x=>buildings.indexOf(x));
 assert.equal(b.batched(buildings[2].meshes[2]),true,'shop signs batch too');assert.equal(b.meshes.length,3,'signs are their own look');
 assert.equal(batched({material:{},role:undefined}),false,'meshes without a role (authored hero fronts) stay their own mesh');
 const facades=b.meshes.find(m=>m.material.roughness===.8).geometry;
 assert.equal(facades.attributes.position.count,9);assert.deepEqual([...facades.attributes.aBid.array],[0,0,0,1,1,1,2,2,2]);
 assert.ok(facades.boundingSphere.radius>10,'bounds come from the parts before any vertex lands');
 assert.equal(facades.attributes.position.array[3],0,'nothing copied before landing');
 b.land(buildings[1]);assert.equal(facades.attributes.position.array[9],1,'the second building lands at its offset');assert.equal(facades.attributes.position.array[0],0);
 assert.equal(b.get(1),0,'hidden until its part is shown');b.set(1,1);assert.equal(b.data[1],1);
 assert.notEqual(batchKey(part(0),buildings[0].meshes[0]),batchKey(part(0),buildings[0].meshes[1]));
});

test('indexed meshes are expanded when they land',()=>{
 const m=mesh(0,{});m.index=new Uint16Array([0,1,2,2,1,0]);const buildings=[{part:part(0),windows:0,meshes:[m]}];
 const b=createBuildingBatches(buildings,new Map(),()=>0);const g=b.meshes[0].geometry;assert.equal(g.attributes.position.count,6);
 b.land(buildings[0]);assert.deepEqual([...g.attributes.position.array.subarray(9,18)],[0,3,0,1,0,0,0,0,0]);
});

test('landed parts hand back to the merged shell beyond LOD.building, with hysteresis',()=>{
 const buildings=[{part:part(0),windows:0,meshes:[mesh(0,{})]}],b=createBuildingBatches(buildings,new Map(),()=>0),mask=createShellMask(1);
 const p={i:0,box:new THREE.Box3(new THREE.Vector3(0,0,0),new THREE.Vector3(8,12,8)),occlusion:{opacity:1,clearTime:1}},at=x=>new THREE.Vector3(8+x,0,4);
 applyPartLod(b,p,'near',at(10),mask);assert.equal(b.get(0),1);assert.equal(mask.get(0),0);
 applyPartLod(b,p,'near',at(LOD.building+10),mask);assert.equal(b.get(0),1,'inside the band it stays');
 applyPartLod(b,p,'near',at(LOD.building+30),mask);assert.equal(b.get(0),0);assert.equal(mask.get(0),1);
 applyPartLod(b,p,'far',at(10),mask);assert.equal(b.get(0),0,'far tiles draw only merged shells');
 p.occlusion.opacity=.5;applyPartLod(b,p,'near',at(10),mask);assert.equal(b.get(0),.5,'a camera fade dims the part');
});

test('batches split into cells and draw only while one of their parts is shown',()=>{
 const far=part(1);far.bbox=[200,0,208,8];const buildings=[{part:part(0),windows:0,meshes:[mesh(0,{})]},{part:far,windows:0,meshes:[mesh(1,{})]}];
 const b=createBuildingBatches(buildings,new Map(),x=>buildings.indexOf(x));
 assert.equal(b.meshes.length,2,'two cells, one look');assert.ok(b.meshes.every(m=>!m.visible),'nothing shown yet');
 b.set(0,1);assert.deepEqual(b.meshes.map(m=>m.visible),[true,false]);
 b.setNear(false);assert.ok(b.meshes.every(m=>!m.visible),'a far tile draws no detail');b.setNear(true);assert.ok(b.meshes[0].visible);
 b.set(0,0);assert.ok(b.meshes.every(m=>!m.visible));
});

test('a batch frees its CPU arrays after the upload that follows its last building landing',()=>{
 const buildings=[0,1].map(i=>({part:part(i),windows:0,meshes:[mesh(i,{})]}));
 const b=createBuildingBatches(buildings,new Map(),x=>buildings.indexOf(x)),g=b.meshes[0].geometry,seen=new Map(),up=()=>{for(const a of Object.values(g.attributes))if(a.version!==(seen.get(a)??0)){seen.set(a,a.version);a.onUploadCallback();}}; // like WebGLAttributes: only changed attributes upload
 b.land(buildings[0]);up();assert.ok(g.attributes.position.array,'kept while a building is still to land');
 b.land(buildings[1]);assert.equal(b.batched(buildings[1].meshes[0]),true,'still known as batched after landing');
 assert.equal(g.attributes.position.array[9],1,'the last building is copied before anything is freed');
 up();assert.equal(g.attributes.position.array,null);assert.equal(g.attributes.aBid.array,null);
 assert.ok(g.boundingSphere.radius>0,'culling bounds survive');
});

test('batch bounds follow the ground a part stands on (terrain cities), so culling never drops a sunken or raised building',()=>{
 const low={...part(0),base:-9},high={...part(1),base:60},buildings=[low,high].map((p,i)=>({part:p,windows:0,meshes:[mesh(i,{})]}));
 const box=createBuildingBatches(buildings,new Map(),x=>buildings.indexOf(x)).meshes[0].geometry.boundingBox;
 assert.ok(box.min.y<=-9,'the sunken part\'s foot is inside');assert.ok(box.max.y>=60+12,'the raised part\'s roof is inside');
});
