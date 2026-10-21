import * as THREE from 'three';
import {groundAt} from '../terrain.js';

// Pant: empty cans left by benches, bins, bus shelters and the hot-dog stands, each worth its deposit (1 kr) to whoever
// picks it up, as plenty of Copenhageners do. Today only (game.js). A share of the street furniture gets a can, picked by
// a hash of its position so the same spots have one on every visit; a can picked up is back after a few minutes. Only
// the cans near the player are drawn: one instanced mesh, refilled a few times a second. Can: Daniel's soda can
// (public/models/props/can.glb, scripts/models/can.py: lemon-lime green with a white wave, no name); a cylinder where it does not load.
const SPOTS={bench:{p:.24,r:[.45,1.1],front:1},bin:{p:.34,r:[.28,.6]},shelter:{p:.45,r:[.4,1.3],front:1},'hotdog-stand':{p:1,r:[1.5,2.6],n:2},hotspot:{p:1,r:[1,14],n:7}}; // hotspot: a quay or a bridge where people sit with a beer (game.js)
const TINTS=['#ffffff','#f4f4f4','#e8e8e8']; // the can is painted (lemon-lime green, white wave): only a little wear between cans
export const PANT_KR=1,PANT_REACH=1.9,PANT_RESPAWN=300; // kr a can (the A deposit), pick-up reach (m), back after (s)
const SCALE=1.5; // a third bigger than a 33 cl can, so they can be spotted from a bike
const hash=(x,z,k)=>{const s=Math.sin(x*12.9898+z*78.233+k*37.719)*43758.5453;return s-Math.floor(s);};

export function createPant({items=[],clear=()=>true,geometry=null,capacity=160,range=90}={}){
 const cans=[];
 for(const it of items){const S=SPOTS[it.k];if(!S||hash(it.x,it.z,1)>S.p)continue;
  for(let j=0;j<(S.n||1);j++){const h=k=>hash(it.x,it.z,k+j*7),yaw=it.yaw||0,d=S.r[0]+h(2)*(S.r[1]-S.r[0]);
   let a,u=0;if(S.front){a=yaw;u=(h(3)-.5)*1.3;}else a=h(3)*Math.PI*2; // in front of benches and shelters (their open side, +Z), all round bins and stands
   const x=it.x+Math.sin(a)*d+Math.cos(a)*u,z=it.z+Math.cos(a)*d-Math.sin(a)*u;
   if(!clear(x,z))continue;
   cans.push({x,z,drop:it.drop||0 /* by a bench or bin off the paving: on the ground drawn there, as the item (main.js) */,yaw:h(4)*Math.PI*2,lying:h(5)<.75,tint:new THREE.Color(TINTS[Math.floor(h(6)*TINTS.length)]),taken:-1e9});}}
 // a coarse grid for the near query
 const CELL=60,grid=new Map(),key=(i,j)=>i*100003+j;
 cans.forEach((c,i)=>{const k=key(Math.floor(c.x/CELL),Math.floor(c.z/CELL));if(!grid.has(k))grid.set(k,[]);grid.get(k).push(i);});
 const geo=geometry?.clone()||(()=>{const g=new THREE.CylinderGeometry(.033,.033,.115,12).translate(0,.0575,0).toNonIndexed();const a=new Float32Array(g.attributes.position.count*3).fill(.82);g.setAttribute('color',new THREE.BufferAttribute(a,3));return g;})();
 geo.computeBoundingBox();const radius=Math.max(geo.boundingBox.max.x,geo.boundingBox.max.z)*SCALE;
 const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.32,metalness:.25,emissive:'#ffffff',emissiveIntensity:.08});
 const mesh=new THREE.InstancedMesh(geo,material,capacity);mesh.name='Pant (empty cans)';mesh.count=0;mesh.frustumCulled=false;mesh.castShadow=true;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
 mesh.instanceColor=new THREE.InstancedBufferAttribute(new Float32Array(capacity*3),3).setUsage(THREE.DynamicDrawUsage);
 const group=new THREE.Group();group.name='Pant';group.add(mesh);
 const m=new THREE.Matrix4(),q=new THREE.Quaternion(),e=new THREE.Euler(),v=new THREE.Vector3(),s=new THREE.Vector3(SCALE,SCALE,SCALE),near=[];
 let acc=1,clock=0;
 // player: {x,z}; returns the number of cans picked up this frame.
 function update(dt,player,{collect=true}={}){
  clock+=dt;acc+=dt;let got=0;if(!player)return 0;
  // glint: a slow shimmer so a can catches the eye
  material.emissiveIntensity=.06+.22*Math.max(0,Math.sin(clock*2.4))**6;
  if(collect)for(const i of near){const c=cans[i];if(clock-c.taken<PANT_RESPAWN)continue;if(Math.hypot(c.x-player.x,c.z-player.z)<PANT_REACH){c.taken=clock;got++;acc=1;}}
  if(acc<.25)return got;acc=0;
  near.length=0;const i0=Math.floor((player.x-range)/CELL),i1=Math.floor((player.x+range)/CELL),j0=Math.floor((player.z-range)/CELL),j1=Math.floor((player.z+range)/CELL);
  for(let i=i0;i<=i1;i++)for(let j=j0;j<=j1;j++){const l=grid.get(key(i,j));if(l)for(const k of l){const c=cans[k];if(clock-c.taken>=PANT_RESPAWN&&Math.hypot(c.x-player.x,c.z-player.z)<range)near.push(k);}}
  if(near.length>capacity){near.sort((a,b)=>Math.hypot(cans[a].x-player.x,cans[a].z-player.z)-Math.hypot(cans[b].x-player.x,cans[b].z-player.z));near.length=capacity;}
  near.forEach((k,n)=>{const c=cans[k];e.set(c.lying?Math.PI/2:0,c.yaw,0,'YXZ');
   mesh.setMatrixAt(n,m.compose(v.set(c.x,groundAt(c.x,c.z)+c.drop+(c.lying?radius:0)+.005,c.z),q.setFromEuler(e),s));mesh.setColorAt(n,c.tint);});
  mesh.count=near.length;mesh.instanceMatrix.needsUpdate=true;mesh.instanceColor.needsUpdate=true;
  return got;
 }
 return {group,update,count:cans.length};
}
