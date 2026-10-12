import './style.css';
import './loading-screen.css';
import './speedometer.css';
import {createSpeedometer} from './speedometer.js';
import {createLoadingScreen} from './loading-screen.js';
import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {SpatialIndex,RADIUS,pointInPolygon,insidePlayable,setPlayableRadius} from './geo.js';
import {loadExtensionIndex,loadExtension,applyExtensions,mapViewFor,activateExtension,createExtensionStreamer} from './extensions.js';
import {setTramLivery} from './tram-model.js';
import {setBusLivery} from './bus-renderer.js';
import {selectCity,useCity,pickStart,startUrl,dataUrl,registerCities,CITIES} from './cities.js';
import {createStartPicker,pickerStep} from './start-picker.js';
import {createAdaptiveResolution} from './adaptive-quality.js';
import {makeCar,driveStep,simulationSteps,PLAYER_MAX_SPEED,displayedSpeedKmh} from './physics.js';
import {animateVehicle} from './vehicles.js';
import {Mobility} from './mobility.js';
import {createStreetLife} from './street-life.js';
import {buildTileInWorker,materialiseBuilding,createSourceShell} from './building-loader.js';
import {attachFacades,applyFacadeHeights,estimateFacades} from './facade-data.js';
import {tileLevel,applyTileLod,createMergedShells,freezeTileGroup,freezeMesh,applyTreeLod,createStaticShadowCuller} from './tile-lod.js';
import {loadTileImages,aheadPoint,tilePriority,createFrameQueue,createDetailScheduler} from './tile-streaming.js';
import {createSurfaceStreamer} from './surface-streaming.js';
import {createCathedral,createSenateSquare,loadSenateMaterials} from './cathedral.js';
import {USPENSKI,createUspenskiCathedral} from './uspenski-cathedral.js';
import {createKauppatori} from './kauppatori.js';
import {advanceOcclusion,stableShadowTarget,shadowFrame} from './render-stability.js';
import {HARBOUR_START} from './demo-route.js';
import {createLandcover} from './landcover.js';
import {TramSimulation} from './tram-simulation.js';
import {createTramRenderer} from './trams.js';
import {createHarbour} from './harbour.js';
import {drivingCameraPose,overviewCameraPose,createDriveCameraState,stepDriveCamera,DRIVE_FOV} from './driving-camera.js';
import {surfaceDetailAt,rumbleFor,createRumbleState} from './road-surface.js';
import {createSkyEnvironment} from './environment.js';
import {correctHarbourLanes,olympiaTramOnlySurfaces,harbourCorridor,HARBOUR_CORRIDOR_CARS} from './road-safety.js';
import {inHarbour} from './harbour-layout.js';
import {Cyclists,createCyclistRenderer} from './cyclists.js';
import {ScooterRiders,createScooterRiderRenderer} from './scooter-riders.js';
import {createBindAds} from './bind-ads.js';
import {createLasipalatsiStops} from './lasipalatsi-stop.js';
import {createKauppatoriTramStops} from './kauppatori-tram-stops.js';
import {createStationStreetLife} from './station-street-life.js';
import {createStationStatues} from './station-statues.js';
import {createStationBuildingDetails} from './station-building.js';
import {createLocationReadout,describeLocation,useProjection} from './location-readout.js';
import {areaCaption,HELSINKI_AREAS} from './area-caption.js';
import {createWaterfrontLandmarks} from './waterfront-landmarks.js';
import {createStreetNameSigns} from './street-name-signs.js';
import {createPalaceLife} from './palace-life.js';
import {createRouteDirectionSigns} from './route-direction-signs.js';
import {createCityHallFlag} from './city-hall-flag.js';
import {createMarketStreetSurface,GRANITE_SETTS_GLSL} from './market-street-surface.js';
import {createLaivasillankatuSigns} from './laivasillankatu-signs.js';
import {createKauppatoriFingerpost} from './kauppatori-fingerpost.js';
import {createSofiankatuSigns} from './sofiankatu-signs.js';
import {createBusSystem} from './bus-system.js';
import {installTransit} from './extension-transit.js';
import {createSea,removeLegacyWater} from './sea.js';
import {PoliceSimulation} from './police.js';
import {createPoliceRenderer} from './police-renderer.js';
import './police-alert.css';
import {cutLowerYard} from './port-yard.js';
import {createRouteCrossingSigns} from './route-crossing-signs.js';
import {createEtelarantaGantry} from './etelaranta-gantry.js';
import {createMarketLife,marketGullColony,createInstancedPeople} from './market-life.js';
import {createCopenhagenGame} from './copenhagen/game.js';
import {createCarriage,createCarriageTraffic} from './copenhagen/carriage.js';
import {createParkedCars} from './copenhagen/parked-cars.js';
import {createRails} from './copenhagen/rails.js';
import {createBoats} from './copenhagen/boats.js';
import {createLandmarks} from './copenhagen/landmarks.js';
import {CityCyclists} from './copenhagen/city-cyclists.js';
import {createTrains} from './copenhagen/trains.js';
import {createCafes} from './copenhagen/cafes.js';
import {PERIOD as PERSON_PERIOD} from './person-model.js';
import {WATER_LEVEL as CPH_WATER} from './quay.js';
import {createBirds,shoreSamples,inWater} from './birds.js';
import {createSenateStreetProps} from './senate-street-props.js';
import {createUniversityLife} from './university-life.js';
import {createKauppatoriRoadworks} from './kauppatori-roadworks.js';
import {createMannerheimintieGantry} from './mannerheimintie-gantry.js';
import {createKaivokatuDetails} from './kaivokatu-details.js';
import {createKamppiChapel} from './kamppi-chapel.js';
import {createAngryDrivers} from './angry-drivers.js';
import {createStationKiosk,STATION_KIOSK_RATU} from './station-kiosk.js';
import {createTerminalLife} from './terminal-life.js';
import {ImpactSystem} from './impacts.js';
import {createCrowdReaction} from './crowd-reaction.js';
import {createPlayerCarRenderer} from './player-car-renderer.js';
import {sweptContact} from './contact-geometry.js';
import {PeopleInteraction} from './people-interaction.js';
import {createPeopleInteractionUI} from './people-interaction-ui.js';
import {WorldObjects,solidBox} from './world-objects.js';
import {MarketShop,stallFrame} from './market-shop.js';
import {createMarketShopUI} from './market-shop-ui.js';
import {createMarketShopRenderer} from './market-shop-renderer.js';
import {GullEncounter} from './gull-encounter.js';
import {createBirdFlightClearance} from './bird-flight-clearance.js';
import {gameIsStopped,onGameStop,reportGameError} from './game-resilience.js';
import {createSky} from './sky.js';
import {createPostPipeline} from './post.js';
import {createLook,WEATHER_UNIFORMS} from './weather.js';
import {facadeGrain} from './facade-grain.js';
import {createStreetFurniture,combineKnockables} from './street-furniture.js';
import {breakableSigns} from './breakable-signs.js';
import {createParkedMicromobility} from './parked-micromobility.js';
import {Finale} from './finale.js';
import {createRoadblock} from './roadblock.js';
import {createMappedFurniture} from './mapped-furniture.js';
import {createPlace} from './place-scene.js';
import {createSpeciesTrees} from './tree-species.js';
import {createTreeTrunks} from './tree-trunks.js';
import {PlayerTravel,TRAVEL_MODES,STARTER_VISUALS} from './player-travel.js';
import {createPlayerTravelRenderer,travelCameraPose} from './player-travel-renderer.js';
import {createTravelUI} from './player-travel-ui.js';
import {createMobileControls} from './mobile-controls.js';
import {updateWorldhoodBrand} from './worldhood-brand.js';
import {installMapillaryAttribution} from './mapillary-attribution.js';
import './worldhood-brand.css';
import {decodeTerrain,setTerrain,hasTerrain,groundAt,groundPose,liftBuildings,footprintBase} from './terrain.js';
import {drapeGeometry,settleObject,createTerrainGround,drawLakeMap} from './terrain-mesh.js';
const impacts=new ImpactSystem();impacts.onVehicleHit=(from,car,a)=>mobility?.knock(a,from,car)??null;
const finale=new Finale({doc:document}); // shared offence log, pursuit pressure, arrest cinematic and BUSTED screen
const locationReadout=createLocationReadout();
const loadingScreen=createLoadingScreen();
const speedometer=createSpeedometer();
let waterfrontLandmarks,palaceLife,cityHallFlag,sea,marketScene,marketLife,universityLife,stationStreetLife,terminalLife,knockables;
let marketShop=null,marketShopRenderer=null; // buying at market stalls on foot (market-shop.js)
const gullEncounter=new GullEncounter();
let safeBirdFlight=null;
let cph=null,cafeGuests=null,carriage=null,coaches=null,parkedCars=null,boats=null,landmarks=null,trains=null,detailPeople=[],travel=null,peopleInteraction=null,staticCars=[],trafficCars=[],cameraTransition=null;

const $=id=>document.getElementById(id);
const keys=new Set();
let data,world,car,startPoint,roofIndex,surfaceIndex,aerialIndex,ready=false,started=false,paused=false,mapOpen=false;
let angryDrivers=null,photoMode=false,captureMode=false,captureBadgeTimer=0,highCamera=false,chaseCamera=true,cameraLook=0,mobility,streetLife,tramSim,tramRenderer,cameraHeading=0,cathedralModel,harbour;
const driveCamera=createDriveCameraState();let cameraFov=DRIVE_FOV.min,cameraRoll=0,cameraShake=[0,0,0];
// Cobblestone rumble (src/road-surface.js): mapped sett polygons bounce the car body and, at half amplitude, the drive camera.
const roadRumble=createRumbleState();let cameraRumble=[0,0,0],surfaceNow={surface:'off',roughness:0},rumbleNow={bob:0,roll:0,pitch:0,intensity:0};
let treeTrunks=null,cityModelPromise,surfaceStreamer=null,extensionStreamer=null,switchingStart=false,startVisitVersion=0,places=[],speciesTrees=null;const placeHidden=new Set();
let birds=null,birdColonies=[],crowd=null; // gulls, pigeons, crows and sparrows from the city's map data (birds.js)
let cyclists,cyclistRenderer,npcScooters,npcScooterRenderer,buses,police,policeRenderer,roadblock; // shared riders and police in every city
let distance=0,viewSpan=150,desiredSpan=150,lastTime=0,lastUI=0,lastTile=0,lastToast=0,toastTimer,areaLabel;
let sound=false,audioContext,oscillator,gain,mobileControls=null;
let startPicker=null,previewVersion=0,previewing=false,startAfterPreview=false; // the ‹ › starting-point picker on the welcome card
onGameStop(()=>{surfaceStreamer?.dispose();extensionStreamer?.dispose();mobileControls?.release();keys.clear();paused=true;peopleInteraction?.dispose();gullEncounter.reset();birds?.clearEncounter();marketShopRenderer?.dispose();audioContext?.suspend().catch(()=>{});});
const scene=new THREE.Scene();
const cityModel=new THREE.Group(),aerialGroup=new THREE.Group();scene.add(cityModel,aerialGroup);aerialGroup.visible=false;document.body.classList.add('photographic');
scene.background=new THREE.Color('#b9cbd4');scene.fog=new THREE.Fog('#b9cbd4',330,850);
// Optional fixed frame for video capture: ?frame=1:1 (largest box of that aspect that fits the window)
// or ?frame=1080x1080 (exact CSS pixels, capped to the window). The game renders only inside the box,
// centred on black, and the HUD is laid out relative to it, so a "record selected portion" over the
// box gives a clean square/vertical clip. Without the parameter the frame is the whole window.
const frameSpec=new URLSearchParams(location.search).get('frame');
const captureFrame={x:0,y:0,w:innerWidth,h:innerHeight,fixed:!!frameSpec};
function layoutFrame(){
 let w=innerWidth,h=innerHeight;
 if(frameSpec){
  const m=frameSpec.match(/^(\d+(?:\.\d+)?)\s*[:x×]\s*(\d+(?:\.\d+)?)$/i);
  if(m){const a=+m[1],b=+m[2];
   if(/x|×/i.test(frameSpec)){w=Math.min(innerWidth,a);h=Math.min(innerHeight,b);}
   else{const aspect=a/b;if(innerWidth/innerHeight>aspect){h=innerHeight;w=Math.round(h*aspect);}else{w=innerWidth;h=Math.round(w/aspect);}}
  }
 }
 captureFrame.w=Math.max(1,Math.round(w));captureFrame.h=Math.max(1,Math.round(h));captureFrame.x=Math.round((innerWidth-captureFrame.w)/2);captureFrame.y=Math.round((innerHeight-captureFrame.h)/2);
 if(captureFrame.fixed){document.body.classList.add('framed');const st=document.body.style;st.left=captureFrame.x+'px';st.top=captureFrame.y+'px';st.width=captureFrame.w+'px';st.height=captureFrame.h+'px';}
}
layoutFrame();
const camera=new THREE.PerspectiveCamera(58,captureFrame.w/captureFrame.h,.25,1500);
let inspectionCamera=null;
const trafficFrustum=new THREE.Frustum(),trafficProjection=new THREE.Matrix4(),trafficSphere=new THREE.Sphere(new THREE.Vector3(),4);
const trafficInView=a=>{trafficSphere.center.set(a.x,1.5+groundAt(a.x,a.z),a.z);return trafficFrustum.intersectsSphere(trafficSphere);};
const focus=new THREE.Vector3(0,0,85);
const renderer=new THREE.WebGLRenderer({canvas:$('world'),antialias:true,powerPreference:'high-performance'});
const maxPixelRatio=Math.min(devicePixelRatio,1.5),resolution=createAdaptiveResolution({max:maxPixelRatio,min:Math.min(maxPixelRatio,.85)});
renderer.setPixelRatio(maxPixelRatio);
renderer.setSize(captureFrame.w,captureFrame.h);
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.85;
const hemi=new THREE.HemisphereLight('#e6eef8','#68786f',1.4);scene.add(hemi);
const sun=new THREE.DirectionalLight('#fff4e2',2.0);sun.position.set(-160,260,-120);sun.castShadow=true;
// 400 m box, biased ahead of the car: 2048 texels give 20 cm shadows where the camera looks.
sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-200,right:200,top:200,bottom:-200,near:1,far:750});sun.shadow.bias=-.0002;sun.shadow.normalBias=.3;
scene.add(sun,sun.target);
const sky=createSky({renderer,scene,camera});sky.applyLighting(hemi,sun);
// One sky PMREM shared by car paint/glass, chrome and tram glazing; rebuilt only when the sky changes.
const skyEnvironment=createSkyEnvironment(renderer,sky.mesh);
// Post pipeline (AO, bloom, grade) and the time-of-day/weather looks; `look` is attached to the road surface and sea below.
let post=null;try{post=createPostPipeline(renderer);}catch(e){console.warn('Post pipeline unavailable, rendering directly:',e);}
let look=null;
const ground=new THREE.Mesh(new THREE.PlaneGeometry(11000,11000),groundPatches(new THREE.MeshStandardMaterial({color:'#94988b',roughness:1})));ground.rotation.x=-Math.PI/2;ground.position.y=-.5;ground.receiveShadow=true;cityModel.add(ground);
// Unmapped ground (yards, lots, verges): soft patches of worn grass and gravel instead of one flat grey.
function groundPatches(material){
 material.onBeforeCompile=shader=>{
  shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vGp;').replace('#include <project_vertex>','#include <project_vertex>\nvGp=(modelMatrix*vec4(transformed,1.)).xyz;');
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vGp;float gpH(vec2 p){return fract(sin(dot(p,vec2(41.7,113.1)))*4371.3);}float gpN(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(gpH(i),gpH(i+vec2(1,0)),f.x),mix(gpH(i+vec2(0,1)),gpH(i+vec2(1,1)),f.x),f.y);}')
   .replace('#include <color_fragment>','#include <color_fragment>\n{float n=gpN(vGp.xz/23.)*.6+gpN(vGp.xz/7.)*.3+gpN(vGp.xz/2.1)*.1;float fp=length(fwidth(vGp.xz));float g=(gpH(floor(vGp.xz*9.))-.5)*(1.-smoothstep(.05,.3,fp));\nvec3 grass=vec3(.29,.36,.2),gravel=vec3(.42,.4,.35);diffuseColor.rgb=mix(gravel,grass,smoothstep(.38,.62,n))*(1.+g*.18);}');
 };
 return material;
}
const surfaceMaterial=new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,side:THREE.DoubleSide});
surfaceMaterial.onBeforeCompile=shader=>{
 shader.vertexShader='varying vec3 vGround;\n#ifdef TERRAIN\nattribute float terrainY;\n#endif\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvGround=position;\n#ifdef TERRAIN\nvGround.y-=terrainY;\n#endif');
 // uWetness comes from weather.js (WEATHER_UNIFORMS.wetness): rain darkens and smooths the asphalt bays.
 shader.uniforms.uWetness=WEATHER_UNIFORMS.wetness;
 shader.fragmentShader='varying vec3 vGround;uniform float uWetness;\nfloat groundHash(vec2 p){return fract(sin(dot(p,vec2(41.7,113.1)))*4371.3);}\nfloat groundNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(groundHash(i),groundHash(i+vec2(1,0)),f.x),mix(groundHash(i+vec2(0,1)),groundHash(i+vec2(1,1)),f.x),f.y);}\n'+GRANITE_SETTS_GLSL+shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
 // Filter sub-pixel masonry and grain; unfiltered fract() patterns sparkle in motion.
 float footprint=max(length(dFdx(vGround.xz)),length(dFdy(vGround.xz)));
 vec2 settFp=vec2(length(vec2(dFdx(vGround.x),dFdy(vGround.x))),length(vec2(dFdx(vGround.z),dFdy(vGround.z))));
 float detail=1.0-smoothstep(0.07,0.40,footprint);
 float grain=(fract(sin(dot(floor(vGround.xz*18.0),vec2(12.9898,78.233)))*43758.5453)-0.5)*(1.0-smoothstep(0.02,0.08,footprint));
 float wetRough=0.0;
 if(vGround.y>0.065&&vGround.y<0.075){
  if(diffuseColor.r<0.35){
   diffuseColor.rgb=mix(vec3(0.075,0.084,0.087),diffuseColor.rgb,0.10);
   // Asphalt: slow tone drift (resurfaced bays), sparse darker patches with a seam, both fading to their mean with distance.
   float tone=groundNoise(vGround.xz/9.0)-0.5;
   vec2 bay=vGround.xz/vec2(6.5,4.2);vec2 cell=floor(bay);float bayHash=groundHash(cell+0.37);
   vec2 toEdge=min(fract(bay),1.0-fract(bay))*vec2(6.5,4.2);float edge=min(toEdge.x,toEdge.y);
   float patchDetail=1.0-smoothstep(0.25,1.0,footprint);
   float bayPatch=step(0.87,bayHash)*patchDetail,seam=(1.0-smoothstep(0.02,0.06+footprint*0.8,edge))*bayPatch;
   diffuseColor.rgb*=(1.0+tone*0.18)*(1.0-bayPatch*(0.12+0.06*groundHash(cell+0.71)))*(1.0-seam*0.35);
   // Wet asphalt: darker, puddles in the low spots of the tone field, far less grain.
   float puddle=smoothstep(0.62,0.75,groundNoise(vGround.xz/3.5+7.0))*uWetness;
   diffuseColor.rgb*=1.0-uWetness*0.22-puddle*0.25;grain*=1.0-uWetness*0.7;wetRough=max(uWetness*0.5,puddle);
  }
  // Stone carriageways (aaa99e) get the shared photo-guided granite setts; light islands keep slabs.
  else if(diffuseColor.r<0.55){float settGloss;diffuseColor.rgb=vec3(0.235,0.230,0.226)*graniteSetts(vGround.xz,settFp,1.0,settGloss);grain=0.0;}
  else {vec2 cell=abs(fract(vGround.xz/vec2(0.28,0.2))-0.5);float seam=smoothstep(0.42,0.49,max(cell.x,cell.y));diffuseColor.rgb*=1.0-mix(0.2,seam,detail)*0.22;}
  diffuseColor.rgb*=1.0+grain*0.13;
 }else if(vGround.y>0.04&&vGround.y<0.06){
  vec2 grid=abs(fract(vGround.xz/vec2(0.7,0.48))-0.5);float seam=smoothstep(0.46,0.50,max(grid.x,grid.y));diffuseColor.rgb*=0.62-mix(0.15,seam,detail)*0.10+grain*0.04;
 }else diffuseColor.rgb*=1.0+grain*0.04;
 `).replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\n roughnessFactor*=1.0-wetRough*0.6;');
};
const buildingMaterial=facadeGrain(new THREE.MeshStandardMaterial({vertexColors:true,roughness:.88}));
look=createLook({scene,sky,hemi,sun,post,surfaces:[surfaceMaterial],getSea:()=>sea,initial:'golden'}); // golden evening is the default look; T cycles the others
$('look-label').textContent=look.label;look.onChange((name,label)=>{$('look-label').textContent=label;});$('look-btn').addEventListener('click',()=>{look.cycle();toast(look.label);$('world').focus();});
window.helsinkiLook={set:(name,opts)=>look.set(name,opts),cycle:()=>look.cycle(),get name(){return look.name;},post};
cutLowerYard(ground.material);cutLowerYard(surfaceMaterial);
const loadedTiles=new Map(),loadingTiles=new Map();
const uploads=createFrameQueue(),detailScheduler=createDetailScheduler(2),treeChunks=[],leafGeometries=[],shadowCuller=createStaticShadowCuller(cityModel);
const photoTiles=new Map(),photoPromises=new Map();
const tmp=new THREE.Object3D();
const treeFocus={value:new THREE.Vector2(1e5,1e5)};
const treeFade={value:0};
const occlusionRay=new THREE.Raycaster(),playerCars=createPlayerCarRenderer(scene),carGroup=playerCars.group;carGroup.visible=false;carGroup.rotation.order='YXZ'; // heading, then rumble pitch/roll in the car's own frame
const travelRenderer=createPlayerTravelRenderer(scene);
const travelUI=createTravelUI({interact:interactTravel,toggleRun:()=>{if(travel?.mode==='walk')travel.sprint=!travel.sprint;},focusWorld:()=>$('world').focus()});
const peopleUI=createPeopleInteractionUI({interact:talkToPerson,choose:replyToPerson,toggleVoice:()=>$('sound-btn').click(),focusWorld:()=>$('world').focus()});
const marketUI=createMarketShopUI({action:marketAction,buy:buyAtStall,close:()=>{marketShop?.close();refreshMarketUI();},focusWorld:()=>$('world').focus()});
const marker=new THREE.Mesh(new THREE.RingGeometry(3.3,3.55,48),new THREE.MeshBasicMaterial({color:'#d95e3b',transparent:true,opacity:.5,depthWrite:false}));marker.rotation.x=-Math.PI/2;marker.position.y=.15;scene.add(marker);marker.visible=false;
const mapCache=document.createElement('canvas');mapCache.width=1800;mapCache.height=1800;
// Map frame in local metres; widened at boot when map extensions are installed.
let mapView={cx:0,cz:0,size:4800,playable:[]},extensions=[],city=null;

function resize(){layoutFrame();renderer.setSize(captureFrame.w,captureFrame.h);camera.aspect=captureFrame.w/captureFrame.h;camera.updateProjectionMatrix();updateCaptureBadge();}
window.addEventListener('resize',resize);resize();
// Capture status badge: what the recorder will get. Sits outside the ?frame box when there is a margin.
function updateCaptureBadge(){
 const b=$('capture-badge');if(!b)return;
 b.hidden=!captureMode;clearTimeout(captureBadgeTimer);if(!captureMode)return;
 // Inside the recorded area (no ?frame margin to put it in) the badge would end up in the clip:
 // show it for a few seconds after V, like the toast, then hide. In the margin it can stay.
 const inMargin=captureFrame.fixed&&(captureFrame.x>=160||captureFrame.y>=40);
 if(!inMargin)captureBadgeTimer=setTimeout(()=>{b.hidden=true;},4000);
 const pr=renderer.getPixelRatio(),w=Math.round(captureFrame.w*pr),h=Math.round(captureFrame.h*pr);
 b.textContent=`CAPTURE · ${w}×${h} px · full resolution · shake off · H hides HUD · V exits`;
 b.style.left='16px';b.style.bottom='16px';b.style.maxWidth='';b.style.whiteSpace='nowrap';
 if(captureFrame.fixed){if(captureFrame.x>=160){b.style.left='-'+(captureFrame.x-16)+'px';b.style.maxWidth=(captureFrame.x-32)+'px';b.style.whiteSpace='normal';}else if(captureFrame.y>=40)b.style.bottom='-'+(captureFrame.y-8)+'px';}
}
// At the playable edge, invite the player to build the next streets (at most every 2 minutes).
let edgeInviteAt=-Infinity;
function showEdgeInvite(){const now=performance.now(),el=$('edge-invite');if(now-edgeInviteAt<120000){toast(`The edge of our ${city.name}. Turn back and keep exploring.`);return;}edgeInviteAt=now;el.hidden=false;clearTimeout(el.timer);el.timer=setTimeout(()=>{el.hidden=true;},12000);}
$('edge-invite').querySelector('button').addEventListener('click',()=>{$('edge-invite').hidden=true;});
function toast(message,{important=false}={}){const el=$('toast');if(!important&&el.classList.contains('important')&&el.classList.contains('visible'))return;el.textContent=message;el.classList.toggle('important',important);el.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),important?5000:2800);}
function progress(n,message){if(gameIsStopped())throw new Error('Startup stopped after a game failure');loadingScreen.progress(n,message);}
// Static hosts answer a missing file with the app's index.html (200, text/html): treat that as a 404.
async function json(url,{cache='default'}={}){const r=await fetch(url,{cache,headers:{Accept:'application/json'}});const missing=r.ok&&/text\/html/i.test(r.headers.get('content-type')||'');if(!r.ok||missing)throw Object.assign(Error(`Could not load ${url} (${missing?404:r.status})`),{status:missing?404:r.status});return r.json();}
async function unpack(url){const r=await fetch(url);if(!r.ok)throw Error(`Could not load ${url} (${r.status})`);const bytes=await r.arrayBuffer();const magic=new Uint8Array(bytes,0,2);if(magic[0]===31&&magic[1]===139)return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();return bytes;}
async function geometry(url){const a=new Float32Array(await unpack(`${url}.pack`));const g=new THREE.BufferGeometry();const buffer=new THREE.InterleavedBuffer(a,6);g.setAttribute('position',new THREE.InterleavedBufferAttribute(buffer,3,0));g.setAttribute('color',new THREE.InterleavedBufferAttribute(buffer,3,3));g.computeVertexNormals();g.computeBoundingSphere();return g;}
async function pool(items,n,fn){let next=0;await Promise.all(Array.from({length:Math.min(n,items.length)},async()=>{while(next<items.length){const item=items[next++];await fn(item);}}));}

function createCar(){
 const g=new THREE.Group();
 const paint=new THREE.MeshStandardMaterial({color:'#e7653d',roughness:.42,metalness:.18});
 const glass=new THREE.MeshStandardMaterial({color:'#364c51',roughness:.16,metalness:.3});
 const black=new THREE.MeshStandardMaterial({color:'#26332f',roughness:.95});
 const silver=new THREE.MeshStandardMaterial({color:'#d6d4c6',roughness:.4,metalness:.6});
 function box(w,h,d,mat,x,y,z){const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);m.castShadow=true;g.add(m);return m;}
 box(1.92,.59,4.5,paint,0,.73,0);box(1.8,.15,4.34,paint,0,1.07,0);
 box(1.62,.54,2.12,glass,0,1.35,.15);box(1.67,.13,1.48,paint,0,1.66,.3);
 box(1.74,.1,1.22,paint,0,1.09,-1.4);box(1.79,.12,.74,paint,0,1.1,1.79);
 box(1.84,.12,.12,silver,0,.66,-2.28);box(1.84,.12,.12,silver,0,.66,2.28);
 const head=new THREE.MeshStandardMaterial({color:'#fff9d9',emissive:'#fff1c5',emissiveIntensity:.5});
 const tail=new THREE.MeshStandardMaterial({color:'#b32817',emissive:'#be3018',emissiveIntensity:.3});
 for(const x of [-.64,.64]){box(.37,.22,.08,head,x,.88,-2.3);box(.4,.18,.08,tail,x,.9,2.3);}
 for(const x of [-.98,.98])for(const z of [-1.4,1.4]){
  const wheel=new THREE.Mesh(new THREE.CylinderGeometry(.37,.37,.23,12),black);wheel.rotation.z=Math.PI/2;wheel.position.set(x,.4,z);wheel.castShadow=true;g.add(wheel);
  const hub=new THREE.Mesh(new THREE.CylinderGeometry(.17,.17,.24,10),silver);hub.rotation.z=Math.PI/2;hub.position.copy(wheel.position);g.add(hub);
 }
 box(.15,.13,.3,paint,-1.04,1.24,-.59);box(.15,.13,.3,paint,1.04,1.24,-.59);
 return g;
}
async function createTrees(trees=data.trees){
 // Every drawn tree gets a solid trunk (src/tree-trunks.js); register points on a traffic lane's carriageway are dropped.
 if(treeTrunks){const t=treeTrunks.build(trees,world);trees=t.draw;world.objects.add(t.obstacles);}
 // Cities other than Helsinki: every registered tree gets its species' shape (src/tree-species.js).
 if(city.scenery!=='helsinki'){speciesTrees=createSpeciesTrees(trees.filter(t=>!world.buildings.at(...t.p)));cityModel.add(speciesTrees.group);speciesTrees.update(focus);return;}
 const {createRouteTrees,detailedTreeArea,detailedTreeCell}=await import('./route-trees.js');
 const detailed=createRouteTrees(trees.filter(t=>detailedTreeArea(t)&&!world.buildings.at(...t.p)));cityModel.add(detailed);harbour.group.userData.detailedTrees=detailed.userData;
 // Detailed trees get blob proxies in cells matching createRouteTrees' buckets (detailedTreeCell); applyTreeLod swaps them by distance.
 const chunks=new Map();for(const t of trees){if(world.buildings.at(...t.p))continue;const key=detailedTreeArea(t)?detailedTreeCell(...t.p):`${Math.floor(t.p[0]/250)},${Math.floor(t.p[1]/250)}`;if(!chunks.has(key))chunks.set(key,[]);chunks.get(key).push(t);}
 const trunkGeometry=new THREE.CylinderGeometry(.21,.32,3.2,7);if(!leafGeometries.length)leafGeometries.push(new THREE.IcosahedronGeometry(1,0),new THREE.IcosahedronGeometry(1,1),new THREE.IcosahedronGeometry(1,2));const leafGeometry=leafGeometries[2];
 const trunkMaterial=new THREE.MeshStandardMaterial({color:'#817f68'}),leafMaterial=new THREE.MeshStandardMaterial({roughness:1,alphaHash:true});
 leafMaterial.onBeforeCompile=shader=>{shader.uniforms.playerPosition=treeFocus;shader.uniforms.treeFade=treeFade;shader.vertexShader='varying vec3 vTree;\n'+shader.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\nvTree=(modelMatrix*instanceMatrix*vec4(position,1.0)).xyz;');shader.fragmentShader='uniform float treeFade;uniform vec2 playerPosition;varying vec3 vTree;\n'+shader.fragmentShader.replace('#include <alphahash_fragment>','diffuseColor.a*=mix(1.0,mix(0.18,1.0,smoothstep(5.0,10.0,distance(vTree.xz,playerPosition))),treeFade);\n#include <alphahash_fragment>');};
 const colours=['#748d5c','#859d66','#93a871','#9caa72','#6f8c62'];
 for(const [key,trees] of chunks){
 const trunk=new THREE.InstancedMesh(trunkGeometry,trunkMaterial,trees.length);
 const isHarbourTree=t=>t.p[1]>690&&t.p[1]<995&&Math.abs(t.p[0]-(220-Math.max(0,940-t.p[1])*.72))<35;
 const leaf=new THREE.InstancedMesh(leafGeometry,leafMaterial,trees.reduce((n,t)=>n+(isHarbourTree(t)?7:1),0));let leafIndex=0;
 trees.forEach((t,i)=>{
   const x=t.p[0],z=t.p[1];const r=/50|70|90/.test(t.size)?3.6:/10|20/.test(t.size)?2.15:2.9;
   const hero=isHarbourTree(t);
   // Register trees carry a real height (and conifer flag): size the trunk and crown to it.
   if(t.height&&!hero){const h=t.height,k=Math.min(3.4,Math.max(.3,h/8.5));
    tmp.position.set(x,1.6*k,z);tmp.scale.set(Math.sqrt(k),k,Math.sqrt(k));tmp.rotation.set(0,0,0);tmp.updateMatrix();trunk.setMatrixAt(i,tmp.matrix);
    if(t.conifer){tmp.position.set(x,h*.56,z);tmp.scale.set(h*.17,h*.44,h*.17);}else{const crown=Math.max(1.3,h*.3);tmp.position.set(x,h-crown*.95,z);tmp.scale.set(crown,crown*1.12,crown);}
    tmp.rotation.set(0,i*2.4,0);tmp.updateMatrix();leaf.setMatrixAt(leafIndex,tmp.matrix);leaf.setColorAt(leafIndex++,new THREE.Color(t.conifer?['#34503a','#3d5c41','#2f4a35'][i%3]:colours[i%colours.length]));return;}
   tmp.position.set(x,hero?2.9:1.6,z);tmp.scale.set(hero?1.7:1,hero?1.8:1,hero?1.7:1);tmp.rotation.set(0,0,0);tmp.updateMatrix();trunk.setMatrixAt(i,tmp.matrix);
   for(let j=0;j<(hero?7:1);j++){
    const angle=j*2.399+i*.7,spread=hero&&j?2.4:0,size=hero?(j?2.35:3.25):r;
    tmp.position.set(x+Math.sin(angle)*spread,hero?(j?7.4+(j%3)*1.05:8.5):4.6+r*.3,z+Math.cos(angle)*spread);tmp.scale.set(size,size*(hero?1:1.15),size);tmp.rotation.set(0,i*2.4+j,0);tmp.updateMatrix();leaf.setMatrixAt(leafIndex,tmp.matrix);leaf.setColorAt(leafIndex++,new THREE.Color(hero?['#49663b','#567243','#607c47','#4e6e3b'][j%4]:colours[i%colours.length]));
   }
 });
 trunk.castShadow=true;leaf.castShadow=true;leaf.receiveShadow=true;cityModel.add(trunk,leaf);
 const box=new THREE.Box3();for(const t of trees)box.expandByPoint(new THREE.Vector3(t.p[0],0,t.p[1]));box.max.y=14;box.expandByScalar(6);trunk.userData.shadowLod=leaf.userData.shadowLod=true;treeChunks.push({key,trunk,leaf,box,detailed:key[0]==='d'?{near:[],far:[]}:null});
 }
 const cells=new Map(treeChunks.map(c=>[c.key,c]));
 for(const mesh of detailed.children){mesh.userData.shadowLod=true;cells.get(mesh.userData.cell)?.detailed[mesh.userData.lod==='far'?'far':'near'].push(mesh);}
}
function createFallbackBuildings(buildings=data.buildings){
 const geoms=[];
 const models=roofIndex.tiles.flatMap(t=>t.parts),ratus=new Set(models.filter(m=>m.ratu>0).map(m=>String(m.ratu))),index=new SpatialIndex(models);
 for(const b of buildings){
  const bb=b.bbox,cx=(bb[0]+bb[2])/2,cz=(bb[1]+bb[3])/2;
  if(ratus.has(String(b.ratu))||index.near(cx,cz).some(m=>{const a=m.bbox;return Math.max(0,Math.min(a[2],bb[2])-Math.max(a[0],bb[0]))*Math.max(0,Math.min(a[3],bb[3])-Math.max(a[1],bb[1]))/Math.max(1,(bb[2]-bb[0])*(bb[3]-bb[1]))>.5;}))continue;
  const shape=new THREE.Shape(b.rings[0].map(p=>new THREE.Vector2(p[0],-p[1])));
  for(const r of b.rings.slice(1))shape.holes.push(new THREE.Path(r.map(p=>new THREE.Vector2(p[0],-p[1]))));
  const small=(b.bbox[2]-b.bbox[0])*(b.bbox[3]-b.bbox[1])<90;const h=small?3.5:15;
  const g=new THREE.ExtrudeGeometry(shape,{depth:h,bevelEnabled:false,steps:1});g.rotateX(-Math.PI/2);g.translate(0,.1+footprintBase(b.rings),0);g.deleteAttribute('uv');geoms.push(g);
 }
 if(geoms.length){const mesh=new THREE.Mesh(mergeGeometries(geoms),new THREE.MeshStandardMaterial({color:'#c5c4b8',roughness:1}));mesh.castShadow=true;mesh.receiveShadow=true;cityModel.add(mesh);geoms.forEach(g=>g.dispose());}
}
function loadRoof(t,at=focus){
 if(ready&&tileDistance(t,at)>650||loadedTiles.has(t.file))return Promise.resolve();
 if(loadingTiles.has(t.file))return loadingTiles.get(t.file);
 const pending=buildRoof(t,at).finally(()=>loadingTiles.delete(t.file));loadingTiles.set(t.file,pending);return pending;
}
async function buildRoof(t,at){
 const group=new THREE.Group(),textures=new Map();let images;
 try{
  // Atlases decode off the main thread (createImageBitmap); the worker decodes its own copy for pixel sampling.
  const sources=await Promise.allSettled([unpack(dataUrl(`${t.file}`)).then(b=>new Float32Array(b)),loadTileImages([...new Set(t.parts.map(p=>p.texture).filter(Boolean))],f=>dataUrl(`${f}`))]);
  if(sources[1].status==='fulfilled')images=sources[1].value;const failed=sources.find(s=>s.status==='rejected');if(failed)throw failed.reason;const a=sources[0].value;
  for(const [file,{bitmap}] of images){const texture=new THREE.Texture(bitmap);texture.flipY=false;texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());texture.needsUpdate=true;textures.set(file,texture);}
  const cathedral=t.parts.find(p=>p.ratu===211);if(cathedral&&!cathedralModel){cathedralModel=createCathedral(a,cathedral);cityModel.add(cathedralModel);}
  applyFacadeHeights(a,t.parts);liftBuildings(a,t.parts); // terrain cities: each part stands on its lowest ground
  const parts=t.parts.filter(p=>![211,212,213,1796,57950,STATION_KIOSK_RATU,USPENSKI.ratu].includes(p.ratu)&&!placeHidden.has(p.id)); // place landmarks and shelters are drawn by place-scene.js
  // Far level: one merged shell per atlas. Near level: per-part shells until the worker's details replace them.
  group.add(...createMergedShells(a,parts,textures));for(const part of parts)group.add(createSourceShell(a,part,textures.get(part.texture)));
  Object.assign(group.userData,{textures,windows:0,tile:t,pending:{array:a,parts,images:new Map([...images].map(([f,i])=>[f,i.bytes]))}});
  freezeTileGroup(group);applyTileLod(group,tileLevel(null,tileDistance(t,at)),at);loadedTiles.set(t.file,group);
  // One atlas upload per frame, then the tile itself: twenty tiles landing after a teleport no longer upload in one frame.
  for(const texture of textures.values())uploads.push(()=>{if(loadedTiles.get(t.file)===group)renderer.initTexture(texture);});
  uploads.push(()=>{if(loadedTiles.get(t.file)===group)cityModel.add(group);});
 }catch(error){
  if(loadedTiles.get(t.file)===group)loadedTiles.delete(t.file);
  cityModel.remove(group);group.children.forEach(m=>{m.geometry.dispose();m.material.dispose();});textures.forEach(t=>t.dispose());images?.forEach(({bitmap})=>bitmap.close());
  throw new Error(`Building tile ${t.file}: ${error.message||error}`);
 }
}
// Worker-detailed buildings land a couple per frame, each replacing its interim shell, so a tile never freezes a frame.
async function detailTile(group){
 // Two overlapping tile passes can both queue the same tile; only the first gets the work.
 const {tile:t,pending,textures}=group.userData;if(!pending)return;group.userData.pending=null;
 const buildings=await buildTileInWorker(pending.array,pending.parts,pending.images);
 if(loadedTiles.get(t.file)!==group)return;
 for(const b of buildings)uploads.push(()=>{
  if(loadedTiles.get(t.file)!==group)return;
  const shell=group.children.find(m=>m.userData.source&&m.userData.id===b.part.id);if(shell){group.remove(shell);shell.geometry.dispose();shell.material.dispose();}
  const meshes=materialiseBuilding(b,textures);for(const m of meshes)freezeMesh(m);group.add(...meshes);group.userData.windows+=b.windows;
  applyTileLod(group,group.userData.level,focus);
 });
}
async function loadPhoto(t){
 if(photoTiles.has(t.file))return;
 if(photoPromises.has(t.file))return photoPromises.get(t.file);
 const promise=(async()=>{
   const texture=await new THREE.TextureLoader().loadAsync(dataUrl(`${t.file}`));texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
   const m=new THREE.Mesh(new THREE.PlaneGeometry(t.size,t.size),new THREE.MeshBasicMaterial({map:texture,toneMapped:false}));m.rotation.x=-Math.PI/2;m.position.set(t.x+t.size/2,.095,t.z+t.size/2);aerialGroup.add(m);photoTiles.set(t.file,m);
 })();photoPromises.set(t.file,promise);try{await promise;}finally{photoPromises.delete(t.file);}
}
async function updatePhotos(){
 if(!aerialIndex)return;
 const range=Math.max(260,viewSpan*Math.max(1,captureFrame.w/captureFrame.h)*.55+120);
 const dist=t=>Math.hypot(Math.max(t.x-focus.x,0,focus.x-t.x-t.size),Math.max(t.z-focus.z,0,focus.z-t.z-t.size));
 await pool(aerialIndex.tiles.filter(t=>dist(t)<range).sort((a,b)=>dist(a)-dist(b)),4,loadPhoto);
 for(const t of aerialIndex.tiles){const m=photoTiles.get(t.file);if(m&&dist(t)>range+650){aerialGroup.remove(m);m.geometry.dispose();m.material.map.dispose();m.material.dispose();photoTiles.delete(t.file);}}
}
function initSurfaceStreamer(){
 surfaceStreamer??=createSurfaceStreamer({concurrency:3,onError:handleTileError,load:async (t,{signal}={})=>{
  const g=drapeGeometry(removeLegacyWater(await geometry(dataUrl(t.file))),{maxEdge:4,mark:true});
  if(signal?.aborted||gameIsStopped()){g.dispose();return;}
  const m=new THREE.Mesh(g,surfaceMaterial);m.receiveShadow=true;cityModel.add(m);
 }});
 surfaceStreamer.add(surfaceIndex);
}
async function ensureCityModel(){
 // Fog ends at 850 m. Load all ground surfaces that can be seen from this start,
 // then keep the same detail streaming ahead as the player travels.
 if(!cityModelPromise)cityModelPromise=(async()=>{
  initSurfaceStreamer();await surfaceStreamer.ensure(car,{radius:900});
  await createTrees();createFallbackBuildings();
 })();
 return cityModelPromise;
}
function rebuildSea(groundExtent){
 const next=createSea(data.water,data,{helsinkiHarbour:city.scenery==='helsinki',groundExtent}),old=sea;
 sea=next;cityModel.add(next.group);ground.geometry.dispose();ground.geometry=next.groundGeometry;
 if(!old)return;
 cityModel.remove(old.group);
 const materials=new Set(),textures=new Set();
 old.group.traverse(o=>{o.geometry?.dispose();for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[])materials.add(m);});
 materials.add(old.material);
 for(const material of materials){
  for(const value of Object.values(material))if(value?.isTexture)textures.add(value);
  for(const uniform of Object.values(material.uniforms||{}))if(uniform.value?.isTexture)textures.add(uniform.value);
  material.dispose();
 }
 for(const texture of textures)texture.dispose();
}
function updateDataCounts(){
 const fmt=n=>Number.isFinite(n)?Math.max(0,Math.trunc(n)).toLocaleString('en'):'0';
 $('data-counts').innerHTML=`<div><strong>${fmt(data.buildings.length)}</strong>loaded footprints</div><div><strong>${fmt(roofIndex.buildings)}</strong>${city.scenery==='helsinki'?'loaded 3D buildings':'modeled buildings'}</div><div><strong>${fmt(data.trees.filter(t=>!t.inferred).length)}</strong>loaded registered trees</div>`;
}
async function visitStart(destination,button){
 if(switchingStart||!ready)return;
 switchingStart=true;const version=++startVisitVersion;mobileControls.release();keys.clear();
 const label=button.textContent,buttons=[...$('landmark-buttons').querySelectorAll('button')];
 for(const b of buttons)b.disabled=true;
 button.textContent=`Loading ${destination.name}…`;button.setAttribute('aria-busy','true');
 try{
  await extensionStreamer.ensureStart(destination);
  const near=roofIndex.tiles.filter(t=>tileDistance(t,destination)<430).sort((a,b)=>tileDistance(a,destination)-tileDistance(b,destination));
  await Promise.all([surfaceStreamer.ensure(destination,{radius:900}),pool(near,4,t=>loadRoof(t,destination))]);
  // GPU uploads are spread across frames, including while this dialog is open.
  while(uploads.size){if(gameIsStopped())throw Error('The game stopped while loading this place');await new Promise(requestAnimationFrame);}
  if(version!==startVisitVersion||!$('map-dialog').open)return; // Closing the map cancels the jump, while its downloads remain useful.
  closeDialogs();setStart(destination);history.replaceState(null,'',startUrl(location,city,destination));
  if(!started)start();else toast(`Starting at ${destination.name}.`);
 }catch(error){console.error(error);toast(`Could not load ${destination.name}. Choose it again to retry.`,{important:true});}
 finally{switchingStart=false;button.textContent=label;button.removeAttribute('aria-busy');for(const b of buttons)b.disabled=false;}
}
function tileDistance(t,at=focus){const b=t.bbox;return Math.hypot(Math.max(b[0]-at.x,0,at.x-b[2]),Math.max(b[1]-at.z,0,at.z-b[3]));}
// One tile pass at a time. A call while one runs (e.g. stepping through starts) asks for one more pass after it.
let tilePass=null,tilePassAgain=false;
function updateTiles(){
 if(tilePass){tilePassAgain=true;return tilePass;}
 tilePass=(async()=>{try{do{tilePassAgain=false;await runTilePass();}while(tilePassAgain);}finally{tilePass=null;}})();
 return tilePass;
}
async function runTilePass(){
 if(!roofIndex)return;
 // Tiles where the car is heading load as early as tiles where it is.
 const range=430,ahead=aheadPoint(car),priority=t=>tilePriority(t,focus,ahead);
 const near=roofIndex.tiles.filter(t=>priority(t)<range).sort((a,b)=>priority(a)-priority(b));
 await pool(near,4,loadRoof);
 for(const t of roofIndex.tiles){const m=loadedTiles.get(t.file);if(!m)continue;
  const d=tileDistance(t);
  if(d>1000){detailScheduler.cancel(t.file);cityModel.remove(m);m.children.forEach(c=>{c.geometry.dispose();c.material.dispose();});m.userData.textures.forEach(x=>{x.image?.close?.();x.dispose();});loadedTiles.delete(t.file);continue;}
  const level=applyTileLod(m,tileLevel(m.userData.level,d),focus);
  // Only near-level tiles are worth the worker's time, nearest first.
  if(level==='near'&&m.userData.pending)detailScheduler.request(t.file,priority(t),()=>detailTile(m),handleTileError);
  else if(level!=='near')detailScheduler.cancel(t.file);
 }
 applyTreeLod(treeChunks,focus,leafGeometries);speciesTrees?.update(focus);shadowCuller.update(focus);
 harbour?.group.userData.terminalDetails?.fleetLod?.(focus); // parked fleet: box level beyond 150 m, hidden past the fog
}
function drawMapBase(){
 const ctx=mapCache.getContext('2d'),s=mapCache.width/mapView.size;
 ctx.fillStyle='#d9dccc';ctx.fillRect(0,0,mapCache.width,mapCache.height);
 ctx.save();ctx.translate(mapCache.width/2-mapView.cx*s,mapCache.height/2-mapView.cz*s);ctx.scale(s,s);
 const fill=(items,color)=>{ctx.fillStyle=color;for(const b of items){ctx.beginPath();for(const r of b.rings){r.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();}ctx.fill('evenodd');}};
 fill(data.water,'#b3ced0');drawLakeMap(ctx,'#b3ced0');fill(data.parks.filter(p=>/Nurm|Mets|Pensas|Niit/.test(p.kind)),'#b5c69f');fill(data.pavement,'#edeade');fill(data.roads,'#f4f2e9');fill(data.buildings,'#a4aca1');
 ctx.beginPath();ctx.arc(0,0,RADIUS,0,Math.PI*2);ctx.strokeStyle='#d95e3b';ctx.lineWidth=5;ctx.setLineDash([18,20]);ctx.stroke();
 // Extension outlines: the drivable corridor beyond the circle.
 for(const multi of mapView.playable)for(const poly of multi){ctx.beginPath();poly[0].forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.closePath();ctx.stroke();}
 ctx.setLineDash([]);
 ctx.restore();
}
function mapCar(ctx,x,z,heading,scale=1){ctx.save();ctx.translate(x,z);ctx.rotate(-heading);ctx.fillStyle='#dc5b36';ctx.strokeStyle='#fff9ee';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,-8*scale);ctx.lineTo(5*scale,6*scale);ctx.lineTo(0,3*scale);ctx.lineTo(-5*scale,6*scale);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();}
function mapPolice(ctx,project,scale){
 const state=police?.snapshot();if(!state)return;
 const searching=state.status==='SEARCHING';
 if(searching&&state.lastSeen){const [x,y]=project(state.lastSeen);ctx.save();ctx.strokeStyle='#387dc6';ctx.lineWidth=2;ctx.setLineDash([5,5]);ctx.beginPath();ctx.arc(x,y,45*scale,0,Math.PI*2);ctx.stroke();ctx.restore();}
 for(const unit of state.units){const [x,y]=project(unit);ctx.save();ctx.translate(x,y);ctx.rotate(-unit.heading);
  if(searching){ctx.fillStyle='#4188ca33';ctx.beginPath();ctx.moveTo(0,0);ctx.arc(0,0,Math.min(145*scale,65),-Math.PI/2-Math.PI/3,-Math.PI/2+Math.PI/3);ctx.closePath();ctx.fill();}
  ctx.shadowColor='#102b45';ctx.shadowBlur=3;ctx.fillStyle=Math.floor(performance.now()/450)%2?'#207be1':'#dc4644';ctx.strokeStyle='white';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,-9);ctx.lineTo(7,6);ctx.lineTo(-7,6);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();
 }
 ctx.canvas.dataset.policeMarkers=String(state.units.length);
 ctx.canvas.setAttribute('aria-label',`City map${state.level?` — ${state.units.length} police units, ${state.status.toLowerCase()}`:''}`);
}
function drawMinimap(){if(!car)return;const canvas=$('minimap'),ctx=canvas.getContext('2d');const span=police?.level?420:1250,s=mapCache.width/mapView.size;const cx=mapCache.width/2+(car.x-mapView.cx)*s,cz=mapCache.height/2+(car.z-mapView.cz)*s;const sw=span*s,sh=sw*canvas.height/canvas.width;ctx.fillStyle='#b3ced0';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(mapCache,cx-sw/2,cz-sh/2,sw,sh,0,0,canvas.width,canvas.height);mapPolice(ctx,p=>[canvas.width/2+(p.x-car.x)*canvas.width/span,canvas.height/2+(p.z-car.z)*canvas.width/span],canvas.width/span);if(cph){const P=p=>[canvas.width/2+(p[0]-car.x)*canvas.width/span,canvas.height/2+(p[1]-car.z)*canvas.width/span],r=cph.route?.();ctx.save();
  if(r?.length>1){ctx.strokeStyle='#7b3fe4';ctx.lineWidth=5;ctx.lineJoin=ctx.lineCap='round';ctx.beginPath();r.forEach((p,i)=>{const [x,y]=P(Array.isArray(p)?p:[p.x,p.z]);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();}
  for(const t of cph.minimapTargets()){let [x,y]=P(t.p);const m=12,cx=canvas.width/2,cy=canvas.height/2,dx=x-cx,dy=y-cy,k=Math.min(1,(cx-m)/Math.max(1e-6,Math.abs(dx)),(cy-m)/Math.max(1e-6,Math.abs(dy)));x=cx+dx*k;y=cy+dy*k;
   ctx.fillStyle=t.color;ctx.strokeStyle='#fff';ctx.lineWidth=2.5;ctx.beginPath();ctx.arc(x,y,k<1?6:8,0,Math.PI*2);ctx.fill();ctx.stroke();}
  ctx.restore();}
 mapCar(ctx,canvas.width/2,canvas.height/2,car.heading,1.25);ctx.fillStyle='#34483d';ctx.font='18px sans-serif';ctx.fillText('N',canvas.width-26,25);}
function drawCityMap(){const canvas=$('city-map'),ctx=canvas.getContext('2d');const side=canvas.height;ctx.fillStyle='#b3ced0';ctx.fillRect(0,0,canvas.width,canvas.height);const offset=(canvas.width-side)/2;ctx.drawImage(mapCache,offset,0,side,side);const s=side/mapView.size,mx=x=>canvas.width/2+(x-mapView.cx)*s,mz=z=>canvas.height/2+(z-mapView.cz)*s;for(const [i,l] of data.landmarks.entries()){const x=mx(l.x),z=mz(l.z);ctx.fillStyle='#f8f5eb';ctx.strokeStyle='#758670';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(x,z,11,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle='#34483d';ctx.font='600 11px sans-serif';ctx.textAlign='center';ctx.fillText(String(i+1),x,z+4);}mapPolice(ctx,p=>[mx(p.x),mz(p.z)],s);mapCar(ctx,mx(car.x),mz(car.z),car.heading,1.35);}
// Tram sections and bus bodies: cars never drive or spawn into them (mobility.js).
const transitBodies=()=>[...(tramSim?.bodies||[]),...(buses?.bodies||[]),...(travel?.parkedBodies()||[])];
const travelObstacles=()=>[...(mobility?.cars.filter(c=>c.edge)||[]),...(tramSim?.bodies||[]),...(buses?.bodies||[]),...(police?.obstacles||[])];
function interactTravel(id=null){
 if(!ready||!started||paused||mapOpen||police?.busted)return;
 // Wanted players may still get out and run: the pursuit follows travel.actor, and units arrest a stopped player on foot too.
 const result=travel.interact(id,travelObstacles());
 if(result.ok){peopleInteraction?.close();cameraTransition={elapsed:0,position:camera.position.clone(),target:camera.position.clone().addScaledVector(camera.getWorldDirection(new THREE.Vector3()),6)};car=travel.actor;playerCars.sync(travel);driveCamera.shake=0;driveCamera.lastSpeed=0;updateHUD(performance.now());}
 if(!result.ok)toast(result.message);$('world').focus();
}
const nearbyPeople=()=>[...(mobility?.people||[]),...detailPeople,...(marketShopRenderer?.vendors||[])];
const canTalk=()=>ready&&started&&!paused&&!mapOpen&&!captureMode&&!police?.busted&&travel?.mode==='walk';
function talkToPerson(){
 if(!canTalk()||gullEncounter.snapshot().phase==='chase')return;
 const result=peopleInteraction.interact(car,nearbyPeople(),{enabled:true});
 if(result.ok&&!result.closed){marketShop?.close();refreshMarketUI();}
}
function replyToPerson(id){
 if(!canTalk())return;
 const result=peopleInteraction.choose(id);
 if(result?.action?.type==='shop'){
  const opened=marketShop?.openStall(result.action.stallId,car);
  if(opened?.message)marketUI.say(opened.message);
  refreshMarketUI();
 }
}
// Market stalls: E (or the prompt button) opens the nearby stall's card, eats what is in hand, or closes the card; 1–5 buy.
function refreshMarketUI(){marketUI.update(marketShop?.snapshot(),{hidden:!canTalk()||!!peopleInteraction?.session,encounter:gullEncounter.snapshot()});}
function heldFoodTarget(){const hand=travelRenderer.hand();return hand?{x:hand.x,y:hand.y-groundAt(hand.x,hand.z),z:hand.z}:undefined;}
function applyGullDrop(event){if(event?.drop)marketShop?.drop({hand:event.hand});}
function announceGulls(){for(const message of gullEncounter.drainMessages())marketUI.say(message,{seconds:4});}
// Once per snack: a gull that walks right up gets a mention.
function noticeGulls(){const h=marketShop?.hand;if(!h||h.item.encounter==='gulls'||h.gull||!marketShop.lure()||!birds)return;if(birds.life.birds.some(b=>b.lured&&b.state==='ground'&&Math.hypot(b.x-car.x,b.z-car.z)<3.6)){h.gull=true;marketUI.say(`A gull has its eye on your ${h.item.name.toLowerCase()}.`);}}
function marketAction(){
 if(!canTalk()||!marketShop)return;
 if(gullEncounter.snapshot().phase==='chase'&&marketShop.hand?.item.encounter==='gulls'){
  applyGullDrop(gullEncounter.drop(car,marketShop.hand,heldFoodTarget()));announceGulls();refreshMarketUI();return;
 }
 const r=marketShop.action(car,{enabled:true});if(r.opened)peopleInteraction?.close();if(r.message)marketUI.say(r.message);refreshMarketUI();
}
function buyAtStall(id){if(!canTalk()||!marketShop?.open)return;const r=marketShop.buy(id);if(r.message)marketUI.say(r.message);refreshMarketUI();}
// Welcome-card picker: load the picked start the way the map dialog does, then move the preview there.
// Only the latest pick applies; earlier downloads stay useful as cache.
async function previewStart(destination){
 if(!ready||started||switchingStart)return;
 const version=++previewVersion;previewing=true;startPicker.busy(true);
 try{
  await extensionStreamer.ensureStart(destination);
  const near=roofIndex.tiles.filter(t=>tileDistance(t,destination)<430).sort((a,b)=>tileDistance(a,destination)-tileDistance(b,destination));
  await Promise.all([surfaceStreamer.ensure(destination,{radius:900}),pool(near,4,t=>loadRoof(t,destination))]);
  if(version!==previewVersion||started)return;
  setStart(destination);history.replaceState(null,'',startUrl(location,city,destination));
 }catch(error){
  console.error(error);if(version!==previewVersion)return;
  startPicker.set(startPoint);toast(`Could not load ${destination.name}. Try it again.`,{important:true});
 }finally{
  if(version===previewVersion){previewing=false;startPicker.busy(false);if(startAfterPreview){startAfterPreview=false;start();}}
 }
}
// Copenhagen: the same spot in the other century (today ↔ 1760). The next load starts where the car is.
function eraJump(){
 const to=city.id==='copenhagen'?'copenhagen-1760':'copenhagen';if(!CITIES[to]||!car)return;
 try{sessionStorage.setItem('era-jump',JSON.stringify({to,x:car.x,z:car.z,heading:car.heading}));}catch{}
 showEraCard(to==='copenhagen'?'today':'1760');
 const u=new URL(location.href);u.searchParams.set('city',to);u.searchParams.delete('start');setTimeout(()=>{location.href=u.href;},900);
}
function showEraCard(era,hold=false){
 let el=document.getElementById('era-card');if(!el){el=document.createElement('div');el.id='era-card';document.body.append(el);}
 el.innerHTML=era==='1760'?'<p>Travelling back to</p><h2>Copenhagen, 1760</h2><p>Frederik V is king. The city ends at the ramparts. Mind the horses.</p>':'<p>Back to</p><h2>Copenhagen, today</h2><p>Bikes, harbour baths and rød pølse.</p>';
 el.className='show';if(!hold)return;setTimeout(()=>{el.className='';},3200);
}
function setStart(l){mobileControls?.release();peopleInteraction?.reset(world);marketShop?.reset();gullEncounter.reset();birds?.clearEncounter();cameraTransition=null;impacts.reset();crowd?.reset();finale.reset();startPoint=l;car=makeCar(l.x,l.z,l.heading??(l.name==='Senate Square'?0:-Math.PI/2+.17));car.distance=distance;if(travel)travel.reset(car,world);else travel=new PlayerTravel(car,world,{cars:()=>[...staticCars,...trafficCars],rides:()=>[...(knockables?.rideSources||[]),...(cyclists?.rideSources||[]),...(npcScooters?.rideSources||[])],obstacles:travelObstacles});peopleInteraction??=new PeopleInteraction(world,{context:()=>({cityName:city.name,landmarks:data?.landmarks||[]}),voiceEnabled:sound});playerCars.sync(travel);focus.set(car.x,0,car.z);cameraHeading=car.heading;tramSim?.reset(car);buses?.reset(car,tramSim?.obstacles);if(mobility){mobility.externalBodies=transitBodies();mobility.reset(car);}npcScooters?.reset(car);roadblock?.reset();police?.reset();marketLife?.reset();universityLife?.reset();terminalLife?.reset();$('district-label').textContent=l.district.toUpperCase();carGroup.position.set(car.x,.1+groundAt(car.x,car.z),car.z);carGroup.rotation.y=car.heading;if(ready)updateTiles().catch(handleTileError);drawMinimap();}
function handleTileError(e){console.error(e);if(!document.body.classList.contains('booting'))toast('Some scenery could not load. Nearby streets will retry.');} // not over the welcome card
const touchScreen=matchMedia('(pointer:coarse)').matches; // phones and tablets: no keyboard, so the HUD and touch buttons stay on
if(touchScreen){document.body.classList.remove('clean-capture');document.body.classList.add('touch');}
function start(){if(!ready)return;if(previewing){startAfterPreview=true;return;}started=true;paused=false;document.body.classList.add('driving');loadingScreen.enter();carGroup.visible=true;marker.visible=false;toast(touchScreen?'Slide to steer · Hold Go to move · Menu for the map and settings':'WASD or arrow keys to drive · Space to handbrake');$('world').focus();}
function focusWorldControls(){if(started&&!paused&&!mapOpen&&!police?.busted&&!gameIsStopped())$('world').focus({preventScroll:true});}
function showDialog(id){if(!ready||police?.busted)return;peopleInteraction?.close();mobileControls?.release();keys.clear();$(id).showModal();mapOpen=true;if(id==='map-dialog')drawCityMap();}
function closeDialogs(){if($('map-dialog').open)startVisitVersion++;document.querySelectorAll('dialog[open]').forEach(d=>d.close());mapOpen=!!document.querySelector('dialog[open]');mobileControls?.release();keys.clear();focusWorldControls();}
function setPaused(value){if(value)peopleInteraction?.close();if(!started||mapOpen||police?.busted)return;paused=value;mobileControls?.release();keys.clear();$('pause-overlay').hidden=!paused;if(!paused)focusWorldControls();}
function setBusted(active){
 // The arrest starts with a short cinematic (finale.cameraPose); the end screen appears when finale.cinematicStep says so.
 if(!active)$('busted-overlay').hidden=true;document.body.classList.toggle('busted',active);mobileControls?.release();keys.clear();
 for(const el of document.querySelectorAll('.topbar,.dashboard,.right-tools,#touch-controls,#touch-aux,#travel-controls'))el.inert=active;
 if(active){gullEncounter.reset();birds?.clearEncounter();paused=false;$('pause-overlay').hidden=true;roadblock?.startArrest(car);finale.arrest({car,police,knockables});}else{roadblock?.clearArrest();$('busted-overlay').classList.remove('live');finale.dismiss();$('world').focus();}
}
function reset(){if(!ready)return;setBusted(false);setStart(startPoint);toast('Back on the road.');}
// BUSTED screen: Continue (Enter/Esc) respawns on the spot — wanted cleared, car repaired, police gone and
// any tram boxing the car in removed; Restart (R) is a clean restart at the chosen starting point.
function repairCar(){if(!car)return;car.flat=0;car.damage=0;car.damageZones={front:0,rear:0,left:0,right:0};car.damageVersion=(car.damageVersion||0)+1;impacts.reset();}
function restart(){if(!ready)return;setBusted(false);knockables?.resetAll();distance=0;setStart(startPoint);toast(`Back on the road at ${startPoint.name}.`);}
function continueDriving(){if(!ready)return;roadblock?.standDown();police?.reset();finale.resume();repairCar();tramSim?.clearAround(car);setBusted(false);toast('Back on the road — wanted level cleared.');}
$('busted-restart').addEventListener('click',restart);$('busted-continue').addEventListener('click',continueDriving);
function zoom(delta){desiredSpan=THREE.MathUtils.clamp(desiredSpan+delta*.35,36,240);}
$('start-btn').addEventListener('click',start);$('map-btn').addEventListener('click',()=>showDialog('map-dialog'));$('minimap-btn').addEventListener('click',()=>showDialog('map-dialog'));$('help-btn').addEventListener('click',()=>showDialog('help-dialog'));$('sources-btn').addEventListener('click',()=>showDialog('sources-dialog'));$('zoom-in').addEventListener('click',()=>zoom(-40));$('zoom-out').addEventListener('click',()=>zoom(40));$('resume-btn').addEventListener('click',()=>setPaused(false));
$('view-label').textContent='Drive';$('view-btn').title='C: cycle Drive, Follow and High cameras · Hold Q/E to look left/right';
function cycleCamera(){if(chaseCamera){chaseCamera=false;highCamera=false;}else if(!highCamera)highCamera=true;else {chaseCamera=true;highCamera=false;}$('view-label').textContent=chaseCamera?'Drive':highCamera?'High':'Follow';}
$('view-btn').addEventListener('click',cycleCamera);
document.querySelectorAll('.close-btn,.dialog-drive').forEach(b=>b.addEventListener('click',closeDialogs));
for(const dialog of document.querySelectorAll('dialog')){
 let backdropPointer=null;
 const outside=e=>{const r=dialog.getBoundingClientRect();return e.target===dialog&&(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom);};
 dialog.addEventListener('pointerdown',e=>{backdropPointer=outside(e)?e.pointerId:null;});
 dialog.addEventListener('pointercancel',()=>{backdropPointer=null;});
 dialog.addEventListener('click',e=>{
  const dismiss=backdropPointer!==null&&(e.pointerId===undefined||e.pointerId===backdropPointer)&&outside(e);
  backdropPointer=null;if(dismiss)dialog.close();
 });
 dialog.addEventListener('close',()=>{
  backdropPointer=null;if(dialog.id==='map-dialog')startVisitVersion++;
  mapOpen=!!document.querySelector('dialog[open]');mobileControls?.release();keys.clear();
  focusWorldControls();
 });
}
window.addEventListener('keydown',e=>{
 const pick=startPicker&&pickerStep(e.code,{ready:ready&&!gameIsStopped(),started,blocked:mapOpen||!!police?.busted});
 if(pick){e.preventDefault();if(!e.repeat)startPicker.step(pick);return;} // before the start ←/→ choose the place; afterwards they steer
 if(e.code!=='Escape'&&e.target.closest?.('button,a,summary,input,select,textarea,[contenteditable="true"]'))return;
 if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)&&!mapOpen)e.preventDefault();
 if(e.repeat)return;
 if(police?.busted){if(finale.ended&&e.code==='Tab')return;e.preventDefault();if(!finale.ended)return;if(e.code==='Enter'||e.code==='Escape')continueDriving();else if(e.code==='KeyR')restart();return;} // BUSTED screen: Enter/Esc continue, R restarts; Tab moves between its two buttons (the HUD is inert)
 if(!started){if(!ready)return;if(e.code==='Enter'){e.preventDefault();start();return;}if(!['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))return;}
 if(e.code==='Escape'&&cph?.blocking?.()&&cph.key(e.code)){e.preventDefault();return;}
 if(e.code==='Escape'){if(marketShop?.close()){refreshMarketUI();return;}if(peopleInteraction?.close())return;if(!mapOpen)setPaused(!paused);return;}
 if(mapOpen)return;
 if(cph&&started&&cph.key(e.code)){e.preventDefault();return;}
 if(e.code==='KeyY'&&started&&city?.id?.startsWith('copenhagen')){e.preventDefault();eraJump();return;}
 if(e.code==='KeyF'||e.code==='Enter'&&started){e.preventDefault();if(!paused)interactTravel();return;}
 if(e.code==='KeyG'){e.preventDefault();talkToPerson();return;}
 if(e.code==='KeyE'&&!paused&&canTalk()&&(marketShop?.intent()||gullEncounter.snapshot().phase==='chase'&&marketShop?.hand?.item.encounter==='gulls')){e.preventDefault();marketAction();return;} // otherwise E keeps looking right
 if(marketShop?.open&&/^(Digit|Numpad)[1-9]$/.test(e.code)){e.preventDefault();const item=marketShop.menu()[Number(e.code.at(-1))-1];if(item)buyAtStall(item.id);return;}
 if(e.code==='KeyM'){showDialog('map-dialog');return;}
 if(e.code==='KeyR'){reset();return;}
 if(e.code==='KeyC'){cycleCamera();return;}
 if(e.code==='KeyT'){look.cycle();toast(look.label);return;}
 if(e.code==='KeyH'){
  document.body.classList.toggle('clean-capture');
  return;
 }
 if(e.code==='KeyV'){ // video capture mode: fixed full resolution, no impact shake
  captureMode=!captureMode;
  if(captureMode?resolution.lock(Math.min(devicePixelRatio,2)):resolution.unlock())renderer.setPixelRatio(resolution.scale);
  toast(captureMode?'Capture mode on: full resolution, no camera shake (V to leave)':'Capture mode off');
  updateCaptureBadge();
  return;
 }
 if(e.code==='Equal'||e.code==='NumpadAdd')zoom(-40);if(e.code==='Minus'||e.code==='NumpadSubtract')zoom(40);
 if(!started&&ready&&['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))start();
 if(!paused)keys.add(e.code);
});
window.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>{keys.clear();setPaused(true);});document.addEventListener('visibilitychange',()=>{if(document.hidden){keys.clear();setPaused(true);}});
$('world').addEventListener('wheel',e=>{e.preventDefault();zoom(Math.sign(e.deltaY)*22);},{passive:false});
$('sound-btn').addEventListener('click',async()=>{sound=!sound;peopleInteraction?.setVoiceEnabled(sound);if(sound&&!audioContext){audioContext=new AudioContext();oscillator=audioContext.createOscillator();gain=audioContext.createGain();oscillator.type='triangle';gain.gain.value=0;oscillator.connect(gain);gain.connect(audioContext.destination);oscillator.start();}if(sound)await audioContext.resume();$('sound-btn').setAttribute('aria-label',sound?'Mute sound':'Enable sound');$('sound-btn').title=sound?'Mute sound':'Enable sound';$('sound-btn').querySelector('.mute-slash').hidden=sound;});
// After a HUD action, the next movement/interaction key belongs to the game.
for(const id of ['view-btn','look-btn','sound-btn','zoom-in','zoom-out'])$(id).addEventListener('click',focusWorldControls);

mobileControls=createMobileControls({
 keys,
 canPlay:()=>ready&&started&&!paused&&!mapOpen&&!police?.busted&&!gameIsStopped(),
 onMenuChange:()=>{mapOpen=!!document.querySelector('dialog[open]');if(mapOpen)peopleInteraction?.close();keys.clear();keys.tilt=0;},
 actions:{
  map:()=>showDialog('map-dialog'),camera:cycleCamera,
  weather:()=>{look.cycle();toast(look.label);},sound:()=>$('sound-btn').click(),
  help:()=>showDialog('help-dialog'),reset,sources:()=>showDialog('sources-dialog'),
 },
 notify:toast,
});

// Overlapping surfaces: prefer one that carries a street name (OSM splits streets into many pieces).
function streetAt(index,x,z){let unnamed=null;for(const p of index.near(x,z)){const b=p.bbox;if(x<b[0]||x>b[2]||z<b[1]||z>b[3]||!pointInPolygon(x,z,p.rings))continue;if(p.name)return p.name;unnamed??=p;}return unnamed?'':null;}
function currentLocation(){
 return describeLocation({car,street:streetAt(world.roads,car.x,car.z)||streetAt(world.pavement,car.x,car.z),
  cameraPosition:camera.position.toArray(),cameraDirection:camera.getWorldDirection(new THREE.Vector3()).toArray(),fov:camera.fov,origin:data.originGK25});
}
function updateHUD(now){
 const wanted=police?.snapshot();$('wanted').hidden=!started||!wanted?.level;
 $('wanted').classList.toggle('searching',wanted?.status==='SEARCHING');$('wanted').classList.toggle('seen',!!wanted?.seen);
 if(wanted?.level){$('wanted-stars').innerHTML='<span class="on">★</span>'.repeat(wanted.level)+'<span class="off">★</span>'.repeat(5-wanted.level);$('wanted-stars').setAttribute('aria-label',`${wanted.level} of 5 wanted stars`);$('wanted-status').textContent=wanted.bustProgress?`BEING ARRESTED · ${wanted.bustSeconds}s`:wanted.status==='SEARCHING'?'SEARCHING — STAY OUT OF SIGHT':`POLICE PURSUIT · ${wanted.units.length} UNIT${wanted.units.length===1?'':'S'}`;}
 if(!car)return;
 const driving=travel?.mode==='car';
 const speed=displayedSpeedKmh(car.speed);$('speed').title='Game-style indicated speed: 70% of world speed';$('gear').textContent=car.speed<-.2?'REVERSE':speed>1?'DRIVING':'PARKED & READY';$('distance').textContent=(car.distance/1000).toFixed(2);
 const road=world.roads.at(car.x,car.z),pave=world.pavement.at(car.x,car.z);$('street').textContent=road?.name||pave?.name||'Off the beaten path';
 if(car.damage>.02)$('gear').textContent=`DAMAGE ${Math.round(car.damage*100)}% · R TO RESET`;
 if(city?.era===1760){}else if(car.battery===0)$('gear').textContent='R TO RECHARGE';else if(car.battery<=.2)$('gear').textContent='LOW BATTERY · R TO RECHARGE';
 if(!driving){$('gear').textContent=TRAVEL_MODES[travel.mode].label.toUpperCase();$('speed').title='Speed in kilometres per hour';}
 let nearest=data.landmarks[0],best=Infinity;for(const l of data.landmarks){const d=Math.hypot(l.x-car.x,l.z-car.z);if(d<best){best=d;nearest=l;}}$('district-label').textContent=nearest.district.toUpperCase();
 if(areaLabel){const caption=document.querySelector('.minimap-caption')?.firstChild,text=`${areaLabel(car.x,car.z,now)} `;if(caption&&caption.textContent!==text)caption.textContent=text;}
 const location=currentLocation();locationReadout.update(location);
 $('coordinates').textContent=`${location.coordinates.latitude.toFixed(6)}° N · ${location.coordinates.longitude.toFixed(6)}° E`;
 drawMinimap();
 if(mapOpen&&$('map-dialog').open)drawCityMap();
}
function frame(now){
 if(gameIsStopped())return;
 requestAnimationFrame(frame);const frameMs=lastTime?now-lastTime:0;const steps=simulationSteps(lastTime?(now-lastTime)/1000:0),dt=steps.reduce((a,b)=>a+b,0);lastTime=now;
 mobileControls.update({started,paused,mapOpen,busted:!!police?.busted,mode:travel?.mode||'car',speed:car?.speed||0});
 if(ready)peopleInteraction.update(dt,car,nearbyPeople(),{enabled:canTalk()});
 if(ready&&marketShop){marketShop.update(paused||mapOpen?0:dt,car,{enabled:canTalk()});for(const m of marketShop.drainMessages())marketUI.say(m);}
 if(ready&&!paused&&!mapOpen&&!police?.busted){
  camera.updateMatrixWorld();trafficFrustum.setFromProjectionMatrix(trafficProjection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
  mobility.visibilityTest=trafficInView;if(buses)buses.simulation.visibilityTest=trafficInView;
  for(const step of steps){
   impacts.step(step,world);crowd?.step(step);let before=null;const driving=travel.mode==='car',parked=travel.parked();
   if(started){
    const previous=before={...car},r=driving?driveStep(car,keys,step,world):travel.step(keys,step,travelObstacles());
    if(r.crashed){car=travel.actor;playerCars.sync(travel);if(now-lastToast>1500){toast(r.crashed>5?'Ouch. That was a hard fall.':'You came off. Press Enter to get back on.');lastToast=now;}}
    police.observeDriving(previous,car,step,{driving});
    const parkedHit=driving&&parked.find(p=>sweptContact(previous,car,p));
    if(parkedHit){Object.assign(car,{x:previous.x,z:previous.z,heading:previous.heading,speed:0});impacts.damage(car,Math.abs(previous.speed),'vehicle');police.report(parkedHit.travelMode==='car'?'vehicle':'property',`parked:${parkedHit.id}`,Math.abs(previous.speed));}
    knockables?.step(step,driving?car:{...car,speed:0},world);
    if(driving){
     police.observe(previous,car,mobility.cars,[]);
     impacts.collide(previous,car,[...mobility.people,...detailPeople],[...cyclists.riders.filter(r=>!r.playerTaken),...npcScooters.riders],[...mobility.cars,...police.obstacles],police);
     if(r.collision==='building'){impacts.damage(car,Math.abs(previous.speed),'building');finale.buildingImpact({...car,speed:previous.speed},Math.abs(previous.speed),world,police);}
    }else if(!r.crashed){const h=travel.hitPeople(previous,[...mobility.people,...detailPeople],impacts,{police,obstacles:travelObstacles()});
     if(h?.fell){car=travel.actor;playerCars.sync(travel);toast(h.fell>5?'Ouch. You hit someone and went flying.':'You hit someone and came off. Press Enter to get back on.');lastToast=now;}else if(h?.bumped&&now-lastToast>1500){toast('Sorry!');lastToast=now;}}
    distance=car.distance;
    if(r.collision&&now-lastToast>2200){if(r.collision==='boundary')showEdgeInvite();if(r.collision==='water')toast('The water is best enjoyed from the shore.');lastToast=now;}
   }
   const beforeTransitImpact=Math.abs(car.speed);
   tramSim.step(step,car,[...mobility.cars,...(buses?.obstacles||[]),...police.obstacles,...parked]);
   buses?.step(step,car,[...mobility.cars,...tramSim.obstacles,...police.obstacles,...parked]);
   if(started&&driving&&beforeTransitImpact>=2&&car.speed===0){impacts.damage(car,beforeTransitImpact,'transit');finale.transitImpact(car,beforeTransitImpact,tramSim.trams,police);}
   mobility.externalObstacles=[...impacts.obstacles(),...tramSim.obstacles,...(buses?.obstacles||[]),...police.obstacles,...parked];mobility.externalBodies=transitBodies();
   mobility.step(step,car);angryDrivers.update(step,mobility.time,car);cyclists.step(step,car);marketLife.update(step,car);universityLife.update(step,car);terminalLife.update(step,car);
   npcScooters.step(step,car,{people:[...mobility.people,...detailPeople],vehicles:[...mobility.cars,...tramSim.obstacles,...(buses?.obstacles||[]),...police.obstacles,...parked],impacts});
   if(started)police.step(step,car,[...mobility.cars,...mobility.people,...detailPeople,...tramSim.obstacles,...(buses?.obstacles||[])]);
   finale.step(step,car,{police,tramSim,knockables,started:started&&driving});
   roadblock?.step(step,car,before,{started:started&&driving,knockables,onBurst:()=>finale.offence('roadblock','Drove into a police roadblock')});
   if(police.busted){setBusted(true);break;}
  }
  knockables?.update();streetLife.update(dt,car);tramRenderer.update(car);cyclistRenderer.update(car);npcScooterRenderer.update(car,dt);policeRenderer.update(dt);roadblock?.update(dt,car);
  if(police.message){toast(police.message);police.message=null;}
  if(cph&&car)cph.update(dt,car,travel.mode,{running:started});if(carriage&&car){carriage.userData.update(car.speed||0,dt);car.battery=1;}coaches?.update(groundAt);parkedCars?.update(car);boats?.update(dt,car);landmarks?.update(dt);trains?.update(dt);cafeGuests?.update(dt,car);
 }else if(ready&&police?.busted){policeRenderer.update(dt);roadblock?.update(dt,car);if(finale.cinematicStep(dt,roadblock?.playing)){$('busted-overlay').classList.toggle('live',!!roadblock?.active);$('busted-overlay').hidden=false;$('busted-continue').focus();}} // arrest cinematic: strobes keep flashing, then the end screen
 if(car){
   speedometer.update(car,dt,{mode:travel.mode});
   travel.advanceTransition(paused||mapOpen?0:dt);playerCars.sync(travel,dt);const vehicle=travel.car;
   treeFocus.value.set(car.x,car.z);
   treeFade.value=chaseCamera&&started?0:1;
   surfaceNow=world?surfaceDetailAt(world,car.x,car.z):surfaceNow;rumbleNow=rumbleFor(travel.mode==='car'&&started&&!paused&&!mapOpen?surfaceNow.surface:'asphalt',travel.mode==='car'?car.speed:0,paused||mapOpen?0:dt,roadRumble,surfaceNow.roughness);
   const slope=groundPose(vehicle.x,vehicle.z,vehicle.heading,1.4,.8); // terrain: wheels on the ground, body pitched and rolled with the slope
   carGroup.position.set(vehicle.x,.12+rumbleNow.bob+slope.y,vehicle.z);carGroup.rotation.y=vehicle.heading;carGroup.rotation.x=rumbleNow.pitch+slope.pitch;
   carGroup.rotation.z=(started?-vehicle.steer*Math.min(Math.abs(vehicle.speed)*.002,.04):0)+rumbleNow.roll+slope.roll;
   animateVehicle(carGroup,vehicle.speed,vehicle.steer,paused||mapOpen?0:dt,keys.has('Space')||keys.has('KeyS')||keys.has('ArrowDown'));
   for(const w of carGroup.userData.wheels)w.pivot.scale.y=vehicle.flat?.7:1;if(vehicle.flat)carGroup.position.y-=.08; // shredded tyres: squashed wheels, car sits on its rims
   marker.position.set(car.x,.14+groundAt(car.x,car.z),car.z);marker.material.opacity=started?.18:.4;
   // Drive-camera feel (src/driving-camera.js): springy heading lag, Q/E look, roll, speed FOV and impact shake.
   driveCamera.heading=cameraHeading;const cam=stepDriveCamera(driveCamera,car,dt,{lookTarget:keys.has('KeyQ')?1.4:keys.has('KeyE')?-1.4:0,drive:chaseCamera&&started,maxSpeed:PLAYER_MAX_SPEED,rumble:{bob:(rumbleNow.cameraBob||0)*(captureMode?.6:1),roll:(rumbleNow.cameraRoll||0)*(captureMode?.6:1)}}); // camera gets its own gentle sway, not the body's jiggle
   cameraHeading=driveCamera.heading;cameraLook=cam.look;cameraFov=cam.fov;cameraRoll=cam.roll;cameraShake=captureMode?[0,0,0]:cam.offset;cameraRumble=cam.rumble; // capture mode keeps 60% cobble rumble, no impact shake
   const ahead=started?11+Math.abs(car.speed)*.5:0;
   const target=new THREE.Vector3(car.x-Math.sin(cameraHeading)*ahead,0,car.z-Math.cos(cameraHeading)*ahead);
   focus.lerp(target,1-Math.exp(-dt*5));
 }
 viewSpan+=(desiredSpan-viewSpan)*(1-Math.exp(-dt*7));resizeCamera();
 const heading=started?cameraHeading:0,height=viewSpan*(highCamera?.85:.64),behind=viewSpan*(highCamera?.40:.70);
 if(chaseCamera&&started){
  const pose=(travel.mode==='car'?drivingCameraPose:travelCameraPose)(travel.viewActor(),cameraHeading,viewSpan,cameraLook,travel.mode==='car'?world.cameraBuildings:world.travelCameraBuildings);
  if(cameraTransition){cameraTransition.elapsed+=paused||mapOpen?0:dt;const t=Math.min(1,cameraTransition.elapsed/.5),blend=t*t*(3-2*t);pose.position=pose.position.map((v,i)=>cameraTransition.position.getComponent(i)+(v-cameraTransition.position.getComponent(i))*blend);pose.target=pose.target.map((v,i)=>cameraTransition.target.getComponent(i)+(v-cameraTransition.target.getComponent(i))*blend);if(t===1)cameraTransition=null;}
  camera.position.set(pose.position[0]+cameraShake[0]+cameraRumble[0],pose.position[1]+cameraShake[1]+cameraRumble[1],pose.position[2]+cameraShake[2]+cameraRumble[2]);camera.lookAt(...pose.target);camera.rotateZ(cameraRoll);
 }else if(started&&car){const pose=overviewCameraPose(car,heading,viewSpan,highCamera);camera.position.set(...pose.position);camera.lookAt(...pose.target);
 }else{camera.position.set(focus.x+Math.sin(heading)*behind,height,focus.z+Math.cos(heading)*behind);camera.lookAt(focus);}
 if(inspectionCamera){camera.position.set(...inspectionCamera.eye);camera.lookAt(...inspectionCamera.target);}
 {const pose=roadblock?.cameraPose()||finale.cameraPose(car);if(pose){camera.position.set(...pose.position);camera.lookAt(...pose.target);}} // arrest cinematic orbit
 const wantFov=chaseCamera&&started&&!inspectionCamera?cameraFov:DRIVE_FOV.min;if(camera.fov!==wantFov){camera.fov=wantFov;camera.updateProjectionMatrix();}
 playerCars.setVisible(!inspectionCamera);
  travelRenderer.update(travel,started&&!paused&&!mapOpen?dt:0,{visible:!inspectionCamera,actorVisible:!police?.busted,hold:marketShop?.holdPose()??null});
  if(ready&&!paused&&!mapOpen&&!police?.busted){
   const birdStep=Math.min(.1,dt); // keep encounter pressure and bird motion on the same clock at low frame rates
   if(started){
    const previousGullPhase=gullEncounter.snapshot().phase;
    applyGullDrop(gullEncounter.update(birdStep,{player:car,hand:marketShop?.hand,gulls:birds?.life.birds||[],foodTarget:heldFoodTarget()}));
    if(previousGullPhase!=='chase'&&gullEncounter.snapshot().phase==='chase'){peopleInteraction?.close();marketShop?.close();}
    announceGulls();
   }
   const encounter=gullEncounter.birdTarget();
   birds?.update(birdStep,{viewer:car,threats:[car],people:[mobility.people,detailPeople],lure:encounter?null:marketShop?.lure(),encounter,safeFlight:safeBirdFlight});
  }
  marketShopRenderer?.update(started&&!paused&&!mapOpen?dt:0,{viewer:car,shop:marketShop,hand:police?.busted?null:travelRenderer.hand(),visible:!inspectionCamera,dropped:gullEncounter.snapshot().dropped});

 document.querySelector('.compass svg').style.transform=`rotate(${heading}rad)`;
 // Fade only the buildings between the chase camera and the player, preserving a readable road view.
 if(car&&started){const target=new THREE.Vector3(car.x,1+groundAt(car.x,car.z),car.z),ray=new THREE.Ray(camera.position.clone(),target.clone().sub(camera.position).normalize()),hit=new THREE.Vector3(),limit=camera.position.distanceTo(target);
  // Blocks from the city model are large and L-shaped: a box test alone fades a whole block the car is merely
  // next to, so shells that pass the box test are checked against their real walls.
  const updated=new Set(),decided=new Map();occlusionRay.ray.copy(ray);occlusionRay.far=Math.max(0,limit-3);
  for(const tile of loadedTiles.values())if(tile.visible)for(const mesh of tile.children){if(!mesh.visible||!mesh.userData.shell)continue;const state=mesh.userData.occlusion;if(!state||decided.get(state))continue;
   const near=!!ray.intersectBox(mesh.userData.box,hit)&&hit.distanceTo(camera.position)<limit-3;decided.set(state,near&&occlusionRay.intersectObject(mesh,false).length>0);}
  for(const tile of loadedTiles.values())if(tile.visible)for(const mesh of tile.children){if(!mesh.visible)continue;const state=mesh.userData.occlusion;if(!updated.has(state)){let fade;if(decided.has(state))fade=decided.get(state);else{const intersects=ray.intersectBox(mesh.userData.box,hit);fade=!!intersects&&hit.distanceTo(camera.position)<limit-3;}advanceOcclusion(state,fade,dt);updated.add(state);}mesh.material.opacity=state.opacity;mesh.material.depthWrite=state.opacity>.999;const fading=state.opacity<.999;if(mesh.material.transparent!==fading){mesh.material.transparent=fading;mesh.material.needsUpdate=true;}}
 }
 // Shadow box and texel snapping follow the active look's sun (weather.js re-applies the same offset below).
 {const sunOffset=look?look.current.sunOffset:new THREE.Vector3(-160,260,160),sf=shadowFrame(sunOffset);
  if(Math.abs(sun.shadow.camera.top-sf.halfHeight)>.5||Math.abs(sun.shadow.camera.right-sf.halfWidth)>.5){Object.assign(sun.shadow.camera,{left:-sf.halfWidth,right:sf.halfWidth,top:sf.halfHeight,bottom:-sf.halfHeight});sun.shadow.camera.updateProjectionMatrix();sun.shadow.normalBias=sf.normalBias;}
  stableShadowTarget({x:focus.x-Math.sin(cameraHeading)*50,y:groundAt(focus.x,focus.z),z:focus.z-Math.cos(cameraHeading)*50},{width:sf.halfWidth*2,height:sf.halfHeight*2},2048,sun.target.position,sunOffset);sun.position.copy(sun.target.position).add(sunOffset);}
 const cp=new THREE.Vector3(0,photoMode?0:65,-31).project(camera);$('cathedral-label').style.left=`${(cp.x*.5+.5)*captureFrame.w}px`;$('cathedral-label').style.top=`${(-cp.y*.5+.5)*captureFrame.h-15}px`;$('cathedral-label').style.opacity=car&&Math.hypot(car.x,car.z+31)<280&&cp.x>-1&&cp.x<1&&cp.y>-.65&&cp.y<.8&&cp.z<1?1:0;
 if(now-lastUI>140&&ready){updateHUD(now);travelUI.update(travel,{started,paused,mapOpen,busted:police?.busted,hidden:captureMode});peopleUI.update(peopleInteraction?.snapshot(),{hidden:!canTalk()||captureMode||gullEncounter.snapshot().phase==='chase'});refreshMarketUI();noticeGulls();lastUI=now;}
 uploads.step(); // rationed GPU uploads for streamed tiles
 if(now-lastTile>1200&&ready&&!switchingStart){surfaceStreamer?.update(car,{radius:1000,aheadSeconds:12});extensionStreamer?.update(car);updateTiles().catch(handleTileError);lastTile=now;}
 if(gain){gain.gain.setTargetAtTime(sound&&started&&travel?.mode==='car'&&!paused&&!mapOpen?.013:0,audioContext.currentTime,.12);oscillator.frequency.setTargetAtTime(42+Math.abs(car?.speed||0)*5,audioContext.currentTime,.1);}
 policeRenderer?.audio(audioContext,sound&&started&&!paused&&!mapOpen&&(!police?.busted||!finale.ended));
 birds?.audio(audioContext,sound&&started&&!paused&&!mapOpen,car,frameMs/1000);
 waterfrontLandmarks?.update(now/1000);
 sea?.update(now/1000);
 skyEnvironment.update(now/1000);
 palaceLife?.update(now/1000,car);
 cityHallFlag?.update(now/1000,car);
 marketScene?.update(now/1000,car);
 stationStreetLife?.update(car,ready&&!paused&&!mapOpen?dt:0);
 // Resize before drawing: changing the pixel ratio clears the canvas, which flashed a blank frame when done after.
 if(ready&&resolution.update(frameMs,dt))renderer.setPixelRatio(resolution.scale);
 look.update(dt,now/1000); // blends the active look and re-applies its sun offset after the shadow target above
 if(post)post.render(scene,camera);else renderer.render(scene,camera);
}
function resizeCamera(){camera.aspect=captureFrame.w/captureFrame.h;camera.updateProjectionMatrix();}
requestAnimationFrame(frame);

async function boot(){
 try{
   try{registerCities((await json('/cities/index.json')).cities);}catch{} // community-built cities
   city=useCity(selectCity(location.search));if(city.scenery!=='helsinki')for(const m of [ground.material,surfaceMaterial]){m.defines={...m.defines,NO_PORT_YARD:''};m.needsUpdate=true;} // Helsinki's lower port yard cut-out
   if(city.id==='copenhagen')STARTER_VISUALS.bike={kind:'ladcykel',color:'#26302b'};if(city.era===1760){STARTER_VISUALS.none=['bike','scooter'];PERSON_PERIOD.year=1760;document.body.classList.add('era-1760');}updateWorldhoodBrand(city);setPlayableRadius(city.radius||2000);
   const helsinki=city.scenery==='helsinki';
   if(!helsinki)finale.zone=null; // station tram scheduling belongs to Helsinki; pursuit rules are shared
   if(!helsinki&&city.projection?.startsWith('+proj'))useProjection(city.projection,city.origin);
   if(city.liveries?.tram)setTramLivery(city.liveries.tram);if(city.liveries?.bus)setBusLivery(city.liveries.bus);
   progress(8,`Loading ${city.name}`);
   const d=unpack(dataUrl('city.pack')).then(bytes=>JSON.parse(new TextDecoder().decode(bytes)));
   const terrainData=city.terrain?.file?unpack(dataUrl(city.terrain.file)).then(decodeTerrain).catch(e=>{console.warn('Terrain unavailable; the city stays flat:',e);return null;}):null; // ground elevation (src/terrain.js)
   const anchorData=city.id.startsWith('copenhagen')?json(dataUrl('anchors.json')).catch(()=>null):null,eraData=city.era===1760?json(dataUrl('era.json')).catch(()=>null):null;
   const boatData=city.id.startsWith('copenhagen')?json(dataUrl('boats.json')).catch(()=>null):null;
   const cafeData=city.id==='copenhagen'?json(dataUrl('cafes.json')).catch(()=>null):null;
   const railData=city.id==='copenhagen'?json(dataUrl('rails.json')).catch(()=>null):null;
   const parkedData=city.id==='copenhagen'?json(dataUrl('parked.json')).catch(()=>null):null; // kerbside parked cars (scripts/parked-cars.py)
   const furnitureData=city.furniture?json(dataUrl(city.furniture)).catch(()=>null):null; // street furniture detected in street-level photos (optional, any city)
   let mobilityData,landcoverData,tramData;[data,roofIndex,surfaceIndex,mobilityData,landcoverData,tramData,extensions]=await Promise.all([d,json(dataUrl('buildings3d-index.json')),json(dataUrl('surface-index.json')),json(dataUrl('mobility.json')),json(dataUrl('landcover.json')),json(dataUrl('trams.json')),loadExtensionIndex(json)]);
   if(city.facades)attachFacades(roofIndex,await json(dataUrl(city.facades)).catch(()=>null)); // photo-described street fronts (optional, any city)
   if(city.estimatedFacades)estimateFacades(roofIndex); // plausible fronts for untextured official meshes (see facade-data.js)
   // Photo-matched places (squares with their tram stop, trees and landmarks; scripts/place-build.mjs): measured heights,
   // register trees with species heights, and the buildings their landmarks replace.
   places=(await Promise.all((city.places||[]).map(p=>json(dataUrl(`places/${p}.json`)).catch(()=>null)))).filter(Boolean);
   for(const pl of places){const inPlace=t=>Math.hypot(t.p[0]-pl.centre[0],t.p[1]-pl.centre[1])<pl.radius;
    data.trees=[...data.trees.filter(t=>!inPlace(t)),...pl.trees.filter(inPlace)];for(const id of pl.hideBuildings||[])placeHidden.add(id);
    for(const t of roofIndex.tiles)for(const part of t.parts)if(pl.heights?.[part.id]&&!part.facade?.height)part.measuredHeight=pl.heights[part.id];}
   // The catalog lists every destination; only the requested region blocks startup.
   if(helsinki)data.landmarks.push({...HARBOUR_START});
   for(const e of extensions)data.landmarks.push(...(e.starts||[]));
   areaLabel=areaCaption(helsinki?[...HELSINKI_AREAS,...extensions.flatMap(e=>e.starts||[])]:data.landmarks,city.name);
   let eraArrival=null;try{eraArrival=JSON.parse(sessionStorage.getItem('era-jump')||'null');sessionStorage.removeItem('era-jump');}catch{} // Y in Copenhagen: same spot, other century
   const requestedStart=new URLSearchParams(location.search).get('start'),firstStart=(eraArrival?.to===city.id&&Number.isFinite(eraArrival.x)?{name:city.era===1760?'1760':'Today',x:eraArrival.x,z:eraArrival.z,heading:eraArrival.heading}:null)||pickStart(data.landmarks,requestedStart)||pickStart(data.landmarks,city.defaultStart)||(helsinki?HARBOUR_START:data.landmarks[0]);
   treeTrunks=createTreeTrunks({lanes:mobilityData.roads.edges});
   const regionStages=new Map(),transitQueue=[],addTransit=e=>{if(!tramSim||!buses)transitQueue.push(e);else installTransit(e.transitLines,{trams:tramSim,tramRenderer,buses:buses.simulation});};
   extensionStreamer=createExtensionStreamer({entries:extensions,load:e=>loadExtension(e,json,unpack),onError:handleTileError,install:async e=>{
    if(gameIsStopped())return;
    if(!world){applyExtensions([e],{data,roofIndex,surfaceIndex,mobility:mobilityData});addTransit(e);return;}
    // Finish nearby ground before opening the region. Other tiles continue to stream ahead.
    surfaceStreamer.add(e.surfaces);await surfaceStreamer.ensure(car,{radius:1000,aheadSeconds:12});
    if(gameIsStopped())return;
    let stage=regionStages.get(e.id);
    if(!stage){
     const roadStart=mobility.roads.edges.length,walkStart=mobility.walks.edges.length;addTransit(e);
     applyExtensions([e],{data,roofIndex,surfaceIndex,mobility,world,police,activate:false});
     stage={roads:mobility.roads.edges.slice(roadStart),walks:mobility.walks.edges.slice(walkStart)};regionStages.set(e.id,stage);
    }
    if(!stage.trees){treeTrunks.addLanes(stage.roads);await createTrees(e.city.trees);stage.trees=true;}
    if(!stage.buildings){createFallbackBuildings(e.city.buildings);stage.buildings=true;}
    if(!stage.streets){streetLife.append({roads:stage.roads,walks:stage.walks,pavement:e.city.pavement});world.objects.add(breakableSigns.bodies);npcScooters?.refreshRoutes(mobility.walks,world);stage.streets=true;}
    if(!stage.water){rebuildSea(Math.max(...e.mapBounds.map(Math.abs)));stage.water=true;}
    if(!stage.active){activateExtension(e);stage.active=true;}
    drawMapBase();updateDataCounts();
   }});
   await extensionStreamer.ensureStart(firstStart);
   mapView=mapViewFor(extensions);
   // ~0.375 px per metre, as before, whatever the map frame size.
   mapCache.width=mapCache.height=Math.min(4096,Math.round(mapView.size*.375));
   // Hilly cities: everything below samples the shared height field; the flat ground plane gives way to a terrain mesh.
   if(setTerrain(await terrainData)){surfaceMaterial.defines={...surfaceMaterial.defines,TERRAIN:''};surfaceMaterial.needsUpdate=true;ground.visible=false;cityModel.add(createTerrainGround(ground.material));}
   if((landcoverData.polygons||landcoverData.runs||[]).length)cityModel.add(settleObject(createLandcover(landcoverData)));
   sea=createSea(data.water,data,{helsinkiHarbour:helsinki});cityModel.add(sea.group);ground.geometry.dispose();ground.geometry=sea.groundGeometry;
   // Helsinki's hand-built scenery (landmarks, harbour, street life, signs). Other cities get the generic engine only.
   async function buildHelsinkiScenery(){
   progress(30,'Loading roads and waterfront');
   const [pavilions]=await Promise.all([new GLTFLoader().loadAsync('/models/senate-pavilions.glb'),loadSenateMaterials(Math.min(8,renderer.capabilities.getMaxAnisotropy()))]);
   pavilions.scene.traverse(m=>{if(m.isMesh){m.castShadow=true;m.receiveShadow=true;}});cityModel.add(pavilions.scene);
   const senate=createSenateSquare(data.pavement);cityModel.add(senate.group);
   const market=createKauppatori(data);marketScene=market;cityModel.add(market.group);
   cityModel.add(createMarketStreetSurface(data));
   const crossingSigns=createSofiankatuSigns(data);cityModel.add(crossingSigns);
   const routeCrossingSigns=createRouteCrossingSigns(data,mobilityData.walks.edges);cityModel.add(routeCrossingSigns);
   const roadworks=createKauppatoriRoadworks(data,correctHarbourLanes(mobilityData),{existingCrossingPosts:[...crossingSigns.userData.placed,...routeCrossingSigns.userData.placed]});cityModel.add(roadworks.group);
   const senateProps=createSenateStreetProps(data);cityModel.add(senateProps.group);
   const kaivokatuDetails=createKaivokatuDetails(data);cityModel.add(kaivokatuDetails.group);
   marketLife=createMarketLife(data,market.stalls,{obstacles:roadworks.placementObstacles});knockables=roadworks.knockables;cityModel.add(marketLife.group);
   birdColonies=marketGullColony(data,market.stalls,{shore:shoreSamples(data.water,{radius:data.radius,extent:data.extent}),inWater:(x,z)=>inWater(data.water,x,z)}); // Kauppatori's gulls
   universityLife=createUniversityLife(data);cityModel.add(universityLife.group);detailPeople=[...marketLife.people,...universityLife.people];
   harbour=createHarbour(data);cityModel.add(harbour.group);
   const harbourSigns=createLaivasillankatuSigns();cityModel.add(harbourSigns);harbour.group.userData.laivasillankatuSigns=harbourSigns.userData;
   const marketFingerpost=createKauppatoriFingerpost();cityModel.add(marketFingerpost);harbour.group.userData.kauppatoriFingerpost=marketFingerpost.userData;
   const destinationSigns=createRouteDirectionSigns();cityModel.add(destinationSigns);harbour.group.userData.destinationSigns=destinationSigns.userData;
   const etelarantaGantry=createEtelarantaGantry();cityModel.add(etelarantaGantry);harbour.group.userData.etelarantaGantry=etelarantaGantry.userData;
   const mannerheimintieGantry=createMannerheimintieGantry();cityModel.add(mannerheimintieGantry);harbour.group.userData.mannerheimintieGantry=mannerheimintieGantry.userData;
   waterfrontLandmarks=createWaterfrontLandmarks();waterfrontLandmarks.update(0);cityModel.add(waterfrontLandmarks.group);
   const streetNames=createStreetNameSigns(data);cityModel.add(streetNames);harbour.group.userData.streetNames=streetNames.userData;harbour.group.userData.waterfront=waterfrontLandmarks.group.userData;
   palaceLife=createPalaceLife();cityModel.add(palaceLife.group);harbour.group.userData.palaceLife=palaceLife.group.userData;
   cityHallFlag=createCityHallFlag();cityModel.add(cityHallFlag.group);harbour.group.userData.cityHallFlag=cityHallFlag.group.userData;
   const statues=createStationStatues();cityModel.add(statues.group,createStationBuildingDetails(),createStationKiosk(data.buildings.find(b=>String(b.ratu)===String(STATION_KIOSK_RATU))));
   const uspenski=createUspenskiCathedral();cityModel.add(uspenski.group);
   const streetObstacles=[...senate.obstacles,...market.obstacles,...harbour.obstacles,...statues.obstacles,...roadworks.obstacles,...senateProps.obstacles,...kaivokatuDetails.obstacles,...uspenski.obstacles];
   const kamppiChapel=createKamppiChapel();cityModel.add(kamppiChapel.group);streetObstacles.push(...kamppiChapel.obstacles);
   streetObstacles.push(...(harbourSigns.obstacles||[]),...(etelarantaGantry.obstacles||[]),...(mannerheimintieGantry.obstacles||[]));
   const lasipalatsiStop=createLasipalatsiStops(data,streetObstacles);cityModel.add(lasipalatsiStop.group);streetObstacles.push(...lasipalatsiStop.obstacles);harbour.group.userData.lasipalatsiStop=lasipalatsiStop.group.userData;
   const kauppatoriStops=createKauppatoriTramStops(data,streetObstacles);cityModel.add(kauppatoriStops.group);streetObstacles.push(...kauppatoriStops.obstacles);harbour.group.userData.kauppatoriStops=kauppatoriStops.group.userData;
   stationStreetLife=createStationStreetLife(data,tramData,streetObstacles);cityModel.add(stationStreetLife.group);streetObstacles.push(...stationStreetLife.obstacles);detailPeople.push(...stationStreetLife.people);
   const ads=await createBindAds(data,tramData.stops,streetObstacles);cityModel.add(ads.group);
   terminalLife=createTerminalLife(data,mobilityData.walks,[...streetObstacles,...ads.obstacles]);cityModel.add(terminalLife.group);detailPeople.push(...terminalLife.people);
   harbour.group.userData.bindAds=ads.group.userData;harbour.group.userData.stationStatues=statues.group.userData;
   // Route street furniture: parked cars and bike racks are solid obstacles; bins and e-scooters are knockable.
   const furniture=createStreetFurniture(data,correctHarbourLanes(mobilityData),tramData,{obstacles:[...streetObstacles,...ads.obstacles]});cityModel.add(furniture.group);streetObstacles.push(...furniture.obstacles);knockables=combineKnockables([knockables,furniture.knockables,senateProps.knockables,marketLife.knockables,universityLife.knockables,harbour.knockables]); // + loose parked bikes/scooters (Senate, Kauppatori, Yliopistonkatu, terminal docks)
   // Parked e-scooter clusters and HSL city-bike stations: knockable bikes/scooters, solid dock rows (parked-micromobility.js).
   const micromobility=createParkedMicromobility(data,correctHarbourLanes(mobilityData),tramData,{obstacles:[...streetObstacles,...ads.obstacles],avoid:[...furniture.plan.bins,...furniture.plan.scooters,...furniture.plan.racks]});cityModel.add(micromobility.group);streetObstacles.push(...micromobility.obstacles);knockables=combineKnockables([knockables,micromobility.knockables]);
   // Light sign posts bend/snap instead of stopping the car (breakable-signs.js): their footprints only guide placement.
   knockables=combineKnockables([knockables,breakableSigns]);
   return {streetObstacles,ads,crossingSigns,routeCrossingSigns,roadworks,senateProps,furniture,micromobility,market,kaivokatuDetails};
   }
   function genericScenery(){
    const empty=()=>({group:new THREE.Group(),userData:{},obstacles:[]});
    const life=()=>({group:new THREE.Group(),people:[],update(){},reset(){},snapshot:()=>({})});
    marketLife=life();universityLife=life();terminalLife=life();detailPeople=[];
    // Copenhagen's game layer (src/copenhagen): jobs, GPS line, sagas and the characters who give them.
    // The characters are spread across the city, so the crowd's single-centre culling is overridden.
    if(city.era===1760&&!carriage){const starter=carGroup.children[0];if(starter){starter.traverse(m=>{if(m.isMesh)m.visible=false;});carriage=createCarriage();starter.add(carriage);}} // 1760: the player's car becomes a coach and horses
    if(city.id.startsWith('copenhagen')){cph?.dispose?.();cph=createCopenhagenGame({scene,city,mobilityData,cityData:data,toast});const npcCentre={x:0,z:0},npc=createInstancedPeople(cph.people,{name:'Copenhagen characters',center:npcCentre});
     npc.update=(u=>(dt,player)=>{if(player){npcCentre.x=player.x;npcCentre.z=player.z;}u(dt,player);npc.group.visible=true;})(npc.update);cityModel.add(npc.group);marketLife={...life(),...npc,group:npc.group};detailPeople=npc.people;}
    harbour={group:new THREE.Group(),obstacles:[],knockables:null};knockables=combineKnockables([breakableSigns]); // traffic-signal posts bend when hit, in every city
    finale.zone=null; // station tram scheduling is Helsinki-specific
    const streetObstacles=[];for(const pl of places){const p=createPlace(pl,{textureUrl:dataUrl});cityModel.add(settleObject(p.group));streetObstacles.push(...p.obstacles);}
    return {streetObstacles,ads:empty(),crossingSigns:empty(),routeCrossingSigns:empty(),roadworks:empty(),senateProps:empty(),furniture:empty(),
     micromobility:{...empty(),knockables:{snapshot:()=>({})}},market:empty(),kaivokatuDetails:empty()};
   }
   progress(30,`Loading ${city.name} streets`);
   const {streetObstacles,ads,crossingSigns,routeCrossingSigns,roadworks,senateProps,furniture,micromobility,market,kaivokatuDetails}=helsinki?await buildHelsinkiScenery():genericScenery();
   staticCars=[...(furniture.enterableCars||[]),...(harbour.enterableCars||[]),...(stationStreetLife?.enterableCars||[])];
   // Detected street furniture: solid boxes join the obstacles; posts, bins and barriers can be knocked down.
   {const an=anchorData&&await anchorData;if(an){const ed=eraData&&await eraData;landmarks=createLandmarks({era:city.era,anchors:an,mills:ed?.mills||[]});cityModel.add(landmarks.group);}}
   {const bd=boatData&&await boatData;if(bd){boats=createBoats(bd,{waterY:CPH_WATER+(sea?.group?.position?.y||0),era:city.era});cityModel.add(boats.group);}}
   {const cd=cafeData&&await cafeData;if(cd){const c=createCafes(cd);cityModel.add(c.group);streetObstacles.push(...(c.obstacles||[]));
    // Guests standing at the café tables, chatting (two at most tables).
    const guests=[];(cd.tables||[]).forEach(([x,z,yaw],i)=>{for(const k of i%3===2?[0]:[0,1]){const a=yaw+(k?2.3:-.8)+i*.7,gx=x+Math.sin(a)*.95,gz=z+Math.cos(a)*.95;guests.push({x:gx,z:gz,heading:Math.atan2(gx-x,gz-z),pose:'chat',walking:false,talkable:true});}});
    if(guests.length){const cx=guests.reduce((s,g)=>s+g.x,0)/guests.length,cz=guests.reduce((s,g)=>s+g.z,0)/guests.length;cafeGuests=createInstancedPeople(guests,{name:'Café guests',center:{x:cx,z:cz},seed:501});cityModel.add(cafeGuests.group);}}}
   {const rd=railData&&await railData;if(rd){cityModel.add(createRails(rd).group);trains=createTrains(rd);cityModel.add(trains.group);}}
   {const pd=parkedData&&await parkedData;if(pd){parkedCars=createParkedCars(pd);cityModel.add(parkedCars.group);streetObstacles.push(...parkedCars.obstacles);}}
   const mapped=furnitureData&&await furnitureData;let mappedFurniture=null;
   if(mapped?.items)for(const pl of places)mapped.items=mapped.items.filter(i=>!(pl.dropFurniture||[]).some(([x,z,r])=>Math.hypot(i.x-x,i.z-z)<r)); // replaced by the place's own lamps and masts
   if(mapped?.items?.length){mappedFurniture=createMappedFurniture(mapped,{player:()=>car,mobility:()=>mobility});cityModel.add(mappedFurniture.group);streetObstacles.push(...mappedFurniture.obstacles);knockables=combineKnockables([knockables,mappedFurniture.knockables]);}
   world={buildings:new SpatialIndex([...data.buildings,...streetObstacles.filter(o=>!o.breakable),...ads.obstacles]),roads:new SpatialIndex(data.roads.filter(r=>!/Koroke/.test(r.kind))),pavement:new SpatialIndex(data.pavement),trafficForbidden:new SpatialIndex(helsinki?[...data.pavement.filter(inHarbour),...data.roads.filter(r=>/Koroke/.test(r.kind)),...olympiaTramOnlySurfaces(data)]:data.roads.filter(r=>/Koroke/.test(r.kind))),water:data.water};
   world.cameraBuildings=new SpatialIndex(data.buildings);world.sightBuildings=world.cameraBuildings; // mapped buildings only: the camera boom and the police surge's line of sight ignore street furniture
   const marketCameraObstacles=new SpatialIndex((market.stalls||[]).map(s=>solidBox({x:s.x,z:s.z,width:s.w+.5,depth:s.d+.5,yaw:s.facing||0})));
   world.travelCameraBuildings={at:(x,z)=>world.cameraBuildings.at(x,z)||marketCameraObstacles.at(x,z)}; // walking cameras must stay outside canopy roofs and counters
   world.collisionBuildings=world.cameraBuildings;
   world.objects=new WorldObjects([...streetObstacles,...ads.obstacles,...breakableSigns.bodies]);
   cityModel.traverse(object=>{if(object.worldObjects)world.objects.add(object.worldObjects);});
   // ?start=<name> picks any start on the city map (fuzzy, accent-insensitive).
   setStart(firstStart);history.replaceState(null,'',startUrl(location,city,firstStart));
   progress(58,'Preparing the driving map');await new Promise(r=>setTimeout(r,30));drawMapBase();
   progress(68,'Loading buildings and textures');focus.set(car.x,0,car.z);await Promise.all([ensureCityModel(),updateTiles()]);
   progress(88,'Loading traffic and pedestrians');mobility=helsinki?new Mobility(correctHarbourLanes(mobilityData),world,{stationCars:16,corridorCars:HARBOUR_CORRIDOR_CARS,corridor:harbourCorridor(world.roads)}):new Mobility(mobilityData,world,city.era===1760?{cars:26,people:220}:city.id==='copenhagen'?{cars:60,people:240}:undefined);mobility.reset(car);angryDrivers=createAngryDrivers({vehicleOf:a=>streetLife?.traffic?.vehicleOf(a)});scene.add(angryDrivers.group);mobility.onCrash=a=>angryDrivers.trigger(a,mobility.time);streetLife=createStreetLife(scene,mobility);streetLife.update(0,car);if(city.era===1760){streetLife.traffic.group.visible=false;coaches=createCarriageTraffic(mobility.cars);scene.add(coaches.group);}world.objects.add(breakableSigns.bodies); // 1760: the traffic is coaches and horses
   trafficCars=city.era===1760?[]:mobility.cars.map(actor=>{const visual=streetLife.traffic.vehicleOf(actor);return {id:`traffic-${actor.id}`,label:visual?.type==='taxi'?'Taxi':'Car',actor,visual:{type:visual?.type||'sedan',paint:visual?.paint.getStyle()},claim(){if(actor.playerTaken||actor.edge===null||Math.abs(actor.speed)>1.2)return false;actor.playerTaken=true;actor.edge=null;actor.speed=0;return true;},release(){delete actor.playerTaken;}};});
   police=new PoliceSimulation(mobility.roads,world);police.relaxed=city.id.startsWith('copenhagen');policeRenderer=createPoliceRenderer(scene,police);police.onIncident=(...incident)=>finale.incident(...incident);roadblock=createRoadblock(scene,{world,police,carModel:carGroup,playerLook:travelRenderer.look,isVisible:trafficInView,obstacles:()=>[...mobility.cars.filter(c=>c.edge),...(tramSim?.bodies||[]),...(buses?.bodies||[]),...travel.parkedBodies(),...police.obstacles],onWarning:message=>toast(message,{important:true})});
   tramSim=new TramSimulation(tramData,world);tramSim.reset(car);tramRenderer=createTramRenderer(scene,tramSim);tramRenderer.update(car);
   cyclists=city.id==='copenhagen'?new CityCyclists(mobility.roads,world,42):new Cyclists(data);cyclistRenderer=createCyclistRenderer(scene,cyclists);cyclistRenderer.update(car);
   npcScooters=new ScooterRiders(mobility.walks,world,city.id.startsWith('copenhagen')?{count:0}:undefined);npcScooters.reset(car);npcScooterRenderer=createScooterRiderRenderer(scene,npcScooters);npcScooterRenderer.update(car);
   birds=createBirds(data,{colonies:birdColonies});cityModel.add(birds.group);
   safeBirdFlight=createBirdFlightClearance({buildings:world.cameraBuildings,stalls:market.stalls||[],water:world.water});
   marketShop=new MarketShop({stalls:market.stalls||[]});if(marketShop.stalls.length)marketShopRenderer=createMarketShopRenderer(cityModel,marketShop.stalls); // only where the city has market stalls
   // Bystanders react to a pedestrian hit: graph walkers through mobility, free crowds directly (crowd-reaction.js).
   {const walkers=new Set(mobility.people);crowd=createCrowdReaction({sight:world.sightBuildings,scare:(a,from,s)=>walkers.has(a)?mobility.scare(a,from,s):a.scared={x:from.x,z:from.z,left:s},hold:(a,s)=>walkers.has(a)?mobility.hold(a,s):a.heldFor=s});
    impacts.onHit=e=>crowd.alarm(e,[mobility.people,detailPeople]);}
   progress(94,'Preparing buses');buses=await createBusSystem(scene,world,car);
   // Lanes know the tram tracks and buses the junction signals; respawn traffic clear of trams and buses.
   transitQueue.splice(0).forEach(addTransit);mobility.attachTrams(tramSim);mobility.attachBuses(buses.simulation);buses.reset(car,tramSim.obstacles);mobility.externalBodies=transitBodies();mobility.reset(car);
   progress(100,'Ready');
   ready=true;carGroup.visible=true;marker.visible=true;loadingScreen.ready(startPoint.name);
   if(!helsinki)$('boot-place-label').textContent=`Your starting point in ${city.name}`;
   startPicker=createStartPicker({starts:data.landmarks,current:startPoint,onChange:previewStart});
   const menu=$('landmark-buttons');data.landmarks.forEach((l,i)=>{const b=document.createElement('button');b.textContent=`${i+1}  ${l.name}`;b.addEventListener('click',()=>visitStart(l,b));menu.append(b);});
   updateDataCounts();
   if(!helsinki){
    document.querySelector('#map-dialog h2').textContent=`${city.name}.`;
    document.querySelector('#map-dialog .dialog-copy').textContent=`${(city.radius/1000).toFixed(1)} km around the centre of ${city.name}. Pick a starting point, then find your own way.`;
    document.querySelector('#map-dialog .map-caption span').textContent=`${(city.radius/1000).toFixed(1)} KM PLAYABLE RADIUS`;
    document.querySelector('#sources-dialog h2').textContent=`${city.name}, from open data.`;
    document.querySelector('#sources-dialog .dialog-copy').textContent=`${city.attribution} Built with the worldhood city builder; maintained by ${city.maintainers?.length?city.maintainers.join(', '):'the community'}.`;
    document.querySelector('#sources-dialog .help-note').textContent=`An evolving reconstruction of the city. Building heights, facades and street details may be estimated. ${hasTerrain()?'Terrain follows the bundled elevation data.':'Terrain is flattened.'} Traffic and public transport are simulated rather than live services.`;
    document.querySelector('#sources-dialog .attribution').textContent=city.attribution;
    const sourceLinks=document.querySelector('#sources-dialog .source-links');sourceLinks.replaceChildren();
    for(const [label,href]of [['OpenStreetMap','https://www.openstreetmap.org/copyright'],['Data and asset credits','https://github.com/worldhood/worldhood/blob/main/NOTICE.md']]){const a=document.createElement('a');a.textContent=label+' ↗';a.href=href;a.target='_blank';a.rel='noreferrer';sourceLinks.append(a);}
    document.querySelector('#map-dialog .map-caption').firstChild.textContent=`${city.name.toUpperCase()} FROM OPEN DATA `;
    document.querySelector('#help-dialog .help-note').textContent='Explore this single-player city playground on foot, by car, bicycle or scooter. Share the streets with simulated traffic and pedestrians. Available rides start near each starting point; buildings and water constrain movement.';
    $('district-label').textContent=city.name.toUpperCase();
    document.querySelector('#pause-overlay h2').textContent=`${city.name} can wait.`;
    $('sources-btn').firstChild.textContent=`Map data © OpenStreetMap contributors · ODbL${city.furniture?' · Mapillary':''}${/Digiroad/.test(city.attribution)?' · Digiroad CC BY':''}${city.terrain?/National Land Survey/.test(city.terrain.source)?' · NLS elevation CC BY':' · Mapterhorn elevation':''} `;
    document.querySelector('.minimap-caption').firstChild.textContent=`${city.name.toUpperCase()} CENTRE `;const cathedralLabel=$('cathedral-label');if(cathedralLabel)cathedralLabel.hidden=true;
   }
   if(extensions.length){
    const names=extensions.map(e=>e.title).join(' and ');
    document.querySelector('#map-dialog .dialog-copy').textContent=`Two kilometres around the cathedral, plus the ${names} corridor (dashed outline). Pick a starting point, then find your own way.`;
    document.querySelector('#map-dialog .map-caption span').textContent='2 KM RADIUS + EXTENSIONS';
    const note=document.createElement('p');note.className='help-note';
    note.textContent=`Map extensions: ${extensions.map(e=>`${e.title} — ${e.provenance.note||`City of Helsinki data fetched ${e.provenance.fetchedAt} (CC BY 4.0); ${e.counts.inferredForestTrees.toLocaleString('en')} forest trees are inferred inside mapped forest areas`}`).join('; ')}. Route crop outlines © OpenStreetMap contributors (ODbL). Seurasaari is car-free in reality.`;
    $('data-counts').after(note);
   }
   if(city.id.startsWith('copenhagen')&&CITIES[city.id==='copenhagen'?'copenhagen-1760':'copenhagen']){const b=$('era-btn');b.hidden=false;$('era-label').textContent=city.id==='copenhagen'?'1760':'Today';b.addEventListener('click',()=>{if(!started)return;eraJump();$('world').focus();});}
   if(eraArrival?.to===city.id){showEraCard(city.era===1760?'1760':'today',true);setTimeout(()=>{if(!started)start();},300);} // arriving from the other century: straight into the game
   if(requestedStart&&!pickStart(data.landmarks,requestedStart))toast(`No start called “${requestedStart}”. Starting at ${firstStart.name}.`);
   installMapillaryAttribution(city);
   {const a=document.createElement('a');a.href='/THIRD_PARTY_LICENSES.txt';a.textContent='Open-source software notices ↗';a.target='_blank';a.rel='noreferrer';document.querySelector('#sources-dialog .source-links').append(a);}
   $('world').setAttribute('aria-label',`3D view of ${city.name}, explored on foot, by car, bike or scooter`);
   document.querySelector('#help-dialog .dialog-copy').textContent=`Explore ${city.name} by car, on foot, by bicycle or on a scooter. Press F to get out, Enter to use a nearby stopped car, bicycle or scooter, and G to greet someone. Hold Shift to run. Tap the small action buttons on a phone. The minimap stays north-up.`;
   document.querySelector('#help-dialog .dialog-drive').firstChild.textContent='Keep exploring ';
   const helpGrid=document.querySelector('#help-dialog .help-grid');if(helpGrid)$('pause-controls').append(helpGrid.cloneNode(true));
   updateHUD(0);
   // Read-only diagnostics for smoke tests and performance inspection.
   window.openCityDrive={getState:()=>({ready,started,paused,mapOpen,photoMode,captureMode,frame:{...captureFrame},pixelRatio:renderer.getPixelRatio(),highCamera,chaseCamera,camera:{type:camera.type,height:camera.position.y,heading:cameraHeading,look:cameraLook},surface:surfaceNow,angryDrivers:angryDrivers?.snapshot()||[],rumble:{bob:rumbleNow.bob,roll:rumbleNow.roll,pitch:rumbleNow.pitch,intensity:rumbleNow.intensity,carY:carGroup.position.y,cameraY:cameraRumble[1]},harbour:harbour.group.userData,car:{...car},travel:travel.snapshot(),conversation:peopleInteraction.snapshot(),mobility:mobility.snapshot(),trams:tramSim.snapshot(),cyclists:cyclists.snapshot(),scooters:npcScooters.snapshot(),streaming:{surfaces:surfaceStreamer?.snapshot(),regions:extensionStreamer?.snapshot(),switchingStart},objects:world.objects.snapshot(),loadedRoofTiles:loadedTiles.size,loadedPhotoTiles:photoTiles.size,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,spawn:{...startPoint},counts:{buildings:data.buildings.length,roofs:roofIndex.buildings,trees:data.trees.length,trunks:{...treeTrunks?.stats}}})};
   window.openCityDrive.getLocation=currentLocation;window.helsinkiDrive=window.openCityDrive; // old name kept as an alias
   // Market stalls: state for smoke tests, and a shortcut that puts the walking player at a stall front (scripted demos).
   window.openCityDrive.market={state:()=>marketShop.snapshot(),encounter:()=>gullEncounter.snapshot(),
    // `clearView`: no other canopy right behind the customer, so the follow camera has room (good for recordings).
    stalls:()=>marketShop.stalls.map(({id,kind,x,z,w,d,facing=0},i,all)=>{const {nx,nz}=stallFrame({facing});return {index:i,id,kind,x,z,w,d,facing,clearView:all.every(o=>o===all[i]||[3,5,7,9].every(k=>{const px=x+nx*(d/2+k),pz=z+nz*(d/2+k);return Math.abs(px-o.x)>o.w/2+1||Math.abs(pz-o.z)>o.d/2+1;}))};}),
    standAt(i=0,{distance=1.2}={}){const s=marketShop.stalls[i];if(!s||travel?.mode!=='walk')return null;const {nx,nz}=stallFrame(s),p={x:s.x+nx*(s.d/2+distance),z:s.z+nz*(s.d/2+distance),heading:Math.atan2(nx,nz)};
     Object.assign(travel.actor,p,{speed:0,steer:0});car=travel.actor;cameraHeading=driveCamera.heading=p.heading;return p;}};
   const baseState=window.openCityDrive.getState;
   window.openCityDrive.getState=()=>({...baseState(),buses:buses.snapshot(),police:police.snapshot(),finale:finale.snapshot(),roadblock:roadblock.snapshot(),knockables:knockables?.snapshot(),impacts:impacts.snapshot(),crossingSigns:crossingSigns.userData,routeCrossingSigns:routeCrossingSigns.userData,places:places.map(p=>p.place),speciesTrees:speciesTrees?{...speciesTrees.stats,shown:speciesTrees.levels()}:null,details:helsinki?{terminal:terminalLife.snapshot(),market:marketLife.group.userData,university:universityLife.group.userData,senate:senateProps.group.userData,roadworks:roadworks.group.userData,furniture:furniture.group.userData,micromobility:{...micromobility.group.userData,...micromobility.knockables.snapshot()},amanda:market.group.userData.amanda,kaivokatu:kaivokatuDetails.group.userData,station:{...stationStreetLife.group.userData,extraTrafficSlots:16,activeExtraCars:mobility.cars.filter(c=>c.stationOnly&&c.edge).length}}:{}});
   if(import.meta.env.DEV)window.openCityDrive.testPoliceIncident=(kind='vehicle',id='test')=>police.report(kind,id);
   if(import.meta.env.DEV){window.openCityDrive.post=post;window.openCityDrive.camera=camera;} // perf/visual inspection of the post pipeline
   if(import.meta.env.DEV){window.openCityDrive.mobility=mobility;window.openCityDrive.travel=travel;window.openCityDrive.objects=world.objects;window.openCityDrive.npcScooters=npcScooters;} // tests: stage NPC cars for crash checks
   if(import.meta.env.DEV){window.openCityDrive.police=police;window.openCityDrive.tramSim=tramSim;window.openCityDrive.roadblock=roadblock;window.openCityDrive.car=()=>car;window.openCityDrive.mobileControls=mobileControls;window.openCityDrive.extensionStreamer=extensionStreamer;window.openCityDrive.streetLife=streetLife;} // tests: surge/arrest diagnostics, tram fleet A/B for frame-rate checks
   if(import.meta.env.DEV){window.openCityDrive.birds=birds;window.openCityDrive.impacts=impacts;window.openCityDrive.crowd=crowd;window.openCityDrive.detailPeople=()=>detailPeople;} // bird flocks: snapshot(), advance()
   if(import.meta.env.DEV)window.openCityDrive.scene=scene; // perf inspection: triangle/draw breakdown by object
   // Repeatable street-level debug viewpoints; absent from production builds.
   if(import.meta.env.DEV)window.openCityDrive.inspectView=({x,z,heading=0})=>{
    inspectionCamera=null;
    if(![x,z,heading].every(Number.isFinite)||!insidePlayable(x,z)||world.buildings.at(x,z)||(!world.roads.at(x,z)&&!world.pavement.at(x,z)))throw Error('Inspection point must be on clear mapped ground');
    setStart({name:'Street inspection',district:'Helsinki',x,z,heading});cameraLook=0;setPaused(true);
   };
   if(import.meta.env.DEV)window.openCityDrive.inspectCamera=({eye,target})=>{
    if(![...eye,...target].every(Number.isFinite)||!insidePlayable(eye[0],eye[2]))throw Error('Invalid reference camera');
    inspectionCamera={eye,target};setPaused(true);
   };
   // Debug: hide/show a named detail group (e.g. 'Route street furniture', 'Granite kerbstones') to measure its render cost.
   if(import.meta.env.DEV)window.openCityDrive.mappedFurniture=mappedFurniture; // tests: placed furniture and its hittable posts
   if(import.meta.env.DEV)window.openCityDrive.setDetailVisible=(name,visible)=>{let n=0;scene.traverse(o=>{if(o.name===name){o.visible=!!visible;n++;}});return n;};
 }catch(e){
  const stage=$('load-detail').textContent;
  console.error('Helsinki startup failed:',stage,e);
  window.helsinkiBootError={stage,message:String(e.message||e),stack:e.stack};
  reportGameError(e,'startup');
 }
}
boot();
