#!/usr/bin/env node
// Walkers' footways against the bus shelters: lists every segment of the walkers' graph (mobility.json walks cut by
// walkerCut, as the game does) that passes through a shelter's box (3.6 x 1.5 m, src/mapped-furniture.js SOLIDS) grown by
// `margin` metres.   node scripts/shelter-walks.mjs [city] [margin=0.3]      exits 1 if any
import fs from 'node:fs';
import {expandMobility,cutWalksAtKerbs} from '../src/mobility-pack.js';
export const W=3.6,D=1.5;
// Does the segment a-b pass through the shelter's box grown by m? (the box in its own frame: x along the street)
export function crosses(s,a,b,m=0){
 const c=Math.cos(s.yaw||0),n=Math.sin(s.yaw||0),loc=p=>[(p[0]-s.x)*c-(p[1]-s.z)*n,(p[0]-s.x)*n+(p[1]-s.z)*c],A=loc(a),B=loc(b),h=[W/2+m,D/2+m];
 let t0=0,t1=1;
 for(let k=0;k<2;k++){const d=B[k]-A[k];if(Math.abs(d)<1e-9){if(Math.abs(A[k])>=h[k])return false;continue;}
  let u=(-h[k]-A[k])/d,v=(h[k]-A[k])/d;if(u>v)[u,v]=[v,u];t0=Math.max(t0,u);t1=Math.min(t1,v);if(t0>=t1)return false;}
 return true;
}
export function shelterCrossings(walks,shelters,margin=.3){
 const G=20,grid=new Map(),out=[];
 for(const s of shelters){const k=Math.floor(s.x/G)+','+Math.floor(s.z/G);if(!grid.has(k))grid.set(k,[]);grid.get(k).push(s);}
 const seen=new Set();
 walks.edges.forEach((e,i)=>{for(let j=1;j<e.points.length;j++){const a=e.points[j-1],b=e.points[j];
  for(let x=Math.floor((Math.min(a[0],b[0])-4)/G);x<=Math.floor((Math.max(a[0],b[0])+4)/G);x++)for(let z=Math.floor((Math.min(a[1],b[1])-4)/G);z<=Math.floor((Math.max(a[1],b[1])+4)/G);z++)
   for(const s of grid.get(x+','+z)||[]){if(!crosses(s,a,b,margin))continue;
    const key=s.ref+':'+[a,b].map(p=>p.join(',')).sort().join(';');if(seen.has(key))continue;seen.add(key); /* a footway and its way back once */
    out.push({shelter:s,edge:i,segment:j,a,b,crossing:!!e.crossing});}}});
 return out;
}
const r2=v=>Math.round(v*100)/100,frame=s=>{const c=Math.cos(s.yaw||0),n=Math.sin(s.yaw||0);return {loc:p=>[(p[0]-s.x)*c-(p[1]-s.z)*n,(p[0]-s.x)*n+(p[1]-s.z)*c],world:q=>[r2(s.x+q[0]*c+q[1]*n),r2(s.z-q[0]*n+q[1]*c)]};};
// The polyline P with its stretch inside shelter s's box grown by C taken round that box, each way: [points, the new part, its length x .7 if behind the shelter]
function detours(s,P,C,leads=[2,1]){
 const {loc,world}=frame(s),h=[W/2+C,D/2+C],L=P.map(loc);let first=null,last=null;
 for(let i=1;i<L.length;i++){const A=L[i-1],B=L[i];let t0=0,t1=1,ok=true;
  for(let k=0;k<2&&ok;k++){const d=B[k]-A[k];if(Math.abs(d)<1e-9){if(Math.abs(A[k])>=h[k]-1e-6)ok=false;continue;}let u=(-h[k]-A[k])/d,v=(h[k]-A[k])/d;if(u>v)[u,v]=[v,u];t0=Math.max(t0,u);t1=Math.min(t1,v);if(t1-t0<1e-6)ok=false;}
  if(!ok)continue;const at=t=>[A[0]+(B[0]-A[0])*t,A[1]+(B[1]-A[1])*t];if(!first)first={i,q:at(t0)};last={i,q:at(t1)};}
 if(!first)return null;
 /* along the box's outline: 0..4, corners at whole numbers, the back (-z) side from 0 to 1 */
 const cs=[[-h[0],-h[1]],[h[0],-h[1]],[h[0],h[1]],[-h[0],h[1]]],par=q=>{let best=0,bd=Infinity;for(let k=0;k<4;k++){const a=cs[k],b=cs[(k+1)%4],l=Math.hypot(b[0]-a[0],b[1]-a[1]),t=Math.max(0,Math.min(1,((q[0]-a[0])*(b[0]-a[0])+(q[1]-a[1])*(b[1]-a[1]))/l/l)),d=Math.hypot(a[0]+(b[0]-a[0])*t-q[0],a[1]+(b[1]-a[1])*t-q[1]);if(d<bd){bd=d;best=k+t;}}return best%4;},
  pt=u=>{const k=Math.floor(u)%4,t=u-Math.floor(u),a=cs[k],b=cs[(k+1)%4];return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];};
 const a=par(first.q),b=par(last.q),out=[];
 for(const dir of [1,-1]){const way=[pt(a)];let span=((b-a)*dir%4+4)%4;if(span<1e-6)span=0;
  for(let u=dir>0?Math.floor(a)+1:Math.ceil(a)-1,n=0;n<4&&(dir>0?u-a:a-u)<span-1e-6;u+=dir,n++)way.push(cs[((u%4)+4)%4]);
  way.push(pt(b));let len=0,z=0;for(let i=1;i<way.length;i++){const l=Math.hypot(way[i][0]-way[i-1][0],way[i][1]-way[i-1][1]);len+=l;z+=l*(way[i][1]+way[i-1][1])/2;}
  const part=way.map(world),pts=[...P.slice(0,first.i),...part,...P.slice(last.i)].filter((p,i,l)=>!i||Math.hypot(p[0]-l[i-1][0],p[1]-l[i-1][1])>.05||i===l.length-1&&(l.splice(i-1,1,p),false));
  pts[0]=P[0];pts[pts.length-1]=P.at(-1);const cost=len*(z<0?.7:1);
  /* first with the corners cut: off the line 2 m (else 1 m) before the box and straight to the box's corner, back on it as far after */
  if(way.length>2){const c=[0];for(let i=1;i<P.length;i++)c.push(c[i-1]+Math.hypot(P[i][0]-P[i-1][0],P[i][1]-P[i-1][1]));
   const sAt=(i,q)=>c[i-1]+Math.hypot(world(q)[0]-P[i-1][0],world(q)[1]-P[i-1][1]),on=d=>{let i=1;while(i<P.length-1&&c[i]<d)i++;const t=(d-c[i-1])/(c[i]-c[i-1]||1);return [r2(P[i-1][0]+(P[i][0]-P[i-1][0])*t),r2(P[i-1][1]+(P[i][1]-P[i-1][1])*t)];};
   leads.forEach((lead,k)=>{const s0=Math.max(0,sAt(first.i,first.q)-lead),s1=Math.min(c.at(-1),sAt(last.i,last.q)+lead);
    const cut=[s0>0?on(s0):P[0],...part.slice(1,-1),s1<c.at(-1)?on(s1):P.at(-1)];
    out.push({pts:[...P.filter((p,i)=>c[i]<s0-.05||!i&&s0>0),...cut,...P.filter((p,i)=>c[i]>s1+.05||i===P.length-1&&s1<c.at(-1))],part:cut,cost:cost-.01*(leads.length-k)});});}
  out.push({pts,part,cost});}
 return out.sort((p,q)=>p.cost-q.cost);
}
export function moveWalksOffShelters(walks,shelters,ground,{clearances=[1.15,.9,.6,.45,.3]}={}){
 const E=walks.edges,N=walks.nodes,G=20,grid=new Map(),left=[];let moved=0,nodes=0;
 const uniq=shelters.filter((s,i)=>!shelters.slice(0,i).some(o=>Math.hypot(o.x-s.x,o.z-s.z)<.5));
 for(const s of uniq){const k=Math.floor(s.x/G)+','+Math.floor(s.z/G);if(!grid.has(k))grid.set(k,[]);grid.get(k).push(s);}
 const near=(a,b)=>{const out=new Set();for(let x=Math.floor((Math.min(a[0],b[0])-4)/G);x<=Math.floor((Math.max(a[0],b[0])+4)/G);x++)for(let z=Math.floor((Math.min(a[1],b[1])-4)/G);z<=Math.floor((Math.max(a[1],b[1])+4)/G);z++)for(const s of grid.get(x+','+z)||[])out.add(s);return out;};
 const key=e=>e.from+'>'+e.to+':'+e.points.map(p=>p[0]+','+p[1]).join(';'),byKey=new Map();for(const e of E)byKey.set(key(e),e);
 const twin=e=>byKey.get(e.to+'>'+e.from+':'+[...e.points].reverse().map(p=>p[0]+','+p[1]).join(';'));
 const set=(e,pts)=>{const t=twin(e);byKey.delete(key(e));e.points=pts;e.length=r2(pts.reduce((l,p,i)=>i?l+Math.hypot(p[0]-pts[i-1][0],p[1]-pts[i-1][1]):0,0));byKey.set(key(e),e);
  if(t&&t!==e){byKey.delete(key(t));t.points=pts.map(p=>[p[0],p[1]]).reverse();t.length=e.length;byKey.set(key(t),t);}};
 const okPath=(pts,crossing,s)=>{for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i],n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.25));for(let k=0;k<=n;k++)if(!ground(a[0]+(b[0]-a[0])*k/n,a[1]+(b[1]-a[1])*k/n,crossing,s))return false;}return true;};
 const used=(s,a,b,C,crossing)=>{ /* the part of a-b inside the box on ground a walker uses */
  if(!crosses(s,a,b,C))return false;if(crossing)return true;const n=Math.max(2,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.25));
  for(let k=0;k<=n;k++){const p=[a[0]+(b[0]-a[0])*k/n,a[1]+(b[1]-a[1])*k/n];if(crosses(s,p,p.map(v=>v+1e-4),C)&&ground(p[0],p[1],false,null,true))return true;}return false;};
 const hit=(e,s,C)=>e.points.some((p,i)=>i&&used(s,e.points[i-1],p,C,e.crossing));
 /* junctions inside a box, to its edge: the nearest place on the outline the ground allows */
 const at=new Map();E.forEach(e=>{for(const n of [e.from,e.to]){if(!at.has(n))at.set(n,[]);at.get(n).push(e);}});
 for(const [n,es] of at){const p=N[n];for(const s of near(p,p)){if(!crosses(s,p,[p[0]+1e-4,p[1]+1e-4],clearances.at(-1))||!es.some(e=>hit(e,s,clearances.at(-1))))continue;
  const {loc,world}=frame(s),q=loc(p);let done=false;
  for(const C of clearances){const h=[W/2+C+.02,D/2+C+.02];if(Math.abs(q[0])>=h[0]||Math.abs(q[1])>=h[1])continue;
   const c=[[q[0],-h[1]],[q[0],h[1]],[-h[0],q[1]],[h[0],q[1]],[-h[0],-h[1]],[h[0],-h[1]],[-h[0],h[1]],[h[0],h[1]]].map(world).filter(w=>ground(w[0],w[1],es.every(e=>e.crossing),s)).sort((a,b)=>Math.hypot(a[0]-p[0],a[1]-p[1])-Math.hypot(b[0]-p[0],b[1]-p[1]))[0];
   if(!c)continue;const old=[p[0],p[1]];N[n]=[c[0],c[1]];
   for(const e of new Set(es)){if(e.from!==n&&e.to!==n)continue;const pts=e.points.map(x=>[x[0],x[1]]);if(e.from===n&&pts[0][0]===old[0]&&pts[0][1]===old[1])pts[0]=[c[0],c[1]];if(e.to===n&&pts.at(-1)[0]===old[0]&&pts.at(-1)[1]===old[1])pts[pts.length-1]=[c[0],c[1]];set(e,pts);}
   nodes++;done=true;break;}
  if(!done)left.push({shelter:s,node:n,why:'a junction of footways in the shelter with no clear ground beside it'});}}
 /* stretches through a box, round it */
 const twins=new Set(),once=E.filter(e=>{if(twins.has(e))return false;const t=twin(e);if(t)twins.add(t);return true;}),tight=new Map();
 for(let pass=0,changed=true;changed&&pass<4;pass++){changed=false;for(const e of once){
  for(const s of near(...e.points.reduce((b,p)=>[[Math.min(b[0][0],p[0]),Math.min(b[0][1],p[1])],[Math.max(b[1][0],p[0]),Math.max(b[1][1],p[1])]],[[Infinity,Infinity],[-Infinity,-Infinity]]))){
   if(!hit(e,s,clearances[0]))continue;const k=E.indexOf(e)+':'+s.x+','+s.z;if(tight.has(k))continue;let C0=null;
   for(const C of clearances){if(!hit(e,s,C)){C0=C;break;} /* already clear by this much: nothing better fits */
    const c=(detours(s,e.points,C+.02)||[]).find(c=>okPath(c.part,e.crossing,s)&&!hit({points:c.pts,crossing:e.crossing},s,C));
    if(c){set(e,c.pts);moved++;changed=true;C0=C;break;}}
   if(C0!==clearances[0])tight.set(k,{shelter:s,edge:E.indexOf(e),clear:C0,why:C0?`room for ${C0} m only`:'no clear ground round the shelter'});}}}
 left.push(...tight.values());
 return {moved,nodes,left};
}
if(import.meta.url===`file://${process.argv[1]}`&&process.argv.includes('--fix')){
 const zlib=await import('node:zlib'),{expandCity}=await import('../src/city-pack.js'),{SpatialIndex}=await import('../src/geo.js'),{SOLIDS}=await import('../src/mapped-furniture.js');
 const city=process.argv[2]||'copenhagen',dir=`public/cities/${city}`;let pack=fs.readFileSync(`${dir}/city.pack`);if(pack[0]===31&&pack[1]===139)pack=zlib.gunzipSync(pack);
 const data=expandCity(JSON.parse(pack.toString())),houses=new SpatialIndex(data.buildings.filter(b=>!/^(roof|construction|carport|bridge)$/.test(b.kind||''))),roads=new SpatialIndex(data.roads.filter(r=>!/Koroke/.test(r.kind||''))),pavement=new SpatialIndex(data.pavement);
 const items=JSON.parse(fs.readFileSync(`${dir}/furniture.json`,'utf8')).items,solid=new Map();
 for(const it of items){if(!SOLIDS[it.k])continue;const k=Math.floor(it.x/8)+','+Math.floor(it.z/8);if(!solid.has(k))solid.set(k,[]);solid.get(k).push(it);}
 const ring=[0,1,2,3,4,5,6,7].map(k=>[Math.cos(k*Math.PI/4),Math.sin(k*Math.PI/4)]);
 /* ground a moved footway may run on: pavement 0.2 m clear of the kerb (a crossing: the carriageway too), 0.6 m off the houses, off other solid furniture; bare: only whether a walker walks there now */
 const ground=(x,z,crossing,own,bare)=>{const on=(x,z)=>!houses.at(x,z)&&(crossing?!!(roads.at(x,z)||pavement.at(x,z)):!roads.at(x,z)&&!!pavement.at(x,z));if(!on(x,z))return false;if(bare)return true;
  if(ring.some(([c,s])=>!on(x+c*.2,z+s*.2)||houses.at(x+c*.6,z+s*.6)))return false;
  for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++)for(const it of solid.get((Math.floor(x/8)+i)+','+(Math.floor(z/8)+j))||[]){if(own&&Math.hypot(it.x-own.x,it.z-own.z)<.5)continue;const [w,d]=SOLIDS[it.k],c=Math.cos(it.yaw||0),n=Math.sin(it.yaw||0),lx=(x-it.x)*c-(z-it.z)*n,lz=(x-it.x)*n+(z-it.z)*c;if(Math.abs(lx)<w/2+.3&&Math.abs(lz)<d/2+.3)return false;}
  return true;};
 const m=JSON.parse(fs.readFileSync(`${dir}/mobility.json`,'utf8'));if(m.packed)throw Error('mobility.json is packed');
 const r=moveWalksOffShelters(m.walks,items.filter(i=>i.k==='shelter'),ground);
 fs.writeFileSync(`${dir}/mobility.json`,JSON.stringify(m));
 for(const l of r.left)console.log(`shelter ${l.shelter.ref||''} at ${l.shelter.x},${l.shelter.z}: ${l.edge!==undefined?'edge '+l.edge:'node '+l.node}: ${l.why}`);
 console.log(`${city}: ${r.moved} footways taken round a shelter, ${r.nodes} junctions moved out of one, ${r.left.filter(l=>!l.clear).length} left as they were`);
}else if(import.meta.url===`file://${process.argv[1]}`){
 const city=process.argv[2]||'copenhagen',margin=+(process.argv[3]??.3),dir=`public/cities/${city}`;
 const m=expandMobility(JSON.parse(fs.readFileSync(`${dir}/mobility.json`,'utf8'))),shelters=JSON.parse(fs.readFileSync(`${dir}/furniture.json`,'utf8')).items.filter(i=>i.k==='shelter');
 const hits=shelterCrossings(cutWalksAtKerbs(m.walks,m.walkerCut).walks,shelters,margin),by=new Set(hits.map(h=>h.shelter));
 for(const h of hits)console.log(`shelter ${h.shelter.ref||''} at ${h.shelter.x},${h.shelter.z}: edge ${h.edge} segment ${h.segment} ${h.a} -> ${h.b}${h.crossing?' (crossing)':''}`);
 console.log(`${city}: ${hits.length} walker footway segments through ${by.size} of ${shelters.length} shelters (margin ${margin} m)`);
 process.exit(hits.length?1:0);
}
