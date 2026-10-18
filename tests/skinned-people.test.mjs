import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import * as THREE from 'three';
import {createSkinnedCrowd} from '../src/skinned-people.js';
import {createPlayerTravelRenderer} from '../src/player-travel-renderer.js';

// A two-bone stand-in for a Quaternius character: one skinned mesh, Walk/Run/Idle clips on its bones.
function fakeLibrary(){
 const root=new THREE.Bone();root.name='Root';const hips=new THREE.Bone();hips.name='Hips';hips.position.y=1;root.add(hips);
 const geometry=new THREE.BoxGeometry(.4,1.8,.3);const n=geometry.attributes.position.count;
 geometry.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(new Array(n*4).fill(0).map((_,i)=>i%4===0?1:0),4));
 geometry.setAttribute('skinWeight',new THREE.Float32BufferAttribute(new Array(n*4).fill(0).map((_,i)=>i%4===0?1:0),4));
 {const c=new THREE.Color('#47375b'),arr=new Float32Array(n*3);for(let i=0;i<n;i++)arr.set([c.r,c.g,c.b],i*3);geometry.setAttribute('color',new THREE.BufferAttribute(arr,3));} // a purple hoodie all over
 const mesh=new THREE.SkinnedMesh(geometry,new THREE.MeshStandardMaterial());const scene=new THREE.Group();scene.add(root,mesh);mesh.bind(new THREE.Skeleton([root,hips]));
 const clip=name=>new THREE.AnimationClip(name,1,[new THREE.NumberKeyframeTrack('Hips.position[y]',[0,1],[1,1.05])]);
 return {models:[{name:'M_Test',scene,clips:{Walk:clip('Walk'),Run:clip('Run'),Idle:clip('Idle')},height:1.8}],material:mesh.material};
}
const walker=(id,x,z,extra={})=>({id,x,z,heading:0,speed:1.3,edge:{},...extra});

test('the nearest walkers are drawn rigged, at their place and facing their way, and no more than max',()=>{
 const crowd=createSkinnedCrowd(fakeLibrary(),{max:2,range:24});
 const near=walker(1,3,0),nearer=walker(2,1,0,{heading:Math.PI/2}),far=walker(3,40,0),third=walker(4,5,0);
 const drawn=crowd.update(.016,{x:0,z:0},[near,nearer,far,third],[]);
 assert.deepEqual([...drawn].map(a=>a.id).sort(),[1,2],'the two nearest within range');
 const shown=crowd.group.children.filter(c=>c.visible);assert.equal(shown.length,2);
 const forNearer=shown.find(c=>Math.abs(c.position.x-1)<1e-6);assert.ok(forNearer,'a rigged figure stands at the walker');
 // walkers face (-sin h, -cos h); the model faces +Z, so rotation.y = h + PI turns it to the same way
 const h=forNearer.rotation.y,face=[Math.sin(h),Math.cos(h)];assert.ok(Math.abs(face[0]+1)<1e-6&&Math.abs(face[1])<1e-6,`faces ${face}`);
});

test('anyone with a pose, a fall, a suitcase or a conversation keeps the procedural figure',()=>{
 const crowd=createSkinnedCrowd(fakeLibrary(),{max:10,range:24});
 const list=[walker(1,1,0,{pose:'phone'}),walker(2,2,0,{knockdown:{}}),walker(3,3,0,{suitcase:true}),walker(4,4,0,{conversation:true}),walker(5,5,0,{pose:'cycle'}),walker(6,6,0)];
 assert.deepEqual([...crowd.update(.016,{x:0,z:0},list,[])].map(a=>a.id),[6]);
});

test('figures are released when their walker leaves the range and reused for the next',()=>{
 const crowd=createSkinnedCrowd(fakeLibrary(),{max:1,range:24}),a=walker(1,2,0),b=walker(2,30,0);
 crowd.update(.016,{x:0,z:0},[a,b],[]);a.x=60;b.x=3;
 const drawn=crowd.update(.016,{x:0,z:0},[a,b],[]);
 assert.deepEqual([...drawn].map(w=>w.id),[2]);assert.equal(crowd.group.children.length,1,'one figure, reused');
 crowd.update(.016,null,[a,b],[]);assert.equal(crowd.group.children.filter(c=>c.visible).length,0,'no viewer: all hidden');
});

test('the walking player is the rigged character; riding, falling or carrying shows the procedural figure',()=>{
 const r=createPlayerTravelRenderer(new THREE.Group());r.setRigged(fakeLibrary(),'M_Test');
 const p={x:10,z:-5,heading:0,speed:1.4,distance:0},travel={mode:'walk',riding:null,rides:[],viewActor:()=>p};
 r.update(travel,1/60);const rig=r.group.getObjectByName('Player (rigged)');
 assert.ok(rig?.visible,'rigged while walking');assert.equal(rig.position.x,10);assert.equal(r.rigged(),'M_Test');
 assert.ok(Math.abs(Math.sin(rig.rotation.y))<1e-6&&Math.cos(rig.rotation.y)<-.999,'faces -Z, the way heading 0 walks');
 p.knockdown={elapsed:.1,duration:2,prone:false,side:1};r.update(travel,1/60);assert.equal(rig.visible,false,'falls as the procedural figure');delete p.knockdown;
 r.update(travel,1/60,{hold:'carry'});assert.equal(rig.visible,false,'carries as the procedural figure');
 r.update(travel,1/60);assert.equal(rig.visible,true);
 travel.mode='car';r.update(travel,1/60);assert.equal(rig.visible,false,'hidden in the car');
 r.setRigged(null);assert.equal(r.group.getObjectByName('Player (rigged)'),undefined);assert.equal(r.rigged(),null);
});

test('the player wears its own colours: a recoloured copy, the walkers keep theirs',()=>{
 const lib=fakeLibrary(),r=createPlayerTravelRenderer(new THREE.Group());r.setRigged(lib,'M_Test',[{from:'#47375b',to:'#d65f39',above:0},{from:'#47375b',to:'#2b2b2b'}]);
 const rig=r.group.getObjectByName('Player (rigged)');let mine=null,theirs=null;rig.traverse(o=>{if(o.isSkinnedMesh)mine=o;});lib.models[0].scene.traverse(o=>{if(o.isSkinnedMesh)theirs=o;});
 assert.notEqual(mine.geometry,theirs.geometry,'own geometry');const c=mine.geometry.attributes.color,y=mine.geometry.attributes.position;
 const orange=new THREE.Color('#d65f39'),dark=new THREE.Color('#2b2b2b');
 for(let i=0;i<c.count;i++){const want=y.getY(i)>0?orange:dark;assert.ok(Math.abs(c.getX(i)-want.r)<1e-6&&Math.abs(c.getZ(i)-want.b)<1e-6,`vertex ${i}`);}
 const purple=new THREE.Color('#47375b');assert.ok(Math.abs(theirs.geometry.attributes.color.getX(0)-purple.r)<1e-6,'the walkers\' copy is untouched');
});

// A `//` comment written into a one-line statement swallows the rest of the line (it hid the Absalon rider and the
// rigged walkers' distance test). Every module must at least parse.
test('every source module parses',()=>{
 const files=[];const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p);else if(/\.m?js$/.test(e.name))files.push(p);}};walk('src');
 const bad=files.filter(f=>spawnSync(process.execPath,['--check',f],{encoding:'utf8'}).status!==0);
 assert.deepEqual(bad,[]);
});
