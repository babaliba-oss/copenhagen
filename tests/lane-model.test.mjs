import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareGraph,Mobility,signalGreen} from '../src/mobility.js';
import {annotateJunctions,annotateTramRelations,tramThreat,boxesOverlap,oncomingPasses,CAR_HALF_LENGTH} from '../src/lane-model.js';
import {TramSimulation} from '../src/tram-simulation.js';
import {laneOffset,busLaneOffsets} from '../src/bus-simulation.js';

// A plus-shaped junction at the origin with 60 m arms, two-way streets, one signal.
function plus({signal=0,lane=1.45,arm=60}={}){
 const nodes=[[0,0],[0,-arm],[arm,0],[0,arm],[-arm,0]],edges=[];
 for(let k=1;k<=4;k++){edges.push({from:k,to:0,points:[nodes[k],nodes[0]],lane,signal});edges.push({from:0,to:k,points:[nodes[0],nodes[k]],lane,signal:-1});}
 return {nodes,edges};
}
const open={roads:{at:()=>true},buildings:{at:()=>undefined}};
const noWalks={nodes:[],edges:[]};
const edgeOf=(graph,from,to)=>graph.edges.find(e=>e.from===from&&e.to===to);
function carOn(sim,edge,s,extra={}){const a=sim.cars[extra.id??0];Object.assign(a,{edge,s,speed:extra.speed??8,plan:[],...sim.position({...a,edge,s,plan:[]}),waiting:0,stuck:0},extra);a.plan=extra.plan||[];return a;}

test('junction: only approaches stop at the signal, crossing approaches never share a green, stop lines clear the cross lanes',()=>{
 const g=prepareGraph(plus());annotateJunctions(g,[{p:[2,2]}]);
 const west=edgeOf(g,4,0),north=edgeOf(g,1,0),out=edgeOf(g,0,2);
 assert.ok(west.signal>=0&&north.signal>=0);assert.equal(out.signal,-1);
 assert.notEqual(west.signalGroup,north.signalGroup);
 for(let t=0;t<64;t+=.25)assert.ok(!(signalGreen(west,t)&&signalGreen(north,t)),`both green at ${t}`);
 assert.ok(west.stopGap>CAR_HALF_LENGTH+1.45+.98,'the car front stops short of the crossing lane');
});

test('junction: signals a few metres apart run as one junction',()=>{
 const g=prepareGraph(plus());g.edges.find(e=>e.from===1&&e.to===0).signal=1;annotateJunctions(g,[{p:[2,2]},{p:[-8,10]}]);
 assert.equal(edgeOf(g,4,0).signal,edgeOf(g,1,0).signal);
});

test('junction: a boulevard\'s two carriageways (lights 54 m apart, nodes 14 m) run as one junction, the middle is not stopped again',()=>{
 const nodes=[[0,0],[14,0],[-60,0],[74,0],[0,-60],[0,60],[14,-60],[14,60]],edges=[],two=(a,b,s)=>{edges.push({from:a,to:b,points:[nodes[a],nodes[b]],lane:1.45,signal:s(b)});edges.push({from:b,to:a,points:[nodes[b],nodes[a]],lane:1.45,signal:s(a)});};
 const sig=k=>k===0?0:k===1?1:-1;two(0,1,sig);two(2,0,sig);two(4,0,sig);two(5,0,sig);two(1,3,sig);two(1,6,sig);two(1,7,sig);
 const g=prepareGraph({nodes,edges});const {centre}=annotateJunctions(g,[{p:[-20,5]},{p:[34,5]}]);
 assert.equal(edgeOf(g,2,0).signal,edgeOf(g,3,1).signal);assert.equal(edgeOf(g,0,1).signal,-1);assert.ok(edgeOf(g,0,1).inside);assert.deepEqual(centre[edgeOf(g,2,0).signal],[7,0]);
});

test('tram relations: crossing, shared same-direction track, oncoming track passed, a track beside the lane shared',()=>{
 const road=prepareGraph({nodes:[[-50,0],[50,0]],edges:[{from:0,to:1,points:[[-50,0],[50,0]],lane:1.5,signal:-1}]}),e=road.edges[0];
 // Lane runs along z=1.5 heading +x. Tracks: a crossing at x=10, a same-direction track on the lane, an oncoming one 2 m away.
 const path=(id,points)=>prepareGraph({nodes:[points[0],points.at(-1)],edges:[{id,shapeId:id,points,from:0,to:1,lane:0}]}).edges[0];
 annotateTramRelations([e],[path('cross',[[10,-40],[10,40]])]);
 assert.equal(e.tramConflicts.length,1);const c=e.tramConflicts[0];assert.ok(c.from<60&&c.to>60&&c.to-c.from<7,`crossing at ${c.from}–${c.to}`);
 annotateTramRelations([e],[path('same',[[-60,1.5],[60,1.5]])]);
 assert.ok(e.tramShared?.length&&!e.tramConflicts,'a lane on its own direction\'s track is shared, not a conflict');
 annotateTramRelations([e],[path('oncoming',[[60,3.6],[-60,3.6]])]);
 assert.ok(!e.tramConflicts&&!e.tramShared,'an oncoming track beside the lane is passed');
 annotateTramRelations([e],[path('beside',[[-60,3.4],[60,3.4]])]);
 assert.ok(e.tramShared?.length&&!e.tramConflicts,'a same-direction track 1.9 m off the lane is shared: the car keeps clear of it or drives on it');
});

test('tram threat: on the stretch or arriving soon blocks it, a tram held at red or far away does not',()=>{
 const path={},at=(s,extra={})=>({path,s,speed:8,wait:0,...extra});
 assert.ok(tramThreat([at(100)],path,98,102,4),'over it');
 assert.ok(tramThreat([at(70)],path,98,102,4),'arrives in about 3 s');
 assert.equal(tramThreat([at(70,{speed:0,redFor:12})],path,98,102,4),null,'stopped at a red light');
 assert.equal(tramThreat([at(10)],path,98,102,4),null,'far away');
 assert.equal(tramThreat([at(140)],path,98,102,4),null,'already past');
});

test('boxes and oncoming passing',()=>{
 const a={x:0,z:0,heading:0,hl:2.36,hw:.98};
 assert.ok(boxesOverlap(a,{x:1.5,z:0,heading:Math.PI/2,hl:2.36,hw:.98}));
 assert.ok(!boxesOverlap(a,{x:2.1,z:0,heading:0,hl:2.36,hw:.98}));
 assert.ok(oncomingPasses({x:0,z:0,heading:0},{x:1.6,z:-10,heading:Math.PI}));
 assert.ok(!oncomingPasses({x:0,z:0,heading:0},{x:.4,z:-10,heading:Math.PI}));
 assert.ok(!oncomingPasses({x:0,z:0,heading:0},{x:1.6,z:-10,heading:0}),'same direction is followed, not passed');
});

test('a car stops before the cross lanes at red and goes on green',()=>{
 const roads=plus(),sim=new Mobility({roads,walks:noWalks,signals:[{p:[2,2]}]},open,{cars:1,people:0});
 const west=edgeOf(sim.roads,4,0);let t=0;while(signalGreen(west,t))t+=.5;sim.time=t;
 const car=carOn(sim,west,30);const player={x:60,z:60,heading:0,speed:0};
 for(let i=0;i<120&&!signalGreen(west,sim.time);i++)sim.step(1/30,player);
 assert.ok(car.x+CAR_HALF_LENGTH<-(1.45+.98),`front at ${(car.x+CAR_HALF_LENGTH).toFixed(2)} is clear of the crossing lane`);
 assert.equal(car.hold,'signal');
 for(let i=0;i<30*25;i++)sim.step(1/30,player);
 assert.ok(car.edge!==west||car.s>west.length-.1,'it drove on once green');
});

test('a car does not enter a junction it cannot leave (keep clear)',()=>{
 const roads=plus({signal:-1}),sim=new Mobility({roads,walks:noWalks,signals:[]},open,{cars:2,people:0});
 const west=edgeOf(sim.roads,4,0),east=edgeOf(sim.roads,0,2);
 // A queue stands just past the junction (held by the player standing in the lane).
 const player={x:16,z:1.45,heading:-Math.PI/2,speed:0};
 const queued=carOn(sim,east,6,{id:1,speed:0});
 const car=carOn(sim,west,35,{plan:[east]});
 for(let i=0;i<30*12;i++)sim.step(1/30,player);
 assert.ok(queued.x<16,'the queue is there');
 assert.ok(car.x+CAR_HALF_LENGTH<-(1.45+.98)+.1,`waiting car front at ${(car.x+CAR_HALF_LENGTH).toFixed(2)} stays out of the box`);
 assert.equal(car.hold,'keep clear');
});

test('a car waits for a tram at a crossing, never stops on the rails, and crosses after it',()=>{
 const roads={nodes:[[-120,0],[120,0]],edges:[{from:0,to:1,points:[[-120,0],[120,0]],lane:1.45,signal:-1}]};
 const world={...open},sim=new Mobility({roads,walks:noWalks,signals:[]},world,{cars:1,people:0});
 const trams=new TramSimulation({paths:[{id:'t',line:'9',destination:'Test',points:[[0,-300],[0,300]]}],stops:[]},world);
 sim.attachTrams(trams);const tram=trams.add(trams.paths[0],270,{speed:8.3});trams.refreshObstacles();
 const car=carOn(sim,sim.roads.edges[0],95,{speed:8});const player={x:60,z:60,heading:0,speed:0};
 let onRails=0,crossedBeforeTram=false;
 for(let i=0;i<30*20;i++){trams.step(1/30,player,sim.cars);sim.externalObstacles=trams.obstacles;sim.externalBodies=trams.bodies;sim.step(1/30,player);
  if(Math.abs(car.x)<CAR_HALF_LENGTH+1.2&&car.speed<.1)onRails++;if(car.x>0&&tram.s<300+22)crossedBeforeTram=true;
  for(const b of trams.bodies)assert.ok(!boxesOverlap({x:car.x,z:car.z,heading:car.heading,hl:2.36,hw:.98},b),'never inside the tram');}
 assert.equal(crossedBeforeTram,false,'the tram went first');
 assert.equal(onRails,0,'never stood on the rails');
 assert.ok(car.x>10,`crossed after the tram (x ${car.x.toFixed(1)})`);
});

test('trams stop at red signals and give way to a tram already on a crossing track',()=>{
 const roads=plus({arm:200}),sim=new Mobility({roads,walks:noWalks,signals:[{p:[0,0]}]},open,{cars:0,people:0});
 const trams=new TramSimulation({paths:[{id:'a',line:'1',destination:'N',points:[[1,190],[1,-190]]},{id:'b',line:'2',destination:'E',points:[[-190,-1],[190,-1]]}],stops:[]},open);
 sim.attachTrams(trams);const [a,b]=trams.paths;
 assert.ok(a.signalStops.length===1&&b.signalStops.length===1&&a.signalStops[0].group!==b.signalStops[0].group);
 assert.ok(a.crossTracks.some(x=>x.other===b),'crossing tracks are known');
 const one=trams.add(a,150,{speed:8}),two=trams.add(b,150,{speed:8});const player={x:900,z:900,heading:0,speed:0};
 let together=0,through=new Set(),redRun=0;
 for(let i=0;i<30*40;i++){trams.step(1/30,player,[]);const bodies=trams.bodies;
  for(const t of [one,two]){if(t.s>230)through.add(t);const stop=t.path.signalStops[0];if(t.s+4.9>stop.s+.5&&t.s+4.9<stop.s+3&&!signalGreen({signal:stop.signal,signalGroup:stop.group},trams.time))redRun++;}
  if(bodies.filter(x=>x.ref===one).some(p=>bodies.filter(x=>x.ref===two).some(q=>boxesOverlap(p,q))))together++;}
 assert.equal(together,0,'the two trams never overlap on the crossing');
 assert.equal(redRun,0,'no tram crosses its stop line at red');
 assert.equal(through.size,2,'both got through');
});

test('bus lanes: interpolated offsets and the car lane of the same direction as target',()=>{
 assert.equal(laneOffset({lanes:[0,1.5,1.5]},1.5),.75);assert.equal(laneOffset({},10),0);
 const path=prepareGraph({nodes:[[0,0],[0,-120]],edges:[{id:'p',points:[[0,0],[0,-120]],from:0,to:1,lane:0}]}).edges[0];Object.assign(path,{start:8,end:110});
 const world={roads:{at:(x,z)=>Math.abs(x)<4},buildings:{at:()=>undefined}};
 const lanes=busLaneOffsets(path,world,'city',()=>1.4);
 assert.ok(lanes.slice(5,30).every(v=>Math.abs(v-1.4)<.01),'keeps to the car lane where it fits');
 const narrow=busLaneOffsets(path,{roads:{at:(x,z)=>Math.abs(x)<2},buildings:{at:()=>undefined}},'city',()=>1.4);
 assert.ok(narrow.every(v=>Math.abs(v)<.8),'falls back where a shifted bus would not fit');
});
