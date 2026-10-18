// Ground crease sweep: steps and spikes in the ground under streets and pavements (what showed as crumpled paving).
// The terrain is prepared as main.js does (water levelled, the 1760 moat sunk, hollows raised, banks levelled; --raw
// skips that), then every 3 m sample on a road or pavement polygon (not in the water) is compared with its street
// neighbours: the largest step, or the bend (second difference) across it. Flagged samples are grouped into clusters,
// listed worst first with their centre and the street names under them.
// node scripts/ground-crease-sweep.mjs copenhagen-1760 [--raw] [--min=0.45] -> clusters to stdout
import fs from 'node:fs';import zlib from 'node:zlib';
import {expandCity} from '../src/city-pack.js';
import {decodeTerrain,setTerrain,flattenWaterBodies,sinkShallowWater,raiseDryHollows,levelBanks} from '../src/terrain.js';
import {inWaterPolygons,SpatialIndex} from '../src/geo.js';
const city=process.argv[2]||'copenhagen-1760',raw=process.argv.includes('--raw'),root=`public/cities/${city}`;
const MIN=+(process.argv.find(a=>a.startsWith('--min='))?.slice(6)??.45);
const read=f=>{let b=fs.readFileSync(`${root}/${f}`);if(b[0]===31&&b[1]===139)b=zlib.gunzipSync(b);return b;};
const data=expandCity(JSON.parse(new TextDecoder().decode(read('city.pack'))));
const tb=read('terrain.pack'),f=setTerrain(decodeTerrain(tb.buffer.slice(tb.byteOffset,tb.byteOffset+tb.byteLength)));
const wet=(x,z)=>inWaterPolygons(data.water,x,z);
if(!raw){if(city==='copenhagen')flattenWaterBodies();if(city.endsWith('1760'))sinkShallowWater(wet);raiseDryHollows(wet);levelBanks(wet);}
const roads=new SpatialIndex(data.roads.filter(r=>r.rings?.length)),pav=new SpatialIndex(data.pavement.filter(r=>r.rings?.length));
const n=f.size,c=f.cell,E=f.extent,g=f.ground,lim=data.radius||1300,street=new Uint8Array(n*n),name=new Map();
for(let j=0;j<n;j++){const z=-E+j*c;if(Math.abs(z)>lim)continue;for(let i=0;i<n;i++){const x=-E+i*c;if(Math.abs(x)>lim||wet(x,z))continue;const r=roads.at(x,z)||pav.at(x,z);if(r){street[j*n+i]=1;if(r.name)name.set(j*n+i,r.name);}}}
const flagged=new Map();
for(let j=1;j<n-1;j++)for(let i=1;i<n-1;i++){const k=j*n+i;if(!street[k])continue;let step=0;for(const q of [k-1,k+1,k-n,k+n])if(street[q])step=Math.max(step,Math.abs(g[k]-g[q]));
 const bx=street[k-1]&&street[k+1]?Math.abs(g[k-1]-2*g[k]+g[k+1]):0,bz=street[k-n]&&street[k+n]?Math.abs(g[k-n]-2*g[k]+g[k+n]):0,v=Math.max(step,.8*Math.max(bx,bz));
 if(v>MIN)flagged.set(k,v);}
const seen=new Set(),clusters=[];
for(const k of flagged.keys()){if(seen.has(k))continue;const stack=[k],cells=[];seen.add(k);
 while(stack.length){const q=stack.pop();cells.push(q);const r=(q/n)|0,cc=q-r*n;for(let dr=-2;dr<=2;dr++)for(let dc=-2;dc<=2;dc++){const p=(r+dr)*n+cc+dc;if(flagged.has(p)&&!seen.has(p)){seen.add(p);stack.push(p);}}}
 let max=0,sx=0,sz=0;const names=new Map();for(const q of cells){max=Math.max(max,flagged.get(q));sx+=-E+(q%n)*c;sz+=-E+((q/n)|0)*c;const s=name.get(q);if(s)names.set(s,(names.get(s)||0)+1);}
 clusters.push({samples:cells.length,max:+max.toFixed(2),x:Math.round(sx/cells.length),z:Math.round(sz/cells.length),streets:[...names].sort((a,b)=>b[1]-a[1]).slice(0,3).map(a=>a[0])});}
clusters.sort((a,b)=>b.max*Math.sqrt(b.samples)-a.max*Math.sqrt(a.samples));
const over1=[...flagged.values()].filter(v=>v>1).length;
console.log(JSON.stringify({city,raw,streetSamples:street.reduce((a,b)=>a+b,0),flagged:flagged.size,over1m:over1,clusters:clusters.slice(0,40)},null,1));
