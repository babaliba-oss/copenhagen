import * as THREE from 'three';
import {groundAt} from '../terrain.js';
import {pointInPolygon,inWaterPolygons} from '../geo.js';

// Geese on the lawns of the big parks (Fælledparken, Kongens Have, Østre Anlæg, Ørstedsparken...; in 1760 the few
// green spaces the map has): small flocks grazing, most near a lake or a moat where there is one, waddling off when
// someone comes close. Model: Daniel's goose (public/models/animals/goose.glb, "Goose Low Poly" by Atlas, CC BY 4.0,
// facing +X like period-life.js's animals); a white egg of a bird where it does not load.
const rnd=seed=>{let s=seed>>>0||1;return ()=>((s=Math.imul(s^s>>>15,1|s)+0x6d2b79f5|0,((s^s>>>14)>>>0)/4294967296));};
const area=ring=>{let a=0;for(let i=0,j=ring.length-1;i<ring.length;j=i++)a+=ring[j][0]*ring[i][1]-ring[i][0]*ring[j][1];return Math.abs(a)/2;};
export function createParkGeese({parks=[],water=[],clear=()=>true,model=null,count=14,seed=7}={}){
 const r=rnd(seed),group=new THREE.Group();group.name='Park geese';
 const lawns=parks.filter(p=>/Nurmikko|Kenttä|Niitty/.test(p.kind||'')&&!/kirkegård|cemetery/i.test(p.name||'')&&p.rings?.[0]?.length>3).map(p=>({p,a:area(p.rings[0])})).filter(l=>l.a>15000).sort((a,b)=>b.a-a.a).slice(0,count);
 const nearWater=(x,z)=>[[25,0],[-25,0],[0,25],[0,-25],[18,18],[-18,-18],[18,-18],[-18,18]].some(([dx,dz])=>inWaterPolygons(water,x+dx,z+dz));
 const geese=[];
 for(const {p} of lawns){const [x0,z0,x1,z1]=p.bbox||[0,0,0,0];let spot=null;
  for(let k=0;k<60&&!spot;k++){const x=x0+r()*(x1-x0),z=z0+r()*(z1-z0);if(!pointInPolygon(x,z,p.rings)||!clear(x,z))continue;if(k<40&&!nearWater(x,z))continue;spot=[x,z];} // the first 40 tries want water close by
  if(!spot)continue;const n=3+Math.floor(r()*5);
  for(let i=0;i<n;i++){const x=spot[0]+(r()-.5)*5,z=spot[1]+(r()-.5)*5;if(clear(x,z))geese.push({hx:spot[0],hz:spot[1],x,z,a:r()*6.28,ph:r()*10,flee:0});}}
 if(!geese.length)return {group,update(){},count:0};
 const geo=model||(()=>{const g=new THREE.SphereGeometry(.17,10,8).scale(1.45,1,1).translate(0,.24,0).toNonIndexed();const a=new Float32Array(g.attributes.position.count*3).fill(.92);g.setAttribute('color',new THREE.BufferAttribute(a,3));return g;})();
 const im=new THREE.InstancedMesh(geo,new THREE.MeshStandardMaterial({vertexColors:true,roughness:.85}),geese.length);im.name='Park geese (flocks)';im.castShadow=true;im.frustumCulled=false;group.add(im);
 const m=new THREE.Matrix4(),q=new THREE.Quaternion(),v=new THREE.Vector3(),one=new THREE.Vector3(1,1,1),E=new THREE.Euler();let t=0,acc=0;
 function update(dt,player){
  t+=dt;acc+=dt;if(acc<.05)return;const step=acc;acc=0;let any=false;
  geese.forEach((g,i)=>{const near=!player||Math.hypot(g.x-player.x,g.z-player.z)<160;
   if(near){any=true;
    const dp=player?Math.hypot(g.x-player.x,g.z-player.z):99;
    if(dp<5){g.flee=2.5;g.a=Math.atan2(g.z-player.z,g.x-player.x)+(Math.sin(t+g.ph)*.4);} // someone close: off they go
    g.flee=Math.max(0,g.flee-step);
    const sp=g.flee>0?1.3:.18;g.a+=(g.flee>0?0:Math.sin(t*.25+g.ph)*.5)*step;
    const nx=g.x+Math.cos(g.a)*sp*step,nz=g.z+Math.sin(g.a)*sp*step;
    if(!clear(nx,nz)||Math.hypot(nx-g.hx,nz-g.hz)>(g.flee>0?14:5))g.a+=Math.PI*.6;else{g.x=nx;g.z=nz;}}
   const graze=g.flee>0?0:Math.max(0,Math.sin(t*.9+g.ph))*.22; // head down to graze now and then
   im.setMatrixAt(i,m.compose(v.set(g.x,groundAt(g.x,g.z),g.z),q.setFromEuler(E.set(0,-g.a,-graze)),one));});
  im.visible=any;if(any)im.instanceMatrix.needsUpdate=true;
 }
 acc=1;update(0,null); // placed before the first frame
 return {group,update,count:geese.length,flocks:lawns.length};
}
