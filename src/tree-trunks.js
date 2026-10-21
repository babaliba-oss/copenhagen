import {segmentDistance,pointInPolygon} from './geo.js';

// Solid tree trunks for every tree the city draws: registered street and park trees, landcover and
// inferred forest trees, extension trees and place trees. Each trunk is a static circle in the shared
// world-object index (world-objects.js), so the car, walking, cycling and scooter checks that already
// stop at posts stop at trunks too. Crowns never collide: driving under branches is fine.
export const TRUNK_RADIUS={min:.15,max:.6,fallback:.22};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const CAR_CLEARANCE=1.05,LANE_CELL=24;

// Trunk radius in metres. Register girth (circumference, cm) wins; then the trunk-diameter class
// ("30 - 50 cm", "70 cm -"); then the height the tree is drawn at; else a typical street tree.
export function trunkRadius(tree={}){
 const {min,max,fallback}=TRUNK_RADIUS;
 if(tree.girth>0)return clamp(tree.girth/(2*Math.PI)/100,min,max);
 const size=String(tree.size||''),range=/(\d+)\s*-\s*(\d+)/.exec(size),open=/(\d+)\s*cm\s*-\s*$/.exec(size);
 if(range)return clamp((+range[1]+ +range[2])/2/200,min,max);
 if(open)return clamp((+open[1]+15)/200,min,max);
 if(tree.height>0)return clamp(.09*Math.sqrt(tree.height),min,max);
 return fallback;
}

// Lane centre lines of the traffic graph (edge.points shifted by edge.lane / laneOffsets, as
// mobility.js routePoint drives them), bucketed for point queries.
export class LaneIndex{
 constructor(edges=[]){this.cells=new Map();this.edges=new WeakSet();this.add(edges);}
 add(edges=[]){
  for(const e of edges){
   if(this.edges.has(e))continue;this.edges.add(e);
   const offsets=e.laneOffsets?.length?e.laneOffsets:[e.lane||0];
   for(let i=1;i<(e.points?.length||0);i++){
    const a=e.points[i-1],b=e.points[i],l=Math.hypot(b[0]-a[0],b[1]-a[1])||1,nx=-(b[1]-a[1])/l,nz=(b[0]-a[0])/l;
    for(const o of offsets){
     const p=[a[0]+nx*o,a[1]+nz*o],q=[b[0]+nx*o,b[1]+nz*o];
     for(let x=Math.floor(Math.min(p[0],q[0])/LANE_CELL);x<=Math.floor(Math.max(p[0],q[0])/LANE_CELL);x++)
      for(let z=Math.floor(Math.min(p[1],q[1])/LANE_CELL);z<=Math.floor(Math.max(p[1],q[1])/LANE_CELL);z++){
       const k=`${x},${z}`;if(!this.cells.has(k))this.cells.set(k,[]);this.cells.get(k).push(p,q);
      }
    }
   }
  }
  return this;
 }
 // Distance to the nearest lane centre line within `reach` metres (Infinity if none).
 distance(x,z,reach=4){
  let best=Infinity;
  for(let cx=Math.floor((x-reach)/LANE_CELL);cx<=Math.floor((x+reach)/LANE_CELL);cx++)
   for(let cz=Math.floor((z-reach)/LANE_CELL);cz<=Math.floor((z+reach)/LANE_CELL);cz++){
    const s=this.cells.get(`${cx},${cz}`);if(!s)continue;
    for(let i=0;i<s.length;i+=2)best=Math.min(best,segmentDistance(x,z,s[i],s[i+1]));
   }
  return best;
 }
}

// A register point inside a drawn carriageway polygon (kind Ajorata…; islands and footways are other kinds) stood on
// the asphalt: the footway polygons overlap the carriageway at junctions, so 'on the pavement' kept it (a tree in the
// middle of the road by Rådhuspladsen). Within `slack` of the kerb it stays (a trunk at the kerb line); deeper, it is
// moved to the nearest kerb and `radius`+0.3 m beyond it, onto the footway. → false: leave it, [x,z]: moved, null: drop
// (the far side of that kerb is a house or another carriageway).
const CARRIAGEWAY=/^Ajorata/;
export function offCarriageway(world,x,z,radius=TRUNK_RADIUS.fallback,slack=.3){
 const roads=world?.roads;if(!roads?.near)return false;
 const inRoad=(px,pz)=>{const list=roads.near(px,pz);for(const p of list){if(!CARRIAGEWAY.test(p.kind||''))continue;const b=p.bbox;if(px>=b[0]&&px<=b[2]&&pz>=b[1]&&pz<=b[3]&&pointInPolygon(px,pz,p.rings))return true;}return false;};
 if(!inRoad(x,z))return false;
 let best=null,d=Infinity;
 for(const p of roads.near(x,z)){if(!CARRIAGEWAY.test(p.kind||''))continue;for(const ring of p.rings)for(let i=0;i<ring.length;i++){const [ax,az]=ring[i],[bx,bz]=ring[(i+1)%ring.length],dx=bx-ax,dz=bz-az,l=dx*dx+dz*dz;if(!l)continue;const t=clamp(((x-ax)*dx+(z-az)*dz)/l,0,1),px=ax+dx*t,pz=az+dz*t,q=Math.hypot(x-px,z-pz);if(q<d){d=q;best=[px,pz];}}}
 if(!best)return false;if(d<=slack)return false;
 const ux=(best[0]-x)/d,uz=(best[1]-z)/d,to=[+(best[0]+ux*(radius+.3)).toFixed(2),+(best[1]+uz*(radius+.3)).toFixed(2)];
 return inRoad(...to)||world.buildings?.at(...to)?null:to;
}

export function trunkObstacle(tree,radius=trunkRadius(tree)){
 const [x,z]=tree.p;
 return {id:`tree:${x},${z}`,name:'a tree',tree:true,x,z,radius,collisionMode:'solid',bbox:[x-radius,z-radius,x+radius,z+radius]};
}

// One registry per loaded city: lanes stream in with extensions, trees are added once per position.
// A trunk inside a lane that traffic drives (register points that fall on the carriageway) would be
// a wall the AI cannot see: on pavement it stays solid (traffic never checks trunks), on the
// carriageway it gets no obstacle and is not drawn. `lanes` is the city's traffic edge list, indexed
// at the first build (after extensions installed at startup have merged their edges into it).
export function createTreeTrunks({lanes=[]}={}){
 const laneIndex=new LaneIndex(),seen=new Set();
 const stats={solid:0,insideBuildings:0,inLane:0,inLaneOnPavement:0,laneDropped:0,carriagewayMoved:0,carriagewayDropped:0};
 return {
  stats,laneIndex,
  addLanes(edges){laneIndex.add(edges);},
  // Returns the trees to draw and the trunk obstacles to add to world.objects.
  build(trees,world){
   const draw=[],obstacles=[];laneIndex.add(lanes);
   for(let t of trees){
    let [x,z]=t.p;
    if(world?.buildings?.at(x,z)){stats.insideBuildings++;continue;}
    const radius=trunkRadius(t);
    {const r=offCarriageway(world,x,z,radius);if(r===null){stats.carriagewayDropped++;continue;}if(r){[x,z]=r;t={...t,p:r};stats.carriagewayMoved++;}}
    if(laneIndex.distance(x,z)<radius+CAR_CLEARANCE){
     stats.inLane++;
     if(!world?.pavement?.at(x,z)){stats.laneDropped++;continue;}
     stats.inLaneOnPavement++;
    }
    draw.push(t);
    const key=`${x},${z}`;if(seen.has(key))continue;seen.add(key);
    stats.solid++;obstacles.push(trunkObstacle(t,radius));
   }
   return {draw,obstacles};
  },
 };
}
