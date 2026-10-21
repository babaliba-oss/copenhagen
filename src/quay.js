import * as THREE from 'three';
import earcut from 'earcut';
import {SpatialIndex,WORLD_EXTENT,clipLinesFor,onClipLine,playableExtent,pointInPolygon,inWaterPolygons} from './geo.js';

// Helsinki's harbour water sits well below street level behind vertical
// granite quay walls (Kauppatori, Pohjoisranta, Eteläranta). The height is a
// photo estimate at the Kolera basin, not a survey.
export const WATER_LEVEL=-1.2;
export const QUAY_FOOT=-1.75;
export const COPING_TOP=.13;
const GROUND_Y=-.5;
const BRIDGE=/silta/i;
const LAND_PROBES=[.6,2];

// Fast "inside any water polygon" test: edges bucketed by 4 m z-rows, then an
// even-odd +x ray. The municipal sea polygon has thousands of vertices, so a
// plain point-in-polygon per quay segment would dominate loading.
export function waterLocator(water){
 // Any water polygon holds the point (overlapping polygons stay wet); the raster in geo.js answers most points at once.
 return (x,z)=>inWaterPolygons(water,x,z);
}

const openRing=ring=>{const r=ring.filter(p=>Number.isFinite(p?.[0])&&Number.isFinite(p?.[1]));if(r.length>1&&r[0][0]===r.at(-1)[0]&&r[0][1]===r.at(-1)[1])r.pop();return r;};
const signedArea=r=>{let s=0;for(let i=0;i<r.length;i++){const a=r[i],b=r[(i+1)%r.length];s+=a[0]*b[1]-b[0]*a[1];}return s/2;};
const onBoundary=(a,b,extent)=>onClipLine(a,b,clipLinesFor(extent));

// Unit normals of each segment pointing toward land (sign +1 = ring interior).
function ringNormals(r,interiorSign){
 const orient=Math.sign(signedArea(r))||1;
 return r.map((a,i)=>{const b=r[(i+1)%r.length],dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz)||1;return [-dz/l*orient*interiorSign,dx/l*orient*interiorSign];});
}
// Mitred offset direction at each vertex, so neighbouring wall panels share
// exactly the same corner points (no cracks, no overlapping coplanar faces).
function miters(normals){
 return normals.map((n2,i)=>{const n1=normals[(i-1+normals.length)%normals.length];let mx=n1[0]+n2[0],mz=n1[1]+n2[1];const l=Math.hypot(mx,mz);
  if(l<1e-6)return [n2[0],n2[1]];mx/=l;mz/=l;const s=1/Math.max(mx*n2[0]+mz*n2[1],.4);return [mx*s,mz*s];});
}
function subdivide(r,step){const out=[];for(let i=0;i<r.length;i++){const a=r[i],b=r[(i+1)%r.length],n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/step));for(let k=0;k<n;k++)out.push([a[0]+(b[0]-a[0])*k/n,a[1]+(b[1]-a[1])*k/n]);}return out;}

// Returns quay/shore segments of the water polygons that border land. Edges on
// the map boundary, edges shared with other water, and edges hidden under
// paved quays mapped over the water are skipped. Paved (non-bridge) surfaces
// that extend over the water get their own walls along their water edges.
// Under a bridge deck the shoreline gets a 'deck' wall: its top stays under the deck's paving. Draped on the
// ground like the others, a granite coping or rock edge lay 13 cm proud across the bridge's carriageway (Langebro's
// Islands Brygge end: a 36 m bar across both carriageways and the island between them).
export function extractQuayEdges(water,land={},{extent=WORLD_EXTENT}={}){
 const inWater=waterLocator(water);
 const paved=[...(land.roads||[]),...(land.pavement||[])].filter(p=>p.rings?.[0]?.length>2&&!BRIDGE.test(`${p.kind||''} ${p.name||''}`));
 const decks=[...(land.roads||[]),...(land.pavement||[])].filter(p=>p.rings?.[0]?.length>2&&BRIDGE.test(`${p.kind||''} ${p.name||''}`)),deckIndex=new SpatialIndex(decks),bridgeIndex=deckIndex;
 // Shore segments passing under a deck are cut every 2 m, so the part under the deck changes kind where the deck ends.
 const nearDeck=(a,b)=>{const x0=Math.min(a[0],b[0]),x1=Math.max(a[0],b[0]),z0=Math.min(a[1],b[1]),z1=Math.max(a[1],b[1]);for(const d of decks){const q=d.bbox;if(q[0]<=x1&&q[2]>=x0&&q[1]<=z1&&q[3]>=z0)return true;}return false;};
 const refine=r=>{if(!decks.length)return r;const out=[];for(let i=0;i<r.length;i++){const a=r[i],b=r[(i+1)%r.length];out.push(a);if(!nearDeck(a,b))continue;const m=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/2);for(let k=1;k<m;k++)out.push([a[0]+(b[0]-a[0])*k/m,a[1]+(b[1]-a[1])*k/m]);}return out;};
 const pavedIndex=new SpatialIndex(paved),buildIndex=new SpatialIndex((land.buildings||[]).filter(p=>p.rings?.[0]?.length>2)),parkIndex=new SpatialIndex((land.parks||[]).filter(p=>p.rings?.[0]?.length>2));
 const classify=(x,z,nx,nz)=>{
  let park=false;
  for(const d of LAND_PROBES){const px=x+nx*d,pz=z+nz*d;if(pavedIndex.at(px,pz)||buildIndex.at(px,pz))return 'quay';if(parkIndex.at(px,pz))park=true;}
  return park?'park':'bare';
 };
 const edges=[];
 // Panel may span points that deviate at most 6 cm (granite) / 20 cm (rock)
 // from its chord, and at most 40 m.
 const straight=(run,b)=>{const dx=b[0]-run.a[0],dz=b[1]-run.a[1],l=Math.hypot(dx,dz),tol=run.kind==='quay'?.06:.2;if(l>40||l<1e-6)return false;
  for(const p of [...run.inner,run.b]){const t=((p[0]-run.a[0])*dx+(p[1]-run.a[1])*dz)/(l*l);if(t<=0||t>=1||Math.abs((p[0]-run.a[0])*dz-(p[1]-run.a[1])*dx)/l>tol)return false;}return true;};
 // Consecutive, nearly collinear segments of one kind are merged into one
 // panel (fewer vertices); capA/capB mark panel ends that need an end cap.
 const emit=(r,normals,keep)=>{
  const m=miters(normals),n=r.length,kinds=r.map((a,i)=>keep(a,r[(i+1)%n],normals[i]));
  let start=kinds.findIndex((k,i)=>k&&kinds[(i-1+n)%n]!==k);if(start<0)start=kinds.some(Boolean)?0:-1;if(start<0)return;
  let run=null;
  for(let s=0;s<n;s++){const i=(start+s)%n,j=(i+1)%n,kind=kinds[i];
   if(!kind){if(run){edges.push(run);run=null;}continue;}
   const piece={a:r[i],b:r[j],n:normals[i],ma:m[i],mb:m[j],kind,capA:kinds[(i-1+n)%n]!==kind,capB:kinds[j]!==kind};
   if(run&&run.kind===kind&&straight(run,piece.b)){run.inner.push(run.b);run.b=piece.b;run.mb=piece.mb;run.capB=piece.capB;}
   else{if(run)edges.push(run);run=piece;piece.inner=[];}
  }
  if(run)edges.push(run);
 };

 for(const {rings} of water)(rings||[]).forEach((ring,ri)=>{
  const r=refine(openRing(ring));if(r.length<3)return;
  // Outer ring: land is outside it; island holes: land is inside them.
  emit(r,ringNormals(r,ri?1:-1),(a,b,n)=>{
   if(Math.hypot(b[0]-a[0],b[1]-a[1])<.02||onBoundary(a,b,extent))return null;
   const mx=(a[0]+b[0])/2,mz=(a[1]+b[1])/2;
   if(inWater(mx+n[0]*.6,mz+n[1]*.6))return null;           // other water
   if(pavedIndex.at(mx-n[0]*.3,mz-n[1]*.3))return null;       // under a paved quay
   if(deckIndex.at(mx-n[0]*.3,mz-n[1]*.3))return 'deck';      // under a bridge: the wall stops below the deck
   return classify(mx,mz,n[0],n[1]);
  });
 });
 for(const p of paved){
  const b=p.bbox;if(!inWater((b[0]+b[2])/2,(b[1]+b[3])/2)&&!p.rings[0].some(([x,z])=>inWater(x,z)))continue;
  const r=subdivide(openRing(p.rings[0]),2);if(r.length<3)continue;
  emit(r,ringNormals(r,1),(a,c,n)=>{
   const mx=(a[0]+c[0])/2,mz=(a[1]+c[1])/2,ox=mx-n[0]*.4,oz=mz-n[1]*.4;
   // Both sides over mapped water: a pier or quay deck, not paving that
   // merely touches the shoreline (which already has its own wall).
   if([[0,0],[-1.5,0],[1.5,0]].some(([d])=>bridgeIndex.at(mx+n[0]*d,mz+n[1]*d)))return null; // the street's end reaching under or beside a bridge deck (1760: today's Højbro Plads and Holmens Kanal over the wider canals): a wall there stood as a block in the water by the bridge
   return inWater(ox,oz)&&inWater(mx+n[0]*.4,mz+n[1]*.4)&&!pavedIndex.at(ox,oz)&&!buildIndex.at(ox,oz)?'quay':null;
  });
 }
 for(const e of edges){delete e.inner;const dx=e.b[0]-e.a[0],dz=e.b[1]-e.a[1],l=Math.hypot(dx,dz)||1,sg=Math.sign(e.n[0]*-dz+e.n[1]*dx)||1;e.n=[-dz/l*sg,dx/l*sg];}
 return edges;
}

// Cross-section profiles as (distance toward land, height) pairs. Consecutive
// pairs become wall strips; the closed polygon becomes an end cap.
const QUAY_PROFILE=[[0,QUAY_FOOT],[0,WATER_LEVEL+.22],[0,-.1],[-.07,-.1],[-.07,COPING_TOP],[.62,COPING_TOP],[.62,-.56]];
const QUAY_COLORS=['#34362e','#67675f','#8f8b80','#aaa698','#a5a193','#8f8b80'];
const rockProfile=top=>[[-.9,QUAY_FOOT],[-.3,WATER_LEVEL+.2],[0,top-.06],[.35,top],[.35,Math.min(top,-.56)]];
const ROCK_COLORS=['#2a2c26','#5d5d55','#6d6c63','#65645b'];
export const PROFILES={
 quay:{points:QUAY_PROFILE,colors:QUAY_COLORS,skirtStart:0},
 park:{points:rockProfile(.06),colors:ROCK_COLORS,skirtStart:-.45},
 bare:{points:rockProfile(GROUND_Y+.06),colors:ROCK_COLORS,skirtStart:-.45},
 deck:{points:[[0,QUAY_FOOT],[0,WATER_LEVEL+.22],[0,-.35],[.3,-.35]],colors:QUAY_COLORS.slice(0,3),skirtStart:0}, // the abutment under a bridge: no coping on the carriageway
};

function linear(hex){const c=new THREE.Color(hex);return [c.r,c.g,c.b];}
function shade(rgb,f){return rgb.map(v=>v*f);}
// Deterministic block-to-block granite variation.
const jitter=(x,z)=>{const s=Math.sin(x*12.9898+z*78.233)*43758.5453;return .9+.2*(s-Math.floor(s));};

const BOLLARD=(()=>{const g=new THREE.CylinderGeometry(.13,.17,.5,8,1,true).toNonIndexed(),top=new THREE.CircleGeometry(.14,8).toNonIndexed();top.rotateX(-Math.PI/2);top.translate(0,.25,0);const a=[...g.attributes.position.array,...top.attributes.position.array];g.dispose();top.dispose();return a;})();
const IRON=linear('#2b2f2e');

// One merged, vertex-coloured mesh for walls, coping, caps and bollards, and a
// separate transparent darkening strip on the water along the walls.
export function buildQuayGeometry(edges,{bollardSpacing=16,skipBollards=()=>false,pontoons=[]}={}){
 const pos=[],col=[],skirtPos=[],skirtCol=[];
 const colors=Object.fromEntries(Object.entries(PROFILES).map(([k,p])=>[k,p.colors.map(linear)]));
 const quad=(a,b,c,d,rgb)=>{for(const p of [a,b,c,a,c,d]){pos.push(...p);col.push(...rgb);}};
 const at=(v,m,[d,y])=>[v[0]+m[0]*d,y,v[1]+m[1]*d];
 const cap=(v,m,kind)=>{const pts=PROFILES[kind].points,ids=earcut(pts.flat()),rgb=colors[kind][1];for(const i of ids){pos.push(...at(v,m,pts[i]));col.push(...rgb);}};
 let bollardRun=0;
 for(const e of edges){
  const prof=PROFILES[e.kind],pts=prof.points,f=jitter(e.a[0],e.a[1]);
  for(let i=1;i<pts.length;i++){const rgb=shade(colors[e.kind][i-1],i>=3&&e.kind==='quay'?f:1);quad(at(e.a,e.ma,pts[i-1]),at(e.b,e.mb,pts[i-1]),at(e.b,e.mb,pts[i]),at(e.a,e.ma,pts[i]),rgb);}
  if(e.capA!==false)cap(e.a,e.ma,e.kind);
  if(e.capB!==false)cap(e.b,e.mb,e.kind);
  // Water-side darkening: wall shade and reflected stonework.
  const s0=prof.skirtStart,s1=s0-3.2,y=WATER_LEVEL+.012;
  const A=at(e.a,e.ma,[s0,y]),B=at(e.b,e.mb,[s0,y]),C=at(e.b,e.mb,[s1,y]),D=at(e.a,e.ma,[s1,y]);
  for(const [p,al] of [[A,.55],[B,.55],[C,0],[A,.55],[C,0],[D,0]]){skirtPos.push(...p);skirtCol.push(0,0,0,al);}
  if(e.kind==='quay'&&bollardSpacing>0){
   const len=Math.hypot(e.b[0]-e.a[0],e.b[1]-e.a[1]);
   for(let t=bollardSpacing-bollardRun;t<len;t+=bollardSpacing){const u=t/len,x=e.a[0]+(e.b[0]-e.a[0])*u+e.n[0]*.3,z=e.a[1]+(e.b[1]-e.a[1])*u+e.n[1]*.3;if(!skipBollards(x,z))bollard(x,z);}
   bollardRun=(bollardRun+len)%bollardSpacing;
  }
 }
 function bollard(x,z){const p=BOLLARD,rgb=IRON;for(let i=0;i<p.length;i+=3){pos.push(p[i]+x,p[i+1]+COPING_TOP+.25,p[i+2]+z);col.push(...rgb);}}
 // Floating structures modelled at street level get a dark hull down into the
 // lowered water, so they do not hover (four sides; the top stays theirs).
 for(const {x,z,w,d,yaw=0,top} of pontoons){
  const c=Math.cos(yaw),sn=Math.sin(yaw),rgb=linear('#2c2e2a'),corner=([u,v])=>[x+u*c+v*sn,z-u*sn+v*c];
  const k=[[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]].map(corner);
  for(let i=0;i<4;i++){const a=k[i],b=k[(i+1)%4];quad([a[0],WATER_LEVEL-.3,a[1]],[b[0],WATER_LEVEL-.3,b[1]],[b[0],top,b[1]],[a[0],top,a[1]],rgb);}
 }
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(col,3));geometry.computeVertexNormals();geometry.computeBoundingSphere();
 const skirt=new THREE.BufferGeometry();skirt.setAttribute('position',new THREE.Float32BufferAttribute(skirtPos,3));skirt.setAttribute('color',new THREE.Float32BufferAttribute(skirtCol,4));skirt.computeBoundingSphere();
 return {geometry,skirt};
}

// Ground plane (in PlaneGeometry local XY, rotated -90° about X by main.js)
// with the water cut out, so the lowered sea is visible behind the quays.
// An installing region can request ground before its playable boundary opens.
// Already activated regions still contribute, so loading a nearer one cannot
// shrink the ground under a previously visited place.
export function groundSizeForExtent(extent=0){return Math.max(11000,2*Math.max(playableExtent(),Number.isFinite(extent)?extent:0)+3000);}
export function createGroundGeometry(water,size=groundSizeForExtent()){
 const h=size/2,polys=[[[[-h,-h],[h,-h],[h,h],[-h,h]],...water.map(w=>openRing(w.rings?.[0]||[])).filter(r=>r.length>2)]];
 for(const w of water)for(const r of (w.rings||[]).slice(1)){const o=openRing(r);if(o.length>2)polys.push([o]);}
 const pos=[];
 for(const rings of polys){
  const flat=[],holes=[];rings.forEach((r,i)=>{if(i)holes.push(flat.length/2);for(const p of r)flat.push(p[0],-p[1]);});
  const ids=earcut(flat,holes,2);
  for(let i=0;i<ids.length;i+=3){const [a,b,c]=[ids[i],ids[i+1],ids[i+2]].map(k=>[flat[k*2],flat[k*2+1]]);const cross=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);for(const p of cross>=0?[a,b,c]:[a,c,b])pos.push(p[0],p[1],0);}
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
 const n=new Float32Array(pos.length);for(let i=2;i<n.length;i+=3)n[i]=1;g.setAttribute('normal',new THREE.BufferAttribute(n,3));g.computeBoundingSphere();return g;
}

// Bridge railings: wherever a bridge deck (road or footway kind 'Silta') borders the water, an iron railing
// stands on its edge (posts every 1.8 m, top and middle rails). Without it a deck over a canal read as a
// road edge you could drive off into the water. Geometry at y=0 above the deck; drape it onto the ground.
export function buildBridgeRailings(water,land={},{height=1.05,ground=()=>0}={}){ // ground(x,z): height of the land; a run stands at its higher (quay) end, not on the canal bed
 const tagged=p=>BRIDGE.test(`${p.kind||''} ${p.name||''}`),inWater=waterLocator(water),decks=[...(land.roads||[]),...(land.pavement||[])].filter(p=>p.rings?.[0]?.length>2).sort((a,b)=>tagged(b)-tagged(a)); // 'Silta' decks, and any paving mapped across the water (a bridge without the tag); the tagged ones first, so they keep their railings where an untagged deck runs along them
 const placed=new Map(),cellOf=(x,z)=>Math.floor(x/4)+','+Math.floor(z/4),railedNear=(x,z,self,r=1.2)=>{for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++)for(const s of placed.get(cellOf(x+i*4,z+j*4))||[]){if(s[4]===self)continue;const dx=s[2]-s[0],dz=s[3]-s[1],l=dx*dx+dz*dz,t=l?Math.max(0,Math.min(1,((x-s[0])*dx+(z-s[1])*dz)/l)):0;if(Math.hypot(x-s[0]-dx*t,z-s[1]-dz*t)<r)return true;}return false;}; // railing already standing within r m on another deck (two decks' edges along each other: Højbro and Højbro Plads, Holmens Bro and Holmens Kanal had a railing each, side by side)
 const parts=[],box=(w,h,d,x,y,z,yaw)=>{const g=new THREE.BoxGeometry(w,h,d);g.rotateY(yaw);g.translate(x,y,z);parts.push(g.index?g.toNonIndexed():g);};
 const paved=new SpatialIndex(decks),otherPaving=(x,z,self)=>paved.near(x,z).some(p=>p!==self&&x>=p.bbox[0]&&x<=p.bbox[2]&&z>=p.bbox[1]&&z<=p.bbox[3]&&pointInPolygon(x,z,p.rings)); // where the deck meets the next road or footway: no railing across it
 // Two decks side by side with a strip of water a few metres wide between them (Langebro's carriageways at the
 // Islands Brygge end, mapped apart): each got a railing along the slot and the slot stayed open, a dark trench down
 // to the harbour along the middle of the road. A slot up to SLOT metres wide is decked over instead, without railings
 // (from the first of the two decks only).
 const SLOT=4,deckOf=(x,z,self)=>paved.near(x,z).find(p=>p!==self&&x>=p.bbox[0]&&x<=p.bbox[2]&&z>=p.bbox[1]&&z<=p.bbox[3]&&pointInPolygon(x,z,p.rings)),order=new Map(decks.map((d,i)=>[d,i])),fillers=[];let slotLength=0;
 let runs=0;const railed=new Set(),deckY=new Map(),rails=[],runList=[];
 for(const deck of decks)for(const ring of deck.rings){const n=ring.length;let ringTop=-Infinity;for(const p of ring){const g=ground(p[0],p[1]);if(Number.isFinite(g))ringTop=Math.max(ringTop,g);}
  for(let i=0;i<n;i++){const a=ring[i],b=ring[(i+1)%n],dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz);if(l<1.5)continue;
   const ux=dx/l,uz=dz/l,nx=-uz,nz=ux,steps=Math.max(1,Math.round(l/1.8));let start=-1;
   // outer side: the one off the deck; a railing where that side is water and no other paving continues
   const inRing=(x,z)=>{let c=false;for(let j=0,m=ring.length,k2=m-1;j<m;k2=j++){const p=ring[j],q=ring[k2];if((p[1]>z)!==(q[1]>z)&&x<(q[0]-p[0])*(z-p[1])/(q[1]-p[1])+p[0])c=!c;}return c;};
   const wet=t=>{const x=a[0]+dx*t,z=a[1]+dz*t,s=inRing(x+nx*.6,z+nz*.6)?-1:1,ox=x+nx*s*1.5,oz=z+nz*s*1.5;
    if(BRIDGE.test(`${deck.kind||''} ${deck.name||''}`)&&inWater(x+nx*s*.3,z+nz*s*.3)&&!otherPaving(x+nx*s*.3,z+nz*s*.3,deck))for(let d=.5;d<=SLOT;d+=.5){const other=deckOf(x+nx*s*d,z+nz*s*d,deck);if(!other)continue;
     slotLength+=l/steps;if(order.get(deck)<order.get(other)){const h=l/steps/2,w=d+.1,p=[[x-ux*h,z-uz*h],[x+ux*h,z+uz*h]];fillers.push({deck,ring:[p[0],p[1],[p[1][0]+nx*s*w,p[1][1]+nz*s*w],[p[0][0]+nx*s*w,p[0][1]+nz*s*w]]});}return false;}
    if(!inWater(ox,oz)||otherPaving(ox,oz,deck))return false;
    return BRIDGE.test(`${deck.kind||''} ${deck.name||''}`)||inWater(x-nx*s*1.5,z-nz*s*1.5);};
   const shadow=[];for(let k=0;k<=steps;k++){const ok=k<steps&&wet((k+.5)/steps);
    if(ok){const mx=a[0]+dx*(k+.5)/steps,mz=a[1]+dz*(k+.5)/steps;shadow[k]=railedNear(mx,mz,deck);if(!shadow[k]){const c=cellOf(mx,mz);if(!placed.has(c))placed.set(c,[]);placed.get(c).push([a[0]+dx*k/steps,a[1]+dz*k/steps,a[0]+dx*(k+1)/steps,a[1]+dz*(k+1)/steps,deck]);}} /* shadowed: the deck still counts as railed (its plate and height), the railing is not drawn twice */
    if(ok&&start<0)start=k;
    else if(!ok&&start>=0){const t0=start/steps,t1=k/steps,x0=a[0]+dx*t0,z0=a[1]+dz*t0,x1=a[0]+dx*t1,z1=a[1]+dz*t1,len=Math.hypot(x1-x0,z1-z0),yaw=Math.atan2(ux,uz);
     // set in 25 cm from the deck edge
     const cx=(x0+x1)/2,cz=(z0+z1)/2,y0=Math.max(ground(x0,z0),ground(x1,z1),ground(a[0],a[1]),ground(b[0],b[1])),y1=y0<ringTop-2?ringTop:y0,y=Number.isFinite(y1)?y1:0; /* all over sunk canal bed: the deck's highest corner */deckY.set(deck,Math.max(deckY.get(deck)??-Infinity,y));
     for(let s=start;s<k;){if(shadow[s]){s++;continue;}let e=s;while(e<k&&!shadow[e])e++; /* the stretches no other deck's railing already lines */
      const u0=s/steps,u1=e/steps,sx0=a[0]+dx*u0,sz0=a[1]+dz*u0,sx1=a[0]+dx*u1,sz1=a[1]+dz*u1,sl=Math.hypot(sx1-sx0,sz1-sz0),posts=[];
      for(let p=s;p<=e;p++){const t=p/steps;posts.push(a[0]+dx*t,a[1]+dz*t);}
      rails.push({deck,cx:(sx0+sx1)/2,cz:(sz0+sz1)/2,len:sl,yaw,y,posts}); // drawn once the deck heights are settled (a span is lifted to the decks it joins)
      runs++;runList.push([sx0,sz0,sx1,sz1,deck.id||'']);s=e;}
     railed.add(deck);start=-1;}
   }
  }
 }
 // A tagged deck with paving along every side (Langebro's carriageway between its cycle tracks) has no railing of its
 // own, so it got no plate either: the paving over the water is dropped, and the road had a hole down to the harbour.
 // It gets a plate at its quay-end height when a fifth of it lies over the water.
 for(const deck of decks){if(railed.has(deck)||!BRIDGE.test(`${deck.kind||''} ${deck.name||''}`))continue;const ring=deck.rings[0],[x0,z0,x1,z1]=deck.bbox||[Math.min(...ring.map(p=>p[0])),Math.min(...ring.map(p=>p[1])),Math.max(...ring.map(p=>p[0])),Math.max(...ring.map(p=>p[1]))];
  const step=Math.max(2,Math.sqrt((x1-x0)*(z1-z0)/4000));let n=0,wet=0; /* fine enough for a thin strip lying diagonally */for(let x=x0+step/2;x<x1;x+=step)for(let z=z0+step/2;z<z1;z+=step)if(pointInPolygon(x,z,deck.rings)){n++;if(inWater(x,z))wet++;}
  if(!n||wet<n*.2)continue;let top=-Infinity;for(const p of ring){const g=ground(p[0],p[1]);if(Number.isFinite(g))top=Math.max(top,g);}railed.add(deck);deckY.set(deck,Number.isFinite(top)?top:0);}
 // A span mapped on its own between two approaches (Langebro's middle, the lifting span of a drawbridge) has every corner
 // out over the water, where the 1760 canal bed is sunk: its plate and railings lay on the bed, 8 m under the approaches,
 // a hole in the bridge with the approaches' raised ground standing beyond it as a block. A bridge deck more than a metre
 // below the bridge decks it touches takes their height (the higher of them), passed along a chain of spans.
 const lifted=new Set();{const list=[...railed].filter(d=>BRIDGE.test(`${d.kind||''} ${d.name||''}`)),bb=d=>{let a=[Infinity,Infinity,-Infinity,-Infinity];for(const [x,z] of d.rings[0])a=[Math.min(a[0],x),Math.min(a[1],z),Math.max(a[2],x),Math.max(a[3],z)];return a;},boxes=new Map(list.map(d=>[d,bb(d)]));
  const touch=(d,e)=>{const p=boxes.get(d),q=boxes.get(e);if(p[2]<q[0]-.6||q[2]<p[0]-.6||p[3]<q[1]-.6||q[3]<p[1]-.6)return false;
   const near=(r,s)=>r.some(([x,z])=>{for(let i=0,m=s.length;i<m;i++){const [ax,az]=s[i],[bx,bz]=s[(i+1)%m],dx=bx-ax,dz=bz-az,l=dx*dx+dz*dz,t=l?Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/l)):0;if(Math.hypot(x-ax-dx*t,z-az-dz*t)<.6)return true;}return false;});
   return near(d.rings[0],e.rings[0])||near(e.rings[0],d.rings[0]);};
  for(let pass=0;pass<4;pass++){let moved=false;for(const d of list){let up=-Infinity;for(const e of list)if(e!==d&&touch(d,e))up=Math.max(up,deckY.get(e));if(up>deckY.get(d)+1){deckY.set(d,up);lifted.add(d);moved=true;}}if(!moved)break;}}
 for(const {deck,cx,cz,len,yaw,y:y0,posts} of rails){const y=lifted.has(deck)?deckY.get(deck):y0;
  box(.07,.07,len,cx,y+height,cz,yaw);box(.05,.05,len,cx,y+height*.5,cz,yaw);
  for(let p=0;p<posts.length;p+=2)box(.07,height,.07,posts[p],y+height/2,posts[p+1],0);}
 if(!parts.length&&!fillers.length)return null;
 // Decks of tagged bridges as plates of their own: the surface tiles drop paving that lies inside the water
 // polygons (dropSunkenSurfaces), which left railings standing over open water.
 // Untagged paving over the water is mostly a street along a quay that the water reaches into (1760's Børsgraven under
 // today's Børskaj, wider canals under Christians Brygge): a plate level with its highest corner stood up to a metre
 // over the cobbles at its low end, a pale slab on the quay with the canal bed raised under it. Its plate follows the
 // nearest dry ground of its own outline instead (never above the flat height); tagged bridges stay flat.
 const plateHeight=new Map();for(const d of railed){const top=deckY.get(d)+.035;if(BRIDGE.test(`${d.kind||''} ${d.name||''}`))continue;
  const dry=[];for(const ring of d.rings)for(let i=0;i<ring.length;i++){const a=ring[i],b=ring[(i+1)%ring.length],n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/2));
   for(let k=0;k<n;k++){const x=a[0]+(b[0]-a[0])*k/n,z=a[1]+(b[1]-a[1])*k/n;if(inWater(x,z))continue;const g=ground(x,z);if(Number.isFinite(g))dry.push(x,z,g);}}
  if(dry.length)plateHeight.set(d,(x,z)=>{let best=Infinity,h=top;for(let i=0;i<dry.length;i+=3){const q=(dry[i]-x)**2+(dry[i+1]-z)**2;if(q<best){best=q;h=dry[i+2]+.035;}}return Math.min(top,h);});}
 const deck=[];for(const d of railed){const r=d.rings[0];
  const flat=r.flat(),ids=earcut(flat),y=deckY.get(d)+.035,at=plateHeight.get(d);for(const i of ids)deck.push(r[i][0],at?at(r[i][0],r[i][1]):y,r[i][1]);}
 // the slots' plates, level with their deck's (or its highest ground where it has none)
 const slotPlates=fillers.map(({deck:d,ring})=>{let y=deckY.get(d);if(y===undefined){y=-Infinity;for(const p of d.rings[0]){const g=ground(p[0],p[1]);if(Number.isFinite(g))y=Math.max(y,g);}if(!Number.isFinite(y))y=0;}y+=.035;for(const i of [0,1,2,0,2,3])deck.push(ring[i][0],y,ring[i][1]);return {rings:[ring],y,name:d.name||'',kind:d.kind||''};});
 const pos=[];for(const g of parts){pos.push(...g.attributes.position.array);g.dispose();}
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geometry.computeVertexNormals();geometry.userData.runs=runs;geometry.userData.rails=runList; // [x0,z0,x1,z1,deck id] per run
 geometry.userData.bridges=[...[...railed].map(d=>({rings:d.rings,y:deckY.get(d)+.035,...(plateHeight.has(d)?{heightAt:plateHeight.get(d)}:{}),name:d.name||'',kind:d.kind||''})),...slotPlates]; // the plates as drawn: what the ground under them must carry (raiseBridgeDecks); heightAt: a plate that follows its quay
 geometry.userData.slots=slotLength;
 if(deck.length){const g=new THREE.BufferGeometry(),uv=new Float32Array(deck.length/3*2);for(let i=0,j=0;i<deck.length;i+=3,j+=2){uv[j]=deck[i]/2.6;uv[j+1]=deck[i+2]/2.6;}g.setAttribute('position',new THREE.Float32BufferAttribute(deck,3));g.setAttribute('uv',new THREE.BufferAttribute(uv,2));const base=new Float32Array(deck.length/3);for(let i=0;i<base.length;i++)base[i]=deck[i*3+1];g.setAttribute('deckBase',new THREE.BufferAttribute(base,1));g.computeVertexNormals();geometry.userData.deck=g;}
 return geometry;
}
