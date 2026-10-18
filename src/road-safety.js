import {routePoint} from './mobility.js';

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
 const distance=Math.hypot(b.x-a.x,b.z-a.z),turn=Math.atan2(Math.sin(b.heading-a.heading),Math.cos(b.heading-a.heading));
 const n=Math.max(1,Math.ceil(distance/.5),Math.ceil(Math.abs(turn)/.15));
 for(let i=1;i<n;i++){const t=i/n;along.x=a.x+(b.x-a.x)*t;along.z=a.z+(b.z-a.z)*t;along.heading=a.heading+turn*t;if(!vehicleFitsRoad(along,world))return false;}
 return true;
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
   if(e.from===3469&&e.to===4404){const i=e.points.findIndex(p=>Math.hypot(p[0]-data.roads.nodes[145][0],p[1]-data.roads.nodes[145][1])<.05);if(i>0)return [{...arc,to:145,points:e.points.slice(0,i+1)},{...arc,from:145,points:e.points.slice(i)}];}
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
