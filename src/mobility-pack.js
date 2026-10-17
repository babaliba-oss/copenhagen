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
