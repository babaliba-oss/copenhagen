import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {buildBridgeRailings,waterLocator,WATER_LEVEL,QUAY_FOOT,extractQuayEdges,buildQuayGeometry,createGroundGeometry,groundSizeForExtent} from './quay.js';
import {ALLAS} from './waterfront-landmarks.js';
import {drapeGeometry,createLakeGeometry,removeLegacyWater} from './terrain-mesh.js';
import {hasTerrain,seaLevel,terrain,groundAt} from './terrain.js';

export {WATER_LEVEL,removeLegacyWater};

// Tileable ripple slopes (RG = d/dx, d/dz) from integer-frequency waves with
// random directions and phases: isotropic, so no regular stripes appear.
export function createRippleTexture(size=128,seed=7){
 let s=seed>>>0;const rnd=()=>((s=(s*1664525+1013904223)>>>0)/4294967296);
 const waves=[];
 for(let i=0;i<28;i++){let kx,ky;do{kx=Math.round((rnd()*2-1)*11);ky=Math.round((rnd()*2-1)*11);}while(Math.hypot(kx,ky)<2);waves.push([kx,ky,rnd()*Math.PI*2,1/Math.pow(Math.hypot(kx,ky),1.35)]);}
 const sx=new Float32Array(size*size),sz=new Float32Array(size*size),sh=new Float32Array(size*size);let max=0,hmax=0;
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){let dx=0,dz=0,h=0;for(const [kx,ky,ph,a] of waves){const c=Math.cos((kx*x+ky*y)*2*Math.PI/size+ph)*a;dx+=c*kx;dz+=c*ky;h+=c;}const i=y*size+x;sx[i]=dx;sz[i]=dz;sh[i]=h;max=Math.max(max,Math.abs(dx),Math.abs(dz));hmax=Math.max(hmax,Math.abs(h));}
 const data=new Uint8Array(size*size*4);
 for(let i=0;i<size*size;i++){data[i*4]=Math.round(127.5+127*sx[i]/max);data[i*4+1]=Math.round(127.5+127*sz[i]/max);data[i*4+2]=Math.round(127.5+127*sh[i]/hmax);data[i*4+3]=255;}
 const t=new THREE.DataTexture(data,size,size,THREE.RGBAFormat);
 t.wrapS=t.wrapT=THREE.RepeatWrapping;t.magFilter=THREE.LinearFilter;t.minFilter=THREE.LinearMipmapLinearFilter;t.generateMipmaps=true;t.anisotropy=4;t.colorSpace=THREE.NoColorSpace;t.needsUpdate=true;
 return t;
}

const SEA_VERTEX=`
#include <common>
#include <fog_pars_vertex>
varying vec3 vSeaWorld;
void main(){
 vec4 worldPosition=modelMatrix*vec4(position,1.);
 vSeaWorld=worldPosition.xyz;
 vec4 mvPosition=viewMatrix*worldPosition;
 gl_Position=projectionMatrix*mvPosition;
 #include <fog_vertex>
}`;
// Fresnel blend of dark Baltic water and a sky/shoreline gradient, three
// scrolling ripple samples, and a sun glint. No reflection render pass.
const SEA_FRAGMENT=`
uniform sampler2D uRipples;
uniform float uSeaTime;
uniform vec3 uDeep,uSkyHorizon,uSkyMid,uSkyZenith,uShore,uSunDir,uSunColor;
uniform float uReflect,uRipple;
#include <common>
#include <fog_pars_fragment>
varying vec3 vSeaWorld;
void main(){
 vec2 p=vSeaWorld.xz;
 vec3 toCam=cameraPosition-vSeaWorld;float dist=length(toCam);vec3 V=toCam/dist;
 vec2 s=texture2D(uRipples,p*.029+uSeaTime*vec2(.0061,.0023)).xy*2.-1.;
 s+=(texture2D(uRipples,mat2(.8,-.6,.6,.8)*p*.083+uSeaTime*vec2(-.0102,.0131)).xy*2.-1.)*.75;
 s+=(texture2D(uRipples,mat2(-.28,.96,-.96,-.28)*p*.27+uSeaTime*vec2(.029,.021)).xy*2.-1.)*.35*(1.-smoothstep(20.,70.,dist));
 // Calm harbour: gentle slopes, flatter still in the distance (less shimmer).
 // Wind gusts (cat's paws): slow-moving patches where the ripples are rougher and the water reads darker.
 float gust=smoothstep(.35,.8,texture2D(uRipples,p*.0042+uSeaTime*vec2(.0024,-.0017)).z*.6+texture2D(uRipples,p*.011-uSeaTime*vec2(.0031,.0011)).z*.4);
 float strength=mix(.085,.03,smoothstep(15.,300.,dist))*uRipple*(.75+.6*gust);
 vec3 N=normalize(vec3(-s.x*strength,1.,-s.y*strength));
 float NdV=clamp(dot(N,V),0.,1.);
 float fresnel=.02+.98*pow(1.-NdV,5.);
 vec3 R=reflect(-V,N);R.y=max(R.y,0.);
 // Sky reflection uses the dome's own three-stop gradient (horizon, mid, zenith).
 vec3 sky=mix(mix(uSkyHorizon,uSkyMid,smoothstep(0.,.22,R.y)),uSkyZenith,smoothstep(.12,.9,R.y));
 // Forward-scattered haze brightens the reflected horizon under the sun.
 vec2 Rh=normalize(R.xz+1e-4),Sh=normalize(uSunDir.xz+1e-4);
 float toward=max(dot(Rh,Sh),0.);
 sky=mix(sky,uSunColor,pow(toward,6.)*(1.-smoothstep(0.,.3,R.y))*.22);
 // Low reflected rays hit the opposite quays, boats and buildings.
 sky=mix(sky,uShore,(1.-smoothstep(.03,.26,R.y))*.85);
 vec3 deep=uDeep*(.85+.3*(s.x*.5+.5))*(1.-gust*.12)+vec3(-.004,.012,.01); // a touch of canal green-teal
 vec3 color=mix(deep,sky*.72,fresnel*uReflect*(1.-gust*.15));
 // Sun glint: a tight disc, a mid lobe broken up by the ripples, and a soft sheen.
 float sun=max(dot(R,uSunDir),0.);
 color+=uSunColor*(pow(sun,260.)*1.4+pow(sun,80.)*.12+pow(sun,28.)*.035)*(.35+.65*fresnel);
 // sparkle: individual ripple facets catching the sun, near the viewer
 color+=uSunColor*pow(sun,900.)*6.*(1.-smoothstep(30.,160.,dist))*step(.55,fract(s.x*7.+s.y*5.));
 gl_FragColor=vec4(color,1.);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 #include <fog_fragment>
}`;

export const SEA_DEFAULTS={deep:'#28332f',shore:'#434a42',horizon:'#b9cbd4',sunColor:'#fff1d6',sunOffset:[-160,260,160]};

// Overhead sky: deeper and bluer than the hazy horizon colour.
function skyZenith(horizon,out=new THREE.Color()){return out.setRGB(horizon.r*.55,horizon.g*.7,Math.min(1,horizon.b*.95));}
function skyMid(horizon,zenith,out=new THREE.Color()){return out.copy(horizon).lerp(zenith,.5);}

export function createSeaMaterial(time={value:0}){
 const c=hex=>new THREE.Color(hex);
 const uniforms=THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
 const horizon=c(SEA_DEFAULTS.horizon),zenith=skyZenith(horizon);
 Object.assign(uniforms,{
  uRipples:{value:createRippleTexture()},uSeaTime:time,
  uDeep:{value:c(SEA_DEFAULTS.deep)},uShore:{value:c(SEA_DEFAULTS.shore)},uReflect:{value:1},uRipple:{value:1},
  uSkyHorizon:{value:horizon},uSkyMid:{value:skyMid(horizon,zenith)},uSkyZenith:{value:zenith},
  uSunDir:{value:new THREE.Vector3(...SEA_DEFAULTS.sunOffset).normalize()},uSunColor:{value:c(SEA_DEFAULTS.sunColor)},
 });
 return new THREE.ShaderMaterial({name:'Helsinki harbour water',uniforms,vertexShader:SEA_VERTEX,fragmentShader:SEA_FRAGMENT,fog:true});
}

// Pull the live sky colours off the procedural dome (src/sky.js exposes them
// as its shader uniforms), so time-of-day or weather changes to the sky are
// mirrored by the water on the same frame. Returns false when no dome is found.
export function applySkyUniforms(u,skyMesh){
 const s=skyMesh?.material?.uniforms;if(!s?.uHorizon)return false;
 u.uSkyHorizon.value.copy(s.uHorizon.value);
 if(s.uZenith)u.uSkyZenith.value.copy(s.uZenith.value);else skyZenith(u.uSkyHorizon.value,u.uSkyZenith.value);
 if(s.uMid)u.uSkyMid.value.copy(s.uMid.value);else skyMid(u.uSkyHorizon.value,u.uSkyZenith.value,u.uSkyMid.value);
 if(s.uSunGlow)u.uSunColor.value.copy(s.uSunGlow.value);
 if(s.uSunDir?.value?.isVector3&&s.uSunDir.value.lengthSq()>0)u.uSunDir.value.copy(s.uSunDir.value).normalize();
 return true;
}

// Kauppatori already places iron bollards on its own quay caps.
const kauppatoriBollards=(x,z)=>x>12&&x<300&&z>265&&z<545;

// Lowered Baltic water on the municipal sea polygons, granite quay walls on
// every shore edge that borders land, and the ground plane cut under the sea.
// Three draw calls: water, quay walls (merged), transparent wall shade.
function splitByCell(source,cell){
 const g=source.index?source.toNonIndexed():source,pos=g.attributes.position,names=Object.keys(g.attributes),buckets=new Map();
 for(let t=0;t<pos.count;t+=3){const x=(pos.getX(t)+pos.getX(t+1)+pos.getX(t+2))/3,z=(pos.getZ(t)+pos.getZ(t+1)+pos.getZ(t+2))/3,k=`${Math.floor(x/cell)},${Math.floor(z/cell)}`;if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(t);}
 const out=[];for(const tris of buckets.values()){const ng=new THREE.BufferGeometry();
  for(const n of names){const a=g.attributes[n],arr=new a.array.constructor(tris.length*3*a.itemSize);let o=0;for(const t of tris)for(let v=0;v<3;v++)for(let c=0;c<a.itemSize;c++)arr[o++]=a.array[(t+v)*a.itemSize+c];ng.setAttribute(n,new THREE.BufferAttribute(arr,a.itemSize,a.normalized));}
  ng.computeBoundingSphere();out.push(ng);}
 if(g!==source)g.dispose();
 return out;
}
export function createSea(water,land={},{helsinkiHarbour=true,groundExtent=0,deckColor='#4a4b4d',deckTexture=null}={}){
 const group=new THREE.Group();group.name='Helsinki harbour water and quays';
 const time={value:0},geometries=[];
 for(const {rings} of water){
  if(!rings?.[0]?.length)continue;
  const shape=new THREE.Shape(rings[0].map(([x,z])=>new THREE.Vector2(x,-z)));
  for(const ring of rings.slice(1))shape.holes.push(new THREE.Path(ring.map(([x,z])=>new THREE.Vector2(x,-z))));
  const g=new THREE.ShapeGeometry(shape).toNonIndexed();g.rotateX(-Math.PI/2);g.translate(0,WATER_LEVEL,0);g.deleteAttribute('uv');geometries.push(g);
 }
 const material=createSeaMaterial(time),u=material.uniforms;
 let sunLight=null,skyDome=null,searched=false,manualSky=false;
 // Follow the sky dome's live colours when there is one, else the scene fog;
 // the sun direction comes from the dome or the shadow-casting light.
 const followSky=(renderer,scene)=>{
  if(!searched){searched=true;scene.traverse(o=>{if(!sunLight&&o.isDirectionalLight)sunLight=o;if(!skyDome&&o.name==='sky'&&o.material?.uniforms?.uHorizon)skyDome=o;});}
  if(!manualSky&&!(skyDome&&applySkyUniforms(u,skyDome))){
   const sky=scene.fog?.color??(scene.background?.isColor?scene.background:null);
   if(sky){u.uSkyHorizon.value.copy(sky);skyZenith(sky,u.uSkyZenith.value);skyMid(u.uSkyHorizon.value,u.uSkyZenith.value,u.uSkyMid.value);}
  }
  if(sunLight&&!(skyDome&&skyDome.material.uniforms.uSunDir)){u.uSunDir.value.subVectors(sunLight.position,sunLight.target.position);if(u.uSunDir.value.lengthSq()>0)u.uSunDir.value.normalize();}
 };
 if(geometries.length){
  // Hilly cities: each water body lies at its own surveyed level (src/terrain.js), stepping down at dams.
  const sea=new THREE.Mesh(drapeGeometry(mergeGeometries(geometries),{water:true,lift:-WATER_LEVEL-.1,maxEdge:10}) /* flat water, no vertex waves: 10 m edges (4 m drew ~170k triangles on a phone) */,material);sea.name='Sea surface';geometries.forEach(g=>g.dispose());
  sea.onBeforeRender=followSky;
  group.add(sea);
  // Under the harbour polygons, one plane at the common water level: where the polygon triangulation leaves a
  // gap (a sliver along a pier, a hole touching the outline) the sea bed showed as a dark trench beside the
  // promenade. Half a metre lower than the real surface, so it only shows through those gaps.
  const level=hasTerrain()?seaLevel():null;
  const ext=groundExtent>0?groundExtent:terrain()?.extent||0;
  if(level!==null&&ext>0){const under=new THREE.Mesh(new THREE.PlaneGeometry(ext*2,ext*2).rotateX(-Math.PI/2).translate(0,level-.6,0),material);under.name='Sea underlay';under.onBeforeRender=followSky;group.add(under);}
 }
 // Lakes found only in the elevation model (src/terrain.js), at their own levels.
 const lakeGeometry=createLakeGeometry();
 if(lakeGeometry){const lakes=new THREE.Mesh(lakeGeometry,material);lakes.name='Lake surfaces';lakes.onBeforeRender=followSky;group.add(lakes);}
 const edges=extractQuayEdges(water,land);
 const {geometry,skirt}=buildQuayGeometry(edges,helsinkiHarbour?{skipBollards:kauppatoriBollards,pontoons:[{x:ALLAS.x,z:ALLAS.z,w:81.9,d:42.9,yaw:ALLAS.yaw,top:-.2}]}:{});
 if(geometry.attributes.position.count){
  // Split into 400 m cells so the quays behind the camera are frustum-culled (one city-wide mesh never is).
  const quayMaterial=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.9,side:THREE.DoubleSide});
  const draped=drapeGeometry(geometry,{maxEdge:10,tolerance:.12}); // tolerance: straight runs on flat ground stay whole (557k triangles city-wide before)
  // Terrain cities: the canal water sits metres below the street (Copenhagen ~3 m), but the wall profile is
  // Helsinki's (foot 1.75 m down), so a dark gap opened under every quay edge, as if you could drive under the
  // street. The foot and the waterline band follow the real water instead.
  if(hasTerrain()){const lvl=seaLevel(),p=draped.attributes.position;for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getZ(i),local=p.getY(i)-groundAt(x,z);
   if(local<QUAY_FOOT+.05)p.setY(i,Math.min(p.getY(i),lvl-.8));else if(Math.abs(local-(WATER_LEVEL+.22))<.03)p.setY(i,Math.min(p.getY(i),lvl+.22));}p.needsUpdate=true;draped.computeVertexNormals();}
  for(const g of splitByCell(draped,1400)){const quay=new THREE.Mesh(g,quayMaterial);quay.name='Granite quay walls';quay.receiveShadow=true;group.add(quay);}
  const shade=new THREE.Mesh(drapeGeometry(skirt,{water:true,lift:-WATER_LEVEL-.1}),new THREE.MeshBasicMaterial({color:'#ffffff',vertexColors:true,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-2}));
  shade.name='Quay shade on water';shade.renderOrder=1;group.add(shade);
 }
 let bridges=[];{const rails=buildBridgeRailings(water,land,{ground:hasTerrain()?groundAt:()=>0});bridges=rails?.userData.bridges||[];if(rails){const m=new THREE.Mesh(rails,new THREE.MeshStandardMaterial({color:'#2b2f31',roughness:.55,metalness:.4}));m.name='Bridge railings';m.castShadow=true;group.add(m);if(rails.userData.deck){let deckGeo=rails.userData.deck;if(hasTerrain()){const lvl=seaLevel();deckGeo.deleteAttribute('normal');const flat=deckGeo.attributes.position.array.slice();for(let i=1;i<flat.length;i+=3)flat[i]=0;const g0=new THREE.BufferGeometry();g0.setAttribute('position',new THREE.BufferAttribute(flat,3));g0.setAttribute('uv',deckGeo.attributes.uv);g0.setAttribute('deckBase',deckGeo.attributes.deckBase);deckGeo=drapeGeometry(g0,{maxEdge:4});
   /* the deck follows the street where there is street under it, and keeps its quay-end height over the water; 5 cm under the street's own paving, which now stays on bridges (surface-tiles.js): level with it, the two asphalts met in a saw-tooth seam. Over open water the ground is raised to 12 cm under the drawn height (raiseBridgeDecks), so the plate sits just under the paving there too */const p=deckGeo.attributes.position,b=deckGeo.attributes.deckBase,wet=waterLocator(water);for(let i=0;i<p.count;i++){const g=p.getY(i),base=b?b.getX(i):lvl+2.6;p.setY(i,wet(p.getX(i),p.getZ(i))?Math.max(base-.17,g-.05):g-.05);}
   /* only the part over the water: on land the street's own surface is already there (two asphalts and a seam) */{const keep=[],q=deckGeo.index?deckGeo.toNonIndexed():deckGeo,qp=q.attributes.position,uvA=q.attributes.uv;for(let t=0;t<qp.count;t+=3){const cx=(qp.getX(t)+qp.getX(t+1)+qp.getX(t+2))/3,cz=(qp.getZ(t)+qp.getZ(t+1)+qp.getZ(t+2))/3;if(wet(cx,cz)||[t,t+1,t+2].some(j=>wet(qp.getX(j),qp.getZ(j))))keep.push(t,t+1,t+2);}const g2=new THREE.BufferGeometry(),P=new Float32Array(keep.length*3),U=new Float32Array(keep.length*2);keep.forEach((j,k)=>{P.set([qp.getX(j),qp.getY(j),qp.getZ(j)],k*3);if(uvA)U.set([uvA.getX(j),uvA.getY(j)],k*2);});g2.setAttribute('position',new THREE.BufferAttribute(P,3));g2.setAttribute('uv',new THREE.BufferAttribute(U,2));deckGeo=g2;}p.needsUpdate=true;deckGeo.computeVertexNormals();}
  const d=new THREE.Mesh(deckGeo,(()=>{const m=new THREE.MeshStandardMaterial({color:deckColor,roughness:.9,side:THREE.DoubleSide});if(deckTexture&&typeof document!=='undefined'){const t=new THREE.TextureLoader().load(`/materials/${deckTexture}-color.jpg`);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=THREE.SRGBColorSpace;m.map=t;m.color.set('#ffffff').lerp(new THREE.Color(deckColor),.25);}return m;})() /* deck in the street's own surface: scanned asphalt today, setts in 1760 */);d.name='Bridge decks';d.receiveShadow=true;group.add(d);}console.info('Bridge railings',rails.userData.runs);}}
 const groundGeometry=createGroundGeometry(water,groundSizeForExtent(groundExtent));
 const kinds={};for(const e of edges)kinds[e.kind]=(kinds[e.kind]||0)+1;
 group.userData={polygons:geometries.length,surfaceHeight:WATER_LEVEL,animated:true,quayEdges:edges.length,quayKinds:kinds,drawCalls:group.children.length,bridges}; // bridges: the deck plates drawn over the water (main.js raises the ground under them)
 return {group,groundGeometry,edges,material,
  update(seconds){if(Number.isFinite(seconds))time.value=seconds;},
  setSky(horizon,zenith){manualSky=true;u.uSkyHorizon.value.set(horizon);if(zenith)u.uSkyZenith.value.set(zenith);else skyZenith(u.uSkyHorizon.value,u.uSkyZenith.value);skyMid(u.uSkyHorizon.value,u.uSkyZenith.value,u.uSkyMid.value);}};
}
