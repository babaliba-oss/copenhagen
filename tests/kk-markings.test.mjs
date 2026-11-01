import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {SpatialIndex} from '../src/geo.js';
import {registerCoverage} from '../src/crossing-markings.js';

// Road markings from Københavns Kommune's register (scripts/kk-markings.py), painted in today's surface chunks at 9.5 cm.
const dir=new URL('../public/cities/copenhagen/',import.meta.url),unzip=b=>b[0]===31&&b[1]===139?gunzipSync(b):b;
const city=JSON.parse(unzip(readFileSync(new URL('city.pack',dir)))),index=JSON.parse(readFileSync(new URL('surface-index.json',dir)));
const lin=h=>[0,2,4].map(i=>{const c=parseInt(h.slice(i,i+2),16)/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;});
const paint=[],ground=[];
for(const r of index){const b=unzip(readFileSync(new URL(r.file+'.pack',dir))),a=new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
 for(let i=0;i+17<a.length;i+=18){const y=a[i+1];if(Math.abs(y-.095)>1e-4&&!((Math.abs(y-.07)<1e-4||Math.abs(y-.068)<1e-4)&&a[i+3]<.6)&&!((Math.abs(y-.05)<1e-4||Math.abs(y-.052)<1e-4)&&a[i+3]-a[i+5]>.15))continue; // carriageway (6.8 cm: out to the kerb, kk-kerbs.py), cycle tracks
  const t={x:(a[i]+a[i+6]+a[i+12])/3,z:(a[i+2]+a[i+8]+a[i+14])/3,rgb:[a[i+3],a[i+4],a[i+5]],rings:[[[a[i],a[i+2]],[a[i+6],a[i+8]],[a[i+12],a[i+14]],[a[i],a[i+2]]]]};
  (Math.abs(y-.095)<1e-4?paint:ground).push(t);}}
const is=(t,h)=>t.rgb.every((c,i)=>Math.abs(c-lin(h)[i])<1e-3),white=paint.filter(t=>is(t,'dedbcf')),blue=paint.filter(t=>is(t,'2f63ab'));
const near=(l,x,z,r)=>l.filter(t=>Math.hypot(t.x-x,t.z-z)<r).length;

test('the city\'s zebra crossings, lane lines and blue cycle crossings are painted at Rådhuspladsen, Kongens Nytorv and Dronning Louises Bro',()=>{
 assert.ok(paint.length>200000&&paint.length<320000,`${paint.length} triangles of paint`);
 assert.ok(white.length>paint.length*.9&&blue.length>2000,`${white.length} white, ${blue.length} blue`);
 assert.ok(near(white,-501.9,494.3,4)>=10,'zebra over H.C. Andersens Boulevard at Rådhuspladsen');
 assert.ok(near(blue,-507.7,481.2,6)>=3,'blue cycle crossing beside it');
 assert.ok(near(white,597.8,36.4,4)>=6,'zebra at Kongens Nytorv');
 assert.ok(near(blue,-633.5,-730.4,6)>=3&&near(white,-690.8,-684.9,4)>=6,'blue cycle crossing and zebra at the Dronning Louises Bro end of Nørre Søgade');
});

test('paint lies on the drawn carriageway or cycle track, never on a footway or a house',()=>{
 const drawn=new SpatialIndex(ground),houses=new SpatialIndex(city.buildings);
 const off=[],indoors=[];for(let i=0;i<paint.length;i+=5){const t=paint[i];if(!drawn.at(t.x,t.z))off.push([t.x|0,t.z|0]);if(houses.at(t.x,t.z))indoors.push([t.x|0,t.z|0]);}
 assert.ok(off.length<paint.length/5*.002,`${off.length} off the drawn road: ${JSON.stringify(off.slice(0,8))}`);
 assert.deepEqual(indoors.slice(0,10),[]);
});

test('no generated dashes or zebra stripes where the city\'s paint is drawn; they stay in Frederiksberg',()=>{
 const covered=registerCoverage(JSON.parse(readFileSync(new URL('road-markings.json',dir))));
 for(const [x,z] of [[-501.9,494.3],[597.8,36.4],[-690.8,-684.9],[-633.5,-730.4]])assert.ok(covered(x,z),`${x},${z}`);
 assert.ok(!covered(-1919,612),'Frederiksberg Allé');assert.ok(!covered(1e5,0));
 const life=readFileSync(new URL('../src/street-life.js',import.meta.url),'utf8');assert.match(life,/excluded:\(x,z\)=>authoredOlympiaMarkings\(x,z\)\|\|painted\(x,z\)/);assert.match(life,/if\(painted\(p\.x,p\.z\)\|\|/);
});

test('today\'s Copenhagen credits the city\'s road-marking register',()=>{
 const today=JSON.parse(readFileSync(new URL('../public/cities/index.json',import.meta.url),'utf8')).cities.find(c=>c.id==='copenhagen');
 assert.match(today.attribution,/Road markings \(lane and stop lines, zebra crossings, arrows, blue cycle crossings\): Københavns Kommune, Afmærkning, CC BY 4\.0 \(wfs-kbhkort\.kk\.dk\)/);
});
