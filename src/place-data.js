// Pure data rules for photo-matched places (a square with its tram stop, trees and landmarks).
// scripts/place-build.mjs turns official open data plus cities/<id>/<place>-reference.json into
// public/cities/<id>/places/<place>.json with these functions; src/place-scene.js draws the result.
// Positions and shapes come from the data; materials, colours and dimensions from the reference,
// which is written from current photos. No network, no THREE: the tests load this directly.

// Paving looks the renderer knows (src/place-scene.js draws each as a procedural texture).
export const PAVINGS=['fan-setts','setts','cobbles','red-granite','tram-blocks','grey-blocks','grey-pavers','stone-dust'];
export const LANDMARKS=['old-church','bell-tower','city-hall','theatre'];

const centroid=ring=>{let x=0,z=0;const n=ring.length-(ring[0]+''===ring.at(-1)+''?1:0);for(let i=0;i<n;i++){x+=ring[i][0];z+=ring[i][1];}return [x/n,z/n];};
export {centroid};
export function pointInRing([x,z],ring){
 let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [xi,zi]=ring[i],[xj,zj]=ring[j];if((zi>z)!==(zj>z)&&x<(xj-xi)*(z-zi)/(zj-zi)+xi)inside=!inside;}return inside;
}
export const ringArea=r=>{let a=0;for(let i=1;i<r.length;i++)a+=r[i-1][0]*r[i][1]-r[i][0]*r[i-1][1];return Math.abs(a)/2;};

// First rule whose tests all pass gives the paving. A rule: {layer, street, type, material (regexes
// on the register's fields), bbox:[x0,z0,x1,z1] on the polygon centroid, paving}.
export function matchPaving(rules,{layer,street='',type='',material=''},ring){
 const c=centroid(ring),re=(p,v)=>p==null||new RegExp(p,'i').test(v);
 for(const r of rules){
  if(r.layer&&r.layer!==layer)continue;
  if(!re(r.street,street)||!re(r.type,type)||!re(r.material,material))continue;
  if(r.bbox&&!(c[0]>=r.bbox[0]&&c[0]<=r.bbox[2]&&c[1]>=r.bbox[1]&&c[1]<=r.bbox[3]))continue;
  return r.paving||null;
 }
 return null;
}

// Tree register species name → model family (src/tree-species.js). Finnish register names carry
// the scientific genus first, e.g. "TILIA X VULGARIS (PUISTOLEHMUS)".
const FAMILIES=[[/^TILIA/,'lime'],[/^ACER/,'maple'],[/^BETULA/,'birch'],[/^PINUS/,'pine'],[/^PICEA/,'spruce'],[/^ABIES/,'fir'],[/^LARIX/,'larch'],
 [/^QUERCUS/,'oak'],[/^ULMUS/,'elm'],[/^FRAXINUS/,'ash'],[/^SORBUS/,'rowan'],[/^ALNUS/,'alder'],[/^(PRUNUS|MALUS|PYRUS|CRATAEGUS)/,'blossom'],
 [/PYLVÄSHAAPA|FASTIGIATA|ERECTA/,'columnar'],[/^POPULUS/,'poplar'],[/^SALIX/,'willow'],[/^AESCULUS/,'chestnut'],[/^PLATANUS/,'maple'],[/^(ROBINIA|GLEDITSIA|AILANTHUS|SOPHORA|STYPHNOLOBIUM)/,'ash'],[/^(CARPINUS|CORYLUS|ZELKOVA)/,'lime'],[/^(AMELANCHIER|MAGNOLIA|CERCIDIPHYLLUM)/,'blossom'],[/^(METASEQUOIA|TAXODIUM)/,'larch'],[/^GINKGO/,'columnar'],[/^(THUJA|JUNIPERUS|TAXUS)/,'spruce']];
export function speciesFamily(species='',conifer=false){
 const s=String(species).toUpperCase().trim();
 for(const [re,f] of FAMILIES)if(re.test(s)&&!(f==='poplar'&&/PYLVÄS/.test(s)))return f;
 if(/PYLVÄS/.test(s))return 'columnar';
 return conifer||/HAVU/.test(s)?'spruce':'broadleaf';
}

// Register height class ("11 - 15m", "Ei tietoa") and trunk girth (cm) → metres. Unknown classes
// fall back on girth, then on the family's typical mature height in Finnish street use.
export const MATURE={lime:16,maple:15,birch:17,pine:18,spruce:18,fir:14,larch:18,oak:14,elm:17,ash:17,rowan:8,alder:12,blossom:6,columnar:14,poplar:20,willow:12,chestnut:14,broadleaf:12};
export function registerHeight(cls,girth,family){
 const m=/(\d+)\s*-\s*(\d+)/.exec(cls||'');
 if(m){const lo=+m[1],hi=+m[2];return lo<=1?hi:(lo+hi)/2;} // young trees in the 1–5 m class are near its top in the photos
 if(/(\d+)\s*m/.test(cls||''))return +/(\d+)/.exec(cls)[1]+2;
 if(girth>0)return Math.min(MATURE[family]??12,4+girth*.07);
 return MATURE[family]??12;
}

// Tram platforms along each stop's own tram path, on the side away from the opposite track. With
// anchor 'front' the stop point is the front of a stopped tram (OSM stop_position) and the platform
// runs back from it; with 'middle' (registers that map the platform itself) it is centred on it.
// paths: [{points:[[x,z]...]}]; returns [{stop, ring, edge:[[x,z],[x,z]], dir:[dx,dz], side, length, width}]
function nearestOnPath(points,x,z){
 let best=null,run=0;
 for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz);if(!l)continue;
  const t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(l*l))),px=a[0]+dx*t,pz=a[1]+dz*t,d=Math.hypot(x-px,z-pz);
  if(!best||d<best.d)best={d,s:run+t*l,x:px,z:pz,dir:[dx/l,dz/l]};run+=l;}
 return best;
}
export function pointAlong(points,s){
 let run=0;for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],l=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!l)continue;
  if(run+l>=s||i===points.length-1){const t=Math.max(0,Math.min(1.5,(s-run)/l));return {x:a[0]+(b[0]-a[0])*t,z:a[1]+(b[1]-a[1])*t,dir:[(b[0]-a[0])/l,(b[1]-a[1])/l]};}run+=l;}
 return null;
}
export function platformsFor(stops,paths,{length=47,width=3.5,edge=1.5,anchor='front'}={}){
 const out=[];
 for(const st of stops){
  const near=paths.map(p=>({p,n:nearestOnPath(p.points,st.x,st.z)})).filter(o=>o.n&&o.n.d<4).sort((a,b)=>a.n.d-b.n.d);if(!near.length)continue;
  const own=near[0],other=paths.map(p=>nearestOnPath(p.points,st.x,st.z)).filter(n=>n&&n.d>=1.5&&n.d<12).sort((a,b)=>a.d-b.d)[0];
  const [dx,dz]=own.n.dir;let nx=-dz,nz=dx; // left of travel
  if(other){const ox=other.x-own.n.x,oz=other.z-own.n.z;if(ox*nx+oz*nz>0){nx=-nx;nz=-nz;}}
  const s1=anchor==='middle'?own.n.s+length/2:own.n.s,s0=Math.max(0,s1-length),pts=[];
  for(let s=s0;s<=s1+.01;s+=Math.min(6,s1-s0||6)){const q=pointAlong(own.p.points,s);if(q)pts.push(q);}
  const end=pointAlong(own.p.points,s1);if(end&&pts.at(-1)&&Math.hypot(pts.at(-1).x-end.x,pts.at(-1).z-end.z)>.2)pts.push(end);
  if(pts.length<2)continue;
  const inner=pts.map(q=>[+(q.x+nx*edge).toFixed(2),+(q.z+nz*edge).toFixed(2)]),outer=pts.map(q=>[+(q.x+nx*(edge+width)).toFixed(2),+(q.z+nz*(edge+width)).toFixed(2)]);
  out.push({stop:st.name,ring:[...inner,...outer.reverse(),inner[0]],edge:inner,side:[+nx.toFixed(3),+nz.toFixed(3)],length:+(s1-s0).toFixed(1),width});
 }
 return out;
}

// Overhead-line poles at a steady spacing along a tram corridor, one each side where the ground is
// clear pavement. clear(x,z) says whether a pole may stand there.
export function polesAlong(points,clear,{spacing=30,offsets=[6,6.5,7,7.5,8,9,10],from=0,to=Infinity}={}){
 const total=points.reduce((n,p,i)=>i?n+Math.hypot(p[0]-points[i-1][0],p[1]-points[i-1][1]):0,0),out=[];
 for(let s=Math.max(from,spacing/2);s<=Math.min(total,to);s+=spacing){
  const q=pointAlong(points,s);if(!q)continue;const [dx,dz]=q.dir;
  for(const side of [1,-1]){const o=offsets.find(o=>clear(q.x-dz*o*side,q.z+dx*o*side));if(o==null)continue;
   out.push({x:+(q.x-dz*o*side).toFixed(2),z:+(q.z+dx*o*side).toFixed(2),yaw:+Math.atan2(dz*side,-dx*side).toFixed(3)});}
 }
 return out;
}

// A shelter from a small mapped roof: centre, long-side direction, length and depth.
export function shelterFrom(ring){
 let best=null;for(let i=1;i<ring.length;i++){const l=Math.hypot(ring[i][0]-ring[i-1][0],ring[i][1]-ring[i-1][1]);if(!best||l>best.l)best={l,a:ring[i-1],b:ring[i]};}
 const c=centroid(ring),area=ringArea(ring),yaw=Math.atan2(best.b[1]-best.a[1],best.b[0]-best.a[0]);
 return {x:+c[0].toFixed(2),z:+c[1].toFixed(2),yaw:+yaw.toFixed(3),length:+best.l.toFixed(2),depth:+(area/best.l).toFixed(2)};
}

// Problems with a built place file; empty when usable.
export function validatePlace(p){
 const e=[];if(!p||typeof p!=='object')return ['place must be an object'];
 if(p.schemaVersion!==1)e.push('schemaVersion must be 1');
 if(!Array.isArray(p.centre)||p.centre.length!==2)e.push('centre: [x, z]');
 for(const [i,s] of (p.paving||[]).entries()){if(!PAVINGS.includes(s.kind))e.push(`paving[${i}].kind: one of ${PAVINGS.join(', ')}`);if(!Array.isArray(s.rings)||!s.rings[0]?.length)e.push(`paving[${i}].rings`);}
 for(const [i,l] of (p.landmarks||[]).entries())if(!LANDMARKS.includes(l.type))e.push(`landmarks[${i}].type: one of ${LANDMARKS.join(', ')}`);
 for(const [i,t] of (p.trees||[]).entries())if(!Number.isFinite(t.height)||t.height<=0||!Array.isArray(t.p))e.push(`trees[${i}]: needs p and height`);
 for(const k of ['platforms','shelters','poles','lamps'])if(p[k]!=null&&!Array.isArray(p[k]))e.push(`${k} must be a list`);
 return e;
}
