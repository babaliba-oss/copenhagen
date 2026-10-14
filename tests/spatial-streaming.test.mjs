import test from 'node:test';
import assert from 'node:assert/strict';
import {createSpatialStreamer,streamingAhead} from '../src/spatial-streaming.js';
import {createSurfaceStreamer,surfaceBounds} from '../src/surface-streaming.js';
import {loadExtensionIndex,loadExtension,createExtensionStreamer,mapViewFor} from '../src/extensions.js';
import {insidePlayable,clearPlayableAreas} from '../src/geo.js';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const record=(id,x)=>({id,bbox:[x,0,x+10,10]});

test('nearest records load with bounded concurrency and finished records stay installed',async()=>{
 const pending=new Map(),calls=[];let active=0,peak=0;
 const s=createSpatialStreamer({concurrency:2,load:r=>{calls.push(r.id);active++;peak=Math.max(peak,active);const d=deferred();pending.set(r.id,d);return d.promise.finally(()=>active--);}});
 s.add([record('far',300),record('near',0),record('middle',100),record('outside',3000)]);s.update({x:0,z:0},{radius:500});await tick();
 assert.deepEqual(calls,['near','middle']);pending.get('near').resolve('near value');await tick();assert.deepEqual(calls,['near','middle','far']);
 pending.get('middle').resolve();pending.get('far').resolve();await tick();assert.equal(peak,2);
 s.update({x:4000,z:4000});s.add([record('near',0)]);assert.deepEqual(await s.require(['near']),['near value']);assert.equal(calls.filter(x=>x==='near').length,1);assert.equal(s.state('outside'),'idle');s.dispose();
});

test('a requested map destination jumps ahead of queued background regions',async()=>{
 const calls=[],pending=new Map(),s=createSpatialStreamer({concurrency:1,load:r=>{calls.push(r.id);const d=deferred();pending.set(r.id,d);return d.promise;}});
 s.add([record('first',0),record('second',100),record('destination',10000)]);
 const background=s.require(['first','second','destination'],{background:true});await tick();const destination=s.require(['destination']);
 pending.get('first').resolve();await tick();assert.deepEqual(calls,['first','destination']);pending.get('destination').resolve();await destination;await tick();pending.get('second').resolve();await background;s.dispose();
});

test('moving away drops queued nearby requests while an explicit destination stays required',async()=>{
 const calls=[],first=deferred(),s=createSpatialStreamer({concurrency:1,load:r=>{calls.push(r.id);return r.id==='first'?first.promise:Promise.resolve(r.id);}});
 s.add([record('first',0),record('left-behind',100),record('destination',5000)]);s.update({x:0,z:0},{radius:500});await tick();
 const destination=s.require(['destination']);s.update({x:10000,z:0},{radius:100});first.resolve();await destination;await tick();assert.deepEqual(calls,['first','destination']);s.dispose();
});

test('required loads retry transient errors and can retry after an exhausted attempt limit',async()=>{
 let attempts=0;const s=createSpatialStreamer({retryDelay:1,maxAttempts:2,load:()=>{attempts++;if(attempts<=2)throw Error('temporary');return 'restored';}});s.add([record('tile',0)]);
 await assert.rejects(s.require(['tile']),/temporary/);assert.equal(attempts,2);assert.equal(s.state('tile'),'error');
 assert.deepEqual(await s.require(['tile']),['restored']);assert.equal(attempts,3);s.dispose();
});

test('surface readiness uses actual polygon bounds and safely includes legacy records',async()=>{
 const values=new Float32Array([-900,0,-10,1,1,1,900,0,10,1,1,1]);assert.deepEqual(surfaceBounds(values),[-900,-10,900,10]);
 const loaded=[],s=createSurfaceStreamer({load:r=>loaded.push(r.file)});s.add([{file:'surfaces/30,0.bin',bbox:surfaceBounds(values)},{file:'legacy.bin'},{file:'distant.bin',bbox:[9000,9000,9100,9100]}]);
 await s.ensure({x:0,z:0},{radius:10});assert.deepEqual(loaded.sort(),['legacy.bin','surfaces/30,0.bin']);assert.equal(s.snapshot().ready,2);s.dispose();
});

test('streaming looks ahead in the actual direction of travel, including reversing',()=>{
 assert.deepEqual(streamingAhead({x:10,z:20,heading:0,speed:10},12),{x:10,z:-100});
 assert.deepEqual(streamingAhead({x:10,z:20,heading:0,speed:-5},12),{x:10,z:80});
 assert.equal(streamingAhead({x:0,z:0,heading:0,speed:1000},20).z,-500);
});

test('catalog loading and map bounds expose all starts without fetching region payloads or opening boundaries',async()=>{
 clearPlayableAreas();const calls=[],entry={id:'outskirts',dir:'extensions/outskirts',mapBounds:[4000,0,5000,1000],playable:[[[[4000,0],[5000,0],[5000,1000],[4000,1000],[4000,0]]]]};
 const entries=await loadExtensionIndex(async url=>{calls.push(url);return {extensions:[entry]};});assert.equal(calls.length,1);assert.match(calls[0],/extensions\/index\.json$/);
 assert.equal(mapViewFor(entries).playable.length,1);assert.ok(!insidePlayable(4500,500));
 const city={water:[]},json=async url=>{calls.push(url);return url.endsWith('water.json')?{water:['shore']}:{};};
 const payload=await loadExtension({...entry,osmWater:'water.json'},json,async url=>{calls.push(url);return new TextEncoder().encode(JSON.stringify(city));});
 assert.deepEqual(payload.city.water,['shore']);assert.equal(calls.length,6);clearPlayableAreas();
});

test('direct starts await complete installation and retries reuse their payload object',async()=>{
 const entries=[record('near',0),record('chosen',5000)],calls=[],gate=deferred();let installs=0,first;
 const s=createExtensionStreamer({entries,retryDelay:1,load:async entry=>{calls.push(entry.id);return {...entry,readyData:true};},install:async e=>{first??=e;assert.equal(e,first);installs++;if(installs===1)throw Error('surface download');await gate.promise;}});
 await tick();assert.deepEqual(calls,[]);await s.ensureStart({x:0,z:0});assert.deepEqual(calls,[]);
 const ready=s.ensureStart({extension:'chosen'});let resolved=false;ready.then(()=>resolved=true);
 // The retry runs on a real timer: wait for it (bounded) instead of a fixed sleep a loaded machine can outrun.
 for(let i=0;i<400&&installs<2;i++)await new Promise(r=>setTimeout(r,5));
 assert.equal(s.state('chosen'),'loading');assert.equal(resolved,false);assert.deepEqual(calls,['chosen']);assert.equal(installs,2);
 gate.resolve();await ready;assert.equal(s.state('chosen'),'ready');assert.equal(s.state('near'),'idle');s.dispose();
});

test('optional missing catalogs are empty but transient failures and malformed catalogs remain visible',async()=>{
 assert.deepEqual(await loadExtensionIndex(async()=>{throw Object.assign(Error('missing'),{status:404});}),[]);
 await assert.rejects(loadExtensionIndex(async()=>{throw Object.assign(Error('server unavailable'),{status:503});}),/server unavailable/);
 await assert.rejects(loadExtensionIndex(async()=>({wrong:[]})),/Invalid map extension catalog/);
});

test('disposing a streamer aborts active callbacks and prevents queued or late completed work',async()=>{
 const gate=deferred(),calls=[],errors=[];let signal;
 const s=createSpatialStreamer({concurrency:1,onError:e=>errors.push(e),load:async(r,context)=>{calls.push(r.id);signal=context.signal;await gate.promise;return r.id;}});
 s.add([record('active',0),record('queued',20)]);const pending=s.require(['active','queued']),rejected=assert.rejects(pending,/disposed/);await tick();
 assert.deepEqual(calls,['active']);assert.equal(signal.aborted,false);s.dispose();await rejected;assert.equal(signal.aborted,true);
 gate.resolve();await tick();assert.deepEqual(calls,['active']);assert.equal(s.state('active'),'cancelled');assert.equal(s.get('active'),undefined);assert.deepEqual(errors,[]);
 await assert.rejects(s.require(['queued']),/disposed/);
});

test('a region download finishing after disposal cannot install or open its area',async()=>{
 const gate=deferred();let installs=0;
 const s=createExtensionStreamer({entries:[record('outer',8000)],load:async e=>{await gate.promise;return e;},install:()=>{installs++;}});
 const pending=s.ensureStart({extension:'outer'}),rejected=assert.rejects(pending,/disposed/);await tick();s.dispose();await rejected;
 gate.resolve();await tick();assert.equal(installs,0);assert.equal(s.state('outer'),'cancelled');
});

test('evictFar unloads far ready records, hands their values over and lets them load again',async()=>{
 const loads=[];const s=createSpatialStreamer({load:r=>{loads.push(r.id);return {id:r.id};},keyOf:r=>r.id,boundsOf:r=>r.bbox});
 s.add([{id:'a',bbox:[0,0,10,10]},{id:'b',bbox:[2000,0,2010,10]}]);
 await s.ensure({x:0,z:0},{radius:5000});assert.deepEqual(loads.sort(),['a','b']);
 const evicted=[];assert.equal(s.evictFar({x:0,z:0},1000,v=>evicted.push(v.id)),1);assert.deepEqual(evicted,['b']);
 assert.equal(s.state('b'),'idle');assert.equal(s.state('a'),'ready');
 await s.ensure({x:2005,z:5},{radius:100});assert.equal(loads.filter(x=>x==='b').length,2);
});
