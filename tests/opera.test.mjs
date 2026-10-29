import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import {createLandmarks} from '../src/copenhagen/landmarks.js';
import {OPERA,OPERA_RING,HIDE_TODAY,operaWorld,operaFootprint,operaGeometry} from '../src/copenhagen/opera.js';
import {expandCity} from '../src/city-pack.js';

// Today's Opera on Holmen is hand-built (opera.js): the model's block is hidden, and the mapped outline (the whole roof)
// becomes the body's, so the plaza under the 32 m overhang is open and the body and its glass foyer are solid.
const inRing=(r,X,Z)=>{let q=false;for(let i=0,j=r.length-1;i<r.length;j=i++){const a=r[i],b=r[j];if((a[1]>Z)!==(b[1]>Z)&&X<(b[0]-a[0])*(Z-a[1])/(b[1]-a[1])+a[0])q=!q;}return q;};
const local=(X,Z)=>{const c=Math.cos(OPERA.rot),s=Math.sin(OPERA.rot),dx=X-OPERA.x,dz=Z-OPERA.z;return [dx*c-dz*s,dx*s+dz*c];};
test('the Opera is drawn today, modestly, and not in 1760', () => {
 const today=createLandmarks({era:null,anchors:{},mills:[]}).group,old=createLandmarks({era:1760,anchors:{},mills:[]}).group;
 assert.ok(today.getObjectByName('Opera glass'),'glass foyer drawn');assert.ok(!old.getObjectByName('Opera glass'),'1760: no Opera');
 const o=operaGeometry(),n=['opaque','glass','soffit','lights'].reduce((t,k)=>t+o[k].attributes.position.count/3,0);assert.ok(n>500&&n<4000,`Opera ${n} triangles`);
});
test('the model\'s block is hidden and the mapped outline is the roof the body stands under', () => {
 const idx=JSON.parse(fs.readFileSync('public/cities/copenhagen/buildings3d-index.json','utf8')),part=idx.tiles.flatMap(t=>t.parts).find(p=>p.id===OPERA.part);
 assert.equal(part?.name,'Operaen');assert.ok(HIDE_TODAY.includes(OPERA.part));
 const raw=fs.readFileSync('public/cities/copenhagen/city.pack'),data=expandCity(JSON.parse(raw[0]===31&&raw[1]===139?zlib.gunzipSync(raw):raw));
 const b=data.buildings.find(q=>q.id===OPERA.id);for(const [X,Z] of b.rings[0]){const [u,v]=local(X,Z);assert.ok(u>-1.5&&u<OPERA.len+1.5&&Math.abs(v)<OPERA.hw+1.5,`mapped corner ${u.toFixed(1)},${v.toFixed(1)} on the roof's edge`);}
 operaFootprint(data.buildings);const r=b.rings[0],at=(u,v)=>inRing(r,...operaWorld(u,v));
 assert.ok(at(90,0)&&at(OPERA.apex+.5,0)&&at(OPERA.front+1,OPERA.side-1)&&at(OPERA.back-1,-OPERA.side+1),'the body and the glass foyer are solid');
 assert.ok(!at(OPERA.apex-1,0)&&!at(10,0)&&!at(OPERA.front-2,OPERA.side-2)&&!at(60,OPERA.side+2),'the plaza under the overhang and the eaves along the sides are open');
 assert.deepEqual(r,OPERA_RING.map(([u,v])=>operaWorld(u,v)));assert.ok(b.height>=OPERA.top,'sight lines: as tall as the roof');
});
test('after dark the foyer glass glows warm (night uniform), and by day it adds nothing', () => {
 const g=createLandmarks({era:null,anchors:{},mills:[]}).group.getObjectByName('Opera glass'),m=g.material;assert.ok(m.userData.nightGlow>0);
 const sh={uniforms:{},fragmentShader:'#include <common>\nvoid main(){\n#include <emissivemap_fragment>\n}'};m.onBeforeCompile(sh);
 assert.match(sh.fragmentShader,/totalEmissiveRadiance\+=vec3\([^)]*\)\*uNight/);assert.equal(sh.uniforms.uNight.value,0,'daylight: no glow');
});
