import * as THREE from 'three';

// Seated and cycling poses for the character models, made from their Idle pose by turning bones in world space, so the
// same code serves both rigs (Quaternius: UpperLeg/LowerLeg under Body, the feet under Root; the R_ costumes: a Mixamo
// chain Hips > LeftUpLeg > LeftLeg > LeftFoot). A pose is described like the procedural rider's (person-model.js):
// hip height and how far it sits back, the crank (centre, radius, angle) or where the feet rest, the bar or the table
// for the hands, a forward lean; in metres for a 1.74 m person, with the model facing +Z and its origin on the ground
// under the bike or chair. Each pose is captured as absolute vertex positions (a morph target) and the hips moved onto
// the saddle or chair (skinned-people.js bakeModel). Checked off-line with scripts/people/pose-preview.mjs.
export const POSE_HEIGHT=1.74;
// On a bike (cyclists.js): hips over the saddle (a little lower than the procedural rider's 1.06: the R_ rig's legs are
// shorter), a forward lean, pedals on the crank, hands on the swept-back grips.
export const RIDE={hipY:1.02,hipZ:-.2,lean:.5,crank:{y:.36,z:-.08,r:.17,x:.13},hands:[[.27,1.15,.32],[.27,1.15,.32]]};
// On a café chair (main.js, the guests; cafes.js: seat .48 m, table top .76 m, both on the ground): hips just above
// the seat, feet under the table, forearms on its top.
export const SIT={hipY:.56,hipZ:-.04,lean:.1,feet:[[.13,.09,.42],[.13,.09,.36]],hands:[[.2,.79,.34],[.2,.79,.34]]};
// The same poses from the procedural rider's anchors (player-ride-models.js: forward is -Z there, +Z here), for the
// player's own bike (a = the crank angle, as the bike's cranks turn) and e-scooter (one foot ahead of the other).
export const rideSpec=(b,a=0)=>({hipY:b.hipY,hipZ:-(b.hipZ||0),lean:.35,crank:{y:b.crankY,z:-(b.crankZ||0),r:b.crankR,x:b.pedalX??.13,a},hands:[[b.barX,b.barY,-b.barZ],[b.barX,b.barY,-b.barZ]]});
export const standSpec=sc=>({hipY:sc.hipY,hipZ:0,lean:.15,feet:[[.07,.08,-sc.frontZ],[.07,.08,-sc.backZ]],hands:[[sc.barX,sc.barY,-sc.barZ],[sc.barX,sc.barY,-sc.barZ]]});
const NAMES={
 thighL:['UpperLeg.L','LeftUpLeg'],shinL:['LowerLeg.L','LeftLeg'],footL:['Foot.L','LeftFoot'],
 thighR:['UpperLeg.R','RightUpLeg'],shinR:['LowerLeg.R','RightLeg'],footR:['Foot.R','RightFoot'],
 armL:['UpperArm.L','LeftArm'],foreL:['LowerArm.L','LeftForeArm'],handL:['Wrist.L','LeftHand'],
 armR:['UpperArm.R','RightArm'],foreR:['LowerArm.R','RightForeArm'],handR:['Wrist.R','RightHand'],
 spine1:['Abdomen','Spine'],spine2:['Torso','Spine1'],spine3:['Chest','Spine2'],neck:['Neck'],head:['Head'],
};
const v1=new THREE.Vector3(),v2=new THREE.Vector3(),q1=new THREE.Quaternion(),q2=new THREE.Quaternion(),q3=new THREE.Quaternion();
export function rigOf(root){
 const by={},key=n=>n.replace(/[.\s]/g,''); // GLTFLoader drops the dots (UpperLeg.L -> UpperLegL)
 root.traverse(o=>{if(o.isBone)by[key(o.name)]=o;});
 const bones={};for(const [k,names] of Object.entries(NAMES)){const n=names.find(n=>by[key(n)]);if(n)bones[k]=by[key(n)];}
 const need=['thighL','shinL','footL','thighR','shinR','footR','armL','foreL','handL','armR','foreR','handR'];
 return need.every(k=>bones[k])?bones:null;
}
const wpos=(b,out)=>b.getWorldPosition(out);
// Turn bone `b` (world space) so that the direction it had towards `from` now points along `to`.
function turn(b,fromDir,toDir){
 q1.setFromUnitVectors(fromDir,toDir);b.getWorldQuaternion(q2);b.parent.getWorldQuaternion(q3);
 b.quaternion.copy(q3.invert().multiply(q1.multiply(q2)));b.updateMatrixWorld(true);
}
function setWorldQuat(b,qw){b.parent.updateMatrixWorld(true);b.parent.getWorldQuaternion(q3);b.quaternion.copy(q3.invert().multiply(q2.copy(qw)));b.updateMatrixWorld(true);}
function setWorldPos(b,p){b.parent.updateMatrixWorld(true);b.position.copy(b.parent.worldToLocal(v1.copy(p)));b.updateMatrixWorld(true);}
// Two-bone IK: the middle joint for a chain from a (length l1) to t (length l2), bending towards `pole`.
function knee(a,t,l1,l2,pole){
 const d=v1.copy(t).sub(a),len=Math.min(Math.max(d.length(),Math.abs(l1-l2)+1e-4),l1+l2-1e-4);d.normalize();
 const x=(l1*l1-l2*l2+len*len)/(2*len),h=Math.sqrt(Math.max(0,l1*l1-x*x));
 const p=v2.copy(pole).addScaledVector(d,-pole.dot(d)).normalize();
 return new THREE.Vector3().copy(a).addScaledVector(d,x).addScaledVector(p,h);
}
export function measure(bones){
 const P=k=>wpos(bones[k],new THREE.Vector3());
 const m={};for(const s of ['L','R']){m['hip'+s]=P('thigh'+s);m['knee'+s]=P('shin'+s);m['ankle'+s]=P('foot'+s);m['shoulder'+s]=P('arm'+s);m['elbow'+s]=P('fore'+s);m['wrist'+s]=P('hand'+s);
  m['thighLen'+s]=m['hip'+s].distanceTo(m['knee'+s]);m['shinLen'+s]=m['knee'+s].distanceTo(m['ankle'+s]);m['upperLen'+s]=m['shoulder'+s].distanceTo(m['elbow'+s]);m['foreLen'+s]=m['elbow'+s].distanceTo(m['wrist'+s]);
  m['footQ'+s]=bones['foot'+s].getWorldQuaternion(new THREE.Quaternion());m['shinQ'+s]=bones['shin'+s].getWorldQuaternion(new THREE.Quaternion());}
 m.hip=m.hipL.clone().add(m.hipR).multiplyScalar(.5);return m;
}
// Pose the rig (already in its Idle pose, measured by `measure`). spec, in the model's frame (+Z forward, y up, origin on the
// ground under the saddle or chair) and a 1.74 m rider's metres (s scales them to the model): {hipY, hipZ, lean (radians),
// feet:[[x,y,z],[x,y,z]] (ankles; x is the distance out to either side) or crank:{y,z,r,a,x} (pedals; a = 0 at the top),
// hands:[[x,y,z],[x,y,z]] (wrists)}. Returns the offset that moves the hips onto spec's hip.
export function pose(root,bones,m,spec,s){
 const hipT=new THREE.Vector3(0,spec.hipY*s,(spec.hipZ||0)*s),off=hipT.clone().sub(m.hip);
 // lean the trunk forward about the model's X, mostly low in the back, and bring the head back up; at least spec.lean,
 // more where the arms would not reach the hands' targets (the characters' torsos and arms differ a lot)
 let lean=spec.lean||0;const X=new THREE.Vector3(1,0,0);
 if(spec.hands&&bones.spine1){
  const base=wpos(bones.spine1,new THREE.Vector3()),sh=[wpos(bones.armL,new THREE.Vector3()),wpos(bones.armR,new THREE.Vector3())];
  const reach=Math.min(m.upperLenL+m.foreLenL,m.upperLenR+m.foreLenR)*.97,R=new THREE.Quaternion();
  const want=spec.hands.map((h,i)=>new THREE.Vector3((i?-1:1)*h[0]*s,h[1]*s,h[2]*s).sub(off));
  for(;lean<1.1;lean+=.05){R.setFromAxisAngle(X,lean);if(sh.every((p,i)=>p.clone().sub(base).applyQuaternion(R).add(base).distanceTo(want[i])<=reach))break;}
 }
 for(const [k,f] of [['spine1',.45],['spine2',.35],['spine3',.2]])if(bones[k]){bones[k].getWorldQuaternion(q2);setWorldQuat(bones[k],q1.setFromAxisAngle(X,lean*f).multiply(q2));}
 if(bones.neck){bones.neck.getWorldQuaternion(q2);setWorldQuat(bones.neck,q1.setFromAxisAngle(X,-lean*.7).multiply(q2));}
 root.updateMatrixWorld(true);
 const c=spec.crank,feet=c?[0,1].map(i=>{const a=c.a+i*Math.PI;return [c.x??.13,c.y+Math.cos(a)*c.r+.08,c.z+Math.sin(a)*c.r-.05];}):spec.feet; // the ankle a little above and behind the pedal
 for(const [i,sd] of [[0,'L'],[1,'R']]){
  const hip=wpos(bones['thigh'+sd],new THREE.Vector3()),side=sd==='L'?1:-1;
  const f=feet[i],ankle=new THREE.Vector3(side*f[0]*s,f[1]*s,f[2]*s).sub(off); // into the rig's frame (hips not yet moved)
  const k=knee(hip,ankle,m['thighLen'+sd],m['shinLen'+sd],new THREE.Vector3(side*.08,0,1));
  const kNow=wpos(bones['shin'+sd],new THREE.Vector3());turn(bones['thigh'+sd],kNow.sub(hip).normalize(),k.clone().sub(hip).normalize());
  const kk=wpos(bones['shin'+sd],new THREE.Vector3()),aNow=wpos(bones['foot'+sd],new THREE.Vector3());
  if(bones['foot'+sd].parent===bones['shin'+sd])turn(bones['shin'+sd],aNow.sub(kk).normalize(),ankle.clone().sub(kk).normalize());
  else{ // Quaternius: the foot hangs from Root, so the shin is aimed by its own length axis (towards where the ankle was)
   const dir=m['ankle'+sd].clone().sub(m['knee'+sd]).normalize();bones['shin'+sd].getWorldQuaternion(q2);
   const cur=dir.clone().applyQuaternion(q3.copy(m['shinQ'+sd]).invert()).applyQuaternion(q2);
   turn(bones['shin'+sd],cur.normalize(),ankle.clone().sub(kk).normalize());setWorldPos(bones['foot'+sd],ankle);}
  setWorldQuat(bones['foot'+sd],m['footQ'+sd]);
 }
 root.updateMatrixWorld(true);
 for(const [i,sd] of [[0,'L'],[1,'R']]){
  const sh=wpos(bones['arm'+sd],new THREE.Vector3()),side=sd==='L'?1:-1,h=spec.hands[i];
  const wrist=new THREE.Vector3(side*h[0]*s,h[1]*s,h[2]*s).sub(off);
  const e=knee(sh,wrist,m['upperLen'+sd],m['foreLen'+sd],new THREE.Vector3(side*.6,-.8,-.2));
  const eNow=wpos(bones['fore'+sd],new THREE.Vector3());turn(bones['arm'+sd],eNow.sub(sh).normalize(),e.clone().sub(sh).normalize());
  const ee=wpos(bones['fore'+sd],new THREE.Vector3()),wNow=wpos(bones['hand'+sd],new THREE.Vector3());turn(bones['fore'+sd],wNow.sub(ee).normalize(),wrist.clone().sub(ee).normalize());
 }
 root.updateMatrixWorld(true);return off;
}
