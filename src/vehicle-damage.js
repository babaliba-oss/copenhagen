import * as THREE from 'three';

export function createVehicleDamage(model){
 // Only this car owns these vertices. Never deform the cached civilian mesh.
 const panels=[];
 model.traverse(m=>{if(m.isMesh&&['paint','glass','black','finishes'].includes(m.material.name)){
  m.geometry=m.geometry.clone();panels.push({mesh:m,base:m.geometry.attributes.position.array.slice()});
 }});
 let version=-1,wasDamaged=false;
 return {update(car){
  const next=car.damageVersion||0;if(next===version)return;version=next;
  const zones=car.damageZones||{front:0,rear:0,left:0,right:0};
  for(const {mesh,base}of panels){const p=mesh.geometry.attributes.position;
   for(let i=0;i<p.count;i++){
    let x=base[i*3],y=base[i*3+1],z=base[i*3+2];
    const front=Math.max(0,(-z-1.15)/.94)*zones.front,rear=Math.max(0,(z-1.3)/.8)*zones.rear;
    z+=front*.30-rear*.25;y-=Math.max(front,rear)*.13;
    if(y>.48&&y<1.2){const side=x>0?zones.right:zones.left;const dent=side*Math.max(0,(Math.abs(x)-.5)/.45)*Math.max(0,1-Math.abs(z)/1.6);x-=Math.sign(x)*dent*.16;}
    p.setXYZ(i,x,y,z);
   }
   p.needsUpdate=true;if(car.damage||wasDamaged)mesh.geometry.computeVertexNormals();mesh.geometry.computeBoundingSphere();
  }
  wasDamaged=!!car.damage;
 }};
}
