import test from 'node:test';
import assert from 'node:assert/strict';
import {createLandmarks,CB1760,CUT_1760,cutParts1760,cutFootprints1760,cutRoadWalls1760} from '../src/copenhagen/landmarks.js';

// 1760 draws the first Christiansborg (1733-45) where today's main block (1907-28) stands: the model's block is cut out,
// the palace is hand-built, and its collision outline is where its walls are drawn (no invisible walls, no walls to drive through).
const {x,z,rot,hx,hz}=CB1760,c=Math.cos(rot),s=Math.sin(rot),world=(u,v)=>[x+u*c+v*s,z-u*s+v*c];
test('the first Christiansborg is solid where it is drawn, and only there', () => {
 const lm=createLandmarks({era:1760,anchors:{},mills:[]}),obs=lm.obstacles.filter(o=>/Christiansborg/.test(o.name));
 const inside=(X,Z)=>obs.some(o=>{const r=o.rings[0];let q=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>Z)!==(b[1]>Z)&&X<(b[0]-a[0])*(Z-a[1])/(b[1]-a[1])+a[0])q=!q;}return q;});
 assert.ok(inside(...world(0,0))&&inside(...world(-hx-2,0))&&inside(...world(hx-1,hz-1)),'block, tower front and corners are solid');
 assert.ok(!inside(...world(-hx-3,0))&&!inside(...world(-hx-.5,20))&&!inside(...world(0,hz+1.5)),'the riding ground and the streets round it are open');
 let tris=0;lm.group.traverse(m=>{if(m.isMesh&&!m.isInstancedMesh)tris+=(m.geometry.index?m.geometry.index.count:m.geometry.attributes.position.count)/3;});
 assert.ok(tris<30000,`landmarks ${tris} triangles`);
 assert.equal(createLandmarks({era:null,anchors:{},mills:[]}).obstacles.filter(o=>/Christiansborg/.test(o.name)).length,0,'today: not drawn');
});
test('today\'s main block is cut out of the model part, the riding ground wings stay', () => {
 const id='kk-osm-way-25992657',tri=(...p)=>p.flatMap(([X,Z])=>[X,10,Z,0,0]);
 const a=new Float32Array([...tri(world(0,0),world(5,0),world(0,5)),...tri([60,500],[65,500],[60,505]),...tri(world(0,-hz+.5),world(0,-hz-3),world(4,-hz))]);
 assert.equal(cutParts1760(a,[{id,start:0,count:9}]),1);
 assert.deepEqual([...a.slice(5,8)],[...a.slice(0,3)],'inside: collapsed');assert.notDeepEqual([...a.slice(20,23)],[...a.slice(15,18)],'riding ground wing kept');assert.notDeepEqual([...a.slice(35,38)],[...a.slice(30,33)],'reaching out: kept');
 const b=cutFootprints1760([{id:'osm-way-25992657',rings:[[[0,0],[1,0],[1,1]]]},{id:'other',rings:[]}]);
 assert.equal(b.length,CUT_1760[id].footprint.length+1);assert.ok(b.every(f=>f.id!=='osm-way-25992657'||f.rings[0].every(([X,Z])=>{const u=(X-x)*c-(Z-z)*s,v=(X-x)*s+(Z-z)*c;return Math.abs(u)>hx-.5||Math.abs(v)>hz-.5;})));
 const w=cutRoadWalls1760([{id,rings:[[world(0,40),world(1,40),world(1,41)]]},{id,rings:[[[60,500],[61,500],[61,501]]]}]);assert.equal(w.length,1);
});
