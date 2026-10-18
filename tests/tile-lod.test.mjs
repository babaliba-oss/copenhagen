import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {LOD,tileLevel,mergedShellRanges,createMergedShells,applyTileLod,applyTreeLod,treeLeafDetail,createStaticShadowCuller,freezeTileGroup} from '../src/tile-lod.js';
import {createSourceShell,materialiseBuilding} from '../src/building-loader.js';
import {tilePriority,aheadPoint,createFrameQueue,createDetailScheduler} from '../src/tile-streaming.js';

const part=(start,count,texture,id)=>({id,start,count,texture,bbox:[0,0,10,10],height:12,ratu:1});
// Two triangles per part: positions then uv, 5 floats per vertex.
const tri=(x)=>[x,0,0,0,0, x+1,0,0,1,0, x,3,0,0,1, x+1,0,0,1,0, x+1,3,0,1,1, x,3,0,0,1];
const array=new Float32Array([...tri(0),...tri(2),...tri(4),...tri(6)]);

test('tile level steps far→near→hidden with a hysteresis band that never flickers',()=>{
 assert.equal(tileLevel(null,100),'near');assert.equal(tileLevel(null,LOD.near+10),'far');assert.equal(tileLevel(null,LOD.visible+1),'hidden');
 let level='near';for(const d of [230,250,270,285,275,255,245]){level=tileLevel(level,d);assert.equal(level,'near',`stay near inside the band at ${d}`);}
 level=tileLevel(level,LOD.far+1);assert.equal(level,'far');
 for(const d of [285,260,245])assert.equal(level=tileLevel(level,d),'far','stay far until well inside');
 assert.equal(tileLevel(level,LOD.near-1),'near');
});

test('merged shells join contiguous parts per atlas and split at gaps',()=>{
 const parts=[part(0,6,'a.jpg','p0'),part(6,6,'a.jpg','p1'),part(12,6,null,'p2'),part(18,6,'b.jpg','p3')];
 const ranges=mergedShellRanges(parts);
 assert.deepEqual(ranges,[{texture:'a.jpg',start:0,end:12},{texture:null,start:12,end:18},{texture:'b.jpg',start:18,end:24}]);
 assert.equal(mergedShellRanges([parts[0],parts[3]]).length,2,'landmark gap splits a run');
 const textures=new Map([['a.jpg',new THREE.Texture()],['b.jpg',new THREE.Texture()]]);
 const meshes=createMergedShells(array,parts,textures);
 assert.equal(meshes.length,3);assert.equal(meshes[0].geometry.attributes.position.count,12);assert.equal(meshes[0].material.map,textures.get('a.jpg'));
 assert.equal(meshes[1].material.map,null);assert.ok(meshes.every(m=>m.userData.lod&&!m.castShadow&&m.userData.box.isEmpty()));
 array.fill(7);assert.equal(meshes[2].geometry.attributes.position.getX(1),7);array.set([...tri(0),...tri(2),...tri(4),...tri(6)]);
});

function tileGroup(){
 const group=new THREE.Group(),textures=new Map([['a.jpg',new THREE.Texture()]]);
 const parts=[part(0,6,'a.jpg','p0'),part(6,6,'a.jpg','p1')];
 group.add(...createMergedShells(array,parts,textures));for(const p of parts)group.add(createSourceShell(array,p,textures.get('a.jpg')));
 return {group,parts,textures};
}
test('far tiles show only merged shells; near tiles show per-part shells until details land',()=>{
 const {group,parts,textures}=tileGroup(),focus=new THREE.Vector3(0,0,0);
 applyTileLod(group,'far',focus);
 assert.ok(group.visible);assert.deepEqual(group.children.map(m=>m.visible),[true,false,false]);
 applyTileLod(group,'near',focus);
 assert.deepEqual(group.children.map(m=>m.visible),[false,true,true]);assert.ok(group.children[1].castShadow,'near shell casts');
 const building={part:parts[0],windows:2,meshes:[
  {attributes:{position:{array:new Float32Array(9),itemSize:3,normalized:false}},shell:true,role:'facade',material:{color:0xffffff,roughness:.8,metalness:0,side:2,vertexColors:false,textured:true}},
  {attributes:{position:{array:new Float32Array(9),itemSize:3,normalized:false}},shell:false,role:'detail',material:{color:0x222222,roughness:.5,metalness:.1,side:0,vertexColors:false,textured:false}},
  {attributes:{position:{array:new Float32Array(9),itemSize:3,normalized:false}},shell:true,role:'detail',material:{color:0x222222,roughness:.5,metalness:.1,side:0,vertexColors:false,textured:false}}]};
 const meshes=materialiseBuilding(building,textures);group.add(...meshes);
 assert.ok(meshes.every(m=>!m.material.transparent),'building materials are opaque until the chase camera fades them');
 applyTileLod(group,'near',focus);
 assert.deepEqual(meshes.map(m=>m.visible),[true,true,true]);assert.deepEqual(meshes.map(m=>m.castShadow),[true,false,true]);
 applyTileLod(group,'near',new THREE.Vector3(500,0,0));
 assert.deepEqual(meshes.map(m=>m.visible),[true,false,true],'window details hide beyond the detail radius');assert.ok(meshes.every(m=>!m.castShadow),'distant shells stop casting');
 applyTileLod(group,'far',focus);
 assert.deepEqual(meshes.map(m=>m.visible),[false,false,true],'authored hero fronts stay visible at the far level');
 assert.ok(meshes.every(m=>!m.castShadow));
 applyTileLod(group,'hidden',focus);assert.equal(group.visible,false);
});

test('frozen tile groups are skipped by the per-frame matrix walk',()=>{
 const {group}=tileGroup();const scene=new THREE.Scene();scene.add(group);freezeTileGroup(group);
 let touched=0;for(const m of group.children)m.updateMatrixWorld=()=>{touched++;};
 scene.updateMatrixWorld(true);assert.equal(touched,0);assert.ok(group.children.every(m=>!m.matrixAutoUpdate));
});

test('tree chunks step canopy detail down with distance, hide past the fog and cast only near the car',()=>{
 const geometries=[0,1,2].map(d=>new THREE.IcosahedronGeometry(1,d));
 const chunk=(x)=>({key:'k'+x,trunk:new THREE.Mesh(),leaf:new THREE.Mesh(geometries[2]),box:new THREE.Box3(new THREE.Vector3(x,0,0),new THREE.Vector3(x+10,14,10)),detailed:null});
 const chunks=[chunk(0),chunk(300),chunk(600),chunk(1200)];
 applyTreeLod(chunks,new THREE.Vector3(0,0,0),geometries);
 assert.deepEqual(chunks.map(c=>c.leaf.geometry.parameters.detail),[2,1,0,0]);
 assert.deepEqual(chunks.map(c=>c.leaf.visible),[true,true,true,false]);
 assert.deepEqual(chunks.map(c=>c.leaf.castShadow),[true,false,false,false]);
 assert.equal(treeLeafDetail(100),2);
});

test('detailed tree buckets hand over full → reduced canopy → blob proxies with hysteresis',()=>{
 const geometries=[0,1,2].map(d=>new THREE.IcosahedronGeometry(1,d));
 const near=[new THREE.Mesh(),new THREE.Mesh()],far=[new THREE.Mesh(),new THREE.Mesh()];
 const c={key:'d0,0',trunk:new THREE.Mesh(),leaf:new THREE.Mesh(geometries[2]),box:new THREE.Box3(new THREE.Vector3(0,0,0),new THREE.Vector3(10,14,10)),detailed:{near,far}};
 const at=x=>applyTreeLod([c],new THREE.Vector3(x,0,0),geometries);
 at(50);assert.ok(near.every(m=>m.visible&&m.castShadow));assert.ok(far.every(m=>!m.visible));assert.equal(c.leaf.visible,false);
 at(170);assert.ok(near.every(m=>m.visible),"still near inside the band");assert.ok(near.every(m=>!m.castShadow),"but no longer casting at 170 m");
 at(200);assert.ok(near.every(m=>!m.visible));assert.ok(far.every(m=>m.visible&&!m.castShadow),'reduced canopy takes over');assert.equal(c.leaf.visible,false);
 at(170);assert.ok(near.every(m=>!m.visible),"stays mid inside the band");
 at(500);assert.ok(far.every(m=>!m.visible));assert.ok(c.leaf.visible&&c.trunk.visible,'blob proxy beyond the reduced canopy range');
 at(450);assert.ok(c.leaf.visible,'stays on the proxy inside the band');
 at(100);assert.ok(near.every(m=>m.visible));assert.equal(c.leaf.visible,false);
});

test('static shadow culler lets only nearby scenery cast and ignores tiles and self-managed trees',()=>{
 const root=new THREE.Group();
 const near=new THREE.Mesh(new THREE.BoxGeometry(2,2,2));near.position.set(50,0,0);near.castShadow=true;
 const far=new THREE.Mesh(new THREE.BoxGeometry(2,2,2));far.position.set(600,0,0);far.castShadow=true;
 const never=new THREE.Mesh(new THREE.BoxGeometry(2,2,2));never.castShadow=false;
 const tile=new THREE.Group();tile.userData.textures=new Map();const inTile=new THREE.Mesh(new THREE.BoxGeometry(1,1,1));inTile.castShadow=true;tile.add(inTile);
 const tree=new THREE.Mesh(new THREE.BoxGeometry(1,1,1));tree.castShadow=true;tree.userData.shadowLod=true;
 const instanced=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial(),1);instanced.setMatrixAt(0,new THREE.Matrix4().makeTranslation(900,0,0));instanced.castShadow=true;
 root.add(near,far,never,tile,tree,instanced);root.updateMatrixWorld(true);
 const culler=createStaticShadowCuller(root,{range:170});
 culler.update(new THREE.Vector3(0,0,0));
 assert.equal(culler.size,3);assert.equal(near.castShadow,true);assert.equal(far.castShadow,false);assert.equal(instanced.castShadow,false);
 assert.equal(never.castShadow,false);assert.equal(inTile.castShadow,true);assert.equal(tree.castShadow,true);
 culler.update(new THREE.Vector3(600,0,0));assert.equal(far.castShadow,true);assert.equal(near.castShadow,false);
});

test('streaming priority favours tiles where the car is heading',()=>{
 const tile=(x)=>({bbox:[x,-10,x+100,10]});
 const focus={x:0,z:0},car={x:0,z:0,speed:25,heading:Math.PI/2}; // heading π/2 ⇒ forward is -x
 const ahead=aheadPoint(car,4,160);assert.ok(ahead.x<-99&&Math.abs(ahead.z)<1e-9);
 assert.ok(tilePriority(tile(-350),focus,ahead)<tilePriority(tile(250),focus,ahead),'tile ahead outranks tile behind at equal distance');
 assert.equal(tilePriority(tile(-50),focus,null),0);
 assert.equal(aheadPoint(null),null);assert.equal(aheadPoint({x:3,z:4,speed:0,heading:1}).x,3);
});

test('frame queue rations jobs per step and the scheduler runs nearest-first with a concurrency limit',async()=>{
 const q=createFrameQueue({maxJobs:2,budgetMs:1000});const ran=[];for(let i=0;i<5;i++)q.push(()=>ran.push(i));
 assert.equal(q.step(),2);assert.deepEqual(ran,[0,1]);q.step();q.step();assert.deepEqual(ran,[0,1,2,3,4]);assert.equal(q.size,0);
 const order=[];let release;const first=new Promise(r=>release=r);
 const s=createDetailScheduler(1);
 s.request('a',300,()=>{order.push('a');return first;});
 s.request('b',100,()=>{order.push('b');});s.request('c',50,()=>{order.push('c');});
 assert.ok(s.request('b',10)===false,'re-requesting only re-prioritises');
 assert.equal(s.cancel('c'),true);
 await Promise.resolve();assert.deepEqual(order,['a']);assert.equal(s.inFlight,1);
 release();await new Promise(r=>setTimeout(r,0));
 assert.deepEqual(order,['a','b']);assert.equal(s.waiting,0);assert.equal(s.inFlight,0);
});

test('meshes whose tile shadow casters cast for them never cast themselves; casters are left to the shadow pass',()=>{
 const {group,parts,textures}=tileGroup(),focus=new THREE.Vector3(0,0,0);
 const building={part:parts[0],windows:0,meshes:[{attributes:{position:{array:new Float32Array(9),itemSize:3,normalized:false}},shell:true,role:'facade',material:{color:0xffffff,roughness:.8,metalness:0,side:2,vertexColors:false,textured:true}}]};
 const meshes=materialiseBuilding(building,textures);for(const m of [...meshes,...group.children])m.userData.castByTile=true;group.add(...meshes);
 const caster=new THREE.Mesh(group.children[0].geometry,new THREE.MeshBasicMaterial());caster.visible=false;caster.castShadow=true;caster.userData.shadowCaster=true;group.add(caster);
 applyTileLod(group,'near',focus);
 assert.ok(group.children.filter(m=>m!==caster).every(m=>!m.castShadow),'nothing but the caster casts');
 assert.equal(caster.visible,false);assert.equal(caster.castShadow,true);
});
