import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {applyImpactPose} from './impact-pose.js';
import {groundAt} from './terrain.js';

// Shared low-poly person: one rounded torso, head, hair cap, coat/skirt and bag
// batch plus a single "segment" batch (thighs, shins, feet, arms, hands,
// pelvis, neck, long hair, luggage rods). Every limb is placed from solved
// joint positions, so thighs always start at the hip, shins at the knee, arms
// at the shoulder. All crowds share this model and its walk cycle.

const TAU=Math.PI*2;
export const REFERENCE_HEIGHT=1.75;
// Fractions of standing height (head = 1/7.5 of height).
export const PROPORTIONS={thigh:.243,shin:.243,ankle:.045,upperArm:.172,forearm:.148,hand:.085,head:1/7.5,shoulderX:.103,hipX:.05,torso:.345,torsoBase:.505};
const JOINT_NAMES=['pelvis','hipL','hipR','kneeL','kneeR','ankleL','ankleR','heelL','heelR','toeL','toeR','base','neck','head','shoulderL','shoulderR','elbowL','elbowR','wristL','wristR','handL','handR','spineX','spineY','spineZ','headY'];
export const JOINT=Object.fromEntries(JOINT_NAMES.map((n,i)=>[n,i*3]));
export const createJoints=()=>new Float64Array(JOINT_NAMES.length*3);

// Helsinki-ish street palette: mostly muted outerwear, a few brighter jackets.
export const PALETTE={
 tops:['#1f2a3a','#1c1d20','#3a3d42','#6b6e72','#b9a585','#a07a52','#5a5e3e','#2f4a3c','#6a2a32','#26354d','#4b4f55','#8d8a80','#b23a33','#c99a2e','#2f7f86','#6f9cc4','#d9d7d0','#d0652c','#7d4d6b'],
 trousers:['#23262c','#2e3440','#3b4a63','#4a4f57','#6d6455','#1b1c1f','#55606e','#8a7f66'],
 skin:['#f1d0b5','#e8bf9e','#e3b48f','#d9a988','#c48d68','#a26b4a','#7a4c33','#5a3726'],
 hair:['#c8ad7a','#a8875a','#5a4030','#3b2a20','#1d1a18','#9a958e','#8a4a2a','#d8c9a3'],
 shoes:['#1b1b1d','#3a2a20','#e6e4de','#55585c','#2a2d33'],
 hats:['#2a2d33','#7a2e2e','#c7b48b','#3a5a6a','#d9d7d0'],
 bags:['#2b2b2e','#6b4a32','#b7a482','#455452','#8a2f35'],
 greys:['#9a958e','#c9c5bd','#e2dfd8','#8a847b','#b5b0a6'],
 scarves:['#8a2f35','#d9d7d0','#3a5a6a','#c99a2e','#4b4f55','#6a2a32','#2f4a3c','#b23a33'],
 dogs:['#1d1a18','#c8ad7a','#7a4c33','#e8e4dc','#5a4030','#9a958e'],
};
function rng(seed){
 // Hash the seed first so neighbouring ids do not share their first draws.
 seed=Math.imul((seed>>>0)^0x9e3779b9,0x85ebca6b);seed=Math.imul(seed^(seed>>>13),0xc2b2ae35);seed=((seed^(seed>>>16))>>>0)||1;
 return()=>{seed^=seed<<13;seed>>>=0;seed^=seed>>>17;seed^=seed<<5;seed>>>=0;return seed/4294967296;};
}
const pick=(r,list)=>list[Math.floor(r()*list.length)%list.length];

// Deterministic appearance for a person index/seed. Draws after the first
// block are appended, so the colours and build of a given seed stay put.
export const AGES=['adult','teen','senior'];
export function personLook(seed=0,overrides={}){
 const r=rng(seed+97),fem=r()<.5?1:0,child=false;
 const height=fem?1.6+r()*.16:1.71+r()*.2;
 const top=r()<.72?pick(r,PALETTE.tops.slice(0,12)):pick(r,PALETTE.tops.slice(12));
 const skin=r()<.8?pick(r,PALETTE.skin.slice(0,5)):pick(r,PALETTE.skin.slice(5));
 const styles=fem?['long','long','bun','bob','beanie','short']:['short','short','short','beanie','bald','bob'];
 const coatRoll=r(),skirt=fem&&r()<.22;
 const bagRoll=r();
 const look={height,body:.88+r()*.28,figure:fem,child,shirt:top,skin,hair:pick(r,PALETTE.hair),hairStyle:pick(r,styles),hat:pick(r,PALETTE.hats),
  trousers:pick(r,PALETTE.trousers),shoes:pick(r,PALETTE.shoes),coat:skirt?.62+r()*.25:coatRoll<.3?.55+r()*.45:0,skirt,
  bagType:bagRoll<.16?'backpack':bagRoll<.27?'tote':bagRoll<.35?'shoulder':null,bagColor:pick(r,PALETTE.bags),phase:r()*TAU};
 // Age, outerwear, scarf, cap, dog/stroller, phone and stride.
 const ageRoll=r(),outerRoll=r(),scarfRoll=r(),accRoll=r(),capRoll=r(),phoneRoll=r(),tone=r(),extra=r();
 look.age=ageRoll<.1?'senior':ageRoll<.17?'teen':'adult';
 if(look.age==='senior'){look.height-=.05;look.hair=pick(r,PALETTE.greys);if(look.hairStyle==='long')look.hairStyle=fem?'bob':'short';if(!look.coat&&!skirt&&tone<.6)look.coat=.7+tone*.4;look.body+=.06;}
 if(look.age==='teen'){look.height-=.03;look.body=Math.min(look.body,.98);}
 look.outer=look.coat&&!skirt?'coat':outerRoll<(look.age==='teen'?.5:.16)?'hoodie':outerRoll<.42?'puffer':'jacket';
 look.scarf=scarfRoll<.28?pick(r,PALETTE.scarves):null;
 if(capRoll<.1&&(look.hairStyle==='short'||look.hairStyle==='bald'))look.hairStyle='cap';
 else if(fem&&capRoll>.88&&look.hairStyle==='long')look.hairStyle='ponytail';
 look.accessory=look.age!=='teen'&&accRoll<.035?'dog':look.age==='adult'&&accRoll<.06?'stroller':null;
 look.dogColor=pick(r,PALETTE.dogs);look.dogSize=.75+extra*.5;
 look.phoneWalk=look.age!=='senior'&&phoneRoll<.09&&!look.accessory;
 look.stride=look.age==='senior'?.82:look.age==='teen'?1.04:.93+tone*.12;
 look.stoop=look.age==='senior'?.08+tone*.08:0;
 // Keep facial variation after the established appearance draws.
 look.eyeSpacing=.94+r()*.12;look.mouthWidth=.91+r()*.18;look.browTilt=(r()-.5)*.0025;
 if(PERIOD.year===1760)dress1760(look,r);
 return Object.assign(look,overrides);
}
// Copenhagen 1760 (set by main.js for the era city): long coats and breeches for men, long skirts and
// aprons for women, wool and linen colours, no phones, backpacks or strollers.
export const PERIOD={year:null};
const PERIOD_1760={coats:['#1f2c4a','#5a2a22','#3b2f25','#4a3b2a','#2f3a2a','#7a2a20','#2a2a2e','#6b5a3a','#8a6b3a','#3a4a5a'],
 skirts:['#5a2a22','#2f3a52','#6b5a3a','#3b2f25','#7a6a4a','#8a3a2a','#2a3a2a'],linen:['#e9e3d4','#ddd3bd','#cfc4ab'],stockings:['#e6e0d0','#3a3530','#d8d0bf'],hats:['#1d1b19','#2a2622','#3b2f25','#e9e3d4']};
function dress1760(look,r){
 const fem=look.figure>0;
 look.shirt=fem?pick(r,PERIOD_1760.linen):pick(r,PERIOD_1760.coats);
 look.trousers=fem?pick(r,PERIOD_1760.skirts):pick(r,PERIOD_1760.coats);
 look.skirt=fem;look.coat=fem?.95+r()*.05:.75+r()*.2;look.outer='coat';
 look.shoes=r()<.7?'#1b1714':'#3a2a20';look.tights=pick(r,PERIOD_1760.stockings);
 look.hat=pick(r,PERIOD_1760.hats);look.hairStyle=fem?(r()<.6?'bun':'beanie'):(r()<.55?'cap':'short');
 if(!fem&&look.hairStyle==='short'&&r()<.5)look.hair=pick(r,PALETTE.greys); // powdered wigs
 look.scarf=fem&&r()<.4?pick(r,PERIOD_1760.linen):null;look.phoneWalk=false;look.bagType=r()<.12?'shoulder':null;look.bagColor='#6b4a32';
 look.accessory=look.accessory==='dog'?'dog':null;
}
const smooth=(a,b,v)=>{const t=Math.min(1,Math.max(0,(v-a)/(b-a)));return t*t*(3-2*t);};

// smile, brow lift and outer-brow tilt. These stay deliberately small on the
// shared street characters; a conversation should not change their identity.
const EXPRESSIONS={neutral:[0,0,0],friendly:[.65,.12,-.001],concerned:[-.35,.3,-.005],angry:[-.3,-.3,.005],surprised:[0,.9,0]};
// Actor API: expression, speaking, and optional mouthOpen (0..1, for audio sync).
// All facial parts are vertices of the existing head instance. The two vectors
// here animate that instance, so a crowd still costs the same nine draw calls.
export function facePose(actor,look,gait,time=0,out=new Float32Array(8),animated=true){
 const expression=actor.expression||(actor.pose==='chat'?'friendly':actor.pose==='flinch'?'surprised':actor.pose==='wave'?'angry':actor.pose==='cuffed'?'concerned':'neutral');
 const e=Object.hasOwn(EXPRESSIONS,expression)?EXPRESSIONS[expression]:EXPRESSIONS.neutral,clock=Number.isFinite(gait.gaitClock)?gait.gaitClock:time,phase=look.phase||0;
 let mouth=expression==='surprised'?.24:0,blink=0;
 if(animated){
  if(Number.isFinite(actor.mouthOpen))mouth=Math.min(1,Math.max(0,actor.mouthOpen));
  else if(actor.speaking){
   const syllable=.5+.5*Math.sin(clock*TAU*4.1+phase),cadence=.5+.5*Math.sin(clock*TAU*1.7+phase*.7);
   const phrase=((clock+phase*.2)%2.7+2.7)%2.7,pause=smooth(.02,.2,phrase)*(1-smooth(2.5,2.68,phrase));
   mouth=(.06+.74*syllable*(.4+.6*cadence))*pause;
  }
  const period=3.4+phase*.23,t=((clock+phase)%period+period)%period;
  blink=smooth(0,.075,t)*(1-smooth(.085,.19,t));
 }
 out[0]=mouth;out[1]=e[0];out[2]=e[1];out[3]=blink;
 out[4]=look.eyeSpacing||1;out[5]=look.mouthWidth||1;out[6]=(look.browTilt||0)+e[2];out[7]=0;
 return out;
}

// Advance gait state from actual ground speed: stride length grows with speed,
// so cadence and amplitude follow movement rather than a fixed clock.
export function advanceGait(actor,gait,dt,look=actor){
 // A knocked-down person walking back to their path (impacts.js) walks at knockdown.walk.
 const v=actor.knockdown?actor.knockdown.walk||0:Math.max(0,actor.speed||0),k=(look.height||1.72)/REFERENCE_HEIGHT;
 const walk=smooth(.03,.55,v),run=smooth(actor.running?1.8:2,3.6,v),a=1-Math.exp(-Math.max(0,dt)*7);
 gait.gaitWalk=gait.gaitWalk===undefined?walk:gait.gaitWalk+(walk-gait.gaitWalk)*a;
 gait.gaitRun=gait.gaitRun===undefined?run:gait.gaitRun+(run-gait.gaitRun)*a;
 // Use the same eased stride in the clock and the feet. Braking must not
 // shorten a stretched leg in one frame, and steady steps still match travel.
 gait.gaitSpeed=gait.gaitSpeed===undefined?v:gait.gaitSpeed+(v-gait.gaitSpeed)*(1-Math.exp(-Math.max(0,dt)*12));
 const stride=k*(look.stride||1)*(.75+.45*gait.gaitSpeed)*Math.max(.15,gait.gaitWalk),direction=actor.gaitDirection<0?-1:1;
 gait.gaitPhase=((gait.gaitPhase??look.phase??0)+dt*TAU*v/stride*direction)%TAU;
 gait.gaitClock=(gait.gaitClock||0)+dt;
 blendPose(actor,gait,dt);
}
// Rendered heading eases towards the walking direction (about a quarter second
// for a right-angle turn) so corners on the walk graph read as a turn, not a snap.
export function smoothHeading(gait,target,dt,rate=8){
 if(gait.yaw===undefined||!Number.isFinite(gait.yaw))return gait.yaw=target;
 const d=Math.atan2(Math.sin(target-gait.yaw),Math.cos(target-gait.yaw));
 gait.yaw+=d*(1-Math.exp(-Math.max(0,dt)*rate));return gait.yaw;
}
// Pose weights ease between the activity poses (~0.3 s to settle) instead of
// snapping when an actor switches from walking to phone, chat or browsing.
export const POSE_NAMES=['phone','chat','browse'];
export function blendPose(actor,gait,dt){
 const pose=actor.pose;let blend=gait.poseBlend;
 if(!blend){blend=gait.poseBlend={};for(const n of POSE_NAMES)blend[n]=pose===n?1:0;return blend;}
 const b=1-Math.exp(-Math.max(0,dt)*10);
 for(const n of POSE_NAMES)blend[n]+=((pose===n?1:0)-blend[n])*b;
 return blend;
}
const noBlend={phone:0,chat:0,browse:0};
function poseWeights(actor,gait){const b=gait.poseBlend;if(b)return b;noBlend.phone=actor.pose==='phone'?1:0;noBlend.chat=actor.pose==='chat'?1:0;noBlend.browse=actor.pose==='browse'?1:0;return noBlend;}

// Dogs and strollers go with free street walkers only (no pose: not riders, officers, luggage or posed crowds).
export const accessoryOn=(actor,look)=>look.accessory&&!actor.pose&&!actor.suitcase&&(look.height||1.7)>1.45?look.accessory:null;
// Share of the walk cycle each foot spends on the ground (double support either side).
export const STANCE=.6;
// The foot lands a little ahead of the hip and leaves well behind it, heel up (fractions of the step, of height).
export const FRONT=.85,HEEL=.09,HEEL_OFF=.55;
const V=new Float64Array(12);
// Two-bone IK in body space; writes elbow/knee to out[o..o+2] and the reachable end to out[e..e+2].
function ik(out,s,o,e,tx,ty,tz,a,b,hx,hy,hz){
 let dx=tx-out[s],dy=ty-out[s+1],dz=tz-out[s+2],d=Math.hypot(dx,dy,dz)||1e-6;dx/=d;dy/=d;dz/=d;
 d=Math.min(a+b-1e-4,Math.max(Math.abs(a-b)+1e-4,d));
 const ca=(a*a+d*d-b*b)/(2*a*d),sa=Math.sqrt(Math.max(0,1-ca*ca));
 const hd=hx*dx+hy*dy+hz*dz;let px=hx-hd*dx,py=hy-hd*dy,pz=hz-hd*dz;const pl=Math.hypot(px,py,pz)||1;px/=pl;py/=pl;pz/=pl;
 out[o]=out[s]+a*(dx*ca+px*sa);out[o+1]=out[s+1]+a*(dy*ca+py*sa);out[o+2]=out[s+2]+a*(dz*ca+pz*sa);
 out[e]=out[s]+dx*d;out[e+1]=out[s+1]+dy*d;out[e+2]=out[s+2]+dz*d;
}
function set(out,j,x,y,z){out[j]=x;out[j+1]=y;out[j+2]=z;}

// Solve a pose in body space (metres; y up from ground, -z forward, +x right).
export function posePerson(actor,look,gait,out,time=0){
 const H=look.height||1.72,k=H/REFERENCE_HEIGHT,P=PROPORTIONS,build=look.body||1,fem=look.figure||0;
 const sw=(1-.07*fem)*(.92+.08*build),hw=(1+.08*fem)*(.94+.06*build);
 const Lt=P.thigh*H,Ls=P.shin*H,Lu=P.upperArm*H,Lf=P.forearm*H,Lh=P.hand*H,ankleH=P.ankle*H;
 const cycle=actor.pose==='cycle'&&actor.bike,scooter=actor.pose==='scooter',scooterFeet=scooter&&actor.scooter;
 const w=cycle||scooter?0:gait.gaitWalk??0,r=cycle||scooter?0:gait.gaitRun??0,phase=gait.gaitPhase??look.phase??0,clock=(gait.gaitClock??time)+(look.phase||0);
 const speed=gait.gaitSpeed??Math.max(0,actor.speed||0),stride=k*(look.stride||1)*(.75+.45*speed);
 // Both gaits use a continuous foot path. Running shortens support, leaving
 // a flight interval between steps, instead of blending two competing strides.
 const stance=STANCE-.25*r,reach=(Lt+Ls)*(1-.0004-.004*w),A=w*Math.min(.42*H,stance*stride/2);
 const lift=w*((.045+.035*Math.min(1,speed/1.4))*(1-r)+.19*r)*H;
 const walkY=[0,0],walkZ=[0,0],walkPitch=[0,0],heel=w*HEEL*H*Math.min(1,speed/1.2)*(1-.3*r);
 const sway=cycle||scooterFeet?0:.012*H*w*(1-.7*r)*Math.sin(phase)+(1-w)*.006*H*Math.sin(clock*.7);
 const hipTurn=cycle||scooterFeet?0:.006*H*w*(1-.3*r)*Math.sin(phase);
 let load=0;
 for(let side=0;side<2;side++){
  const sgn=side?1:-1,ph=phase+(side?Math.PI:0),hj=JOINT.hipL+side*3,aj=JOINT.ankleL+side*3;
  const hx=sgn*P.hipX*H*hw;
  if(cycle||scooterFeet){continue;}
  const u=(((ph-Math.PI/2)/TAU)%1+1)%1,strike=.24*w*(1-.65*r),push=Math.asin(Math.min(.9,heel/(.112*H)));
  let rise=0;
  if(u<stance){const t=u/stance;walkZ[side]=-A*FRONT+2*A*t;
   walkPitch[side]=strike*(1-smooth(0,.16,t))-push*smooth(HEEL_OFF,1,t);load=Math.max(load,Math.sin(Math.PI*t)**2);
  }else{const q=(u-stance)/(1-stance),z0=A*(2-FRONT),c=2*A*(1-stance)/stance,q2=q*q,q3=q2*q;
   // Matching endpoint velocity prevents a hitch at heel strike and toe-off.
   walkZ[side]=(2*q3-3*q2+1)*z0+(q3-2*q2+q)*c+(-2*q3+3*q2)*(-A*FRONT)+(q3-q2)*c;
   walkPitch[side]=-push*(1-smooth(0,.42,q))+strike*smooth(.6,1,q);rise=lift*Math.sin(Math.PI*q)**2;
  }
  // Keep the heel or toe on the floor while the shoe rolls. The same pitch at
  // the end of swing and start of support removes the old heel-strike snap.
  const fp=walkPitch[side],fy=Math.sin(fp);
  walkY[side]=ankleH+(Math.cos(fp)-1)*.028*H+Math.max(fy*.03*H,-fy*.112*H)+rise;
  set(out,hj,hx+sway,0,sgn*hipTurn);set(out,aj,hx*.96,0,0);
 }
 let py;
 if(cycle){
  const b=actor.bike;py=b.hipY;
  for(let side=0;side<2;side++){const sgn=side?1:-1,ang=b.crank+(side?Math.PI:0),hj=JOINT.hipL+side*3;
   set(out,hj,sgn*P.hipX*H*hw,py,b.hipZ);
   // Pedal under the ball of the foot; knee points forward and up.
   const fp=-.25+.2*Math.sin(ang),ball=.06656*H,drop=.028*H;
   const ankleY=b.pedalX?b.crankY+b.crankR*Math.cos(ang)+(b.pedalTop||0)+.036*k-Math.sin(fp)*ball+Math.cos(fp)*drop:b.crankY+b.crankR*Math.cos(ang)+ankleH*.9;
   const ankleZ=b.pedalX?b.crankZ+b.crankR*Math.sin(ang)+Math.cos(fp)*ball+Math.sin(fp)*drop:b.crankZ+b.crankR*Math.sin(ang)+.05;
   ik(out,hj,JOINT.kneeL+side*3,JOINT.ankleL+side*3,sgn*(b.pedalX||P.hipX*H*hw*1.1),ankleY,ankleZ,Lt,Ls,0,.5,-1);
  }
 }else if(scooterFeet){
  py=scooterFeet.hipY;
  for(let side=0;side<2;side++){const sgn=side?1:-1,hj=JOINT.hipL+side*3;
   set(out,hj,sgn*P.hipX*H*hw,py,0);
   ik(out,hj,JOINT.kneeL+side*3,JOINT.ankleL+side*3,sgn*scooterFeet.footX,ankleH,side?scooterFeet.backZ:scooterFeet.frontZ,Lt,Ls,0,0,-1);
  }
 }else{
  py=ankleH+reach+r*.015*H;
  for(let side=0;side<2;side++){const hj=JOINT.hipL+side*3,aj=JOINT.ankleL+side*3,dx=out[aj]-out[hj],dz=walkZ[side]-out[hj+2];
   py=Math.min(py,walkY[side]+Math.sqrt(Math.max(0,reach*reach-dx*dx-dz*dz)));}
  // A soft supporting knee absorbs the step; the pelvis rises during flight.
  py-=w*(.012+.012*r)*H*load;
  for(let side=0;side<2;side++){const hj=JOINT.hipL+side*3,aj=JOINT.ankleL+side*3;
   out[hj+1]=py;ik(out,hj,JOINT.kneeL+side*3,aj,out[aj],walkY[side],walkZ[side],Lt,Ls,0,0,-1);
  }
 }
 set(out,JOINT.pelvis,sway,py,cycle?actor.bike.hipZ:0);
 // Feet: flat during stance, heel strike toe-up, toe-down after push-off.
 for(let side=0;side<2;side++){
  const aj=JOINT.ankleL+side*3;
  const fp=cycle?-.25+.2*Math.sin(actor.bike.crank+(side?Math.PI:0)):walkPitch[side];
  const fy=Math.sin(fp),fz=-Math.cos(fp),dy=-Math.cos(fp),dz=-Math.sin(fp),drop=.028*H;
  set(out,JOINT.heelL+side*3,out[aj],out[aj+1]-fy*.03*H+dy*drop,out[aj+2]-fz*.03*H+dz*drop);
  set(out,JOINT.toeL+side*3,out[aj]*1.04,out[aj+1]+fy*.112*H+dy*drop,out[aj+2]+fz*.112*H+dz*drop);
 }
 // Upper body frame: forward lean with speed, shoulders counter-rotate the hips.
 const weights=poseWeights(actor,gait),phoneLook=Math.max(weights.phone,look.phoneWalk&&!actor.pose?1:0);
 // Browsing only reaches out when (nearly) standing; chat gestures fade in the same way.
 const browseW=weights.browse*(1-smooth(.35,.6,w)),chatW=weights.chat*(1-smooth(.1,.4,w));
 const stoop=cycle?0:(look.stoop||0)+(actor.lean||0),lean=cycle?(actor.bike.lean??.62):scooter?.25:.035*w+.2*r+.03*phoneLook+(1-w)*.01*Math.sin(clock*1.1)+stoop,twist=cycle?0:-.11*w*(1-.4*r)*Math.sin(phase);
 const yy=Math.cos(lean),yz=-Math.sin(lean);let xx=Math.cos(twist),xy=0,xz=Math.sin(twist);
 const d=xy*yy+xz*yz;xy-=d*yy;xz-=d*yz;const xl=Math.hypot(xx,xy,xz);xx/=xl;xy/=xl;xz/=xl;
 const zx=xy*yz-xz*yy,zy=xz*0-xx*yz,zz=xx*yy-xy*0;
 set(out,JOINT.spineX,xx,xy,xz);set(out,JOINT.spineY,0,yy,yz);set(out,JOINT.spineZ,zx,zy,zz);
 const bx=out[JOINT.pelvis],by=py-.026*H,bz=out[JOINT.pelvis+2];set(out,JOINT.base,bx,by,bz);
 const up=(j,ox,oy,oz)=>set(out,j,bx+xx*ox+zx*oz,by+xy*ox+yy*oy+zy*oz,bz+xz*ox+yz*oy+zz*oz);
 up(JOINT.neck,0,P.torso*H*.97,.008*H);
 const hp=lean*.45-stoop*.75-(cycle&&!actor.bike.seated?.13:0)+.33*phoneLook+.03*Math.sin(clock*.9)+(actor.headPitch||0),hy=Math.cos(hp),hz=-Math.sin(hp);
 set(out,JOINT.headY,0,hy,hz);
 set(out,JOINT.head,out[JOINT.neck],out[JOINT.neck+1]+hy*.09*H,out[JOINT.neck+2]+hz*.09*H-.01*H);
 // Arms: swing opposite to the same-side leg; more swing and a bent elbow when running.
 const armAmp=w*((.26+.12*Math.min(1,speed/1.5))*(1-r)+r*.62);
 for(let side=0;side<2;side++){
  const sgn=side?1:-1,sj=JOINT.shoulderL+side*3,ej=JOINT.elbowL+side*3,wj=JOINT.wristL+side*3,hj=JOINT.handL+side*3;
  up(sj,sgn*P.shoulderX*H*sw,P.torso*H*.885,.004*H);
  const ph=phase+(side?Math.PI:0);
  let target=null;
  if(cycle){const b=actor.bike;target=[sgn*b.barX,b.barY,b.barZ];}
  else if(scooter)target=[sgn*(scooterFeet?.barX??.22),scooterFeet?.barY??.95,scooterFeet?.barZ??-.455];
  else if(side===1&&actor.suitcase)target=[.34*H/1.74,.86*H/1.74+.0,.2*H/1.74];
  // Carrying something bought (market-shop.js): right hand forward and out to the side (hold 0), raised to the mouth (hold 1).
  else if(side===1&&actor.hold>=0&&actor.hold!==null){const q=H/1.74,t=actor.hold;target=[(.3-.17*t)*q,(.97+.42*t)*q,(-.2-.02*t)*q,1,-.6,.5];}
  // Angry driver: hand up over the head, shaken side to side (elbow out to the side).
  // ...and the other arm out to the side, palm up: "what are you doing?"
  else if(side===0&&actor.pose==='wave'){const q=H/1.74,beat=Math.max(0,Math.sin(clock*3.1));target=[-.42*q,1.12*q+.1*q*beat,-.26*q,-1,-.4,.3];}
  else if(side===1&&actor.pose==='wave'){const q=H/1.74,shake=Math.sin(clock*11);target=[.32*q+.09*shake,1.96*q+.03*Math.abs(shake),-.08*q,1,0,-.3];}
  // Police: right palm up at the oncoming car ('stop'); both hands out gripping a
  // person at chest or ground height ('grab'/'grabLow'); hands cuffed behind the back ('cuffed').
  else if(side===1&&actor.pose==='stop'){const q=H/1.74;target=[.22*q,1.62*q,-.52*q,1,-.2,.4];}
  else if(actor.pose==='grab'||actor.pose==='grabLow'){const q=H/1.74,low=actor.pose==='grabLow';target=[sgn*.17*q,(low?.62:1.08)*q,(low?-.42:-.46)*q,sgn,-.6,.3];}
  else if(actor.pose==='cuffed'){const q=H/1.74;target=[sgn*.06*q,.9*q,.17*q,sgn,-.3,-.6];}
  // Hit by a vehicle: arms flail while tumbling, spread out while lying, push off the ground to get up.
  else if(actor.knockdown?.body&&actor.knockdown.phase!=='return'&&actor.knockdown.phase!=='stagger'&&actor.knockdown.phase!=='gesture'){const q=H/1.74,ph=actor.knockdown.phase,t=actor.knockdown.elapsed*(side?9:7.3);
   target=ph==='flight'?[sgn*(.45+.15*Math.sin(t))*q,(1.45+.3*Math.sin(t*1.3))*q,(-.15+.3*Math.cos(t))*q,sgn,.2,.3]:ph==='rise'?[sgn*.25*q,.75*q,-.45*q,sgn,-.5,.3]:[sgn*.62*q,1.25*q,(side?.05:-.2)*q,sgn,.3,.2];}
  // Startled by a crash nearby: hands up in front of the face.
  else if(actor.pose==='flinch'){const q=H/1.74;target=[sgn*.12*q,1.5*q,-.26*q,sgn,-.4,.6];}
  // Arrest: palms flat on the car roof, leaning in; an officer's hands at the
  // suspect's wrists ('cuffing'); one hand on the suspect's upper arm while
  // walking them ('escort', escortSide = the suspect's side); thumbs at the vest ('belt').
  else if(actor.pose==='handsOnCar'){const q=H/1.74;target=[sgn*.34*q,1.38*q,-.62*q,sgn,-.3,.6];}
  else if(actor.pose==='cuffing'){const q=H/1.74;target=[sgn*.09*q,1.0*q,-.4*q,sgn,-.7,.2];}
  else if(actor.pose==='escort'&&sgn===(actor.escortSide||1)){const q=H/1.74;target=[sgn*.3*q,1.2*q,-.16*q,sgn,-.5,.4];}
  else if(actor.pose==='belt'){const q=H/1.74;target=[sgn*.13*q,1.0*q,-.13*q,sgn,-.4,.6];}
  // Pushing a stroller: both hands on the handlebar. Dog walkers hold the lead low and forward.
  else if(accessoryOn(actor,look)==='stroller'){const q=H/1.74;target=[sgn*.19*q,.98*q,-.44*q,sgn,-.6,.4];}
  else if(side===0&&accessoryOn(actor,look)==='dog'){const q=H/1.74;target=[-.24*q,.86*q,-.24*q,-1,-.6,.5];}
  if(target){
   ik(out,sj,ej,wj,target[0],target[1],target[2],Lu,Lf,target[3]??sgn*.35,target[4]??-.6,target[5]??.75);
   if(actor.grip&&(cycle||scooter)){
    // Put the palm around the bar. A normal outstretched hand continues well
    // past its wrist target, which made riders look as if they missed the grips.
    const dx=out[ej]-target[0],dy=out[ej+1]-target[1],dz=out[ej+2]-target[2],d=Math.hypot(dx,dy,dz)||1,back=Lh*.40;
    ik(out,sj,ej,wj,target[0]+dx/d*back,target[1]+dy/d*back,target[2]+dz/d*back,Lu,Lf,sgn*.35,-.6,.75);
    set(out,hj,target[0]-dx/d*.028,target[1]-dy/d*.028,target[2]-dz/d*.028);continue;
   }
   const fx=out[wj]-out[ej],fy=out[wj+1]-out[ej+1],fz=out[wj+2]-out[ej+2],fl=Math.hypot(fx,fy,fz)||1;
   set(out,hj,out[wj]+fx/fl*Lh,out[wj+1]+fy/fl*Lh,out[wj+2]+fz/fl*Lh);continue;
  }
  // Right hand held in front of the chest (phone) or reaching to a stall (browse):
  // weight of the hold pose this frame, blended against the natural arm swing below.
  const hold=side===1?Math.min(1,phoneLook+browseW):0;
  const chat=chatW,bag=look.bagType==='tote'&&side===0?.45:1;
  const alpha=-armAmp*bag*Math.sin(ph+r*.35)+.04+(1-w)*.02*Math.sin(clock*.8+side)+chat*(side?.32+.12*Math.sin(clock*2.1+(look.phase||0)):.05);
  const beta=.18+w*(1-r)*(.14+.25*Math.max(0,alpha))+w*r*(1.12+.12*Math.sin(ph+.4))+chat*(side?.95+.25*Math.sin(clock*2.6):.1);
  const abd=.13+.03*(build-1)+r*.04;
  const ua=alpha+lean*.6,fa=ua+beta,sa=Math.sin(abd);
  let ux=sgn*sa,uy=-Math.cos(ua),uz=-Math.sin(ua);const ul=Math.hypot(ux,uy,uz);ux/=ul;uy/=ul;uz/=ul;
  set(out,ej,out[sj]+ux*Lu,out[sj+1]+uy*Lu,out[sj+2]+uz*Lu);
  let fx=sgn*sa*.4,fy=-Math.cos(fa),fz=-Math.sin(fa);const fl=Math.hypot(fx,fy,fz);fx/=fl;fy/=fl;fz/=fl;
  set(out,wj,out[ej]+fx*Lf,out[ej+1]+fy*Lf,out[ej+2]+fz*Lf);
  set(out,hj,out[wj]+fx*Lh,out[wj+1]+fy*Lh,out[wj+2]+fz*Lh);
  if(hold>1e-3){
   // Torso-relative hand target, mixed between phone and stall reach by their weights.
   const pb=phoneLook/(phoneLook+browseW),ox=(.035*pb+.07*(1-pb))*H,oy=(.2*pb+.07*(1-pb))*H,oz=(-.15*pb-.2*(1-pb))*H;
   for(let i=0;i<3;i++){S[i]=out[ej+i];S[3+i]=out[wj+i];S[6+i]=out[hj+i];}
   const tx=bx+xx*ox+zx*oz,ty=by+xy*ox+yy*oy+zy*oz,tz=bz+xz*ox+yz*oy+zz*oz;
   ik(out,sj,ej,wj,tx,ty,tz,Lu,Lf,.45*sgn,-.75,.45);
   set(out,hj,out[wj]-.01*H,out[wj+1]+(.05*pb-.02*(1-pb))*H,out[wj+2]-.04*H);
   if(hold<1){
    // Lerp the chain, then restore bone lengths from the shoulder down.
    for(let i=0;i<3;i++){out[ej+i]=S[i]+(out[ej+i]-S[i])*hold;out[wj+i]=S[3+i]+(out[wj+i]-S[3+i])*hold;out[hj+i]=S[6+i]+(out[hj+i]-S[6+i])*hold;}
    relength(out,sj,ej,Lu);relength(out,ej,wj,Lf);relength(out,wj,hj,Math.min(Lh,Math.hypot(out[hj]-out[wj],out[hj+1]-out[wj+1],out[hj+2]-out[wj+2])));
   }
  }
 }
 return out;
}
const S=new Float64Array(9);
function relength(out,a,b,L){let dx=out[b]-out[a],dy=out[b+1]-out[a+1],dz=out[b+2]-out[a+2];const d=Math.hypot(dx,dy,dz)||1e-6;dx*=L/d;dy*=L/d;dz*=L/d;out[b]=out[a]+dx;out[b+1]=out[a+1]+dy;out[b+2]=out[a+2]+dz;}

// ---------- geometry ----------
function lathe(profile,segments){const g=new THREE.LatheGeometry(profile.map(([r,y])=>new THREE.Vector2(r,y)),segments);g.computeVertexNormals();return g;}
// Rounded, tapering limb from y=0 (radius 1, proximal) to y=1 (radius ~.78, distal).
// Segment counts are the cheapest that no longer read as faceted at arm's length;
// lathes share ring vertices, so normals are smooth around the limb.
export function limbGeometry(){return lathe([[0,0],[.8,.06],[1,.2],[.8,.86],[0,1]],8);}
export function torsoGeometry(){return lathe([[0,0],[.8,.03],[.84,.16],[.78,.38],[.92,.66],[1,.82],[.88,.93],[.45,.99],[0,1]],12);}
function coatGeometry(){return lathe([[0,0],[.84,0],[.92,.35],[1.08,.97],[0,1]],12);}
export function headGeometry(){
 const parts=[],tint=(g,v,feature=0)=>{
  const n=g.attributes.position.count,c=new Float32Array(n*3),f=new Float32Array(n*3),rgb=typeof v==='number'?[v,v,v]:new THREE.Color(v).toArray();
  for(let i=0;i<n;i++){c.set(rgb,i*3);f[i*3]=feature;}
  g.setAttribute('color',new THREE.BufferAttribute(c,3));g.setAttribute('faceFeature',new THREE.BufferAttribute(f,3));return g;
 };
 const skull=new THREE.SphereGeometry(1,14,9),p=skull.attributes.position;
 for(let i=0;i<p.count;i++){let x=p.getX(i),y=p.getY(i),z=p.getZ(i);if(y<0){const t=1-.28*y*y;x*=t;if(z<0)z*=1-.12*y*y;}p.setXYZ(i,x*.077,y*.117,z*.094);}
 skull.computeVertexNormals();parts.push(tint(skull,1));
 const neck=new THREE.CylinderGeometry(.043,.047,.13,6,1,true);neck.translate(0,-.115,.012);parts.push(tint(neck,1));
 const nose=new THREE.SphereGeometry(.02,6,4);nose.scale(.65,1.15,.9);nose.translate(0,-.012,-.09);parts.push(tint(nose,1));
 // Thin, curved facial patches sit just in front of the skin. The old tiny
 // spheres were largely buried in the skull, leaving the face unreadable.
 const front=(x,y)=>-.094*Math.sqrt(Math.max(.08,1-(x/.077)**2-(y/.117)**2))-.0025;
 const patch=(vertices,indices,feature,colour,units)=>{
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices.flat(),3));g.setIndex(indices);g.computeVertexNormals();
  // Keep the attribute set shared with the sphere/neck when merging.
  g.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(vertices.length*2),2));tint(g,colour,feature);
  const f=g.attributes.faceFeature;for(let i=0;i<vertices.length;i++){f.setY(i,units[i][0]);f.setZ(i,units[i][1]);}parts.push(g);
 };
 const disc=(x,y,rx,ry,feature,colour,depth=0,steps=8)=>{
  const vertices=[[x,y,front(x,y)-depth]],units=[[0,0]],indices=[];
  for(let i=0;i<steps;i++){const a=i/steps*TAU,u=Math.cos(a),v=Math.sin(a),px=x+rx*u,py=y+ry*v;vertices.push([px,py,front(px,py)-depth]);units.push([u,v]);indices.push(0,(i+1)%steps+1,i+1);}
  patch(vertices,indices,feature,colour,units);
 };
 for(const s of [-1,1]){
  const ear=new THREE.SphereGeometry(.022,4,3);ear.scale(.45,1,.7);ear.translate(s*.074,.0,.008);parts.push(tint(ear,.92));
  disc(s*.03,.018,.014,.0065,1,'#dad5c8');
  disc(s*.03,.018,.0047,.0052,2,'#332c27',.0007);
  const vertices=[],units=[],indices=[];
  for(let i=0;i<3;i++){const u=i-1,x=s*(.03+u*.016),y=.038+(1-u*u)*.0015;
   for(const edge of [-1,1]){const py=y+edge*.0015;vertices.push([x,py,front(x,py)-.001]);units.push([u,edge]);}
   if(i<2){const a=i*2;indices.push(a,a+1,a+2,a+1,a+3,a+2);}
  }
  // Each eyebrow points outwards in its local coordinate, reversing winding on one side.
  if(s<0)for(let i=0;i<indices.length;i+=3)[indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];
  patch(vertices,indices,3,'#514138',units);
 }
 disc(0,-.047,.022,.0013,4,'#321e20',.0008,12);
 const lip=[],units=[],indices=[];
 for(let i=0;i<12;i++){const a=i/12*TAU,u=Math.cos(a),v=Math.sin(a);
  for(const [rx,ry] of [[.022,.0013],[.024,.0028]]){const x=rx*u,y=-.047+ry*v;lip.push([x,y,front(x,y)-.001]);units.push([u,v]);}
  const a0=i*2,b=(i+1)%12*2;indices.push(a0,b,b+1,a0,b+1,a0+1);
 }
 patch(lip,indices,5,'#97625a',units);
 const flat=parts.map(g=>g.index?g.toNonIndexed():g),merged=mergeGeometries(flat);
 new Set([...parts,...flat]).forEach(g=>g.dispose());return merged;
}
// Far level (beyond PERSON_LOD.detail): four-sided limbs, a six-sided torso and a low sphere head,
// roughly a quarter of the near triangles. Nobody is drawn past PERSON_LOD.hide.
export const PERSON_LOD={face:18,detail:70,hide:220};
export function limbLowGeometry(){return lathe([[0,0],[.9,.1],[.8,.9],[0,1]],4);}
export function torsoLowGeometry(){return lathe([[0,0],[.85,.05],[.95,.6],[.85,.95],[0,1]],6);}
export function headLowGeometry(){
 const g=new THREE.SphereGeometry(1,6,4),p=g.attributes.position;
 for(let i=0;i<p.count;i++)p.setXYZ(i,p.getX(i)*.077,p.getY(i)*.117,p.getZ(i)*.094);
 g.computeVertexNormals();g.setAttribute('color',new THREE.BufferAttribute(new Float32Array(p.count*3).fill(1),3));return g;
}
export function hairGeometry(){
 // Cap: covers the crown and back of head, hairline high at the forehead.
 const g=new THREE.SphereGeometry(1,14,6,0,TAU,0,Math.PI*.72),p=g.attributes.position;
 for(let i=0;i<p.count;i++){let x=p.getX(i),y=p.getY(i),z=p.getZ(i);const front=Math.max(0,-z);y=Math.max(y,-.62+1.16*smooth(.1,.8,front));p.setXYZ(i,x*.083,y*.124+.004,z*.1+.004);}
 g.computeVertexNormals();return g;
}

// Police torsos: the jacket/vest print is mapped around the body (u, back at
// u=.5) and up it (v = height on the torso), so lettering stays square.
export function uniformTorsoGeometry(){
 const g=torsoGeometry().rotateY(Math.PI),p=g.attributes.position,uv=g.attributes.uv;
 for(let i=0;i<p.count;i++)uv.setY(i,p.getY(i));return g;
}
// Finnish police: dark navy patrol jacket with reflective POLIISI across the
// back, or a fluorescent yellow vest with silver bands and POLIISI on a navy panel.
export const POLICE_UNIFORM={navy:'#1b2436',vest:'#d4e03c',reflective:'#c8ccd0',text:'POLIISI'};
function uniformTexture(kind){
 if(typeof document==='undefined')return null;
 const canvas=document.createElement('canvas');canvas.width=512;canvas.height=256;const ctx=canvas.getContext('2d'),U=POLICE_UNIFORM;
 const band=(v0,v1,colour,u0=0,u1=1)=>{ctx.fillStyle=colour;ctx.fillRect(u0*512,(1-v1)*256,(u1-u0)*512,(v1-v0)*256);};
 const text=(t,u,v,h,w,colour)=>{ctx.save();ctx.fillStyle=colour;ctx.font=`900 ${h*256}px Arial, Helvetica, sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';
  const m=ctx.measureText(t).width;ctx.translate(u*512,(1-v)*256);ctx.scale(w*512/m,1);ctx.fillText(t,0,0);ctx.restore();};
 if(kind==='vest'){
  band(0,1,U.vest);band(.2,.27,U.reflective);band(.36,.43,U.reflective);
  band(.55,.8,U.navy,.36,.64);text(U.text,.5,.675,.2,.25,U.reflective);
  band(.62,.7,U.navy,.84,.96);text(U.text,.9,.66,.07,.1,U.vest);
 }else{
  band(0,1,U.navy);band(.06,.1,'#11161f');text(U.text,.5,.66,.17,.24,U.reflective);
  band(.64,.69,U.reflective,.86,.94);band(.6,.7,'#2a3550',.06,.12);
 }
 const t=new THREE.CanvasTexture(canvas);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;
}

// ---------- instanced batch ----------
const color=new THREE.Color(),looks=new WeakMap();
function colors(look){
 let c=looks.get(look);if(c)return c;
 const rgb=v=>{color.set(v);return [color.r,color.g,color.b];};
 c={shirt:rgb(look.shirt||'#4b4f55'),skin:rgb(look.skin||'#e3b48f'),trousers:rgb(look.trousers||'#2e3440'),hair:rgb(look.hairStyle==='beanie'?look.hat||'#2a2d33':look.hair||'#3b2a20'),
  shoes:rgb(look.shoes||'#1b1b1d'),bag:rgb(look.bagColor||'#2b2b2e'),legs:rgb(look.skirt?(look.tights||'#2a2a2e'):look.trousers||'#2e3440'),coat:rgb(look.skirt?look.trousers||'#2e3440':look.shirt||'#4b4f55'),
  case:rgb(look.caseColor||'#334b60'),metal:rgb('#9da4a6'),dark:rgb('#25282b'),scarf:rgb(look.scarf||'#8a2f35'),dog:rgb(look.dogColor||'#5a4030'),
  black:rgb('#141518'),phone:rgb('#202226'),badge:rgb('#c9ccd0'),vest:rgb(look.uniform==='vest'?'#d4e03c':look.shirt||'#1e2a44')};
 if(look.hairStyle==='cap'||look.hairStyle==='police')c.hair=rgb(look.hat||'#2a2d33');
 looks.set(look,c);return c;
}

function faceMaterial(){
 const material=new THREE.MeshStandardMaterial({roughness:.75,vertexColors:true});
 material.onBeforeCompile=shader=>{
  shader.vertexShader='attribute vec3 faceFeature;\nattribute vec4 faceState;\nattribute vec4 faceShape;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
   float feature=faceFeature.x;
   if(feature>0.5 && feature<3.5){
    transformed.x*=faceShape.x;
    if(feature<2.5){
     transformed.y=0.018+(position.y-0.018)*(1.0-0.96*faceState.w);
    }else{
     transformed.y+=0.007*faceState.z+faceFeature.y*faceShape.z;
    }
   }else if(feature>3.5){
    transformed.x*=faceShape.y*(1.0+0.1*faceState.y-0.18*faceState.x);
    transformed.y+=faceFeature.z*0.011*faceState.x+(faceFeature.y*faceFeature.y*0.009-0.002)*faceState.y;
    transformed.z+=max(0.0,-faceFeature.z)*0.002*faceState.x;
   }
   if(feature>0.5){
    // Follow the skin surface as the brows rise or the mouth opens.
    vec2 fromFace=position.xy/vec2(0.077,0.117),toFace=transformed.xy/vec2(0.077,0.117);
    float before=sqrt(max(0.08,1.0-dot(fromFace,fromFace)));
    float after=sqrt(max(0.08,1.0-dot(toFace,toFace)));
    transformed.z-=0.094*(after-before);
   }
  `).replace('#include <color_vertex>',`#include <color_vertex>
   #ifdef USE_INSTANCING_COLOR
    if(faceFeature.x>0.5){
     // Whites and dark pupils keep contrast on every skin tone. Lip and brow
     // colour retain some of the person's complexion without disappearing.
     float skinMix=faceFeature.x>4.5?0.6:(faceFeature.x>2.5 && faceFeature.x<3.5?0.3:0.0);
     vColor.rgb=color.rgb*mix(vec3(1.0),instanceColor,skinMix);
    }
   #endif
  `);
 };
 material.customProgramCacheKey=()=>'person-face-v1';return material;
}

export function createPersonBatch(capacity,options={}){
 const group=new THREE.Group();group.name=options.name||'Pedestrians';
 const luggage=!!options.luggage,culled=!!options.frustumCulled,lod={...PERSON_LOD,...(options.lod||{})};
 const cloth=new THREE.MeshStandardMaterial({roughness:.9}),skinMat=new THREE.MeshStandardMaterial({roughness:.7,vertexColors:true});
 const make=(geometry,material,count,name,shadow=options.castShadow!==false)=>{const m=new THREE.InstancedMesh(geometry,material,Math.max(1,count));m.name=name;m.castShadow=shadow;m.receiveShadow=false;m.frustumCulled=culled;
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);m.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1,count)*3),3);m.instanceColor.setUsage(THREE.DynamicDrawUsage);m.count=0;group.add(m);return m;};
 // Per person: 15 body segments, up to 4 for scarf/hood/belt/ponytail, plus a pool
 // for the few dogs and strollers (12 segments each); writes past a pool are dropped.
 const segPer=19+(luggage?5:0)+3;
 const meshes={
  torso:make(torsoGeometry(),cloth,capacity,'Person torsos and jackets'),
  head:make(headGeometry(),faceMaterial(),capacity,'Person heads'),
  hair:make(hairGeometry(),cloth,capacity,'Person hair and hats'),
  seg:make(limbGeometry(),cloth,capacity*segPer,'Person limbs, hips, neck and feet'),
  coat:make(coatGeometry(),cloth,capacity,'Long coats and skirts'),
  bag:make(new RoundedBoxGeometry(1,1,1,1,.12).translate(0,-.5,0),cloth,capacity*(luggage?3:2)+4,'Bags, backpacks, caps, phones and strollers'),
  // Far level: no shadows, no hair, hands, feet or bags; the coat shares the low torso lathe.
  lowTorso:make(torsoLowGeometry(),cloth,capacity*2,'Distant person torsos and coats',false),
  lowHead:make(headLowGeometry(),skinMat,capacity,'Distant person heads',false),
  lowSeg:make(limbLowGeometry(),cloth,capacity*10,'Distant person limbs',false),
 };
 const faceState=new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1,capacity)*4),4).setUsage(THREE.DynamicDrawUsage);
 const faceShape=new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1,capacity)*4),4).setUsage(THREE.DynamicDrawUsage),face=new Float32Array(8);
 meshes.head.geometry.setAttribute('faceState',faceState);meshes.head.geometry.setAttribute('faceShape',faceShape);
 if(options.police){
  // Police uniforms: textured torsos (navy patrol jacket, hi-vis vest), two more draw calls in the officers' batch only.
  for(const kind of ['jacket','vest']){const map=uniformTexture(kind);meshes[kind]=make(uniformTorsoGeometry(),new THREE.MeshStandardMaterial({roughness:.8,map}),capacity,`Police ${kind==='vest'?'hi-vis vests':'patrol jackets'}`);}
 }
 const list=Object.values(meshes),cursor=new Int32Array(list.length),start=new Int32Array(list.length);
 for(const m of list)m.userData.capacity=m.instanceMatrix.count;
 const UNIFORM={jacket:list.indexOf(meshes.jacket),vest:list.indexOf(meshes.vest)},BAG=5,WHITE=[1,1,1];
 const SEG=3,LOW_TORSO=6,LOW_HEAD=7,LOW_SEG=8;
 const J=createJoints();let px=0,pz=0,c=1,s=0,ground=0,minX=0,maxX=0,minZ=0,maxZ=0,minY=0,maxY=0,focus=null,far=false;
 function write(mesh,idx,Xx,Xy,Xz,Yx,Yy,Yz,Zx,Zy,Zz,tx,ty,tz,rgb){
  // Body-space basis/translation to world, column-major.
  if(idx>=mesh.userData.capacity)return;
  const a=mesh.instanceMatrix.array,o=idx*16;
  a[o]=Xx*c+Xz*s;a[o+1]=Xy;a[o+2]=-Xx*s+Xz*c;a[o+3]=0;
  a[o+4]=Yx*c+Yz*s;a[o+5]=Yy;a[o+6]=-Yx*s+Yz*c;a[o+7]=0;
  a[o+8]=Zx*c+Zz*s;a[o+9]=Zy;a[o+10]=-Zx*s+Zz*c;a[o+11]=0;
  a[o+12]=px+tx*c+tz*s;a[o+13]=ground+ty;a[o+14]=pz-tx*s+tz*c;a[o+15]=1;
  const col=mesh.instanceColor.array;col[idx*3]=rgb[0];col[idx*3+1]=rgb[1];col[idx*3+2]=rgb[2];
 }
 // Capsule segment from a to b (body space) with side-axis hint; ends extended to overlap joints.
 function seg(ax,ay,az,bx,by,bz,rx,rz,hx,hy,hz,ea,eb,rgb){
  let yx=bx-ax,yy=by-ay,yz=bz-az;const L=Math.hypot(yx,yy,yz)||1e-6;yx/=L;yy/=L;yz/=L;
  const d=hx*yx+hy*yy+hz*yz;let xx=hx-d*yx,xy=hy-d*yy,xz=hz-d*yz,xl=Math.hypot(xx,xy,xz);
  if(xl<1e-5){xx=0;xy=0;xz=1;const d2=yz;xx-=d2*yx;xy-=d2*yy;xz-=d2*yz;xl=Math.hypot(xx,xy,xz)||1;}
  xx/=xl;xy/=xl;xz/=xl;const zx=xy*yz-xz*yy,zy=xz*yx-xx*yz,zz=xx*yy-xy*yx,len=L+ea+eb;
  if(far)write(meshes.lowSeg,cursor[LOW_SEG]++,xx*rx,xy*rx,xz*rx,yx*len,yy*len,yz*len,zx*rz,zy*rz,zz*rz,ax-yx*ea,ay-yy*ea,az-yz*ea,rgb);
  else write(meshes.seg,cursor[SEG]++,xx*rx,xy*rx,xz*rx,yx*len,yy*len,yz*len,zx*rz,zy*rz,zz*rz,ax-yx*ea,ay-yy*ea,az-yz*ea,rgb);
 }
 const jsegFree=(ax,ay,az,bx,by,bz,rx,rz,rgb)=>seg(ax,ay,az,bx,by,bz,rx,rz,1,0,0,rx*.6,rx*.6,rgb);
 const jseg=(a,b,rx,rz,ea,eb,rgb,hx=1,hy=0,hz=0)=>seg(J[a],J[a+1],J[a+2],J[b],J[b+1],J[b+2],rx,rz,hx,hy,hz,ea,eb,rgb);
 // `viewer` ({x,z}) selects each person's level by distance; without one everybody is drawn in full.
 function begin(viewer=null){cursor.fill(0);minX=minZ=minY=Infinity;maxX=maxZ=maxY=-Infinity;focus=viewer&&Number.isFinite(viewer.x)&&Number.isFinite(viewer.z)?viewer:null;}
 function draw(actor,look=actor,gait=actor,time=0){
  const distance=focus?Math.hypot(actor.x-focus.x,actor.z-focus.z):0;
  if(distance>lod.hide)return false;
  far=distance>lod.detail;
  posePerson(actor,look,gait,J,time);start.set(cursor);
  if(far){drawFar(actor,look,gait);return true;}
  const H=look.height||1.72,k=H/REFERENCE_HEIGHT,build=look.body||1,fem=look.figure||0,col=colors(look),hk=Math.sqrt(k)*(H<1.4?1.08:1);
  const sw=(1-.07*fem)*(.92+.08*build),hw=(1+.08*fem)*(.94+.06*build),limb=k*Math.sqrt(build);
  px=actor.x;pz=actor.z;minX=Math.min(minX,px);maxX=Math.max(maxX,px);minZ=Math.min(minZ,pz);maxZ=Math.max(maxZ,pz);if(actor.knockdown?.body){const b=actor.knockdown.body;minX=Math.min(minX,b.x);maxX=Math.max(maxX,b.x);minZ=Math.min(minZ,b.z);maxZ=Math.max(maxZ,b.z);}c=Math.cos(actor.heading||0);s=Math.sin(actor.heading||0);ground=(actor.groundY??options.ground??.13)+groundAt(px,pz);minY=Math.min(minY,ground);maxY=Math.max(maxY,ground);
  const X=JOINT.spineX,Y=JOINT.spineY,Z=JOINT.spineZ,b=JOINT.base;
  // Torso (jacket), elliptical: wide at the shoulders, shallow front-to-back.
  // Puffer jackets and vests over a jacket read bulkier than a coat or hoodie.
  const bulk=look.outer==='puffer'?1.1:look.uniform==='vest'?1.06:1;
  const tw=.125*H*sw*bulk,td=.07*H*(.9+.1*build)*(1+.04*fem)*bulk,tl=PROPORTIONS.torso*H;
  const tm=look.uniform&&UNIFORM[look.uniform]>=0?UNIFORM[look.uniform]:0;
  write(list[tm],cursor[tm]++,J[X]*tw,J[X+1]*tw,J[X+2]*tw,J[Y]*tl,J[Y+1]*tl,J[Y+2]*tl,J[Z]*td,J[Z+1]*td,J[Z+2]*td,J[b],J[b+1],J[b+2],tm?WHITE:col.shirt);
  // Head and hair share the head frame.
  const hY=JOINT.headY,hx=J[hY],hy=J[hY+1],hz=J[hY+2],zx=J[X+1]*hz-J[X+2]*hy,zy=J[X+2]*hx-J[X]*hz,zz=J[X]*hy-J[X+1]*hx,h=JOINT.head;
  const headIndex=cursor[1];
  if(headIndex<faceState.count){facePose(actor,look,gait,time,face,distance<=lod.face);faceState.setXYZW(headIndex,face[0],face[1],face[2],face[3]);faceShape.setXYZW(headIndex,face[4],face[5],face[6],face[7]);}
  write(meshes.head,cursor[1]++,J[X]*hk,J[X+1]*hk,J[X+2]*hk,hx*hk,hy*hk,hz*hk,zx*hk,zy*hk,zz*hk,J[h],J[h+1],J[h+2],col.skin);
  const style=look.hairStyle||(look.hat?'beanie':'short');
  const capped=style==='cap'||style==='police';
  if(style!=='bald'){const g=style==='beanie'||capped?1.1:style==='short'?1:1.04,lift=style==='beanie'?.012:capped?.016:0;
   write(meshes.hair,cursor[2]++,J[X]*hk*g,J[X+1]*hk*g,J[X+2]*hk*g,hx*hk*g,hy*hk*g,hz*hk*g,zx*hk*g,zy*hk*g,zz*hk*g,J[h]+hx*lift,J[h+1]+hy*lift,J[h+2]+hz*lift,col.hair);}
  // Peak of a cap (police caps get a silver badge above it).
  if(capped){const f=-.098*hk,u=.045*hk;
   write(meshes.bag,cursor[BAG]++,J[X]*.165*hk,J[X+1]*.165*hk,J[X+2]*.165*hk,hx*.012*hk,hy*.012*hk,hz*.012*hk,zx*.085*hk,zy*.085*hk,zz*.085*hk,J[h]+hx*u+zx*f,J[h+1]+hy*u+zy*f,J[h+2]+hz*u+zz*f,style==='police'?col.black:col.hair);
   if(style==='police'){const f2=-.092*hk,u2=.085*hk;write(meshes.bag,cursor[BAG]++,J[X]*.03*hk,J[X+1]*.03*hk,J[X+2]*.03*hk,hx*.03*hk,hy*.03*hk,hz*.03*hk,zx*.01,zy*.01,zz*.01,J[h]+hx*u2+zx*f2,J[h+1]+hy*u2+zy*f2,J[h+2]+hz*u2+zz*f2,col.badge);}}
  // Legs: thigh from hip joint, shin from knee, foot from heel to toe. Pelvis joins both hips.
  const legC=col.legs;
  for(let side=0;side<2;side++){const o=side*3;
   jseg(JOINT.hipL+o,JOINT.kneeL+o,.07*limb*hw,.074*limb,.05*k,.03*k,legC);
   jseg(JOINT.kneeL+o,JOINT.ankleL+o,.053*limb,.056*limb,.035*k,.045*k,look.skirt?col.legs:legC);
   jseg(JOINT.heelL+o,JOINT.toeL+o,.046*k,.036*k,.012*k,.008*k,col.shoes);
  }
  const hl=JOINT.hipL,hr=JOINT.hipR,pw=.07*H*hw;
  seg(J[hl]-pw*.5,J[hl+1]+.004*H,J[hl+2],J[hr]+pw*.5,J[hr+1]+.004*H,J[hr+2],.065*H*(.9+.1*build),.06*H*hw,0,1,0,.02*k,.02*k,col.trousers);
  // Arms: upper arm from the shoulder joint inside the rounded shoulder, forearm from the elbow, hand.
  for(let side=0;side<2;side++){const o=side*3;
   jseg(JOINT.shoulderL+o,JOINT.elbowL+o,.047*limb*sw,.05*limb,.04*k,.025*k,col.shirt);
   jseg(JOINT.elbowL+o,JOINT.wristL+o,.04*limb,.041*limb,.025*k,.012*k,col.shirt);
   jseg(JOINT.wristL+o,JOINT.handL+o,.036*k,.02*k,.01*k,0,col.skin,0,0,1);
  }
  // Long hair / bun as a hair-coloured segment behind the head.
  if(style==='ponytail'){const bx0=J[h]+zx*.075*hk+hx*.03*hk,by0=J[h+1]+zy*.075*hk+hy*.03*hk,bz0=J[h+2]+zz*.075*hk+hz*.03*hk,sw2=Math.sin((gait.gaitPhase||0)*2)*.025*(gait.gaitWalk||0);
   seg(bx0,by0,bz0,bx0+zx*.06+J[X]*sw2-hx*.17*hk,by0+zy*.06-hy*.17*hk,bz0+zz*.06+J[X+2]*sw2-hz*.17*hk,.035*hk,.03*hk,J[X],J[X+1],J[X+2],.01,.01,col.hair);}
  if(style==='long'||style==='bun'||style==='bob'){
   const len=style==='long'?.16:style==='bob'?.08:.045,bx0=J[h]+zx*.06*hk,by0=J[h+1]+zy*.06*hk+hy*.035*hk,bz0=J[h+2]+zz*.06*hk;
   if(style==='bun')seg(bx0+zx*.04,by0+hy*.05,bz0+zz*.04,bx0+zx*.08,by0+hy*.07,bz0+zz*.08,.04*hk,.04*hk,J[X],J[X+1],J[X+2],.01,.01,col.hair);
   else seg(bx0,by0,bz0,bx0+zx*.035*hk-hx*len*hk,by0+zy*.035*hk-hy*len*hk,bz0+zz*.035*hk-hz*len*hk,(style==='bob'?.085:.075)*hk,.045*hk,J[X],J[X+1],J[X+2],.02,.02,col.hair);
  }
  // Long coat or skirt: flares from the waist. At full stride the hem lifts
  // and the skirt deepens front-to-back (and shifts forward) so the leading
  // knee and trailing shin stay inside the cloth instead of poking through.
  if(look.coat>0){const w=gait.gaitWalk||0,r=gait.gaitRun||0,stride=w*(1-r)*.75+r;
   const len=(.04+.24*look.coat)*H*(1-.1*w*(1-r)-.24*r),cw=(look.skirt?.098:.108)*H*hw*(1+.05*stride),cd=(look.skirt?.066:.074)*H+(.07*w+.09*r)*H,top=.12*H;
   const ox=J[b]+J[Y]*top,oy=J[b+1]+J[Y+1]*top,oz=J[b+2]+J[Y+2]*top-.035*H*stride,tilt=.12*r,dy=-Math.cos(tilt),dz=Math.sin(tilt);
   write(meshes.coat,cursor[4]++,cw,0,0,0,dy*len,dz*len,0,-dz*cd,dy*cd,ox,oy,oz,col.coat);}
  // Bags.
  const bag=look.bagType||(look.bag?'tote':null);
  if(bag==='backpack'){const d=.072*H*build+.075,o=PROPORTIONS.torso*H*.86;
   write(meshes.bag,cursor[5]++,J[X]*.3*k,J[X+1]*.3*k,J[X+2]*.3*k,J[Y]*.4*k,J[Y+1]*.4*k,J[Y+2]*.4*k,J[Z]*.15*k,J[Z+1]*.15*k,J[Z+2]*.15*k,J[b]+J[Y]*o+J[Z]*d,J[b+1]+J[Y+1]*o+J[Z+1]*d,J[b+2]+J[Y+2]*o+J[Z+2]*d,col.bag);}
  else if(bag==='tote'){const w=JOINT.wristL;write(meshes.bag,cursor[5]++,.1*k,0,0,0,.3*k,0,0,0,.32*k,J[w]-.02*k,J[w+1]+.01,J[w+2],col.bag);}
  else if(bag==='shoulder'){const o=.1*H,x=-.13*H*hw;write(meshes.bag,cursor[5]++,J[X]*.07*k,J[X+1]*.07*k,J[X+2]*.07*k,0,.22*k,0,J[Z]*.26*k,J[Z+1]*.26*k,J[Z+2]*.26*k,J[b]+J[X]*x+J[Y]*o,J[b+1]+J[X+1]*x+J[Y+1]*o,J[b+2]+J[X+2]*x+J[Y+2]*o,col.bag);}
  drawExtras(actor,look,gait,H,k,hk,build,hw,col);
  if(luggage&&actor.suitcase){const h=H/1.74;
   write(meshes.bag,cursor[5]++,.37*h,0,0,0,.54*h,0,0,0,.25*h,.34*h,.63*h,.63*h,col.case);
   for(let side=0;side<2;side++){const x=(.27+side*.14)*h;seg(x,.86*h,.2*h,x,.6*h,.63*h,.012*h,.012*h,1,0,0,0,0,col.metal);
    seg((.19+side*.3)*h,.075*h,.69*h,(.23+side*.3)*h,.075*h,.69*h,.06*h,.06*h,0,1,0,0,0,col.dark);}
   seg(.25*h,.86*h,.2*h,.43*h,.86*h,.2*h,.022*h,.022*h,0,1,0,0,0,col.dark);
  }
  if(actor.knockdown)for(let m=0;m<list.length;m++)for(let i=start[m],e=Math.min(cursor[m],list[m].userData.capacity);i<e;i++)applyImpactPose(list[m],i,actor);
  return true;
 }
 // Scarf, hood, duty belt and radio, phone in hand, dog on a lead, stroller.
 function drawExtras(actor,look,gait,H,k,hk,build,hw,col){
  const X=JOINT.spineX,Y=JOINT.spineY,Z=JOINT.spineZ,n=JOINT.neck,b=JOINT.base;
  const at=(j,ox,oy,oz)=>[J[j]+J[X]*ox+J[Y]*oy+J[Z]*oz,J[j+1]+J[X+1]*ox+J[Y+1]*oy+J[Z+1]*oz,J[j+2]+J[X+2]*ox+J[Y+2]*oy+J[Z+2]*oz];
  if(look.scarf){const a=at(n,0,-.035*H,.0),c=at(n,0,.02*H,0);seg(...a,...c,.058*H,.052*H,J[X],J[X+1],J[X+2],0,0,col.scarf);
   const t0=at(n,.03*H,-.02*H,-.05*H),t1=at(n,.035*H,-.15*H,-.068*H);seg(...t0,...t1,.026*H,.01*H,J[X],J[X+1],J[X+2],0,0,col.scarf);}
  if(look.outer==='hoodie'){const a=at(n,0,-.01*H,.045*H),c=at(n,0,-.075*H,.06*H);seg(...a,...c,.07*H,.035*H,J[X],J[X+1],J[X+2],.01,.01,col.shirt);}
  if(look.uniform){const hl=JOINT.hipL,hr=JOINT.hipR,pw=.08*H*hw,y=.045*H;
   seg(J[hl]-pw*.5,J[hl+1]+y,J[hl+2],J[hr]+pw*.5,J[hr+1]+y,J[hr+2],.072*H*(.9+.1*build),.066*H*hw,0,1,0,.02*k,.02*k,col.black);
   const r=at(b,-.06*H,PROPORTIONS.torso*H*.78,-.075*H);write(meshes.bag,cursor[BAG]++,J[X]*.05*k,J[X+1]*.05*k,J[X+2]*.05*k,J[Y]*.075*k,J[Y+1]*.075*k,J[Y+2]*.075*k,J[Z]*.025*k,J[Z+1]*.025*k,J[Z+2]*.025*k,...r,col.black);}
  const phone=Math.max(gait.poseBlend?.phone||0,actor.pose==='phone'?1:0,look.phoneWalk&&!actor.pose?1:0);
  if(phone>.5){const w=JOINT.handR;write(meshes.bag,cursor[BAG]++,J[X]*.07*k,J[X+1]*.07*k,J[X+2]*.07*k,J[Y]*.012*k,J[Y+1]*.012*k,J[Y+2]*.012*k,J[Z]*.14*k,J[Z+1]*.14*k,J[Z+2]*.14*k,J[w],J[w+1]+.02*k,J[w+2],col.phone);}
  const acc=accessoryOn(actor,look);
  if(acc==='dog')drawDog(look,gait,H,col);
  else if(acc==='stroller'){const q=H/1.74,y=.98*q,z=-.44*q;
   seg(-.21*q,y,z,.21*q,y,z,.016,.016,0,1,0,0,0,col.black);
   for(const sx of [-1,1]){seg(sx*.19*q,y,z,sx*.19*q,.32,z-.4,.013,.013,1,0,0,0,0,col.metal);seg(sx*.19*q,.32,z-.4,sx*.19*q,.12,z-.7,.012,.012,1,0,0,0,0,col.metal);
    for(const wz of [z-.25,z-.75])seg(sx*.22*q-.025,.1,wz,sx*.22*q+.025,.1,wz,.1,.1,0,1,0,0,0,col.black);}
   write(meshes.bag,cursor[BAG]++,.4*q,0,0,0,.3,0,0,0,.6*q,0,.68,z-.62,col.bag);
   seg(0,.62,z-.78,0,.86,z-.98,.21*q,.16,1,0,0,0,0,col.bag);}
 }
 // A dog on a lead at the walker's left, trotting at twice the walker's cadence.
 function drawDog(look,gait,H,col){
  const D=look.dogSize||1,q=H/1.74,x=-.6*q,z=-.62*q,h=.36*D,L=.26*D,w=gait.gaitWalk||0,ph=(gait.gaitPhase||0)*2,c=col.dog;
  const lift=.012*D*Math.abs(Math.sin(ph))*w,y=h+lift,chest=[x,y,z-L],hip=[x,y+.01,z+L],head=[x,y+.17*D,z-L-.12*D];
  seg(...hip,...chest,.1*D,.13*D,1,0,0,.07*D,.09*D,c);
  for(const ex of [-1,1])seg(head[0]+ex*.035*D,head[1]+.03*D,head[2]+.02*D,head[0]+ex*.05*D,head[1]+.08*D,head[2]+.03*D,.018*D,.01*D,0,0,1,0,0,c);
  seg(...chest,...head,.055*D,.06*D,1,0,0,0,.03*D,c);
  seg(head[0],head[1],head[2],x,head[1]-.025*D,head[2]-.12*D,.04*D,.04*D,1,0,0,.02*D,0,c);
  for(const [lx,lz,o] of [[-1,-1,0],[1,1,0],[1,-1,Math.PI],[-1,1,Math.PI]]){const a=.42*w*Math.sin(ph+o),top=[x+lx*.055*D,y-.03*D,lz<0?z-L*.85:z+L*.85];
   seg(...top,top[0],.02+.04*D*w*Math.max(0,Math.sin(ph+o+1.6)),top[2]-Math.sin(a)*h*.8,.04*D,.04*D,1,0,0,.03,0,c);}
  seg(...hip,x,y+.14*D,z+L+.12*D,.02*D,.02*D,1,0,0,0,0,c);
  const hand=JOINT.handL;seg(J[hand],J[hand+1],J[hand+2],x,head[1]-.06*D,head[2]+.07*D,.006,.006,1,0,0,0,0,col.black);
 }
 // Same solved joints, cheaper bodies: torso, head, thighs, shins, upper arms, forearms, pelvis, coat.
 function drawFar(actor,look,gait){
  const H=look.height||1.72,k=H/REFERENCE_HEIGHT,build=look.body||1,fem=look.figure||0,col=colors(look),hk=Math.sqrt(k)*(H<1.4?1.08:1);
  const sw=(1-.07*fem)*(.92+.08*build),hw=(1+.08*fem)*(.94+.06*build),limb=k*Math.sqrt(build);
  px=actor.x;pz=actor.z;minX=Math.min(minX,px);maxX=Math.max(maxX,px);minZ=Math.min(minZ,pz);maxZ=Math.max(maxZ,pz);if(actor.knockdown?.body){const b=actor.knockdown.body;minX=Math.min(minX,b.x);maxX=Math.max(maxX,b.x);minZ=Math.min(minZ,b.z);maxZ=Math.max(maxZ,b.z);}c=Math.cos(actor.heading||0);s=Math.sin(actor.heading||0);ground=(actor.groundY??options.ground??.13)+groundAt(px,pz);minY=Math.min(minY,ground);maxY=Math.max(maxY,ground);
  const X=JOINT.spineX,Y=JOINT.spineY,Z=JOINT.spineZ,b=JOINT.base;
  const tw=.125*H*sw,td=.07*H*(.9+.1*build)*(1+.04*fem),tl=PROPORTIONS.torso*H;
  write(meshes.lowTorso,cursor[LOW_TORSO]++,J[X]*tw,J[X+1]*tw,J[X+2]*tw,J[Y]*tl,J[Y+1]*tl,J[Y+2]*tl,J[Z]*td,J[Z+1]*td,J[Z+2]*td,J[b],J[b+1],J[b+2],look.uniform?col.vest:col.shirt);
  if(accessoryOn(actor,look)==='dog'){const D=look.dogSize||1,q=H/1.74;jsegFree(-.6*q,.36*D,-.62*q-.26*D,-.6*q,.36*D,-.62*q+.26*D,.1*D,.12*D,col.dog);}
  const hY=JOINT.headY,hx=J[hY],hy=J[hY+1],hz=J[hY+2],zx=J[X+1]*hz-J[X+2]*hy,zy=J[X+2]*hx-J[X]*hz,zz=J[X]*hy-J[X+1]*hx,h=JOINT.head;
  const style=look.hairStyle||(look.hat?'beanie':'short'),g=style==='bald'?1:1.04;
  write(meshes.lowHead,cursor[LOW_HEAD]++,J[X]*hk*g,J[X+1]*hk*g,J[X+2]*hk*g,hx*hk*g,hy*hk*g,hz*hk*g,zx*hk*g,zy*hk*g,zz*hk*g,J[h],J[h+1],J[h+2],style==='bald'?col.skin:col.hair);
  for(let side=0;side<2;side++){const o=side*3;
   jseg(JOINT.hipL+o,JOINT.kneeL+o,.07*limb*hw,.074*limb,.05*k,.03*k,col.legs);
   jseg(JOINT.kneeL+o,JOINT.ankleL+o,.053*limb,.056*limb,.035*k,.06*k,col.legs);
   jseg(JOINT.shoulderL+o,JOINT.elbowL+o,.047*limb*sw,.05*limb,.04*k,.025*k,col.shirt);
   jseg(JOINT.elbowL+o,JOINT.wristL+o,.04*limb,.041*limb,.025*k,.03*k,col.shirt);
  }
  const hl=JOINT.hipL,hr=JOINT.hipR,pw=.07*H*hw;
  seg(J[hl]-pw*.5,J[hl+1]+.004*H,J[hl+2],J[hr]+pw*.5,J[hr+1]+.004*H,J[hr+2],.065*H*(.9+.1*build),.06*H*hw,0,1,0,.02*k,.02*k,col.trousers);
  if(look.coat>0){const w=gait.gaitWalk||0,r=gait.gaitRun||0,stride=w*(1-r)*.75+r;
   const len=(.04+.24*look.coat)*H*(1-.1*w*(1-r)-.24*r),cw=(look.skirt?.098:.108)*H*hw*(1+.05*stride),cd=(look.skirt?.066:.074)*H+(.07*w+.09*r)*H,top=.12*H;
   const ox=J[b]+J[Y]*top,oy=J[b+1]+J[Y+1]*top,oz=J[b+2]+J[Y+2]*top-.035*H*stride,tilt=.12*r,dy=-Math.cos(tilt),dz=Math.sin(tilt);
   write(meshes.lowTorso,cursor[LOW_TORSO]++,cw,0,0,0,dy*len,dz*len,0,-dz*cd,dy*cd,ox,oy,oz,col.coat);}
  if(actor.knockdown)for(let m=0;m<list.length;m++)for(let i=start[m],e=Math.min(cursor[m],list[m].userData.capacity);i<e;i++)applyImpactPose(list[m],i,actor);
 }
 function end(){
  for(let m=0;m<list.length;m++){const mesh=list[m];mesh.count=Math.min(cursor[m],mesh.userData.capacity);for(const [at,n] of [[mesh.instanceMatrix,16],[mesh.instanceColor,3]]){at.clearUpdateRanges();if(mesh.count){at.addUpdateRange(0,mesh.count*n);at.needsUpdate=true;}} // upload only the drawn instances
   // Upload only the instances drawn this frame, not the whole pool.
   mesh.instanceMatrix.clearUpdateRanges?.();mesh.instanceColor.clearUpdateRanges?.();
   if(mesh.count){mesh.instanceMatrix.addUpdateRange?.(0,mesh.count*16);mesh.instanceColor.addUpdateRange?.(0,mesh.count*3);}
   // Bounds from body positions (+ reach of a fallen/striding person) instead of per-instance scans.
   if(culled){mesh.boundingSphere??=new THREE.Sphere();if(minX>maxX)mesh.boundingSphere.makeEmpty();else{mesh.boundingSphere.center.set((minX+maxX)/2,(minY+maxY)/2+1,(minZ+maxZ)/2);mesh.boundingSphere.radius=Math.hypot(maxX-minX,maxZ-minZ,maxY-minY)/2+2.5;}}}
  for(const attribute of [faceState,faceShape]){attribute.clearUpdateRanges();if(meshes.head.count)attribute.addUpdateRange(0,meshes.head.count*4);attribute.needsUpdate=true;}
 }
 return {group,meshes,list,begin,draw,end,joints:J,drawCalls:list.length,segmentsPerPerson:segPer,lod};
}
