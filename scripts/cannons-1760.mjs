// Guns on the 1760 ramparts: two or three cannons on every bastion's top, at its outer edge, pointing out over the moat.
// The earthworks are the smoothed rampart stretches kk-buildings.py writes (`embankment: 1` parts); a gun stands where the
// top is level (its highest band), set in 2.5 m from the edge. Writes public/cities/copenhagen-1760/cannons.json:
// [[x, y, z, yaw], ...] with y absolute (the parts lifted onto the terrain as the game does) and yaw the muzzle's heading
// (three.js rotation.y; the model's muzzle points +Z).
// node scripts/cannons-1760.mjs
import fs from 'node:fs';import path from 'node:path';import zlib from 'node:zlib';
import {decodeTerrain,setTerrain,liftBuildings,sinkShallowWater,raiseDryHollows,levelBanks} from '../src/terrain.js';
import {inWaterPolygons} from '../src/geo.js';
const root='public/cities/copenhagen-1760',idx=JSON.parse(fs.readFileSync(path.join(root,'buildings3d-index.json'),'utf8'));
{let tb=fs.readFileSync(path.join(root,'terrain.pack'));if(tb[0]===31)tb=zlib.gunzipSync(tb);setTerrain(decodeTerrain(tb.buffer.slice(tb.byteOffset,tb.byteOffset+tb.byteLength)));
 const water=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(root,'city.pack')))).water,wet=(x,z)=>inWaterPolygons(water,x,z);
 sinkShallowWater(wet);raiseDryHollows(wet);levelBanks(wet);} // the terrain as main.js prepares it for 1760, so the parts are lifted to where the game puts them
const CENTRE=[150,0]; // the old town inside the walls: "out" is away from here
const guns=[];
for(const t of idx.tiles){const parts=t.parts.filter(p=>p.embankment&&p.height>=5);if(!parts.length)continue;
 let raw=fs.readFileSync(path.join(root,t.file));if(raw[0]===31&&raw[1]===139)raw=zlib.gunzipSync(raw);
 const a=new Float32Array(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));liftBuildings(a,t.parts.map(p=>({...p})));
 for(const p of parts){let top=-Infinity;for(let i=p.start;i<p.start+p.count;i++)top=Math.max(top,a[i*5+1]);
  const pts=[];for(let i=p.start;i<p.start+p.count;i++)if(a[i*5+1]>top-.25)pts.push([a[i*5],a[i*5+2]]);
  if(pts.length<6)continue;const cx=pts.reduce((s,q)=>s+q[0],0)/pts.length,cz=pts.reduce((s,q)=>s+q[1],0)/pts.length;
  let dx=cx-CENTRE[0],dz=cz-CENTRE[1];const l=Math.hypot(dx,dz)||1;dx/=l;dz/=l;
  // the top's outermost point along "out", and its extent across
  let far=-Infinity,lo=Infinity,hi=-Infinity;for(const [x,z] of pts){const o=(x-cx)*dx+(z-cz)*dz,s=(x-cx)*-dz+(z-cz)*dx;far=Math.max(far,o);lo=Math.min(lo,s);hi=Math.max(hi,s);}
  if(far<4)continue; // a narrow ridge, no level top for a gun
  const across=hi-lo,n=across>30?3:across>14?2:1,yaw=Math.atan2(dx,dz);
  for(let k=0;k<n;k++){const s=n===1?(lo+hi)/2:lo+across*(.25+.5*k/(n-1)),o=far-2.5;
   // keep it on the level top: the nearest top point to the slot
   let best=null,d=Infinity;for(const [x,z] of pts){const q=Math.hypot(x-(cx+dx*o-dz*s),z-(cz+dz*o+dx*s));if(q<d){d=q;best=[x,z];}}
   if(best&&d<4)guns.push([+best[0].toFixed(2),+(top+.02).toFixed(2),+best[1].toFixed(2),+yaw.toFixed(3)]);}}
}
fs.writeFileSync(path.join(root,'cannons.json'),JSON.stringify(guns));
console.log(guns.length,'cannons on',new Set(guns.map(g=>Math.round(g[0]/40)+','+Math.round(g[2]/40))).size,'bastions');
