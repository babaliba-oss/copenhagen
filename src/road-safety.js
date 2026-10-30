import {routePoint} from './mobility.js';

const hypot=(x,z)=>Math.sqrt(x*x+z*z); // not Math.hypot: in optimised code it allocated ~80 bytes a call (its arguments boxed), thousands of calls a step
// Adjacent road polygons do not always meet exactly; a hair-thin unmapped sliver with road on both sides
// of it is still road (the same tolerance buses use). Cars used to stop for good at such a seam.
const SEAM=.4;
const roadAt=(world,x,z)=>!!world.roads.at(x,z)||(world.roads.at(x+SEAM,z)&&world.roads.at(x-SEAM,z))||(world.roads.at(x,z+SEAM)&&world.roads.at(x,z-SEAM));
// The footprint points of physics.js carSamples, tested one by one without building the list (called for
// every car every step: the lists were a good part of the per-frame garbage).
const FOOTPRINT=[0,0,-.9,-2.15,.9,-2.15,-.9,2.15,.9,2.15,0,-2.3,0,2.3,-1,0,1,0];
export function vehicleFitsRoad(p,world){
 if(!world.trafficForbidden)return !!world.roads.at(p.x,p.z)&&!world.buildings.at(p.x,p.z);
 const s=Math.sin(p.heading),c=Math.cos(p.heading);
 for(let i=0;i<FOOTPRINT.length;i+=2){const lx=FOOTPRINT[i],lz=FOOTPRINT[i+1],x=p.x+lx*c+lz*s,z=p.z-lx*s+lz*c;if(!roadAt(world,x,z)||world.trafficForbidden.at(x,z)||world.buildings.at(x,z))return false;}
 return true;
}
const along={x:0,z:0,heading:0};
export function safeVehicleSegment(a,b,world){
 if(!vehicleFitsRoad(b,world))return false;
 if(!world.trafficForbidden)return true;
 const distance=hypot(b.x-a.x,b.z-a.z),turn=Math.atan2(Math.sin(b.heading-a.heading),Math.cos(b.heading-a.heading));
 const n=Math.max(1,Math.ceil(distance/.5),Math.ceil(Math.abs(turn)/.15));
 for(let i=1;i<n;i++){const t=i/n;along.x=a.x+(b.x-a.x)*t;along.z=a.z+(b.z-a.z)*t;along.heading=a.heading+turn*t;if(!vehicleFitsRoad(along,world))return false;}
 return true;
}
// Lanes through a drawn wall (list: 0.6 m strips {rings: [A+, B+, B-, A-]}, scripts/road-walls.mjs) are not driven: the
// edge is marked as not fitting (Mobility.fits, routed round like a lane off the carriageway); vehicleFitsRoad's footprint
// every 2 m steps over so thin a strip. A lane (its offset polyline) within REACH of a strip's middle line runs a car's
// body through it. Marked edges also get walled=true (police routes round them too: PoliceSimulation.unfit). Returns the edges marked.
export function markWalledLanes(edges,list,REACH=.9+.3){
 const C=16,grid=new Map(),cell=(x,z)=>Math.floor(x/C)*65536+Math.floor(z/C);
 for(const w of list){const r=w.rings[0],s=[(r[0][0]+r[3][0])/2,(r[0][1]+r[3][1])/2,(r[1][0]+r[2][0])/2,(r[1][1]+r[2][1])/2];
  for(let x=Math.floor((Math.min(s[0],s[2])-REACH)/C);x<=Math.floor((Math.max(s[0],s[2])+REACH)/C);x++)for(let z=Math.floor((Math.min(s[1],s[3])-REACH)/C);z<=Math.floor((Math.max(s[1],s[3])+REACH)/C);z++){const k=x*65536+z;let l=grid.get(k);if(!l)grid.set(k,l=[]);l.push(s);}}
 const ptSeg=(px,pz,ax,az,bx,bz)=>{const dx=bx-ax,dz=bz-az,l=dx*dx+dz*dz,t=l?Math.max(0,Math.min(1,((px-ax)*dx+(pz-az)*dz)/l)):0;return hypot(px-ax-dx*t,pz-az-dz*t);};
 const cross=(ax,az,bx,bz,cx,cz,dx,dz)=>{const d=(bx-ax)*(dz-cz)-(bz-az)*(dx-cx);if(!d)return false;const t=((cx-ax)*(dz-cz)-(cz-az)*(dx-cx))/d,u=((cx-ax)*(bz-az)-(cz-az)*(bx-ax))/d;return t>=0&&t<=1&&u>=0&&u<=1;};
 const near=(ax,az,bx,bz,s)=>!(Math.min(ax,bx)-REACH>Math.max(s[0],s[2])||Math.max(ax,bx)+REACH<Math.min(s[0],s[2])||Math.min(az,bz)-REACH>Math.max(s[1],s[3])||Math.max(az,bz)+REACH<Math.min(s[1],s[3]))&&(cross(ax,az,bx,bz,...s)||Math.min(ptSeg(ax,az,...s),ptSeg(bx,bz,...s),ptSeg(s[0],s[1],ax,az,bx,bz),ptSeg(s[2],s[3],ax,az,bx,bz))<REACH);
 let n=0;
 for(const e of edges){if(e.fits===false)continue;const lane=e.lane||0;let hit=false;
  for(let i=1;i<e.points.length&&!hit;i++){const a=e.points[i-1],b=e.points[i],L=hypot(b[0]-a[0],b[1]-a[1])||1,ox=-(b[1]-a[1])/L*lane,oz=(b[0]-a[0])/L*lane,ax=a[0]+ox,az=a[1]+oz,bx=b[0]+ox,bz=b[1]+oz;
   for(let x=Math.floor((Math.min(ax,bx))/C);x<=Math.floor((Math.max(ax,bx))/C)&&!hit;x++)for(let z=Math.floor((Math.min(az,bz))/C);z<=Math.floor((Math.max(az,bz))/C)&&!hit;z++){const l=grid.get(x*65536+z);if(l)for(const s of l)if(near(ax,az,bx,bz,s)){hit=true;break;}}}
  if(hit){e.fits=false;e.walled=true;n++;}}
 return n;
}
// Separating-axis test for the conservative vehicle footprints. This covers
// cross traffic as well as a car directly ahead, so turns cannot stack cars.
export {trafficFootprintsOverlap} from './contact-geometry.js';
// Southern Olympia approach: the central paved strip is reserved for trams.
// Cars use separate carriageways outside the two long splitter islands.
export const OLYMPIA_TRAM_SURFACE_IDS=['336585'];
export const olympiaTramOnlySurfaces=city=>city.roads.filter(p=>OLYMPIA_TRAM_SURFACE_IDS.some(id=>p.id.endsWith('.'+id)));
export const OLYMPIA_CAR_APPROACHES=[
 {from:146,to:4404,points:[[210.4,1032.31],[216,1028],[222,1024],[225.5,1020],[228.7,1016],[231,1012],[233.6,1009],[236.64,1007.53]],signal:152},
 {from:3532,to:2300,points:[[220.24,995.64],[218,999],[215.75,1004],[212.25,1014],[208.5,1024],[205.5,1032],[205,1036],[206.47,1042.16]],signal:-1},
].map(e=>({...e,lane:0,separateCarriageway:true,olympiaApproach:true,crossing:false}));
// Narrow separated carriageways already have centre lines per carriageway.
// Applying the ordinary 1.45 m two-way lane offset puts cars onto the islands.
export function correctHarbourLanes(data){
 const ids=new Set(['1058:1057','1056:1058','1055:1056','785:1055']);
 const wrongWay=new Set(['1057:1058','1058:1056','1056:1055','1055:785']);
 // Demo routing correction: northbound east of the islands, southbound west.
 // The source network gave both directions to each narrow separate branch.
 // The source has a reverse copy of every roundabout arc. Keep only the
 // counter-clockwise ring (X east, Z south), shared by traffic and police.
 const ring=[785,786,1057,3532,3469,4404,4405,4407,3529,3530,785];
 const circulation=new Set(ring.slice(1).map((to,i)=>`${ring[i]}:${to}`));
 ring.slice(1).forEach((to,i)=>wrongWay.add(`${to}:${ring[i]}`));
 const edges=data.roads.edges.filter(e=>!wrongWay.has(`${e.from}:${e.to}`)).flatMap(e=>{
  const key=`${e.from}:${e.to}`;
  if(key==='146:145')return [{...OLYMPIA_CAR_APPROACHES[0]}];
  if(key==='145:146')return [{...OLYMPIA_CAR_APPROACHES[1]}];
  if(circulation.has(key)){
   // These are already single-lane centre lines. The usual two-way offset
   // pushes the southern arc's vehicle footprint onto the splitter island.
   const arc={...e,lane:0,roundabout:true,separateCarriageway:true,signal:-1};
   // The southern approach node sits part-way along an arc but was never
   // connected to it. Split at that existing point, not across the garden.
   if(e.from===3469&&e.to===4404){const i=e.points.findIndex(p=>hypot(p[0]-data.roads.nodes[145][0],p[1]-data.roads.nodes[145][1])<.05);if(i>0)return [{...arc,to:145,points:e.points.slice(0,i+1)},{...arc,from:145,points:e.points.slice(i)}];}
   return [arc];
  }
  return [ids.has(key)?{...e,lane:0,separateCarriageway:true}:{...e}];
 });
 return {...data,roads:{...data.roads,edges}};
}
// Signal records identify junctions, not the individual pole coordinates.
// Only return an anchor on mapped pavement outside the road, never a lane.
export function signalAnchor(edge,world){
 if(!world.pavement)return null;
 for(const setback of [4,7,10])for(const side of [1,-1])for(let offset=2;offset<=14;offset+=.35){
  const p=routePoint(edge,Math.max(0,edge.length-setback),side*offset);
  if(!world.pavement.at(p.x,p.z)||world.roads.at(p.x,p.z)||world.buildings.at(p.x,p.z))continue;
  if([[.18,0],[-.18,0],[0,.18],[0,-.18]].some(([dx,dz])=>world.roads.at(p.x+dx,p.z+dz)||world.buildings.at(p.x+dx,p.z+dz)))continue;
  return p;
 }
 return null;
}
export const authoredOlympiaMarkings=(x,z)=>x>215&&x<247&&z>958&&z<979;
// The main demo road from Olympia terminal to Kauppatori, by mapped street name.
// Pohjoisesplanadi counts only along Kauppatori, not further west along the Esplanadi.
export const HARBOUR_CORRIDOR_CARS=26;
export function harbourCorridor(roads){
 return (x,z)=>{const name=roads.at(x,z)?.name;return name==='Laivasillankatu'||name==='Eteläranta'||(name==='Pohjoisesplanadi'&&x>-20);};
}
