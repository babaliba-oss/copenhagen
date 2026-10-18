// Bridge sweep: decks you see but would fall through. The railing builder (src/quay.js buildBridgeRailings) draws a
// plate over the water for every road or footway mapped across it; the car and the people stand on the terrain
// (groundAt), which only carries a bridge where the elevation model saw one. Where a period bridge or a mapped
// crossing has no bridge in today's elevation model (1760's moat and canals are sunk below their banks), the deck
// floats over open water and whatever drives onto it drops into the canal.
// The terrain is prepared as main.js does (water levelled, the 1760 moat sunk, hollows raised, banks levelled), then
// raiseBridgeDecks (src/terrain.js) can be applied with --fix to show what the game now does.
// node scripts/bridge-sweep.mjs copenhagen-1760 [--fix] -> JSON to stdout
import fs from 'node:fs';import zlib from 'node:zlib';
import {decodeTerrain,setTerrain,groundAt,flattenWaterBodies,sinkShallowWater,raiseDryHollows,levelBanks,raiseBridgeDecks} from '../src/terrain.js';
import {inWaterPolygons,pointInPolygon} from '../src/geo.js';
import {buildBridgeRailings} from '../src/quay.js';
const city=process.argv[2]||'copenhagen-1760',fix=process.argv.includes('--fix'),root=`public/cities/${city}`;
const data=JSON.parse(zlib.gunzipSync(fs.readFileSync(`${root}/city.pack`)));
{let tb=fs.readFileSync(`${root}/terrain.pack`);if(tb[0]===31)tb=zlib.gunzipSync(tb);setTerrain(decodeTerrain(tb.buffer.slice(tb.byteOffset,tb.byteOffset+tb.byteLength)));}
const wet=(x,z)=>inWaterPolygons(data.water,x,z);
if(city==='copenhagen')flattenWaterBodies();
if(city.endsWith('1760'))sinkShallowWater(wet);
raiseDryHollows(wet);levelBanks(wet);
const rails=buildBridgeRailings(data.water,data,{ground:groundAt}),bridges=rails?.userData.bridges||[];
if(fix)raiseBridgeDecks(bridges,wet);
const out=[];
for(const b of bridges){const r=b.rings[0];let x0=Infinity,z0=Infinity,x1=-Infinity,z1=-Infinity;for(const [x,z] of r){x0=Math.min(x0,x);z0=Math.min(z0,z);x1=Math.max(x1,x);z1=Math.max(z1,z);}
 let n=0,low=0,worst=0;for(let x=x0+.5;x<x1;x+=1)for(let z=z0+.5;z<z1;z+=1){if(!pointInPolygon(x,z,b.rings)||!wet(x,z))continue;n++;const d=b.y-groundAt(x,z);if(d>.6)low++;worst=Math.max(worst,d);}
 if(n&&low>.2*n)out.push({name:b.name,kind:b.kind,x:Math.round((x0+x1)/2),z:Math.round((z0+z1)/2),deck:+b.y.toFixed(2),overWater:n,fallThrough:low,worstDrop:+worst.toFixed(1)});}
out.sort((a,b)=>b.fallThrough-a.fallThrough);
console.log(JSON.stringify({city,fix,bridges:bridges.length,broken:out.length,list:out},null,1));
