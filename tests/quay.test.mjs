import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {extractQuayEdges,buildQuayGeometry,createGroundGeometry,waterLocator,WATER_LEVEL,COPING_TOP,QUAY_FOOT} from '../src/quay.js';
import {createSea} from '../src/sea.js';

const sq=(x0,z0,x1,z1)=>[[x0,z0],[x1,z0],[x1,z1],[x0,z1]];
const poly=(rings,extra={})=>({rings,...extra});
// A 40 m basin: land (pavement) along the west, another water body sharing
// the east edge, the map boundary on the south edge, a park on the north.
const basin=poly([sq(0,-40,40,2400)]);
const neighbour=poly([sq(40,-40,80,2400)]);
const land={pavement:[poly([sq(-20,-40,0,2400)])],parks:[poly([sq(-5,-60,80,-40)])],roads:[],buildings:[]};
const mid=e=>[(e.a[0]+e.b[0])/2,(e.a[1]+e.b[1])/2];

test('water locator matches polygons with holes',()=>{
 const inside=waterLocator([poly([sq(0,0,10,10),sq(4,4,6,6)])]);
 assert.equal(inside(1,1),true);assert.equal(inside(5,5),false);assert.equal(inside(11,5),false);
});

test('quay edges only border land: not other water, not the map boundary',()=>{
 const edges=extractQuayEdges([basin,neighbour],land,{extent:2400});
 assert.ok(edges.length>0);
 for(const e of edges){const [x,z]=mid(e);assert.ok(!(Math.abs(x-40)<1e-6),'shared water edge skipped');assert.ok(z<2399,'boundary skipped');}
 const west=edges.filter(e=>Math.abs(mid(e)[0])<1e-6);
 assert.ok(west.length>0&&west.every(e=>e.kind==='quay'),'pavement shore is a granite quay');
 assert.ok(west.every(e=>e.n[0]<-.99),'land normal points away from the water');
 const north=edges.filter(e=>Math.abs(mid(e)[1]+40)<1e-6);
 assert.ok(north.length>0&&north.every(e=>e.kind==='park'&&e.n[1]<-.99));
 assert.ok(!edges.some(e=>Math.abs(mid(e)[0]-80)<1e-6&&e.kind==='quay'));
});

test('island holes get walls facing outward into the water',()=>{
 const edges=extractQuayEdges([poly([sq(0,0,100,100),sq(40,40,60,60)])],{pavement:[poly([sq(40,40,60,60)])]},{extent:2400});
 const island=edges.filter(e=>{const [x,z]=mid(e);return x>=40&&x<=60&&z>=40&&z<=60;});
 assert.equal(island.length,4);
 for(const e of island){const [x,z]=mid(e);assert.ok((x+e.n[0]-50)**2+(z+e.n[1]-50)**2<(x-50)**2+(z-50)**2,'normal points into the island');assert.equal(e.kind,'quay');}
});

test('paving mapped over the water is walled, and shoreline under it is hidden',()=>{
 const pier=poly([sq(20,0,30,50)]);
 const edges=extractQuayEdges([poly([sq(0,0,100,100)])],{pavement:[pier,poly([sq(-10,-10,0,110)])]},{extent:2400});
 const pierEdges=edges.filter(e=>{const [x,z]=mid(e);return x>=20&&x<=30&&z>0&&z<=50;});
 assert.ok(pierEdges.length>=3&&pierEdges.every(e=>e.kind==='quay'));
 assert.ok(!edges.some(e=>{const [x,z]=mid(e);return z<1e-6&&x>20&&x<30;}),'no wall under the pier');
});

test('quay geometry is finite, closed at the corners, and has the photographed wall height',()=>{
 const edges=extractQuayEdges([basin,neighbour],land,{extent:2400}),{geometry,skirt}=buildQuayGeometry(edges);
 const p=geometry.attributes.position.array;assert.ok(p.length>0&&p.every(Number.isFinite));
 assert.ok(skirt.attributes.position.array.every(Number.isFinite));
 let minY=Infinity,maxY=-Infinity;for(let i=1;i<p.length;i+=3){minY=Math.min(minY,p[i]);maxY=Math.max(maxY,p[i]);}
 assert.equal(minY,QUAY_FOOT);assert.ok(minY<WATER_LEVEL,'wall foot is under the water line');
 assert.ok(Math.abs(maxY-(COPING_TOP+.5))<1e-6,'bollards on the coping');
 const wallAboveWater=COPING_TOP-WATER_LEVEL;assert.ok(wallAboveWater>1&&wallAboveWater<1.6);
 // Coping top faces exist at street level with upward normals.
 const n=geometry.attributes.normal.array;let coping=0;for(let i=0;i<p.length;i+=3)if(Math.abs(p[i+1]-COPING_TOP)<1e-6&&Math.abs(n[i+1])>.99)coping++;
 assert.ok(coping>0);
 // Wall face vertices lie exactly on the shoreline (no gap between water and wall).
 const west=[];for(let i=0;i<p.length;i+=3)if(p[i+1]===QUAY_FOOT&&Math.abs(p[i])<1e-6)west.push(p[i+2]);
 assert.ok(west.length>0);
});

test('ground plane is cut where the sea is, keeping islands',()=>{
 const g=createGroundGeometry([poly([sq(0,0,100,100),sq(40,40,60,60)])],1000),p=g.attributes.position;
 let area=0;const cut=[];
 for(let i=0;i<p.count;i+=3){const a=new THREE.Vector3().fromBufferAttribute(p,i),b=new THREE.Vector3().fromBufferAttribute(p,i+1),c=new THREE.Vector3().fromBufferAttribute(p,i+2);
  const cr=b.clone().sub(a).cross(c.clone().sub(a));assert.ok(cr.z>=0,'faces +Z in plane space');area+=cr.length()/2;
  const x=(a.x+b.x+c.x)/3,z=-(a.y+b.y+c.y)/3;if(x>0&&x<100&&z>0&&z<100&&!(x>40&&x<60&&z>40&&z<60))cut.push([x,z]);}
 assert.equal(cut.length,0);assert.ok(Math.abs(area-(1000*1000-100*100+400))<1e-3);
});

test('createSea wires water, quays and shade into at most three meshes',()=>{
 const sea=createSea([basin,neighbour],land);
 assert.ok(sea.group.children.filter(m=>m.name!=='Granite quay walls').length<=3,'water and shade in at most three meshes (quays are split into culling cells)');assert.ok(sea.group.getObjectByName('Granite quay walls'));
 assert.ok(sea.group.userData.quayEdges>0);assert.ok(sea.groundGeometry.attributes.position.count>0);
 const shade=sea.group.getObjectByName('Quay shade on water');assert.ok(shade.material.transparent&&!shade.material.depthWrite);
});
