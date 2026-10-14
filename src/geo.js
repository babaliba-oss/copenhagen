export const ORIGIN = [24.9522, 60.1701];
// Playable circle around the city origin; a city may set its own radius.
export let RADIUS = 2000;
export function setPlayableRadius(radius){RADIUS=radius;}
export const WORLD_EXTENT = 2400;
export function pointInRing(x, z, ring) {
  let inside = false;
  for (let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i], b=ring[j];
    if ((a[1]>z)!==(b[1]>z) && x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0]) inside=!inside;
  }
  return inside;
}
export function pointInPolygon(x,z,rings) {
  if(!pointInRing(x,z,rings[0])) return false;
  for(let i=1;i<rings.length;i++) if(pointInRing(x,z,rings[i])) return false;
  return true;
}
export function bounds(rings) {
  let minX=Infinity,minZ=Infinity,maxX=-Infinity,maxZ=-Infinity;
  for(const p of rings[0]) { minX=Math.min(minX,p[0]);minZ=Math.min(minZ,p[1]);maxX=Math.max(maxX,p[0]);maxZ=Math.max(maxZ,p[1]); }
  return [minX,minZ,maxX,maxZ];
}
export function segmentDistance(x,z,a,b) {
  const dx=b[0]-a[0], dz=b[1]-a[1], d=dx*dx+dz*dz;
  const t=d ? Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/d)) : 0;
  return Math.hypot(x-a[0]-t*dx,z-a[1]-t*dz);
}
// Axis-aligned lines along which water data was clipped ([axis, value], axis 0
// = x, 1 = z). Water edges lying on them are data boundaries, not shorelines.
const waterClipLines=[[0,-WORLD_EXTENT],[0,WORLD_EXTENT],[1,-WORLD_EXTENT],[1,WORLD_EXTENT]];
export function registerWaterClip(box){for(const [k,v] of [[0,box[0]],[1,box[1]],[0,box[2]],[1,box[3]]])if(!waterClipLines.some(([a,b])=>a===k&&b===v))waterClipLines.push([k,v]);}
export function clipLinesFor(extent){return extent===WORLD_EXTENT?waterClipLines:[[0,-extent],[0,extent],[1,-extent],[1,extent]];}
export function onClipLine(a,b,lines,tolerance=.01){return lines.some(([k,v])=>Math.abs(a[k]-v)<tolerance&&Math.abs(b[k]-v)<tolerance);}
// Map extensions add drivable areas outside the RADIUS circle (MultiPolygons in
// local metres, registered at boot from public/data/extensions/index.json).
const playableAreas=[];
export function registerPlayableArea(multi){
 const b=[Infinity,Infinity,-Infinity,-Infinity];
 for(const poly of multi)for(const p of poly[0]){b[0]=Math.min(b[0],p[0]);b[1]=Math.min(b[1],p[1]);b[2]=Math.max(b[2],p[0]);b[3]=Math.max(b[3],p[1]);}
 playableAreas.push({multi,bbox:b});
}
export function clearPlayableAreas(){playableAreas.length=0;}
// Farthest playable coordinate from the origin (any axis): the ground plane must reach it.
export function playableExtent(){let m=RADIUS;for(const {bbox} of playableAreas)for(const v of bbox)m=Math.max(m,Math.abs(v));return m;}
export function insidePlayable(x,z,margin=0){
 if(Math.hypot(x,z)<=RADIUS-margin)return true;
 for(const {multi,bbox} of playableAreas){
  if(x<bbox[0]||x>bbox[2]||z<bbox[1]||z>bbox[3])continue;
  for(const rings of multi){
   if(!pointInPolygon(x,z,rings))continue;
   if(margin<=0)return true;
   let clear=true;for(const r of rings)for(let i=1;i<r.length&&clear;i++)if(segmentDistance(x,z,r[i-1],r[i])<margin)clear=false;
   // Near an edge shared with the circle the circle itself may still allow it.
   if(clear||Math.hypot(x,z)<=RADIUS)return true;
  }
 }
 return false;
}
const NONE=Object.freeze([]);
// Numeric cell key (no string allocation); cell coordinates stay well inside ±2^20.
const cellKey=(x,z)=>(x+1048576)*2097152+(z+1048576);
export class SpatialIndex {
  constructor(items, size=64) {
    this.size=size; this.cells=new Map();this.items=new WeakSet();this.add(items);
  }
  // Streaming appends to the same index held by collision, camera and AI.
  // Reusing an installed polygon is harmless when an installation is retried.
  add(items) {
    const size=this.size;
    for(const item of items) {
      if(this.items.has(item))continue;this.items.add(item);
      item.bbox ??= bounds(item.rings);
      const b=item.bbox;
      for(let x=Math.floor(b[0]/size);x<=Math.floor(b[2]/size);x++) for(let z=Math.floor(b[1]/size);z<=Math.floor(b[3]/size);z++) {
        const k=cellKey(x,z);if(!this.cells.has(k))this.cells.set(k,[]);this.cells.get(k).push(item);
      }
    }
    return this;
  }
  near(x,z){return this.cells.get(cellKey(Math.floor(x/this.size),Math.floor(z/this.size)))||NONE;}
  at(x,z){
    // Hot path: called thousands of times per frame by physics, traffic and pedestrians.
    for(const p of this.near(x,z)){if(p.disabled)continue;const b=p.bbox;if(x>=b[0]&&x<=b[2]&&z>=b[1]&&z<=b[3]&&pointInPolygon(x,z,p.rings))return p;}
    return undefined;
  }
}

// Point-in-water against a world's water polygon list, through a spatial index built once per list (and
// rebuilt when streaming appends to it). A linear scan of every harbour polygon was the slow path.
const waterIndexes=new WeakMap();
export function inWaterPolygons(water,x,z){
 if(!water?.length)return false;
 let entry=waterIndexes.get(water);
 if(!entry||entry.count!==water.length){entry={count:water.length,index:new SpatialIndex(water.filter(w=>w?.rings?.length))};waterIndexes.set(water,entry);}
 return !!entry.index.at(x,z);
}
