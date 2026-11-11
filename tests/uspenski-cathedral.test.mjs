import {mainSource} from './helpers/main-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import * as THREE from 'three';
import {USPENSKI,USPENSKI_HILL,createUspenskiCathedral,hillHeight,toLocal} from '../src/uspenski-cathedral.js';
import {SpatialIndex,bounds,pointInPolygon,pointInRing} from '../src/geo.js';

const city=JSON.parse(gunzipSync(readFileSync(new URL('../public/data/city.pack',import.meta.url))));
const record=city.buildings.find(b=>b.ratu===1691);
const model=createUspenskiCathedral();
const church=model.group.children.find(o=>/RATU 1691/.test(o.name));

test('Uspenski is the municipal RATU 1691 building (Kanavakatu 1 / Pormestarinrinne 1)',()=>{
 assert.ok(record,'municipal footprint present');assert.equal(record.address,'Pormestarinrinne 1');
 // Minimum-area rectangle of the main block (excluding apses and south wing).
 const pts=record.rings[0].filter(([x,z])=>z<190.5&&x<439.9);let best;
 for(let a=-.12;a<=.12;a+=.001){const c=Math.cos(a),s=Math.sin(a),u=pts.map(([x,z])=>x*c-z*s),v=pts.map(([x,z])=>x*s+z*c),A=(Math.max(...u)-Math.min(...u))*(Math.max(...v)-Math.min(...v));if(!best||A<best.A)best={a,A,u:[Math.min(...u),Math.max(...u)],v:[Math.min(...v),Math.max(...v)]};}
 const c=Math.cos(best.a),s=Math.sin(best.a),cu=(best.u[0]+best.u[1])/2,cv=(best.v[0]+best.v[1])/2;
 assert.ok(Math.abs(best.a-USPENSKI.angle)<.006,`orientation ${best.a}`);
 assert.ok(Math.hypot(cu*c+cv*s-USPENSKI.x,-cu*s+cv*c-USPENSKI.z)<.3,'centre registered');
 assert.ok(Math.abs((best.u[1]-best.u[0])/2-USPENSKI.halfX)<.1&&Math.abs((best.v[1]-best.v[0])/2-USPENSKI.halfZ)<.1);
});

test('reconstruction fills the municipal footprint and height envelope without spilling',()=>{
 const box=new THREE.Box3().setFromObject(church),[x0,z0,x1,z1]=record.bbox;
 assert.ok(box.min.x>x0-1.5&&box.max.x<x1+2.5&&box.min.z>z0-1.5&&box.max.z<z1+1.5,`bbox ${JSON.stringify(box)}`);
 // Municipal LoD2 shell maximum is 48.27 m; the cross top matches it.
 const index=JSON.parse(readFileSync(new URL('../public/data/buildings3d-index.json',import.meta.url)));
 const tile=index.tiles.find(t=>t.parts.some(p=>p.ratu===1691)),part=tile.parts.find(p=>p.ratu===1691&&p.texture);
 const bytes=gunzipSync(readFileSync(new URL('../public/data/'+tile.file,import.meta.url))),a=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/4);
 let top=-Infinity,tx=0,tz=0;for(let i=part.start;i<part.start+part.count;i++)if(a[i*5+1]>top){top=a[i*5+1];tx=a[i*5];tz=a[i*5+2];}
 assert.ok(Math.abs(box.max.y-top)<.5,`cross top ${box.max.y} vs ${top}`);
 // Main dome axis sits on the municipal summit cluster.
 const [lx,lz]=toLocal(tx,tz);assert.ok(Math.hypot(lx-USPENSKI.crossing[0],lz-USPENSKI.crossing[1])<1.2);
 // Every footprint vertex lies inside the modelled mass (local extents incl. apse + south wing).
 for(const [x,z] of record.rings[0]){const [u,v]=toLocal(x,z);const inMain=u>-14.2&&u<21.2&&v>-14.2&&v<14.2,inWing=u>-3&&u<5&&v>12&&v<29.4;assert.ok(inMain||inWing,`footprint vertex ${x},${z}`);}
});

test('geometry is finite, merged per material and within budget; 13 gilded cupolas',()=>{
 let tris=0,meshes=0;
 model.group.traverse(o=>{if(!o.isMesh)return;meshes++;const p=o.geometry.attributes.position;assert.ok(p.array.every(Number.isFinite));tris+=(o.geometry.index?o.geometry.index.count:p.count)/3;assert.equal(o.material.map,null,'procedural materials only');});
 assert.ok(meshes<=12,`draw calls ${meshes}`);assert.ok(tris<150000,`triangles ${tris}`);
 assert.equal(model.group.userData.cupolas,13);assert.equal(model.group.userData.bellTowerCupolas,1);assert.equal(model.group.userData.sourceRatu,1691);
});

test('rock hill is a collision obstacle that encloses the church and stays off mapped streets',()=>{
 const hill=model.obstacles.find(o=>o.id==='uspenski-hill');assert.ok(hill);
 const world=new SpatialIndex([...model.obstacles]);
 for(const [x,z] of record.rings[0])assert.ok(world.at(x,z),'church footprint blocked');
 const ring=USPENSKI_HILL,street=[...city.roads,...city.pavement].map(p=>({...p,bbox:p.bbox||bounds(p.rings)})).filter(p=>p.bbox[2]>355&&p.bbox[0]<460&&p.bbox[3]>140&&p.bbox[1]<240);
 for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.5);
  for(let j=0;j<=n;j++){const x=a[0]+(b[0]-a[0])*j/n,z=a[1]+(b[1]-a[1])*j/n;for(const p of street){const bb=p.bbox;if(bb&&(x<bb[0]||x>bb[2]||z<bb[1]||z>bb[3]))continue;assert.ok(!pointInPolygon(x,z,p.rings),`hill edge enters ${p.kind} ${p.name} at ${x},${z}`);}}}
 for(const p of street)for(const [x,z] of p.rings[0])assert.ok(!pointInRing(x,z,hill.rings[0]),`${p.name} inside hill`);
 // Terrace height under the church, zero at the rim (meets the flat streets).
 assert.ok(Math.abs(hillHeight(USPENSKI.x,USPENSKI.z)-USPENSKI.terrace)<.6);
 for(const [x,z] of ring)assert.ok(hillHeight(x,z)<.8);
});

test('main.js replaces the municipal shell and registers the obstacle',()=>{
 const src=mainSource;
 assert.match(src,/USPENSKI\.ratu\]\.includes\(p\.ratu\)/);assert.match(src,/\.\.\.uspenski\.obstacles/);assert.match(src,/createUspenskiCathedral\(\)/);
});
