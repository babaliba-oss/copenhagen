// Split out of main.js: Copenhagen's mapped street furniture tidied before it is built
// (items in traffic lanes or on the water, benches along the kerb, duplicate signs, signal heads and poles).
import {SpatialIndex,inWaterPolygons} from './geo.js';
import {datedNow,placeBenches,bringAshore} from './mapped-furniture.js';
export function tidyFurniture(mapped,city,data,sea){
   if(mapped?.items?.length&&city.id.startsWith('copenhagen')){ /* furniture placed from photos can land on the carriageway: drop what stands in a traffic lane, off the pavement */
    const lanes=new SpatialIndex(data.roads.filter(r=>/^Ajorata/.test(r.kind))),islands=new SpatialIndex(data.roads.filter(r=>/Koroke/.test(r.kind))),walk=new SpatialIndex(data.pavement);const before=mapped.items.length;
    // The carriageway is drawn over any footway mapped across it (crossings, squares), so a foot on it stands in the road
    // even where a footway polygon overlaps (a wire pole and a lamp stood mid-junction on Kongens Nytorv). Within 0.6 m
    // of a lane only counts off the pavement (a post at the kerb); traffic islands keep their lights and signs.
    const onRoad=(x,z)=>lanes.at(x,z)&&!islands.at(x,z);
    const inLane=(x,z)=>onRoad(x,z)||[[.6,0],[-.6,0],[0,.6],[0,-.6]].some(([a,b])=>lanes.at(x+a,z+b))&&!walk.at(x,z)&&!islands.at(x,z);mapped.poleAllowed=(x,z)=>!inLane(x,z);
    {const now=Date.now();mapped.items=mapped.items.filter(it=>datedNow(it,now));} // dated items (the city's current roadworks, scripts/kk-roadworks.py): only while they run
    mapped.items=mapped.items.filter(it=>it.k==='wire-lamp'||it.src==='kk-roadworks'||!onRoad(it.x,it.z)); /* roadworks barriers stand in the parking lane at the kerb, never in a traffic lane *//* wire lamps hang 7 m over the carriageway, where the register places them: dropped with the rest, 8,400 of 10,200 went and the few over the pavements hung from one wire */console.info(`Street furniture: ${before-mapped.items.length} items in traffic lanes dropped`);
    {const r=placeBenches(mapped.items,{houses:new SpatialIndex(data.buildings),wheels:new SpatialIndex(data.roads.filter(r=>!/Koroke/.test(r.kind))),walk});mapped.items=r.items; // benches along the kerb, facing the street; one bench per spot (mapped-furniture.js)
     console.info(`Street furniture: benches set along the kerb ${r.turned} (moved off the carriageway ${r.moved}, dropped ${r.dropped}), park benches turned to their footway ${r.parked}, doubles dropped ${r.doubled}`);}
    {const b=mapped.items.length;mapped.items=mapped.items.filter(it=>!([[0,0],[2.5,0],[-2.5,0],[0,2.5],[0,-2.5]].every(([a,b])=>inWaterPolygons(data.water,it.x+a,it.z+b))&&!lanes.at(it.x,it.z)&&!walk.at(it.x,it.z))); /* well out on the water, not the quay-edge lamps and bollards */console.info(`Street furniture: ${b-mapped.items.length} items standing in the water dropped`);} // signs and poles mapped on the water (bridge ends, survey drift)
    {const decks=new SpatialIndex((sea?.group?.userData?.bridges||[]).filter(d=>d.rings?.[0]?.length>2)),houses=new SpatialIndex(data.buildings||[]),r=bringAshore(mapped.items,{wet:(x,z)=>inWaterPolygons(data.water,x,z),deck:(x,z)=>!!decks.at(x,z),blocked:(x,z)=>!!houses.at(x,z)||onRoad(x,z)});mapped.items=r.items;console.info(`Street furniture: ${r.moved} items on the quay edge moved ashore, ${r.dropped} dropped`);} /* the rest of the quay-edge items: no paving is drawn over the mapped water, they hung over the canal (benches on Christianshavn's quays) */
    // Sign clutter: photo detections give blank blue 'generic plates' (no readable type) and the same sign seen
    // from several photos. Keep posts with a real face, one per face within 5 m, and at most 3 posts in 8 m.
    {const grid=new Map(),key=(x,z)=>Math.floor(x/8)+','+Math.floor(z/8),near=(x,z)=>{const out=[],gx=Math.floor(x/8),gz=Math.floor(z/8);for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++)for(const q of grid.get((gx+i)+','+(gz+j))||[])if(Math.hypot(q.x-x,q.z-z)<8)out.push(q);return out;};let dropped=0;
     mapped.items=mapped.items.filter(it=>{if(it.k!=='sign'||it.src==='kk-skilte')return true; /* the city's sign register (scripts/kk-signs.py): real posts, one record each */const keep=(it.faces||[]).map((f,i)=>f!=='generic-plate'?i:-1).filter(i=>i>=0),faces=keep.map(i=>it.faces[i]);if(!faces.length){dropped++;return false;}if(Array.isArray(it.yaws)&&it.yaws.length===it.faces.length)it.yaws=keep.map(i=>it.yaws[i]);
      const ns=near(it.x,it.z);if(ns.length>=3||ns.some(q=>Math.hypot(q.x-it.x,q.z-it.z)<5&&q.faces.some(f=>faces.includes(f)))){dropped++;return false;}
      it.faces=faces;const k=key(it.x,it.z);if(!grid.has(k))grid.set(k,[]);grid.get(k).push(it);return true;});
     console.info(`Street furniture: ${dropped} duplicate or blank signs dropped`);}
    // Signal heads: one head seen from several photos lands as several posts a few metres apart. Keep one per
    // kind and facing (35 degrees) within 5 m.
    {const kept=new Map(),cell=(x,z)=>Math.floor(x/5)+','+Math.floor(z/5);let dropped=0;
     mapped.items=mapped.items.filter(it=>{if(it.k!=='traffic-light'&&it.k!=='crossing-light')return true;const gx=Math.floor(it.x/5),gz=Math.floor(it.z/5);
      for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++)for(const q of kept.get((gx+i)+','+(gz+j))||[])if(q.k===it.k&&Math.hypot(q.x-it.x,q.z-it.z)<5&&Math.abs(Math.atan2(Math.sin((q.yaw||0)-(it.yaw||0)),Math.cos((q.yaw||0)-(it.yaw||0))))<.6){dropped++;return false;}
      {let n=0;for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++)for(const q of kept.get((gx+i)+','+(gz+j))||[])if(q.k===it.k&&Math.hypot(q.x-it.x,q.z-it.z)<6)n++;if(n>=3){dropped++;return false;}} // a traffic island holds a few heads, not a forest
      const key=cell(it.x,it.z);if(!kept.has(key))kept.set(key,[]);kept.get(key).push(it);return true;});
     console.info(`Street furniture: ${dropped} duplicate signal heads dropped`);}
    // Photo 'poles': in Copenhagen mostly the post of a lamp or sign already mapped, never a timber utility pole.
    // Drop those within 2.5 m of another post or 6 m of a kept pole; the rest stand as plain galvanised posts.
    {const POSTED=/^(lamp|sign|traffic-light|crossing-light|mast-lamp|park-lamp|parking-meter)$/,grid=new Map(),cell=(x,z)=>Math.floor(x/6)+','+Math.floor(z/6);
     for(const it of mapped.items)if(POSTED.test(it.k)){const k=cell(it.x,it.z);if(!grid.has(k))grid.set(k,[]);grid.get(k).push(it);}
     const close=(x,z,r,test)=>{const gx=Math.floor(x/6),gz=Math.floor(z/6);for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++)for(const q of grid.get((gx+i)+','+(gz+j))||[])if(test(q)&&Math.hypot(q.x-x,q.z-z)<r)return true;return false;};
     let dropped=0;mapped.items=mapped.items.filter(it=>{if(it.k!=='pole')return true;if(close(it.x,it.z,2.5,q=>q.k!=='steel-pole')||close(it.x,it.z,6,q=>q.k==='steel-pole')){dropped++;return false;}it.k='steel-pole';const k=cell(it.x,it.z);if(!grid.has(k))grid.set(k,[]);grid.get(k).push(it);return true;});
     console.info(`Street furniture: ${dropped} duplicate poles dropped`);}}
}
