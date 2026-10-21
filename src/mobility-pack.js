// mobility.json wire format. public/ keeps the plain graph ({nodes:[[x,z]], edges:[{from,to,points,length,
// lane,crossing,signal}]}) for scripts and tests; the build (vite.config.js) ships a columnar form: node
// coordinates in centimetres, one array per edge field, crossings as a list of edge indices, and each edge's
// inner points as centimetre deltas, or -1-i when it runs back along edge i. Copenhagen: 20.7 MB of JSON to
// 5.3 MB (3.3 MB to 1.6 MB compressed). expandMobility accepts either form.
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
// Bridges built after the era a city is drawn for (era.json lateBridges: {id: why}, today's footbridges left in 1760):
// their paving goes from the roads and footways (no deck, railings or plate over the water) and the footway edges
// that ran along them go too, so no walker crosses the water where no bridge stands. Returns the polygons dropped.
export function dropLateBridges(city,walks,gone){
 const ids=new Set(Object.keys(gone||{}));if(!ids.size||!city)return [];const late=[];
 for(const key of ['roads','pavement']){if(!city[key])continue;city[key]=city[key].filter(p=>{if(!ids.has(p.id))return true;late.push(p);return false;});}
 if(late.length&&walks?.edges)dropWalksThroughBuildings(walks,late,{clearance:0});
 return late;
}
