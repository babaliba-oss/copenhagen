import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {SpatialIndex} from '../src/geo.js';
import {danishSign,danishCode,underKind,drawDanish,DK_SIGNS} from '../src/danish-signs.js';
import {signFace,drawSignFace} from '../src/sign-faces.js';
import {plateLayout} from '../src/mapped-furniture.js';

// Copenhagen's road signs from Københavns Kommune's sign register (scripts/kk-signs.py, k101 skilte_total), drawn with
// our own Danish faces (src/danish-signs.js).
const dir=new URL('../public/cities/copenhagen/',import.meta.url),read=f=>JSON.parse(readFileSync(new URL(f,dir)));
const city=JSON.parse(gunzipSync(readFileSync(new URL('city.pack',dir)))),layer=read('furniture.json'),mob=read('mobility.json');
const signs=layer.items.filter(i=>i.k==='sign'&&i.src==='kk-skilte');

test('the register\'s codes map to Danish faces; unknown ones are not drawn',()=>{
 assert.deepEqual([danishSign('DK:C55[40km]').face,danishSign('DK:C55[40km]').text,danishSign('DK:C55[40km]').shape],['dk-c55-40','40','circle']);
 assert.equal(danishSign('DK:E33/E23(ny)[]').wheelchair,true);assert.equal(danishCode('E33,A5'),'E33');assert.equal(danishCode('E18.2'),'E18');
 assert.equal(danishSign('DK:C61').style,'dk-no-stop');assert.equal(danishSign('DK:B11').shape,'triangle-down');assert.equal(danishSign('DK:D15,3').angle,135);
 assert.equal(danishSign('DK:E68,4[30km]').face,'dk-e68-4-30');assert.equal(danishSign('DK:E69,1').end,true);
 assert.equal(danishSign('DK:N42,2').known,false);assert.equal(danishSign('DK:SO').known,false);
 assert.equal(signFace('DK:C19').face,'dk-c19','sign-faces.js reads DK: codes');assert.equal(signFace('DK:U:left').shape,'small');
 assert.deepEqual(['501','H.pil','V.pil','209','UC60,1  "Undertavle med pil begge retninger"'].map(underKind),['text','right','left','bike','both']);
});

test('every Danish face paints on a canvas, inside its cell',()=>{
 const calls=[],ctx=new Proxy({},{get:(o,k)=>k in o?o[k]:(...a)=>{calls.push([k,a]);},set:(o,k,v)=>(o[k]=v,true)});
 const specs=[...Object.keys(DK_SIGNS).map(c=>danishSign(`DK:${c}[30]`)),...['text','left','right','both','bike'].map(k=>danishSign(`DK:U:${k}`))];
 for(const s of specs){calls.length=0;assert.ok(drawDanish(ctx,s,{cx:64,cy:64,r:60,bx:4,by:4,bw:120,bh:120}),s.face);assert.ok(calls.length>2,s.face);drawSignFace(ctx,s,0,0,128,128);}
 for(const [k,a] of calls)if(/^(moveTo|lineTo|fillRect)$/.test(k))assert.ok(a.slice(0,2).every(v=>Number.isFinite(v)&&v>=-1&&v<=129),`${k} ${a}`);
});

test('the register\'s posts stand on the pavement: never on the carriageway, in a house or in the water',()=>{
 assert.ok(signs.length>12000,`${signs.length} register posts`);
 const plates=signs.reduce((n,s)=>n+s.faces.length,0);assert.ok(plates>24000,`${plates} plates`);
 const faces=new Map(layer.faces.map(f=>[f.face,f.code]));
 for(const s of signs){assert.equal(s.faces.length,s.yaws.length);for(const f of s.faces){assert.ok(faces.has(f),f);assert.ok(signFace(faces.get(f)).known,f);}}
 const roads=new SpatialIndex(city.roads.filter(r=>!/island/.test(r.kind||''))),houses=new SpatialIndex([...city.buildings,...read('kk-footprints.json')]),water=new SpatialIndex(city.water);
 const bad={road:0,house:0,water:0};for(const s of signs){if(roads.at(s.x,s.z))bad.road++;if(houses.at(s.x,s.z))bad.house++;if(water.at(s.x,s.z))bad.water++;}
 assert.ok(bad.road<signs.length*.003&&bad.house<signs.length*.003&&bad.water<10,JSON.stringify(bad));
});

test('where the register covers the city the photo-detected signs are gone; Frederiksberg keeps them',()=>{
 const photo=layer.items.filter(i=>i.k==='sign'&&i.src==='mapillary');assert.ok(photo.length>200&&photo.length<1500,`${photo.length} photo signs left`);
 const grid=new Set(signs.map(s=>Math.floor(s.x/100)+','+Math.floor(s.z/100)));
 assert.equal(photo.filter(p=>grid.has(Math.floor(p.x/100)+','+Math.floor(p.z/100))).length,0,'no photo sign in a 100 m cell with a register sign');
 assert.ok(photo.some(p=>Math.hypot(p.x+1900,p.z-600)<400),'Frederiksberg Allé');
});

test('plates face the traffic: along the road they stand by, and the speed plates say the game\'s limit',()=>{
 const edges=mob.roads.edges.filter(e=>!e.crossing),segs=new Map(),G=20;
 edges.forEach((e,k)=>{for(let i=1;i<e.points.length;i++){const [a,b]=[e.points[i-1],e.points[i]],key=Math.floor((a[0]+b[0])/2/G)+','+Math.floor((a[1]+b[1])/2/G);if(!segs.has(key))segs.set(key,[]);segs.get(key).push([a,b,e]);}});
 const nearest=(x,z)=>{let best=null,bd=8;for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++)for(const [a,b,e] of segs.get((Math.floor(x/G)+i)+','+(Math.floor(z/G)+j))||[]){const dx=b[0]-a[0],dz=b[1]-a[1],l=dx*dx+dz*dz;if(!l)continue;const t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/l)),d=Math.hypot(x-a[0]-dx*t,z-a[1]-dz*t);if(d<bd){bd=d;best={dx:dx/Math.sqrt(l),dz:dz/Math.sqrt(l),e};}}return best;};
 let along=0,n=0;for(const s of signs){const e=nearest(s.x,s.z);if(!e)continue;n++;if(Math.abs(Math.sin(s.yaw)*e.dx+Math.cos(s.yaw)*e.dz)>.7)along++;}
 assert.ok(n>8000&&along/n>.9,`${along} of ${n} plates face along the nearest road`);
 const limits=mob.speedLimit,speed=signs.filter(s=>s.faces[0].startsWith('dk-c55-'));assert.ok(speed.length>140,`${speed.length} speed plates`);
 const ok=speed.filter(s=>{const v=+s.faces[0].split('-').pop();return mob.roads.edges.some((e,k)=>limits[k]===v&&e.points.some(p=>Math.hypot(p[0]-s.x,p[1]-s.z)<60));});
 assert.ok(ok.length/speed.length>.95,`${ok.length} of ${speed.length} speed plates match a road edge's limit nearby`);
});

test('a post\'s plates stack under each other, back plates the other way; today credits the register',()=>{
 const s=signs.find(s=>s.faces.length>=3&&s.faces.some(f=>f.startsWith('dk-u-')));assert.ok(s);
 const lay=plateLayout(s.faces.map(face=>({face,code:layer.faces.find(f=>f.face===face).code})),s.yaws);assert.ok(lay.every(p=>p.y>.9),'plates above head height');
 assert.ok(signs.some(s=>new Set(s.yaws).size===2),'double-sided posts');
 const today=JSON.parse(readFileSync(new URL('../public/cities/index.json',import.meta.url),'utf8')).cities.find(c=>c.id==='copenhagen');assert.match(today.attribution,/Københavns Kommune, Skilte, CC BY 4\.0/);
});
