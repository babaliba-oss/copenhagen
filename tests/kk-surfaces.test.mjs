import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {SpatialIndex} from '../src/geo.js';

// Cobbles and gravel from Københavns Kommune's surface register (scripts/kk-surfaces.py), in today's surface chunks.
const dir=new URL('../public/cities/copenhagen/',import.meta.url),unzip=b=>b[0]===31&&b[1]===139?gunzipSync(b):b;
const city=JSON.parse(unzip(readFileSync(new URL('city.pack',dir)))),index=JSON.parse(readFileSync(new URL('surface-index.json',dir)));
const lin=h=>[0,2,4].map(i=>{const c=parseInt(h.slice(i,i+2),16)/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;});
function layer(y){const out=[];for(const r of index){const b=unzip(readFileSync(new URL(r.file+'.pack',dir))),a=new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
 for(let i=0;i+17<a.length;i+=18)if(Math.abs(a[i+1]-y)<1e-4&&Math.abs(a[i+7]-y)<1e-4&&Math.abs(a[i+13]-y)<1e-4){const ax=a[i],az=a[i+2],bx=a[i+6],bz=a[i+8],cx=a[i+12],cz=a[i+14];out.push({x:(ax+bx+cx)/3,z:(az+bz+cz)/3,area:Math.abs((bx-ax)*(cz-az)-(cx-ax)*(bz-az))/2,rgb:[a[i+3],a[i+4],a[i+5]]});}}return out;}
const stone=layer(.072),gravel=layer(.062);

test('natural stone is drawn as setts and gravel as gravel, where the city\'s register has them',()=>{
 const m2=l=>l.reduce((s,t)=>s+t.area,0);
 assert.ok(m2(stone)>15000,`${m2(stone)|0} m2 of stone`);assert.ok(m2(gravel)>150000,`${m2(gravel)|0} m2 of gravel`);
 const sett=lin('aaa99e'),grit=lin('c4b9a2');
 assert.ok(stone.every(t=>t.rgb.every((c,i)=>Math.abs(c-sett[i])<1e-3)),'stone in the stone carriageways\' colour (the setts in the ground shader)');
 assert.ok(gravel.every(t=>t.rgb.every((c,i)=>Math.abs(c-grit[i])<1e-3)));
 const near=(l,x,z,r)=>l.filter(t=>Math.hypot(t.x-x,t.z-z)<r).length;
 assert.ok(near(gravel,-720,-38,120)>100,'Ørstedsparken\'s gravel paths');assert.ok(near(stone,-450,-290,120)>50,'stone round Israels Plads');
 const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');assert.match(main,/vGround\.y>0\.059&&vGround\.y<0\.065/,'the ground shader\'s gravel band');
});

test('none of it covers a road, a house or the water',()=>{
 const roads=new SpatialIndex(city.roads.filter(r=>!/island/.test(r.kind||''))),solid=new SpatialIndex([...city.buildings,...city.water]);
 const bad=[];for(const l of [stone,gravel])for(let i=0;i<l.length;i+=7){const t=l[i];if(roads.at(t.x,t.z)||solid.at(t.x,t.z))bad.push([t.x|0,t.z|0]);}
 assert.deepEqual(bad.slice(0,10),[]);
});
