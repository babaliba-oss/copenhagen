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
    const list=this.near(x,z); // indexed: for-of allocated an iterator result per polygon tested
    for(let i=0;i<list.length;i++){const p=list[i];if(p.disabled)continue;const b=p.bbox;if(x>=b[0]&&x<=b[2]&&z>=b[1]&&z<=b[3]&&pointInPolygon(x,z,p.rings))return p;}
    return undefined;
  }
}

// Point-in-water against a world's water polygon list, through a spatial index built once per list (and
// rebuilt when streaming appends to it). A linear scan of every harbour polygon was the slow path.
const waterIndexes=new WeakMap();
export function inWaterPolygons(water,x,z){
 if(!water?.length)return false;
 let entry=waterIndexes.get(water);
 if(!entry||entry.count!==water.length){entry={count:water.length,index:new SpatialIndex(water.filter(w=>w?.rings?.length)),raster:waterRaster(water)};waterIndexes.set(water,entry);}
 // 2 m raster: clearly wet / clearly dry cells answer at once; only cells an edge crosses run the polygon test
 // (the exact test ran per surface vertex at boot: seconds of point-in-polygon on the harbour's long rings).
 const r=entry.raster;if(r){const cx=Math.floor((x-r.x0)/r.res),cz=Math.floor((z-r.z0)/r.res);if(cx>=0&&cz>=0&&cx<r.w&&cz<r.h){const v=r.cells[cz*r.w+cx];if(v<2)return v===1;
  // shore cell: crossings of a ray towards +x, counted per polygon over the edges in this 4 m row only
  const e=r.rows.get(Math.floor(z/4));if(!e)return false;let odd=null;
  for(let i=0;i<e.length;i+=5){const az=e[i+1],bz=e[i+3];if((az>z)!==(bz>z)&&x<(e[i+2]-e[i])*(z-az)/(bz-az)+e[i]){const id=e[i+4];(odd??=new Map()).set(id,!odd.get(id));}}
  if(!odd)return false;for(const o of odd.values())if(o)return true;return false;}}
 return !!entry.index.at(x,z);
}
// Cells: 0 dry, 1 inside some polygon, 2 on an edge (exact test needed). Each polygon is filled on its own
// (even-odd within it, so islands stay dry); overlapping polygons stay wet.
export function waterRaster(water,res=2){
 const list=water.filter(w=>w?.rings?.length);if(!list.length)return null;
 let x0=Infinity,z0=Infinity,x1=-Infinity,z1=-Infinity;for(const w of list){const b=w.bbox??=bounds(w.rings);x0=Math.min(x0,b[0]);z0=Math.min(z0,b[1]);x1=Math.max(x1,b[2]);z1=Math.max(z1,b[3]);}
 x0=Math.max(x0,-4000)-res;z0=Math.max(z0,-4000)-res;x1=Math.min(x1,4000)+res;z1=Math.min(z1,4000)+res;
 const w=Math.ceil((x1-x0)/res),h=Math.ceil((z1-z0)/res);if(w*h>2.5e7)return null;const cells=new Uint8Array(w*h);
 for(const poly of list){const b=poly.bbox,r0=Math.max(0,Math.floor((b[1]-z0)/res)),r1=Math.min(h-1,Math.floor((b[3]-z0)/res)),xs=[];
  for(let row=r0;row<=r1;row++){const z=z0+(row+.5)*res;xs.length=0;
   for(const ring of poly.rings)for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],c=ring[j];if((a[1]>z)!==(c[1]>z))xs.push((c[0]-a[0])*(z-a[1])/(c[1]-a[1])+a[0]);}
   xs.sort((p,q)=>p-q);for(let k=0;k+1<xs.length;k+=2){const c0=Math.max(0,Math.ceil((xs[k]-x0)/res-.5)),c1=Math.min(w-1,Math.floor((xs[k+1]-x0)/res-.5));for(let c=c0;c<=c1;c++)if(cells[row*w+c]===0)cells[row*w+c]=1;}}
 }
 for(const poly of list)for(const ring of poly.rings)for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],c=ring[j],l=Math.hypot(c[0]-a[0],c[1]-a[1]),n=Math.max(1,Math.ceil(l/(res*.4)));
  for(let k=0;k<=n;k++){const x=a[0]+(c[0]-a[0])*k/n,z=a[1]+(c[1]-a[1])*k/n,cx=Math.floor((x-x0)/res),cz=Math.floor((z-z0)/res);
   for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){const X=cx+dx,Z=cz+dz;if(X>=0&&Z>=0&&X<w&&Z<h)cells[Z*w+X]=2;}}}
 const rows=new Map();list.forEach((poly,id)=>{for(const ring of poly.rings)for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],c=ring[j];if(a[1]===c[1])continue;
  for(let k=Math.floor(Math.min(a[1],c[1])/4);k<=Math.floor(Math.max(a[1],c[1])/4);k++){let l=rows.get(k);if(!l)rows.set(k,l=[]);l.push(a[0],a[1],c[0],c[1],id);}}});
 return {x0,z0,res,w,h,cells,rows};
}
