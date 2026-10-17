// city.pack wire format. The source files in public/ keep plain rings ([[x,z],...] in metres)
// for the build scripts and tests; the deployed copies are compacted by the build (vite.config.js): each ring
// becomes one flat list of centimetre deltas (coordinates round to the centimetre) ("r"), bboxes are dropped (derived again on
// load). Copenhagen: 10.2 MB gzip to 3.1 MB. expandCity accepts either form.
const RINGED=['buildings','roads','pavement','parks','water'];

export function compactCity(city){
 if(city.packed===2)return city;
 for(const k of RINGED){const list=city[k];if(!Array.isArray(list))continue;
  for(const f of list){
   if(!Array.isArray(f.rings)||!f.rings.every(r=>Array.isArray(r)&&r.every(p=>p.length===2&&Number.isFinite(p[0])&&Number.isFinite(p[1]))))return city; // anything unusual: ship it as is
  }}
 const out={...city,packed:2};
 for(const k of RINGED){const list=city[k];if(!Array.isArray(list))continue;
  out[k]=list.map(f=>{const g={...f};delete g.rings;delete g.bbox;
   g.r=f.rings.map(r=>{const a=new Array(r.length*2);let px=0,pz=0;r.forEach((p,i)=>{const x=Math.round(p[0]*100),z=Math.round(p[1]*100);a[i*2]=x-px;a[i*2+1]=z-pz;px=x;pz=z;});return a;});
   return g;});}
 return out;
}

export function expandCity(city){
 if(city?.packed!==2)return city;
 for(const k of RINGED){const list=city[k];if(!Array.isArray(list))continue;
  for(const f of list){if(!f.r)continue;let x0=Infinity,z0=Infinity,x1=-Infinity,z1=-Infinity;
   f.rings=f.r.map(a=>{const ring=new Array(a.length/2);let x=0,z=0;for(let i=0;i<a.length;i+=2){x+=a[i];z+=a[i+1];const X=x/100,Z=z/100;ring[i/2]=[X,Z];if(X<x0)x0=X;if(X>x1)x1=X;if(Z<z0)z0=Z;if(Z>z1)z1=Z;}return ring;});
   f.bbox=[x0,z0,x1,z1];delete f.r;}}
 delete city.packed;return city;
}
