// mobility.json wire format. public/ keeps the plain graph ({nodes:[[x,z]], edges:[{from,to,points,length,
// lane,crossing,signal}]}) for scripts and tests; the build (vite.config.js) ships a columnar form: node
// coordinates in centimetres, one array per edge field, crossings as a list of edge indices, and each edge's
// inner points as centimetre deltas, or -1-i when it runs back along edge i. Copenhagen: 20.7 MB of JSON to
// 5.3 MB (3.3 MB to 1.6 MB compressed). expandMobility accepts either form.
import polygonClipping from 'polygon-clipping';
const FIELDS='crossing from lane length points signal to'.split(' ');
const cm=v=>Math.round(v*100);

function compactGraph(G){
 const N=G.nodes,E=G.edges;
 for(const p of N)if(!Array.isArray(p)||p.length!==2)return null;
 for(const e of E){const k=Object.keys(e).sort();if(k.join()!==FIELDS.join())return null;
  const a=e.points[0],b=e.points[e.points.length-1],A=N[e.from],B=N[e.to];
  if(!A||!B||e.points.length<2||a[0]!==A[0]||a[1]!==A[1]||b[0]!==B[0]||b[1]!==B[1])return null;
  if(e.points.some(p=>p.length!==2)||typeof e.crossing!=='boolean')return null;}
 const out={nodes:new Array(N.length*2),from:[],to:[],length:[],lane:[],signal:[],crossing:[],pts:[]};
 N.forEach((p,i)=>{out.nodes[i*2]=cm(p[0]);out.nodes[i*2+1]=cm(p[1]);});
 const seen=new Map(),sig=(f,t,pts)=>f+'>'+t+':'+pts.map(p=>cm(p[0])+','+cm(p[1])).join(';');
 E.forEach((e,i)=>{out.from.push(e.from);out.to.push(e.to);out.length.push(e.length);out.lane.push(e.lane);out.signal.push(e.signal);if(e.crossing)out.crossing.push(i);
  const back=seen.get(sig(e.to,e.from,[...e.points].reverse()));
  if(back!==undefined){out.pts.push(-1-back);return;}
  seen.set(sig(e.from,e.to,e.points),i);
  const a=[];let px=cm(e.points[0][0]),pz=cm(e.points[0][1]);
  for(let j=1;j<e.points.length-1;j++){const x=cm(e.points[j][0]),z=cm(e.points[j][1]);a.push(x-px,z-pz);px=x;pz=z;}
  out.pts.push(a);});
 return out;
}

export function compactMobility(m){
 if(!m||m.packed===2||!m.roads||!m.walks)return m;
 const roads=compactGraph(m.roads),walks=compactGraph(m.walks);
 if(!roads||!walks)return m;
 return {...m,packed:2,roads,walks};
}

function expandGraph(P){
 const n=P.nodes.length/2,nodes=new Array(n);
 for(let i=0;i<n;i++)nodes[i]=[P.nodes[i*2]/100,P.nodes[i*2+1]/100];
 const crossing=new Set(P.crossing),edges=new Array(P.from.length);
 for(let i=0;i<edges.length;i++){const f=P.from[i],t=P.to[i],code=P.pts[i];let points;
  if(typeof code==='number'){points=edges[-1-code].points.map(p=>[p[0],p[1]]).reverse();}
  else{const A=nodes[f];points=[[A[0],A[1]]];let x=Math.round(A[0]*100),z=Math.round(A[1]*100);
   for(let j=0;j<code.length;j+=2){x+=code[j];z+=code[j+1];points.push([x/100,z/100]);}
   const B=nodes[t];points.push([B[0],B[1]]);}
  edges[i]={from:f,to:t,points,length:P.length[i],lane:P.lane[i],crossing:crossing.has(i),signal:P.signal[i]};}
 return {nodes,edges};
}

export function expandMobility(m){
 if(m?.packed!==2)return m;
 m.roads=expandGraph(m.roads);m.walks=expandGraph(m.walks);delete m.packed;return m;
}

// Footway edges that run through a drawn house: a path mapped through a building passage the model draws shut (around
// Christiansborg, the palace's wings and the Thorvaldsen Museum), or hugging a façade the city model draws a metre
// further out than the mapped footprint. Walkers on them walked through the walls, or stuck at them until they were
// recycled. Drops (in place) every non-crossing edge whose line runs at least `run` metres inside one of `houses`
// ({rings}: the drawn footprints) or within `clearance` metres of one (on the `res` raster the footprints are filled
// into), the first and last `ends` metres aside (paths meet at doors and corners). Returns the number dropped.
export function dropWalksThroughBuildings(walks,houses,{clearance=.5,run=1,ends=.75,res=.5}={}){
 const polys=(houses||[]).filter(h=>h?.rings?.[0]?.length>2);if(!walks?.edges?.length||!polys.length)return 0;
 let X0=Infinity,Z0=Infinity,X1=-Infinity,Z1=-Infinity;for(const h of polys)for(const [x,z] of h.rings[0]){if(x<X0)X0=x;if(x>X1)X1=x;if(z<Z0)Z0=z;if(z>Z1)Z1=z;}
 const R=Math.max(0,Math.round(clearance/res));X0-=R*res;Z0-=R*res; // grown by R cells: the footprint spans, then the rows
 const W=Math.ceil((X1-X0)/res)+R+2,H=Math.ceil((Z1-Z0)/res)+R+2,WW=Math.ceil(W/32),bits=new Uint32Array(WW*H);let xs=new Float64Array(64);
 const span=(o,i0,i1)=>{const w0=i0>>5,w1=i1>>5,m0=~0<<(i0&31),m1=(i1&31)===31?~0:(1<<((i1&31)+1))-1;if(w0===w1){bits[o+w0]|=m0&m1;return;}bits[o+w0]|=m0;for(let w=w0+1;w<w1;w++)bits[o+w]=~0;bits[o+w1]|=m1;}; // whole words between the ends
 for(const h of polys){let a=Infinity,b=-Infinity;for(const [,z] of h.rings[0]){if(z<a)a=z;if(z>b)b=z;}
  for(let j=Math.max(0,Math.floor((a-Z0)/res));j<=Math.min(H-1,Math.ceil((b-Z0)/res));j++){const z=Z0+(j+.5)*res,o=j*WW;let n=0; /* scanline through the cell centres, even-odd over every ring (holes stay open) */
   for(const r of h.rings)for(let i=0,k=r.length-1;i<r.length;k=i++){const p=r[i],q=r[k];if((p[1]>z)!==(q[1]>z)){let v=p[0]+(q[0]-p[0])*(z-p[1])/(q[1]-p[1]),m=n++;if(n>xs.length)xs=Float64Array.from({length:xs.length*2},(_,u)=>xs[u]||0);while(m>0&&xs[m-1]>v){xs[m]=xs[m-1];m--;}xs[m]=v;}} /* insertion sort: a row crosses a few edges */
   for(let t=0;t+1<n;t+=2){const i0=Math.max(0,Math.ceil((xs[t]-X0)/res-.5)-R),i1=Math.min(W-1,Math.floor((xs[t+1]-X0)/res-.5)+R);if(i1>=i0)span(o,i0,i1);}}}
 let grid=bits;if(R>0){grid=new Uint32Array(WW*H);for(let j=0;j<H;j++)for(let d=-R;d<=R;d++){const jj=j+d;if(jj<0||jj>=H)continue;const o=j*WW,p=jj*WW;for(let w=0;w<WW;w++)grid[o+w]|=bits[p+w];}}
 const before=walks.edges.length;
 walks.edges=walks.edges.filter(e=>{if(e.crossing||!(e.points?.length>1))return true;const L=e.length??0;let pos=0,len=0;
  for(let i=1;i<e.points.length;i++){const a=e.points[i-1],b=e.points[i],l=Math.hypot(b[0]-a[0],b[1]-a[1]),k=Math.max(1,Math.ceil(l/.5));
   for(let j=i===1?0:1;j<=k;j++){const s=pos+l*j/k;if(s<ends||s>L-ends){len=0;continue;}
    const gi=Math.floor((a[0]+(b[0]-a[0])*j/k-X0)/res),gj=Math.floor((a[1]+(b[1]-a[1])*j/k-Z0)/res);
    if(gi>=0&&gj>=0&&gi<W&&gj<H&&(grid[gj*WW+(gi>>5)]>>>(gi&31)&1)){len+=l/k;if(len>=run)return false;}else len=0;}
   pos+=l;}
  return true;});
 return before-walks.edges.length;
}
// Road dead ends at a house (a driveway mapped up to a door or a courtyard gate the model draws shut): traffic drives to
// the end node and turns there, and its front stood in the wall (1760: 37 of 147 dead ends, the coach 3.3 m ahead of its
// centre). Each dead end is cut back (in place) until a vehicle standing at it, `front` metres ahead and `half` either side,
// is clear of `houses` ({at(x,z)}); one with under `keep` metres left goes, with its way back. Returns {trimmed,dropped}.
export function trimDeadEndsAtHouses(roads,houses,{front=3.3,half=1.1,keep=4,step=.5}={}){
 if(!roads?.edges?.length||!houses)return {trimmed:0,dropped:0};
 let N=roads.nodes?.length||0;for(const e of roads.edges){if(e.from>=N)N=e.from+1;if(e.to>=N)N=e.to+1;}
 const one=new Int32Array(N).fill(-1),many=new Uint8Array(N),see=(a,b)=>{if(one[a]<0)one[a]=b;else if(one[a]!==b)many[a]=1;}; /* a dead end: one neighbour node (typed arrays: a Map of Sets and string-keyed pairs over 44k edges were most of 200 ms on today's map) */
 for(const e of roads.edges){see(e.from,e.to);see(e.to,e.from);}
 const dead=a=>one[a]>=0&&!many[a],pair=new Map();for(const e of roads.edges)if(dead(e.from)){let l=pair.get(e.from);if(!l)pair.set(e.from,l=[]);l.push(e);} /* every edge out of a dead end leads back to its one neighbour */
 const F=[front,2,1,0],Wd=[-half,0,half],clear=(x,z,ux,uz)=>{for(let i=0;i<4;i++){const f=F[i];for(let j=0;j<3;j++){const w=Wd[j];if(houses.at(x+ux*f-uz*w,z+uz*f+ux*w))return false;}}return true;}; /* no arrays per call; the front first (it is the one in the wall) */
 const at=(P,s)=>{for(let i=1;i<P.length;i++){const a=P[i-1],b=P[i],l=Math.hypot(b[0]-a[0],b[1]-a[1]);if(s<=l||i===P.length-1){const t=l?Math.min(1,s/l):0;return {i,x:a[0]+(b[0]-a[0])*t,z:a[1]+(b[1]-a[1])*t,ux:l?(b[0]-a[0])/l:0,uz:l?(b[1]-a[1])/l:0};}s-=l;}return null;};
 const len=P=>{let l=0;for(let i=1;i<P.length;i++)l+=Math.hypot(P[i][0]-P[i-1][0],P[i][1]-P[i-1][1]);return l;};
 const drop=new Set();let trimmed=0;
 for(const e of roads.edges){if(!dead(e.to)||e.crossing)continue;const L=len(e.points),end=at(e.points,L);if(!end||clear(end.x,end.z,end.ux,end.uz))continue;
  let s=L;while(s>0){s-=step;const p=at(e.points,Math.max(0,s));if(clear(p.x,p.z,p.ux,p.uz))break;}
  const back=pair.get(e.to)||[];
  if(s<keep){drop.add(e);for(const r of back)drop.add(r);continue;}
  const p=at(e.points,s),pts=[...e.points.slice(0,p.i).map(q=>[q[0],q[1]]),[+p.x.toFixed(2),+p.z.toFixed(2)]];
  if(roads.nodes?.[e.to])roads.nodes[e.to]=[pts.at(-1)[0],pts.at(-1)[1]];e.points=pts;e.length=len(pts);trimmed++;
  for(const r of back){r.points=pts.map(q=>[q[0],q[1]]).reverse();r.length=e.length;}}
 if(drop.size)roads.edges=roads.edges.filter(e=>!drop.has(e));
 return {trimmed,dropped:drop.size};
}
// Bridges built after the era a city is drawn for (era.json lateBridges: {id: why}, today's footbridges left in 1760):
// their paving goes from the roads and footways (no deck, railings or plate over the water) and the footway edges
// that ran along them go too, so no walker crosses the water where no bridge stands. A carriage bridge (Ajorata: Nyhavnsbroen,
// 1874) takes its lanes from the road graph as well (roads), or the coaches and the GPS line still crossed the water there.
// Returns the polygons dropped.
export function dropLateBridges(city,walks,gone,roads=null){
 const ids=new Set(Object.keys(gone||{}));if(!ids.size||!city)return [];const late=[];
 for(const key of ['roads','pavement']){if(!city[key])continue;city[key]=city[key].filter(p=>{if(!ids.has(p.id))return true;late.push(p);return false;});}
 if(late.length&&walks?.edges){const before=new Set(walks.edges);dropWalksThroughBuildings(walks,late,{clearance:0});const after=new Set(walks.edges);dropStranded(walks,[...before].filter(e=>!after.has(e)));} /* and the footway stubs left on the quay (Bryghusbroen: 9 nodes on Christians Brygge) */
 const carried=late.filter(p=>/Ajorata/.test(p.kind||''));if(carried.length&&roads?.edges){const before=new Set(roads.edges);dropWalksThroughBuildings(roads,carried,{clearance:0});const after=new Set(roads.edges);dropStranded(roads,[...before].filter(e=>!after.has(e)));}
 clipToDryGround(city,walks,roads,late);
 return late;
}
// Whether two polygons ({rings, bbox}) share any area (even-odd over every ring): a vertex of one inside the other, or two
// edges crossing. Cheap next to the clipping it saves.
function overlaps(p,q){
 const inside=(x,z,rings)=>{let c=false;for(const r of rings)for(let i=0,k=r.length-1;i<r.length;k=i++){const a=r[i],b=r[k];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])c=!c;}return c;};
 const [x0,z0,x1,z1]=p.bbox,inBox=([x,z])=>x>=x0&&x<=x1&&z>=z0&&z<=z1;
 for(const r of p.rings)for(const v of r)if(inside(v[0],v[1],q.rings))return true;
 for(const r of q.rings)for(const v of r)if(inBox(v)&&inside(v[0],v[1],p.rings))return true;
 const cross=(a,b,c,d)=>{const o=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);return o(a,b,c)*o(a,b,d)<0&&o(c,d,a)*o(c,d,b)<0;};
 for(const s of q.rings)for(let j=1;j<s.length;j++){const c=s[j-1],d=s[j];if(Math.max(c[0],d[0])<x0||Math.min(c[0],d[0])>x1||Math.max(c[1],d[1])<z0||Math.min(c[1],d[1])>z1)continue;for(const r of p.rings)for(let i=1;i<r.length;i++)if(cross(r[i-1],r[i],c,d))return true;}
 return false;
}
// A closed ring cut to a box [x0,z0,x1,z1] grown by a metre (Sutherland-Hodgman, one side at a time); closed again.
function toBox(ring,[x0,z0,x1,z1]){
 let r=ring.slice(0,-1);x0-=1;z0-=1;x1+=1;z1+=1;
 for(const [k,v,keepAbove] of [[0,x0,true],[0,x1,false],[1,z0,true],[1,z1,false]]){if(!r.length)break;const ins=p=>keepAbove?p[k]>=v:p[k]<=v,out=[];
  for(let i=0;i<r.length;i++){const a=r[i],b=r[(i+1)%r.length],ia=ins(a),ib=ins(b);if(ia)out.push(a);if(ia!==ib){const t=(v-a[k])/(b[k]-a[k]),q=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];q[k]=v;out.push(q);}}r=out;}
 return r.length?[...r,r[0]]:[];
}
// Paving left over the water once the era's bridges are settled, cut back to the dry ground (in place): the short
// ramps mapped under a dropped bridge's name (Nyhavnsbroen's and Børsbroen's, about 15 m² each over the harbour, drew a
// deck plate sticking out from the quay; dropping them whole took Nyhavn's and Børsgade's quay lanes too). A bridge
// tagged as one (Silta) stands as mapped. The lanes and footway edges running over the cut-off parts are cut back to
// the shore, and the stubs they strand go. Returns the number of polygons cut.
function clipToDryGround(city,walks,roads,late){
 const water=city?.water||[];if(!water.length)return 0;const silta=p=>/silta/i.test(p.kind||''),hit=(a,b)=>a[0]<=b[2]&&b[0]<=a[2]&&a[1]<=b[3]&&b[1]<=a[3];
 const names=new Set(late.filter(p=>silta(p)&&p.name).map(p=>p.name)),decks=[...(city.roads||[]),...(city.pavement||[])].filter(silta);
 const area=m=>{let s=0;for(const poly of m)poly.forEach((r,i)=>{let a=0;for(let k=0;k<r.length-1;k++)a+=r[k][0]*r[k+1][1]-r[k+1][0]*r[k][1];s+=(i?-1:1)*Math.abs(a/2);});return s;};
 const round=poly=>poly.map(r=>r.map(([x,z])=>[+x.toFixed(2),+z.toFixed(2)])),box=poly=>poly[0].reduce((b,[x,z])=>[Math.min(b[0],x),Math.min(b[1],z),Math.max(b[2],x),Math.max(b[3],z)],[Infinity,Infinity,-Infinity,-Infinity]);
 const wet=[];let cut=0;
 for(const key of ['roads','pavement']){if(!city[key])continue;const out=[];
  for(const p of city[key]){if(silta(p)||!(p.rings?.[0]?.length>2)||!p.bbox){out.push(p);continue;}
   if(!names.has(p.name)){out.push(p);continue;}
   const ws=water.filter(w=>w.rings?.[0]?.length>2&&hit(w.bbox,p.bbox)).map(w=>({rings:w.rings.map(r=>toBox(r,p.bbox)).filter(r=>r.length>3)})).filter(w=>w.rings.length&&overlaps(p,w));if(!ws.length){out.push(p);continue;} /* the water cut to the polygon's box first: the sea's 1400 vertices around each quay street were most of a second */
   let off,dry;try{off=polygonClipping.intersection(p.rings,polygonClipping.union(...ws.map(w=>w.rings)));if(area(off)<.5){out.push(p);continue;}dry=polygonClipping.difference(p.rings,...ws.map(w=>w.rings));}catch{out.push(p);continue;}
   cut++;for(const poly of dry){if(area([poly])<.5)continue;const rings=round(poly);out.push({...p,rings,bbox:box(rings)});} /* each dry piece keeps the polygon's id and kind */
   const on=decks.filter(d=>hit(d.bbox,p.bbox));if(on.length)try{off=polygonClipping.difference(off,...on.map(d=>d.rings));}catch{} /* not where a standing bridge's deck covers it */
   for(const poly of off)if(area([poly])>=.5)wet.push({rings:poly});}
  city[key]=out;}
 if(wet.length)for(const g of [walks,roads])if(g?.edges)dropStranded(g,trimThrough(g,wet));
 return cut;
}
// Edges running at least `run` metres through `polys` ({rings}) are cut back to their dry ends (in place): the piece
// up to where the line first enters, and the one from where it last leaves, each to a new dead-end node shared by the
// edge and its way back, so the land part of a way crossing the water stays.
// A piece under a metre goes. Returns the edges cut.
function trimThrough(g,polys,{run=1,res=.5}={}){
 const boxes=polys.map(p=>p.rings[0].reduce((b,[x,z])=>[Math.min(b[0],x),Math.min(b[1],z),Math.max(b[2],x),Math.max(b[3],z)],[Infinity,Infinity,-Infinity,-Infinity]));
 const inside=(x,z,rings)=>{let c=false;for(const r of rings)for(let i=0,k=r.length-1;i<r.length;k=i++){const a=r[i],b=r[k];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])c=!c;}return c;};
 const wet=(x,z)=>polys.some((p,i)=>{const b=boxes[i];return x>=b[0]&&x<=b[2]&&z>=b[1]&&z<=b[3]&&inside(x,z,p.rings);});
 const added=[],node=(x,z)=>{for(const [n,ax,az] of added)if(Math.hypot(ax-x,az-z)<.3)return n;const n=g.nodes.length;g.nodes.push([x,z]);added.push([n,x,z]);return n;};
 const len=P=>{let l=0;for(let i=1;i<P.length;i++)l+=Math.hypot(P[i][0]-P[i-1][0],P[i][1]-P[i-1][1]);return l;};
 const cut=[],out=[];
 for(const e of g.edges){const P=e.points;if(e.crossing||!(P?.length>1)||!boxes.some(b=>P.some((p,i)=>i&&Math.max(p[0],P[i-1][0])>=b[0]&&Math.min(p[0],P[i-1][0])<=b[2]&&Math.max(p[1],P[i-1][1])>=b[1]&&Math.min(p[1],P[i-1][1])<=b[3]))){out.push(e);continue;} /* no segment's box meets the water's */
  const S=[];for(let i=1;i<P.length;i++){const a=P[i-1],b=P[i],l=Math.hypot(b[0]-a[0],b[1]-a[1]),k=Math.max(1,Math.ceil(l/res));for(let j=i===1?0:1;j<=k;j++){const x=a[0]+(b[0]-a[0])*j/k,z=a[1]+(b[1]-a[1])*j/k;S.push({i,x,z,w:wet(x,z)});}}
  let longest=0,cur=0;for(let k=1;k<S.length;k++){cur=S[k].w&&S[k-1].w?cur+Math.hypot(S[k].x-S[k-1].x,S[k].z-S[k-1].z):0;longest=Math.max(longest,cur);}if(longest<run){out.push(e);continue;}
  cut.push(e);const first=S.findIndex(s=>s.w),last=S.findLastIndex(s=>s.w);
  const edge=(a,b)=>{const lo=a,hi=b;for(let n=0;n<12;n++){const m={x:(a.x+b.x)/2,z:(a.z+b.z)/2};if(wet(m.x,m.z)===lo.w)a={...m,w:lo.w};else b={...m,w:hi.w};}return [+((a.x+b.x)/2).toFixed(2),+((a.z+b.z)/2).toFixed(2)];}; /* the shore between a dry and a wet sample, to a centimetre */
  if(first>0){const q=edge(S[first-1],S[first]),pts=[...P.slice(0,S[first-1].i),[S[first-1].x,S[first-1].z],q].filter((p,k,A)=>!k||Math.hypot(p[0]-A[k-1][0],p[1]-A[k-1][1])>.01),l=len(pts);if(l>=1)out.push({...e,to:node(q[0],q[1]),points:pts,length:l});}
  if(last<S.length-1){const q=edge(S[last+1],S[last]),pts=[q,[S[last+1].x,S[last+1].z],...P.slice(S[last+1].i)].filter((p,k,A)=>!k||Math.hypot(p[0]-A[k-1][0],p[1]-A[k-1][1])>.01),l=len(pts);if(l>=1)out.push({...e,from:node(q[0],q[1]),points:pts,length:l});}}
 g.edges=out;return cut;
}
// The lanes left cut off by dropped ones (Nyhavnsbroen left a 1 m stub of its ramp, an island of two nodes: the GPS
// line and the Harbour Run took it as Nyhavn's nearest node and found no way from it): a piece of under `max` nodes
// that a dropped lane used to join to the rest goes too (Holmen's 39 nodes of lanes with Værftsbroen, 1860-70: the naval
// yard was reached by ferry, so no coach goes there).
function dropStranded(g,dropped,max=40){
 if(!dropped.length)return;const adj=new Map(),link=(a,b)=>{let l=adj.get(a);if(!l)adj.set(a,l=[]);l.push(b);};for(const e of g.edges){link(e.from,e.to);link(e.to,e.from);}
 const gone=new Set();for(const e of dropped)for(const s of [e.from,e.to]){if(gone.has(s)||!adj.has(s))continue;const seen=new Set([s]),q=[s];while(q.length&&seen.size<max){for(const w of adj.get(q.pop())||[])if(!seen.has(w)){seen.add(w);q.push(w);}}if(seen.size<max)for(const v of seen)gone.add(v);}
 if(gone.size)g.edges=g.edges.filter(e=>!gone.has(e.from)&&!gone.has(e.to));
}
// Footways mapped on the carriageway (today's walks graph carries every street's centreline and the last metres of each
// footway out to it): walkers keep to the pavement, so they walked up to the kerb, were refused and turned back there
// (by 507,-304: a 67 m centreline edge entered from a 5 m doorway spur). The walker simulation gets the graph cut to the
// pavement; the full graph stays for the player's on-foot GPS (which crosses streets anywhere). kerbPieces (build time,
// scripts/kerb-walks.mjs) finds, for each non-crossing edge with its way back, the stretches whose line lies on ground
// walkable(x,z) allows, `margin` short of the kerb, pieces under `min` metres left out: {n: edges, e: [edge index], p:
// [[from, to, ...] metres along it, -1 for its end; [] where nothing is left]} (mobility.json walkerCut). Others stay whole.
const cumLen=P=>{const c=[0];for(let i=1;i<P.length;i++)c.push(c[i-1]+Math.hypot(P[i][0]-P[i-1][0],P[i][1]-P[i-1][1]));return c;};
const pointAlong=(P,c,s)=>{let i=1;while(i<P.length-1&&c[i]<s)i++;const l=c[i]-c[i-1]||1,t=Math.max(0,Math.min(1,(s-c[i-1])/l));return [P[i-1][0]+(P[i][0]-P[i-1][0])*t,P[i-1][1]+(P[i][1]-P[i-1][1])*t,i];};
const ptsKey=P=>P.map(p=>p[0]+','+p[1]).join(';');
function walkTwins(E){const map=new Map();for(const e of E)if(!e.crossing)map.set(e.from+'>'+e.to+':'+ptsKey(e.points),e);
 const done=new Set(),pairs=[];E.forEach((e,i)=>{if(e.crossing||done.has(e))return;done.add(e);const b=map.get(e.to+'>'+e.from+':'+ptsKey([...e.points].reverse()));if(b)done.add(b);pairs.push([i,e,b]);});return pairs;} /* each footway once, with its way back */
export function kerbPieces(walks,walkable,{step=.25,margin=.3,min=1}={}){
 const E=walks?.edges||[],out={n:E.length,e:[],p:[]};
 for(const [i,e] of walkTwins(E)){const P=e.points,c=cumLen(P),L=c.at(-1),n=Math.max(1,Math.ceil(L/step)),ok=[];for(let k=0;k<=n;k++){const q=pointAlong(P,c,L*k/n);ok.push(walkable(q[0],q[1]));}
  if(ok.every(Boolean))continue;const pieces=[];
  for(let k=0;k<=n;){if(!ok[k]){k++;continue;}let j=k;while(j<n&&ok[j+1])j++;const a=k?L*k/n+margin:0,b=j<n?L*j/n-margin:L;if(b-a>=min)pieces.push(+a.toFixed(2),j<n?+b.toFixed(2):-1);k=j+1;}
  out.e.push(i);out.p.push(pieces);}
 return out;
}
// The walker graph from the full one and kerbPieces' cut (the full graph is left as it is). A dead end left at a kerb is
// pruned back to its junction when that spur is under `spur` metres (walkers then keep to the pavement it branched from),
// and a piece cut off on both sides under `island` metres goes. Crossings stay as mapped (they are how walkers get over),
// and so do edges added after the cut was made (extensions). Returns {walks:{nodes,edges},cut,dropped,pruned,km:[before,after]}.
export function cutWalksAtKerbs(walks,cut,{spur=15,island=10}={}){
 const E=walks?.edges||[],N=(walks?.nodes||[]).slice(),fx=v=>+v.toFixed(2),km=l=>+(l.reduce((s,e)=>s+(e.crossing?0:e.length),0)/2000).toFixed(1),before=km(E);
 if(!cut?.e?.length||cut.n>E.length)return {walks:{nodes:N,edges:E.slice()},cut:0,dropped:0,pruned:0,km:[before,before]};
 const slice=(P,c,a,b)=>{const A=pointAlong(P,c,a),B=pointAlong(P,c,b),out=[[fx(A[0]),fx(A[1])]];for(let i=A[2];i<B[2];i++)out.push(P[i]);out.push([fx(B[0]),fx(B[1])]);return out.filter((p,i)=>!i||p[0]!==out[i-1][0]||p[1]!==out[i-1][1]);};
 const pieces=new Map();cut.e.forEach((i,k)=>pieces.set(i,cut.p[k]));
 const cutNodes=new Set(),node=p=>{N.push([p[0],p[1]]);cutNodes.add(N.length-1);return N.length-1;},repl=new Map();let nCut=0,dropped=0;
 for(const [i,e,back] of walkTwins(E.slice(0,cut.n))){const q=pieces.get(i);if(!q)continue;const out=[];repl.set(e,out);if(back)repl.set(back,[]);if(!q.length){dropped++;continue;}nCut++;
  const P=e.points,c=cumLen(P),L=c.at(-1);
  for(let k=0;k<q.length;k+=2){const a=q[k],b=q[k+1]<0?L:Math.min(L,q[k+1]),pts=slice(P,c,a,b),f=a>0?node(pts[0]):e.from,t=q[k+1]>=0?node(pts.at(-1)):e.to;pts[0]=[N[f][0],N[f][1]];pts[pts.length-1]=[N[t][0],N[t][1]]; /* ends exactly on their nodes (compactGraph) */
   const len=fx(cumLen(pts).at(-1));out.push({...e,from:f,to:t,points:pts,length:len});if(back)out.push({...back,from:t,to:f,points:pts.map(p=>[p[0],p[1]]).reverse(),length:len});}}
 const out=E.flatMap(e=>repl.get(e)||[e]); /* in the graph's order, a footway's pieces where it stood */
 /* spurs left at a kerb: from each cut dead end along nodes of two neighbours to a junction */
 const nb=new Map(),add=(a,b,e)=>{let m=nb.get(a);if(!m)nb.set(a,m=new Map());let l=m.get(b);if(!l)m.set(b,l=[]);l.push(e);};
 for(const e of out){add(e.from,e.to,e);add(e.to,e.from,e);}
 const deg=new Map();for(const e of E){deg.set(e.from,(deg.get(e.from)||new Set()).add(e.to));}
 for(const [k,m] of nb)if(m.size===1&&deg.get(k)?.size>1)cutNodes.add(k); /* a node whose way on (on the carriageway) went whole */
 const gone=new Set();let pruned=0;
 for(const s of cutNodes){const m=nb.get(s);if(!m||m.size!==1)continue;let prev=s,cur=[...m.keys()][0],len=0,chain=[],crossing=false;
  for(;;){const l=nb.get(prev).get(cur);chain.push(...l);if(l.some(e=>e.crossing))crossing=true;len+=Math.min(...l.map(e=>e.length));const mm=nb.get(cur);if(mm.size!==2||chain.length>200)break;const nx=[...mm.keys()].find(k=>k!==prev);prev=cur;cur=nx;}
  const end=nb.get(cur).size;if(crossing||chain.some(e=>gone.has(e)))continue;
  if(end>2&&len<spur||end===1&&len<island){for(const e of chain)gone.add(e);pruned++;}}
 const edges=out.filter(e=>!gone.has(e));
 return {walks:{nodes:N,edges},cut:nCut,dropped,pruned,km:[before,km(edges)]};
}
