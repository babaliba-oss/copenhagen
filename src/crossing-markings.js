import polygonClipping from 'polygon-clipping';
import {pointInPolygon, segmentDistance} from './geo.js';

// Københavns Kommune's road-marking register is drawn into today's Copenhagen surface chunks (scripts/kk-markings.py);
// road-markings.json is the bitmask of 16 m cells it covers. registerCoverage(data)(x,z) says whether the city's own paint
// lies there, so the generated centre dashes and zebra stripes (street-life.js) are left out and not drawn twice.
export function registerCoverage(data){
 if(!data?.bits||!data.n||!data.cell)return ()=>false;
 const raw=typeof atob==='function'?atob(data.bits):Buffer.from(data.bits,'base64').toString('binary'),bytes=new Uint8Array(raw.length);
 for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
 const {n,cell,origin}=data;
 return (x,z)=>{const cx=Math.floor((x-origin)/cell),cz=Math.floor((z-origin)/cell);if(cx<0||cz<0||cx>=n||cz>=n)return false;const i=cz*n+cx;return (bytes[i>>3]>>(i&7)&1)===1;};
}

// Ground-plan fits from Helsinki's 2025 5 cm orthophoto, not survey drawings.
// Corners are metre-scale estimates.
export const REVIEWED_CROSSINGS = [
 {id:'sofiankatu-north', corners:[[79.0,234.7],[84.5,234.5],[85.0,242.8],[79.4,243.0]], axis:'z'},
 {id:'sofiankatu-south', corners:[[79.5,247.1],[85.0,246.9],[85.2,254.0],[79.7,254.2]], axis:'z'},
 {id:'sofiankatu-cycleway', corners:[[79.8,255.0],[85.1,254.8],[85.2,256.7],[79.9,256.9]], axis:'z', cycleway:true},
 {id:'mariankatu-palace', corners:[[255.6,163.9],[263.5,168.0],[263.7,172.7],[255.8,169.1]], axis:'x'},
];

export function reviewedCrossingArea(x,z){
 return (x>76&&x<88&&z>233&&z<258)||(x>251&&x<268&&z>160&&z<175);
}

// A Suojatie is often stored as two or more links split at the traffic graph.
// Merge straight continuations before spacing bars, so a graph node does not
// create an artificial two-metre unpainted gap in the middle of a carriageway.
export function crossingChains(edges){
 const unique=[],keys=new Set(),at=new Map();
 for(const e of edges){
  if(!e.crossing||e.points.length<2)continue;
  const key=[e.from,e.to].sort((a,b)=>a-b).join(':');if(keys.has(key))continue;keys.add(key);
  const i=unique.length;unique.push(e);
  for(const n of [e.from,e.to]){if(!at.has(n))at.set(n,[]);at.get(n).push(i);}
 }
 const used=new Set(),chains=[];
 for(let seed=0;seed<unique.length;seed++){
  if(used.has(seed))continue;used.add(seed);
  const e=unique[seed],points=e.points.map(p=>p.slice());let start=e.from,end=e.to;
  for(const front of [false,true])for(;;){
   const node=front?start:end,available=(at.get(node)||[]).filter(i=>!used.has(i));
   const tip=front?points[0]:points.at(-1),before=front?points[1]:points.at(-2),dx=tip[0]-before[0],dz=tip[1]-before[1];
   const next=available.find(i=>{const n=unique[i],path=n.from===node?n.points:[...n.points].reverse(),a=path[0],b=path[1],vx=b[0]-a[0],vz=b[1]-a[1];return (dx*vx+dz*vz)/Math.hypot(dx,dz)/Math.hypot(vx,vz)>.97;});
   if(next===undefined)break;used.add(next);const n=unique[next],path=n.from===node?n.points:[...n.points].reverse();
   if(front){points.unshift(...path.slice(1).reverse().map(p=>p.slice()));start=n.from===node?n.to:n.from;}
   else{points.push(...path.slice(1).map(p=>p.slice()));end=n.from===node?n.to:n.from;}
  }
  chains.push({points,bbox:bounds(points)});
 }
 return chains;
}

const closed=ring=>[...ring,ring[0]];
const bounds=ring=>[Math.min(...ring.map(p=>p[0])),Math.min(...ring.map(p=>p[1])),Math.max(...ring.map(p=>p[0])),Math.max(...ring.map(p=>p[1]))];
function clippedToRoad(ring,world){
 const [x0,z0,x1,z1]=bounds(ring),roads=new Set();
 const probes=[...ring,[(x0+x1)/2,(z0+z1)/2]],onRoad=probes.map(([x,z])=>!!world.roads.at(x,z)&&!world.pavement?.at(x,z));
 if(onRoad.every(Boolean))return [[closed(ring)]];
 if(onRoad.every(v=>!v))return [];
 // Keep the city-wide fallback conservative and inexpensive. Exact boundary
 // clipping is only warranted at the individually reviewed route crossings.
 if(!reviewedCrossingArea((x0+x1)/2,(z0+z1)/2))return [];
 const overlaps=p=>p.bbox[0]<=x1&&p.bbox[2]>=x0&&p.bbox[1]<=z1&&p.bbox[3]>=z0;
 for(const [x,z] of [...ring,[(x0+x1)/2,(z0+z1)/2]])for(const r of world.roads.near?.(x,z)||[])if(overlaps(r))roads.add(r);
 if(!roads.size)return [];
 try {
 const cuts=[...roads].map(r=>polygonClipping.intersection([closed(ring)],r.rings)).filter(p=>p.length);
 if(!cuts.length)return [];
 let result=cuts.length===1?cuts[0]:polygonClipping.union(...cuts);
 const forbidden=new Set();
 for(const [x,z] of ring)for(const p of world.pavement?.near?.(x,z)||[])if(overlaps(p))forbidden.add(p);
 if(result.length&&forbidden.size)result=polygonClipping.difference(result,...[...forbidden].map(p=>p.rings));
 return result;
 } catch {
  // Invalid municipal rings must not abort city loading. Conservatively omit
  // a malformed sliver rather than draw a full stripe over an island.
  return [];
 }
}

export function crossingPolygons(edges,world,{excluded=()=>false,reviewed=REVIEWED_CROSSINGS}={}){
 const chains=crossingChains(edges),polygons=[];
 for(const chain of chains){
  let phase=.45;
  for(let i=1;i<chain.points.length;i++){
   const a=chain.points[i-1],b=chain.points[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(!length)continue;
   const ux=dx/length,uz=dz/length;
   for(let s=phase;s<length;s+=1.05){
    const x=a[0]+ux*s,z=a[1]+uz*s;if(reviewedCrossingArea(x,z)||excluded(x,z))continue;
    const ring=[[-1.5,-.25],[1.5,-.25],[1.5,.25],[-1.5,.25]].map(([w,h])=>[x-uz*w+ux*h,z+ux*w+uz*h]);
    polygons.push(...clippedToRoad(ring,world));
   }
   phase=((phase-length)%1.05+1.05)%1.05;
  }
 }
 for(const crossing of reviewed){
  const [x0,z0,x1,z1]=bounds(crossing.corners),vertical=crossing.axis==='z',first=vertical?z0:x0,last=vertical?z1:x1;
  for(let s=first+.12;s<last;s+=1.05){
   const band=vertical?[[x0-1,s],[x1+1,s],[x1+1,s+.5],[x0-1,s+.5]]:[[s,z0-1],[s+.5,z0-1],[s+.5,z1+1],[s,z1+1]];
   const cut=polygonClipping.intersection([closed(crossing.corners)],[closed(band)]);
   // The separately photographed cycleway crossing is deliberately not clipped
   // against a car-road mask: that mask does not contain the cycle track.
   for(const polygon of cut)polygons.push(...(crossing.cycleway?[polygon]:clippedToRoad(polygon[0],world)));
  }
 }
 return {polygons,chains};
}

export function nearCrossing(x,z,chains){
 if(REVIEWED_CROSSINGS.some(c=>pointInPolygon(x,z,[closed(c.corners)])||c.corners.some((a,i)=>segmentDistance(x,z,a,c.corners[(i+1)%4])<.4)))return true;
 return chains.some(({points})=>points.some((b,i)=>i&&segmentDistance(x,z,points[i-1],b)<1.65));
}

// Split long surveyed kerb edges to allow a low threshold across crossings,
// instead of keeping a raised granite wall across the pedestrian route.
export function kerbSegments(a,b,chains){
 const dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),count=Math.ceil(length/.6),out=[];
 if(!count)return out;
 const x0=Math.min(a[0],b[0])-2,x1=Math.max(a[0],b[0])+2,z0=Math.min(a[1],b[1])-2,z1=Math.max(a[1],b[1])+2;
 const nearby=chains.filter(c=>c.bbox[0]<=x1&&c.bbox[2]>=x0&&c.bbox[1]<=z1&&c.bbox[3]>=z0);
 for(let i=0;i<count;i++){
  const x=a[0]+dx*(i+.5)/count,z=a[1]+dz*(i+.5)/count,lowered=nearCrossing(x,z,nearby);
  const last=out.at(-1);if(last&&last.lowered===lowered){last.b=[a[0]+dx*(i+1)/count,a[1]+dz*(i+1)/count];}
  else out.push({a:[a[0]+dx*i/count,a[1]+dz*i/count],b:[a[0]+dx*(i+1)/count,a[1]+dz*(i+1)/count],lowered});
 }
 return out;
}
