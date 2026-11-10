// Wire forms of furniture.json and bus-corridors.json. public/ keeps the plain files for scripts and tests; the
// build (vite.config.js) ships these, like city.pack and mobility.json (city-pack.js, mobility-pack.js).
//  furniture.json: each item loses mly, seen and ref (Mapillary feature ids, photo dates, the registers' record
//   ids): provenance for the build scripts, never read in the game. Copenhagen 1.44 MB -> 0.82 MB compressed.
//  bus-corridors.json: each path's points as one flat list of centimetre steps ([x0,z0,dx,dz,...]) in pts
//   instead of [[x,z],...] in metres to the millimetre. Copenhagen 0.61 MB -> 0.13 MB compressed.
//   expandBusCorridors accepts either form.
const PROVENANCE=['mly','seen','ref'];
export function slimFurniture(f){
 if(!Array.isArray(f?.items))return f;
 return {...f,items:f.items.map(it=>{if(!PROVENANCE.some(k=>k in it))return it;const o={...it};for(const k of PROVENANCE)delete o[k];return o;})};
}
const cm=v=>Math.round(v*100);
export function compactBusCorridors(d){
 if(!Array.isArray(d?.paths)||d.packed||d.paths.some(p=>!Array.isArray(p.points)||p.points.some(q=>q.length!==2)))return d;
 return {...d,packed:1,paths:d.paths.map(p=>{const {points,...rest}=p,pts=[];let px=0,pz=0;for(const [x,z] of points){const X=cm(x),Z=cm(z);pts.push(X-px,Z-pz);px=X;pz=Z;}return {...rest,pts};})};
}
export function expandBusCorridors(d){
 if(d?.packed!==1)return d;
 const {packed,...out}=d;
 out.paths=d.paths.map(p=>{const {pts,...rest}=p,points=[];let x=0,z=0;for(let i=0;i<pts.length;i+=2){x+=pts[i];z+=pts[i+1];points.push([x/100,z/100]);}return {...rest,points};});
 return out;
}
