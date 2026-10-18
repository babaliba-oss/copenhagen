// Anticipate bends in the mapped polyline, including the outgoing junction.
// Physics still uses the original road path and swept clearance tests.
const angleBetween=(a,b)=>Math.abs(Math.atan2(Math.sin(b-a),Math.cos(b-a)));
const heading=(a,b)=>Math.atan2(-(b[0]-a[0]),-(b[1]-a[1]));
// The speed a bend `angle` radians sharp, `distance` metres ahead, allows now (no limit when gentle or passed).
const bendLimit=(limit,angle,distance)=>{
 if(angle<.22||distance< -5)return limit;
 const turnSpeed=Math.max(3,8-angle*2.2),brakingDistance=Math.max(0,distance-2);
 return Math.min(limit,Math.sqrt(turnSpeed*turnSpeed+7*brakingDistance));
};
// Called for every car every step: no closures or iterators in here.
export function cornerSpeedLimit(edge,s,cruise,nextEdges=NONE){
 let limit=cruise;const pts=edge.points,n=pts.length;
 for(let i=1;i<n-1;i++){
  const d=edge.cumulative[i]-s;
  if(d>cruise*cruise/7+5)break;
  limit=bendLimit(limit,angleBetween(heading(pts[i-1],pts[i]),heading(pts[i],pts[i+1])),d);
 }
 const endHeading=heading(pts[n-2],pts[n-1]);
 for(let k=0;k<nextEdges.length;k++){const next=nextEdges[k];if(next?.points.length>1)limit=bendLimit(limit,angleBetween(endHeading,heading(next.points[0],next.points[1])),edge.length-s);}
 return limit;
}
const NONE=[];
// Mapped speed limits (edge.speed, km/h): drivers keep their own pace relative to the limit (cruise is set for 50 km/h).
export const edgeCruise=(edge,cruise)=>edge?.speed?Math.min(edge.speed/3.6,cruise*edge.speed/50):cruise;
// …and ease off before a lower limit begins (next: the edge after this one, remaining metres to it).
export const approachCruise=(cruise,next,base,remaining)=>next?.speed?Math.min(cruise,Math.sqrt(edgeCruise(next,base)**2+7*Math.max(0,remaining-2))):cruise;
export const edgeTopSpeed=(edge,top)=>edge?.speed?Math.max(top,edge.speed/3.6):top;
// Multi-lane carriageways (edge.laneOffsets): each car keeps to one lane of its own.
export const carLane=(edge,id)=>edge.laneOffsets?.length?edge.laneOffsets[id%edge.laneOffsets.length]:edge.lane;
