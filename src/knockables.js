import * as THREE from 'three';
import {groundAt} from './terrain.js';

// Light street furniture (roadworks bollards) that the car knocks over instead of stopping against.
// Each item is a small rigid body: it is kicked by the car, tumbles in the air, bounces, slides and
// comes to rest lying on its side. Rendering uses one InstancedMesh per material.
// The update(focus) call packs the instances in range of the player.
const GRAVITY=9.81,CAR_HALF_WIDTH=.98,CAR_HALF_LENGTH=2.3,RESPAWN_AFTER=60,RESPAWN_CLEAR=70;

function randomFor(seed){let s=seed*9301+49297;return()=>{s=(s*9301+49297)%233280;return s/233280;};}

export function carContact(car,x,z,radius){
  const s=Math.sin(car.heading),c=Math.cos(car.heading),dx=x-car.x,dz=z-car.z;
  const lateral=dx*c-dz*s,longitudinal=dx*s+dz*c;
  return Math.abs(lateral)<CAR_HALF_WIDTH+radius&&Math.abs(longitudinal)<CAR_HALF_LENGTH+radius?{lateral,longitudinal}:null;
}

export function createKnockables(items,parts,{radius=.3,height=1.1,range=Infinity}={}){
  const group=new THREE.Group();group.name='Knockable street furniture';
  const meshes=parts.map(({geometry,material})=>{const m=new THREE.InstancedMesh(geometry,material,items.length);m.castShadow=true;m.receiveShadow=true;m.frustumCulled=false;group.add(m);return m;});
  const bodies=items.map((p,i)=>({id:p.id??i,home:{x:p.x,z:p.z,yaw:p.yaw},x:p.x,y:0,z:p.z,yaw:p.yaw,vx:0,vy:0,vz:0,spin:0,
    tilt:0,tiltRate:0,axis:new THREE.Vector3(1,0,0),knocked:false,resting:true,restTime:0,rand:randomFor(i+1)}));
  const qYaw=new THREE.Quaternion(),qTilt=new THREE.Quaternion(),up=new THREE.Vector3(0,1,0),matrix=new THREE.Matrix4(),pos=new THREE.Vector3(),one=new THREE.Vector3(1,1,1);
  let hits=0;

  function kick(b,car,contact){
    const speed=Math.abs(car.speed),dir=Math.sign(car.speed)||1,fx=-Math.sin(car.heading)*dir,fz=-Math.cos(car.heading)*dir;
    // Glancing blows push sideways, away from the car's centre line.
    const sx=Math.cos(car.heading)*Math.sign(contact.lateral),sz=-Math.sin(car.heading)*Math.sign(contact.lateral);
    const side=.35+Math.min(.5,Math.abs(contact.lateral)/CAR_HALF_WIDTH*.5),boost=1.15+b.rand()*.35;
    b.vx=(fx+sx*side)*speed*boost;b.vz=(fz+sz*side)*speed*boost;
    b.vy=Math.min(9,1.2+speed*.28*(.6+b.rand()*.6));
    // Tip over in the direction of travel: rotate about the horizontal axis perpendicular to the push.
    const h=Math.hypot(b.vx,b.vz)||1;b.axis.set(b.vz/h,0,-b.vx/h);
    b.tiltRate=3+speed*.35+b.rand()*2.5;b.spin=(b.rand()-.5)*speed*.9;
    b.knocked=true;b.resting=false;b.restTime=0;hits++;
  }

  function step(dt,car,world){
    let slowdown=0;
    for(const b of bodies){
      if(b.playerTaken||b.disabled)continue;
      // Upright bollards are only struck when the car is actually moving into them; fallen ones get nudged along.
      if(car&&b.y<.6&&Math.abs(car.speed)>.6){
        const contact=carContact(car,b.x,b.z,radius);
        if(contact&&(b.resting||Math.hypot(b.vx,b.vz)<Math.abs(car.speed)*.8)){if(!b.knocked)slowdown+=.012;kick(b,car,contact);}
      }
      if(b.resting){
        if(b.knocked&&car&&(b.restTime+=dt)>RESPAWN_AFTER&&Math.hypot(car.x-b.home.x,car.z-b.home.z)>RESPAWN_CLEAR)reset(b);
        continue;
      }
      b.vy-=GRAVITY*dt;
      const nx=b.x+b.vx*dt,nz=b.z+b.vz*dt;
      if(world?.buildings?.at(nx,nz)){b.vx*=-.35;b.vz*=-.35;}else{b.x=nx;b.z=nz;}
      b.y+=b.vy*dt;b.yaw+=b.spin*dt;
      const airborne=b.y>0;
      if(!airborne){
        b.y=0;
        if(b.vy<-1.5){b.vy*=-.28;b.tiltRate*=.55;}else b.vy=0;
        const friction=Math.exp(-dt*(b.tilt>1.2?3.2:1.6));b.vx*=friction;b.vz*=friction;b.spin*=friction;
      }
      if(airborne)b.tilt+=b.tiltRate*dt;
      else{
        // On the ground a tumbling bollard settles onto its side (tilt ≡ π/2 mod π).
        const target=Math.round((b.tilt-Math.PI/2)/Math.PI)*Math.PI+Math.PI/2;
        b.tilt+=(target-b.tilt)*(1-Math.exp(-dt*9));b.tiltRate=0;
      }
      if(!airborne&&b.vy===0&&Math.hypot(b.vx,b.vz)<.08&&Math.abs(Math.abs(b.tilt%Math.PI)-Math.PI/2)<.02){b.vx=b.vz=b.spin=0;b.resting=true;}
    }
    if(car&&slowdown)car.speed*=1-Math.min(.06,slowdown);
  }

  function reset(b){Object.assign(b,{x:b.home.x,z:b.home.z,yaw:b.home.yaw,y:0,vx:0,vy:0,vz:0,spin:0,tilt:0,tiltRate:0,knocked:false,resting:true,restTime:0});}

  // Instances are packed: only items within `range` of the focus (the player) are drawn, so a city-wide set
  // (thousands of bins) costs only the nearby few in triangles and shadow passes.
  let lastFocus=null;
  function update(focus=lastFocus){
    if(focus)lastFocus={x:focus.x,z:focus.z};
    let n=0;
    for(const b of bodies){
      if(b.playerTaken||b.disabled){if(range===Infinity){matrix.makeScale(0,0,0);for(const m of meshes)m.setMatrixAt(n,matrix);n++;}continue;} // unpacked sets keep instance i = item i (per-item colours)
      if(focus&&range<Infinity&&Math.abs(b.x-focus.x)+Math.abs(b.z-focus.z)>range*1.3&&Math.hypot(b.x-focus.x,b.z-focus.z)>range)continue;
      qYaw.setFromAxisAngle(up,b.yaw);qTilt.setFromAxisAngle(b.axis,b.tilt).multiply(qYaw);
      // Lying bollards rest on their side, lifted by half the board thickness so they do not sink into the road.
      pos.set(b.x,b.y+Math.abs(Math.sin(b.tilt))*.05+groundAt(b.x,b.z),b.z);matrix.compose(pos,qTilt,one);
      for(const m of meshes)m.setMatrixAt(n,matrix);n++;
    }
    for(const m of meshes){m.count=n;m.instanceMatrix.needsUpdate=true;}
  }

  update();
  return {group,bodies,step,update,resetBody(body){if(!bodies.includes(body))return false;reset(body);update();return true;},resetAll(){for(const b of bodies)if(!b.playerTaken)reset(b);update();},snapshot:()=>({count:bodies.length,knocked:bodies.filter(b=>b.knocked&&!b.playerTaken).length,hits})};
}
