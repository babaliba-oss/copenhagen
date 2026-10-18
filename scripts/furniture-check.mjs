// npm run furniture:check -- [city] [screenshot-dir]   (needs `npm run dev` running; GAME_URL to point elsewhere)
// Drives the car into detected street furniture from furniture.json and checks it reacts like Helsinki's:
// lamp and sign posts bend or snap, bins are knocked over, junction boxes stop the car.
// Exits non-zero if any check fails.
import fs from 'node:fs';
import {chromium} from '@playwright/test';
import {gunzipSync} from 'node:zlib';
import {SpatialIndex} from '../src/geo.js';

const id=process.argv[2]||'tampere',shots=process.argv[3],base=process.env.GAME_URL||'http://127.0.0.1:5173';
const layer=JSON.parse(fs.readFileSync(`public/cities/${id}/furniture.json`)),city=JSON.parse(gunzipSync(fs.readFileSync(`public/cities/${id}/city.pack`)));
const buildings=new SpatialIndex(city.buildings),solids=layer.items.filter(i=>/junction-box|bench|bike-rack|hydrant/.test(i.k));
// A straight run-up from the road side: 14 m clear of buildings and other furniture.
function approach(it){
 for(const turn of [0,.4,-.4,.8,-.8,Math.PI]){const yaw=(it.yaw||0)+turn,dx=Math.sin(yaw),dz=Math.cos(yaw);
  const clear=[...Array(28)].every((_,k)=>{const d=1.2+k*.5,x=it.x+dx*d,z=it.z+dz*d;return !buildings.at(x,z)&&![-1,1].some(s=>buildings.at(x+dz*s,z-dx*s))&&!layer.items.some(o=>o!==it&&Math.hypot(o.x-x,o.z-z)<1.6);});
  if(clear)return {x:it.x+dx*14,z:it.z+dz*14,heading:yaw};}
 return null;
}
const pick=(kind,n)=>layer.items.filter(i=>i.k===kind&&Math.hypot(i.x,i.z)<900).map(it=>({it,start:approach(it)})).filter(c=>c.start).slice(0,n);
const browser=await chromium.launch({channel:process.env.PW_CHANNEL||'chrome'}),errors=[];
// A fresh game per run-up: a rampage brings the police, and a busted driver stops moving.
async function open(){
 const page=await browser.newPage({viewport:{width:1280,height:800}});page.on('pageerror',e=>errors.push(String(e)));
 await page.goto(`${base}/?city=${id}`);
 await page.waitForFunction(()=>window.openCityDrive?.getState().ready||window.helsinkiBootError,null,{timeout:180000});
 const failed=await page.evaluate(()=>window.helsinkiBootError);if(failed)throw Error(`Game failed to start: ${failed.message}`);
 await page.getByRole('button',{name:'Let’s go for a drive'}).click();await page.waitForTimeout(1500);return page;
}
const results=[];
async function drive(kind,{it,start},check){
 const page=await open();
 await page.evaluate(({start})=>{const c=window.openCityDrive.car();Object.assign(c,{x:start.x,z:start.z,heading:start.heading,speed:0});},{start});
 await page.waitForTimeout(300);
 const before=await page.evaluate(()=>window.openCityDrive.getState().knockables);
 await page.keyboard.down('w');await page.waitForTimeout(2600);await page.keyboard.up('w');await page.waitForTimeout(700);
 const after=await page.evaluate(({it})=>{const s=window.openCityDrive.getState(),m=window.openCityDrive.mappedFurniture,car=window.openCityDrive.car();
  let post=null;for(const c of m.chunks.values())for(const b of c.signs.bodies)if(Math.hypot(b.x-it.x,b.z-it.z)<.05)post={state:b.state,knocked:b.knocked};
  return {knockables:s.knockables,post,car:{x:car.x,z:car.z,speed:car.speed},distance:Math.hypot(car.x-it.x,car.z-it.z),flags:{paused:s.paused,started:s.started,busted:s.police?.busted,map:s.mapOpen}};},{it});
 const ok=check(before,after);results.push({kind,at:[it.x,it.z],ok,post:after.post,hits:after.knockables.hits-before.hits,carToObject:+after.distance.toFixed(2),flags:after.flags});
 // Look back at the object from beside the run-up.
 if(shots){const a=(it.yaw||0)+.9;await page.evaluate(v=>{window.openCityDrive.inspectCamera(v);document.getElementById('pause-overlay').hidden=true;},{eye:[it.x+Math.sin(a)*8,3.2,it.z+Math.cos(a)*8],target:[it.x,1.2,it.z]});
  await page.waitForTimeout(900);await page.screenshot({path:`${shots}/hit-${kind}-${results.length}.png`});}
 await page.close();
}
for(const c of pick('lamp',2))await drive('lamp',c,(b,a)=>a.post?.knocked&&a.post.state!=='upright'&&a.knockables.hits>b.hits);
for(const c of pick('sign',1))await drive('sign',c,(b,a)=>a.post?.knocked&&a.knockables.hits>b.hits);
for(const c of pick('bin',1))await drive('bin',c,(b,a)=>a.knockables.knocked>b.knocked);
for(const c of pick('junction-box',1))await drive('junction-box',c,(b,a)=>a.distance<3.2&&a.distance>.3);
console.log(JSON.stringify({city:id,results,errors},null,1));
await browser.close();
if(errors.length||!results.length||results.some(r=>!r.ok))process.exit(1);
