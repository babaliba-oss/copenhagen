import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {drapeGeometry} from '../terrain-mesh.js';

// Copenhagen's blue cycle crossings: where a cycle track stops at a junction and carries on across the
// road, the crossing is painted blue. Found from the data alone: the short end edge of a cycle-track
// polygon that faces a carriageway, projected along the track across road only, kept when it lands on
// another cycle track within 30 m. Nothing is painted where the far side is not a cycle track.
const isCycle=p=>/pyör|Pyör|cycle/.test(p?.kind||'');

export function createCycleCrossings({pavement=[],world}){
 const quads=[],at=[],done=new Set();
 const axisOf=poly=>{const r=poly.rings[0];let mx=0,mz=0;for(const q of r){mx+=q[0];mz+=q[1];}mx/=r.length;mz/=r.length;let a=0,b=0,c=0;for(const q of r){const x=q[0]-mx,z=q[1]-mz;a+=x*x;b+=x*z;c+=z*z;}const t=.5*Math.atan2(2*b,a-c);return [Math.cos(t),Math.sin(t)];};
 for(const poly of pavement){if(!isCycle(poly))continue;
  const ring=poly.rings?.[0];if(!ring||ring.length<4)continue;
  // track axis by principal component (the polygons are buffered lines with rounded ends)
  let mx=0,mz=0;for(const q of ring){mx+=q[0];mz+=q[1];}mx/=ring.length;mz/=ring.length;
  let sxx=0,sxz=0,szz=0;for(const q of ring){const x=q[0]-mx,z=q[1]-mz;sxx+=x*x;sxz+=x*z;szz+=z*z;}
  const th=.5*Math.atan2(2*sxz,sxx-szz),ax=Math.cos(th),az=Math.sin(th);
  let lo=Infinity,hi=-Infinity,wlo=Infinity,whi=-Infinity;for(const q of ring){const t=(q[0]-mx)*ax+(q[1]-mz)*az,n=-(q[0]-mx)*az+(q[1]-mz)*ax;lo=Math.min(lo,t);hi=Math.max(hi,t);wlo=Math.min(wlo,n);whi=Math.max(whi,n);}
  const width=whi-wlo;if(hi-lo<8||width<1.2||width>4.5||(hi-lo)<width*3)continue; // a straight strip, not a plaza
  for(const [t,sg] of [[lo,-1],[hi,1]]){const ox=ax*sg,oz=az*sg,cn=(wlo+whi)/2,ex=mx+ax*t-az*cn,ez=mz+az*t+ax*cn;
   if(!world.roads.at(ex+ox*1.2,ez+oz*1.2))continue; // the track ends at a carriageway
   let landed=0,far=null;
   for(let s=1;s<=30;s+=.5){const x=ex+ox*s,z=ez+oz*s;if(world.roads.at(x,z))continue;const p=world.pavement.at(x,z);if(isCycle(p)&&p!==poly){landed=s;far=p;}break;}
   if(landed<4)continue;
   // the same track continuing (parallel within 25 degrees), each pair painted once
   const [bx,bz]=axisOf(far);if(Math.abs(bx*ax+bz*az)<Math.cos(25*Math.PI/180))continue;
   const key=[poly.id??poly.bbox?.join(),far.id??far.bbox?.join()].sort().join('|');if(done.has(key))continue;done.add(key);
   {let lo2=landed-.5,hi2=landed;for(let k=0;k<5;k++){const m=(lo2+hi2)/2;world.roads.at(ex+ox*m,ez+oz*m)?lo2=m:hi2=m;}landed=hi2;}
   const w=Math.min(2.4,Math.max(1.6,width)),px=-oz*w/2,pz=ox*w/2,e=landed-.05,s0=-.1;
   const corners=[[ex+px+ox*s0,ez+pz+oz*s0],[ex-px+ox*s0,ez-pz+oz*s0],[ex-px+ox*e,ez-pz+oz*e],[ex+px+ox*e,ez+pz+oz*e]];
   const g=new THREE.BufferGeometry(),y=.118,pos=[],tri=[[0,1,2],[0,2,3]];
   const up=(corners[1][0]-corners[0][0])*(corners[2][1]-corners[0][1])-(corners[1][1]-corners[0][1])*(corners[2][0]-corners[0][0]);
   for(const tr of tri)for(const k of (up>0?[tr[0],tr[2],tr[1]]:tr))pos.push(corners[k][0],y,corners[k][1]);
   g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.computeVertexNormals();quads.push(g);at.push([Math.round(ex+ox*e/2),Math.round(ez+oz*e/2),Math.round(Math.atan2(ox,oz)*100)/100]);}
 }
 const group=new THREE.Group();group.name='Blue cycle crossings';
 if(quads.length){const m=new THREE.Mesh(drapeGeometry(mergeGeometries(quads),{maxEdge:2}),new THREE.MeshStandardMaterial({color:'#2f6db5',roughness:.9,polygonOffset:true,polygonOffsetFactor:-2}));quads.forEach(g=>g.dispose());m.receiveShadow=true;group.add(m);}
 group.userData={crossings:quads.length,at};
 return group;
}
