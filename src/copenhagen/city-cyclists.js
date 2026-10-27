import {routePoint,prepareGraph} from '../mobility.js';
import {pointInPolygon,inWaterPolygons} from '../geo.js';
import {raisedDecks,groundAt} from '../terrain.js';
const hypot=(x,z)=>Math.sqrt(x*x+z*z); // not Math.hypot: in optimised code it allocated ~80 bytes a call (its arguments boxed)

// Copenhagen's cyclists: riders on the cycle tracks along the car streets (the strip right of the traffic
// lane, outside the parked cars where there is room). Each rider follows a random ~700 m route through the
// street graph near the player and is re-spawned ahead when done or left behind. Rendered with the shared
// cyclist renderer (src/cyclists.js), which only needs `riders`.
const RANGE=420;
// A rider on a deck link: on the deck from end to end, its surface; just off its ends, still inside the outline where it is
// lower than a kerb, its foot; anywhere else the ground (a footway beneath it), NaN. Tabulated along the link every STEP m
// (heightAt costs ~8 us a call; the riding line is fixed) and read by linear interpolation.
const MOUNT=.45,STEP=.5;
function deckHeight(e,s,x,z){const d=e.deck;if(s>=e.deckFrom&&s<=e.deckTo)return d.heightAt(x,z);const [x0,z0,x1,z1]=d.bbox;if(x<x0||x>x1||z<z0||z>z1||!pointInPolygon(x,z,d.rings))return NaN;const h=d.heightAt(x,z);return h-groundAt(x,z)<MOUNT?h:NaN;}
function deckProfile(e){const n=Math.ceil(e.length/STEP),out=new Float32Array(n+1);for(let i=0;i<=n;i++){const s=Math.min(e.length,i*STEP),p=routePoint(e,s,e.lane);out[i]=deckHeight(e,s,p.x,p.z);}return out;}
function deckY(e,s){const f=Math.max(0,Math.min(e.heights.length-1,s/STEP)),i=Math.floor(f),a=e.heights[i],b=e.heights[Math.min(i+1,e.heights.length-1)];return a!==a?(b!==b||f-i<.5?null:b):b!==b?(f-i<.5?a:null):a+(b-a)*(f-i);} // NaN: the ground

export class CityCyclists{
 constructor(roads,world,count=36,random=Math.random,{parked=null,walks=null,decks=raisedDecks()}={}){ // parked(x,z,r): boxes of the parked cars near a point ({x,z,heading,halfWidth,halfLength}; parked-cars.js near()); walks: the full footway graph (mobility.json), for the way onto a raised deck
  this.roads=roads;this.world=world;this.random=random;this.offsets=new Map();this.parked=parked;
  this.riders=Array.from({length:count},(_,id)=>({id,travelMode:'bike',halfWidth:.34,halfLength:.9,x:1e6,z:1e6,heading:0,speed:0,cruise:4.2+random()*1.8,phase:random()*6,route:null,leg:0,s:0,deckY:null}));
  this.links=new Map();this.linkList=[];if(walks&&decks?.length)for(const d of decks)this.linkDeck(d,walks);
 }
 // Raised decks (terrain.js, quay.js findRaisedDecks: Cykelslangen) are cycle ways the car graph does not have: each is
 // linked to the street graph as a cycle-only edge pair (never added to `roads`, so no car can take it). The edge runs from a
 // street node the riders use, along the footway graph to the deck's end, the deck's centreline, and on to a street node at
 // its other end; deckFrom..deckTo is the stretch on the deck, where the rider is drawn at the deck's height (deckY).
 linkDeck(d,walks){
  const c=d.centre,W=walks,E=this.roads.edges,N=this.roads.nodes,w=this.world;if(!c||c.length<2)return;
  const P=n=>Array.isArray(n)?n:[n.x,n.z],[x0,z0,x1,z1]=d.bbox,on=e=>{const p=e.points[Math.floor(e.points.length/2)],q=e.points[Math.max(0,Math.floor(e.points.length/2)-1)],x=(p[0]+q[0])/2,z=(p[1]+q[1])/2;return x>=x0&&x<=x1&&z>=z0&&z<=z1&&pointInPolygon(x,z,d.rings);}; // a footway along the deck itself
  const out=new Map();for(const e of W.edges){const [x,z]=e.points[0];if(x<x0-270||x>x1+270||z<z0-270||z>z1+270||on(e))continue; /* the footways within reach of the deck, less the one along it */if(!out.has(e.from))out.set(e.from,[]);out.get(e.from).push(e);}
  const incoming=new Map();for(const e of E){const [x,z]=e.points.at(-1);if(x<x0-280||x>x1+280||z<z0-280||z>z1+280)continue;if(!incoming.has(e.to))incoming.set(e.to,[]);incoming.get(e.to).push(e);}
  const ride=e=>e.length>4&&!e.crossing&&this.offset(e)!==null,ok=new Map(),cells=new Map(),key=(x,z)=>Math.floor(x/10)*65536+Math.floor(z/10); // street nodes near the deck in 10 m cells; whether riders use one is asked only of those reached
  const usable=i=>{if(!ok.has(i))ok.set(i,(this.roads.outgoing[i]||[]).map(j=>typeof j==='number'?E[j]:j).some(ride)&&(incoming.get(i)||[]).some(ride));return ok.get(i);};
  N.forEach((n,i)=>{const [x,z]=P(n);if(x<x0-270||x>x1+270||z<z0-270||z>z1+270)return;const k=key(x,z);if(!cells.has(k))cells.set(k,[]);cells.get(k).push([x,z,i]);});
  const near=(x,z)=>{const list=[];for(let dx=-10;dx<=10;dx+=10)for(let dz=-10;dz<=10;dz+=10)for(const n of cells.get(key(x+dx,z+dz))||[])list.push(n);return list;};
  const clear=(a,b)=>{const n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.5);for(let k=0;k<=n;k++){const x=a[0]+(b[0]-a[0])*k/n,z=a[1]+(b[1]-a[1])*k/n;if(w.buildings.at(x,z)||!w.roads.at(x,z)&&!w.pavement?.at(x,z)&&w.water&&inWaterPolygons(w.water,x,z))return false;}return true;};
  const end=pt=>{ // from the deck's end along the footways (up to 250 m) to the nearest street node a rider uses (within 10 m of a footway node, in a clear line)
   let start=-1,sd=8;W.nodes.forEach((n,i)=>{const [x,z]=P(n),k=Math.hypot(x-pt[0],z-pt[1]);if(k<sd&&out.has(i)){sd=k;start=i;}});if(start<0)return null;
   const dist=new Map([[start,0]]),prev=new Map(),queue=[[0,start]];let best=null;
   while(queue.length){let m=0;for(let i=1;i<queue.length;i++)if(queue[i][0]<queue[m][0])m=i;const [g,n]=queue.splice(m,1)[0];if(g>dist.get(n))continue;if(g>250||best&&g>=best.cost)break;
    const p=P(W.nodes[n]);for(const [x,z,i] of near(p[0],p[1])){const k=Math.hypot(x-p[0],z-p[1]);if(k<10&&(!best||g+k<best.cost)&&usable(i)&&clear(p,[x,z]))best={cost:g+k,node:i,walk:n};}
    for(const e of out.get(n)||[]){const h=g+e.length;if(h<(dist.get(e.to)??Infinity)){dist.set(e.to,h);prev.set(e.to,e);queue.push([h,e.to]);}}}
   if(!best)return null;const pts=[P(N[best.node])];for(let n=best.walk;n!==start;){const e=prev.get(n);for(let k=e.points.length-2;k>=0;k--)pts.push(e.points[k]);n=e.from;}return {node:best.node,pts};}; // street node -> deck end
  const a=end(c[0]),b=end(c.at(-1));if(!a||!b||a.node===b.node)return;
  const join=(q,list)=>{let k=0;for(let i=1;i<list.length&&Math.hypot(list[i][0]-list[0][0],list[i][1]-list[0][1])<15;i++)if(Math.hypot(list[i][0]-q[0],list[i][1]-q[1])<Math.hypot(list[k][0]-q[0],list[k][1]-q[1]))k=i;return k;}; // onto the centreline where the footway meets it, not back to its tip (a hairpin)
  const i0=join(a.pts.at(-1),c),i1=c.length-1-join(b.pts.at(-1),[...c].reverse()),line=c.slice(i0,i1+1);
  const pts=[];for(const p of [...a.pts,...line,...[...b.pts].reverse()])if(!pts.length||Math.hypot(p[0]-pts.at(-1)[0],p[1]-pts.at(-1)[1])>.05)pts.push(p);
  const g=prepareGraph({nodes:[0,1],edges:[{from:0,to:1,points:pts,lane:.9},{from:1,to:0,points:[...pts].reverse(),lane:.9}]}),at=q=>{let k=0;for(let i=1;i<pts.length;i++)if(Math.hypot(pts[i][0]-q[0],pts[i][1]-q[1])<Math.hypot(pts[k][0]-q[0],pts[k][1]-q[1]))k=i;return g.edges[0].cumulative[k];};
  const s0=at(line[0]),s1=at(line.at(-1)),L=g.edges[0].length,n=this.linkList.length;
  for(const [e,from,to,lo,hi] of [[g.edges[0],a.node,b.node,s0,s1],[g.edges[1],b.node,a.node,L-s1,L-s0]]){Object.assign(e,{id:`deck${n}:${from}`,from,to,crossing:false,cycleOnly:true,deck:d,deckFrom:lo,deckTo:hi});e.heights=deckProfile(e);this.offsets.set(e.id,e.lane);if(!this.links.has(from))this.links.set(from,[]);this.links.get(from).push(e);this.linkList.push(e);}
 }
 // the ways on from a street node: the streets, and a raised deck's cycle way from there (taken every other time: it is the way across)
 onward(cur,list){const l=this.links.get(cur.to);if(!l)return list;const deck=l.filter(e=>e.to!==cur.from);return deck.length&&this.random()<.5?deck:list;}
 offset(e){
  if(this.offsets.has(e.id))return this.offsets.get(e.id);
  const w=this.world;let best=null;
  for(const o of [e.lane+3.9,e.lane+3.2,e.lane+1.7]){
   let ok=0;for(const f of [.25,.5,.75]){const p=routePoint(e,e.length*f,o);if(!w.buildings.at(p.x,p.z)&&(w.roads.at(p.x,p.z)||w.pavement?.at(p.x,p.z)))ok++;}
   if(ok>=2&&!this.throughParked(e,o)){best=o;break;}
  }
  this.offsets.set(e.id,best);return best;
 }
 // A riding line through a parked car (narrow streets: the cars at the kerb fill the strip the track would take) is
 // no line: riders went through the parked cars along 174 streets in the centre. No line left: the street is not ridden.
 throughParked(e,o){if(!this.parked)return false;for(let s=1;s<e.length;s+=2){const p=routePoint(e,s,o);for(const b of this.parked(p.x,p.z,3.2)){const dx=p.x-b.x,dz=p.z-b.z,c=Math.cos(b.heading),sn=Math.sin(b.heading);if(Math.abs(dx*c-dz*sn)<b.halfWidth+.45&&Math.abs(dx*sn+dz*c)<b.halfLength+.45)return true;}}return false;}
 spawn(r,player){
  const E=this.roads.edges;
  for(let tries=0;tries<40;tries++){
   const k=Math.floor(this.random()*(E.length+this.linkList.length)),e=k<E.length?E[k]:this.linkList[k-E.length];if(e.length<15||e.crossing)continue;
   const m=e.points[Math.floor(e.points.length/2)],d=hypot(m[0]-player.x,m[1]-player.z);if(d<40||d>340)continue;
   if(d<160&&player.heading!==undefined){const fx=-Math.sin(player.heading),fz=-Math.cos(player.heading);if(((m[0]-player.x)*fx+(m[1]-player.z)*fz)/d>.2)continue;} // not popping up ahead
   if(this.visibilityTest&&d<260&&tries<30&&this.visibilityTest({x:m[0],z:m[1]}))continue; // nor anywhere else the camera looks
   if(this.offset(e)===null)continue;
   const route=[e];let total=e.length,cur=e;
   while(total<700){const next=this.onward(cur,(this.roads.outgoing[cur.to]||[]).map(i=>typeof i==='number'?E[i]:i).filter(n=>n.to!==cur.from&&n.length>4&&!n.crossing&&this.offset(n)!==null));if(!next.length)break;cur=next[Math.floor(this.random()*next.length)];route.push(cur);total+=cur.length;}
   r.route=route;r.leg=0;r.s=this.random()*e.length*.5;r.speed=r.cruise*.8;return true;
  }
  r.route=null;return false;
 }
 // visibilityTest: set by main.js (the camera frustum, as for the traffic); without one, anything within 160 m counts as seen.
 visible(r,player){const d=hypot(r.x-player.x,r.z-player.z);return d<RANGE&&(this.visibilityTest?d<12||this.visibilityTest(r):d<160);}
 extend(r){const E=this.roads.edges,cur=r.route.at(-1),out=(this.roads.outgoing[cur.to]||[]).map(i=>typeof i==='number'?E[i]:i).filter(n=>n.length>4&&!n.crossing),on=out.filter(n=>n.to!==cur.from),usual=on.filter(n=>this.offset(n)!==null);
  const list=this.onward(cur,usual.length?usual:on.length?on:out);if(!list.length)return false;r.route.push(list[Math.floor(this.random()*list.length)]);return true;}
 snapshot(){return this.riders.filter(r=>!r.playerTaken&&r.route).map(({id,x,z,heading,speed,deckY})=>({id,x,z,heading,speed,deckY}));}
 step(dt,player){
  if(!player)return;
  for(const r of this.riders){
   if(r.knockdown||r.playerTaken){r.speed=0;continue;}
   if(!r.route||hypot(r.x-player.x,r.z-player.z)>RANGE){if(!this.spawn(r,player)){r.x=r.z=1e6;r.deckY=null;continue;}}
   const e=r.route[r.leg],o=this.offset(e)??e.lane+1.7;
   const ahead=routePoint(e,Math.min(e.length,r.s+4),o),blocked=hypot(ahead.x-player.x,ahead.z-player.z)<3&&(player.deckY!=null)===(r.deckY!=null); // the player under the deck (or on it, the rider below) is no one in the way
   r.speed+=Math.max(-5*dt,Math.min(1.5*dt,(blocked?0:r.cruise)-r.speed));
   r.s+=r.speed*dt;
   // End of the route: out of sight the rider is re-spawned elsewhere; in sight it rides on (the route is extended), so
   // nobody vanishes in the middle of a junction. A dead end in sight: wait there until the camera has turned away.
   if(r.s>=e.length){if(r.leg+1>=r.route.length&&(this.visible(r,player)?!this.extend(r):true)){if(this.visible(r,player)){r.s=e.length;r.speed=0;}else{r.route=null;continue;}}else{r.s-=e.length;r.leg++;if(r.leg>8){r.route.splice(0,r.leg);r.leg=0;}}}
   const cur=r.route[r.leg],p=routePoint(cur,r.s,this.offset(cur)??cur.lane+1.7);r.x=p.x;r.z=p.z;r.heading=p.heading;r.phase+=r.speed*dt*2.2;
   r.deckY=cur.heights?deckY(cur,r.s):null; // up on a raised deck: its height (drawn there by cyclists.js)
  }
 }
}
