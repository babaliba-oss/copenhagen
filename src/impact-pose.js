import * as THREE from 'three';
import {groundAt} from './terrain.js';
// How far a knocked-down actor is from upright: 0 standing, 1 lying flat.
export function fallAmount(actor){
 const k=actor.knockdown;if(!k)return 0;
 if(k.body){const b=k.body;return Math.min(1,Math.max(0,1-Math.abs(Math.cos(b.pitch)*Math.cos(b.roll))));}
 const fall=Math.min(1,k.elapsed/.45),rise=Math.min(1,Math.max(0,(k.duration-k.elapsed)/1.4));
 return Math.min(fall*fall*(3-2*fall),rise*rise*(3-2*rise));
}
// Height of the body pivot (the pelvis) above the feet of a standing person.
export const PIVOT=.95;
const root=new THREE.Matrix4(),part=new THREE.Matrix4(),temp=new THREE.Matrix4();
// Moves an instance drawn standing at (actor.x, actor.z), facing actor.heading,
// to where a knocked actor really is. With a tumbling body (impacts.js) the
// pelvis is at body.x/y/z, facing body.heading, pitched and rolled, possibly
// metres from where the person was drawn. Knockdowns without a body (the
// player falling off a bike) just tip over on the spot.
// A rider knocked down on a raised deck (Cykelslangen) lies on the deck, not on the ground under it.
const levelAt=(actor,x,z)=>actor.deckY??groundAt(x,z);
export function applyImpactPose(mesh,index,actor){
 const k=actor.knockdown;if(!k)return;
 if(k.body){
  const b=k.body,g=levelAt(actor,actor.x,actor.z); // heights above the local ground (src/terrain.js)
  root.makeTranslation(b.x,.13+b.y+levelAt(actor,b.x,b.z),b.z);
  root.multiply(temp.makeRotationY(b.heading));root.multiply(temp.makeRotationX(b.pitch));root.multiply(temp.makeRotationZ(b.roll));
  root.multiply(temp.makeTranslation(0,-PIVOT,0));root.multiply(temp.makeRotationY(-(actor.heading||0)));
  root.multiply(temp.makeTranslation(-actor.x,-.13-g,-actor.z));
  mesh.getMatrixAt(index,part);part.premultiply(root);mesh.setMatrixAt(index,part);return;
 }
 const fall=fallAmount(actor);if(!fall)return;
 const prone=k.prone,g=levelAt(actor,actor.x,actor.z);
 root.makeTranslation(actor.x,.13+g+fall*(prone?.12:.34),actor.z);
 root.multiply(temp.makeRotationY(actor.heading||0));
 // prone: pitched forward onto the face (forward is -z), otherwise onto the side.
 root.multiply(prone?temp.makeRotationX(-fall*Math.PI/2):temp.makeRotationZ((k.side||1)*fall*Math.PI/2));
 root.multiply(temp.makeRotationY(-(actor.heading||0)));
 root.multiply(temp.makeTranslation(-actor.x,-.13-g,-actor.z));
 mesh.getMatrixAt(index,part);part.premultiply(root);mesh.setMatrixAt(index,part);
}
