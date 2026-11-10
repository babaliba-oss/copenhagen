// Analytics hooks (src/track.js) and share links (src/copenhagen/share.js).
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {createTracker,track,bucket} from '../src/track.js';
import {shareUrl,shareOut,shareSaid,SITE} from '../src/copenhagen/share.js';
const env=(config,over={})=>{const calls=[];return {calls,t:createTracker({config,nav:{sendBeacon:u=>{calls.push(['beacon',u]);return true;},...over.nav},loc:{hostname:'gtcopenhagen.com',origin:'https://gtcopenhagen.com',pathname:'/',search:'?city=copenhagen-1760&start=nyhavn&utm_x=secret',...over.loc},doc:{title:'Grand Tour Copenhagen',referrer:'https://example.org/'},fetch:(u,o)=>{calls.push(['fetch',u,o]);return Promise.resolve();}})};};

test('provider none (the default, and what index.html ships): no network call at all',()=>{
 for(const config of ['none','',undefined,'nonsense https://x.example','goatcounter']){const {t,calls}=env(config);
  assert.equal(t('pageview',{city:'copenhagen'}),false);assert.equal(t('race_finish',{id:'lakes-loop',medal:'gold'}),false);assert.deepEqual(calls,[],String(config));}
 assert.match(fs.readFileSync('index.html','utf8'),/<meta name="analytics" content="none" \/>/);
 assert.equal(track('start'),false,'no page (node): nothing, and no throw');
});
test('GoatCounter: a page view with the map in its path, an event as name/values, by beacon',()=>{
 const {t,calls}=env('goatcounter https://gtc.goatcounter.com/count');
 assert.equal(t('pageview',{city:'copenhagen-1760',era:'1760',device:'phone'}),true);assert.equal(t('race_finish',{id:'lakes-loop',medal:'gold'}),true);
 assert.equal(calls.length,2);const [a,b]=calls.map(c=>new URL(c[1]));assert.equal(calls[0][0],'beacon');
 assert.equal(a.origin+a.pathname,'https://gtc.goatcounter.com/count');
 assert.equal(a.searchParams.get('p'),'/?city=copenhagen-1760','only the map is kept from the address');assert.equal(a.searchParams.get('r'),'https://example.org/');assert.equal(a.searchParams.get('e'),null);
 assert.equal(b.searchParams.get('p'),'race_finish/lakes-loop/gold');assert.equal(b.searchParams.get('e'),'true');assert.equal(b.searchParams.get('r'),null);
 assert.ok(!calls.some(c=>/secret|nyhavn/.test(c[1])));
});
test('GoatCounter without sendBeacon falls back to a keepalive fetch',()=>{
 const {t,calls}=env('goatcounter https://gtc.goatcounter.com/count',{nav:{sendBeacon:undefined}});t('start');
 assert.equal(calls[0][0],'fetch');assert.equal(calls[0][2].keepalive,true);assert.match(calls[0][1],/[?&]p=start&/);
});
test('Plausible: the events API, a JSON body with the event, the page, the domain and the values',()=>{
 const {t,calls}=env('plausible gtcopenhagen.com');t('pageview',{device:'desktop'});t('saga_finish',{id:'holger',long:'x'.repeat(90),skip:{a:1}});
 assert.equal(calls[0][1],'https://plausible.io/api/event');assert.equal(calls[0][2].method,'POST');assert.equal(calls[0][2].keepalive,true);
 assert.deepEqual(JSON.parse(calls[0][2].body),{name:'pageview',url:'https://gtcopenhagen.com/?city=copenhagen-1760',domain:'gtcopenhagen.com',referrer:'https://example.org/',props:{device:'desktop'}});
 const e=JSON.parse(calls[1][2].body);assert.equal(e.name,'saga_finish');assert.equal(e.props.id,'holger');assert.equal(e.props.long.length,40);assert.ok(!('skip' in e.props)&&!('referrer' in e));
 const own=env('plausible gtcopenhagen.com https://stats.example/api/event');own.t('start');assert.equal(own.calls[0][1],'https://stats.example/api/event');
});
test('never tracks with Do Not Track or Global Privacy Control, on localhost or in ?cinematic, and never throws',()=>{
 for(const over of [{nav:{doNotTrack:'1'}},{nav:{globalPrivacyControl:true}},{loc:{hostname:'localhost'}},{loc:{hostname:'127.0.0.1'}},{loc:{search:'?cinematic'}}])
  for(const config of ['goatcounter https://gtc.goatcounter.com/count','plausible gtcopenhagen.com']){const {t,calls}=env(config,over);assert.equal(t('start'),false);assert.deepEqual(calls,[]);}
 const bad=createTracker({config:'plausible gtcopenhagen.com',nav:{},loc:{hostname:'gtcopenhagen.com',origin:'https://gtcopenhagen.com',pathname:'/',search:''},doc:{},fetch:()=>{throw Error('blocked');}});
 assert.equal(bad('start'),false);
 const rejecting=createTracker({config:'plausible gtcopenhagen.com',nav:{},loc:{hostname:'gtcopenhagen.com',origin:'https://gtcopenhagen.com',pathname:'/',search:''},doc:{},fetch:()=>Promise.reject(Error('offline'))});
 assert.equal(rejecting('start'),true); // the rejection is swallowed (an unhandled one would fail this test run)
});
test('seconds to ready come in buckets',()=>{assert.deepEqual([2,7,15,30,60,200].map(bucket),['under 5 s','5-10 s','10-20 s','20-40 s','40-80 s','over 80 s']);});
test('nothing is stored: track.js uses no cookies or storage',()=>{assert.doesNotMatch(fs.readFileSync('src/track.js','utf8').replace(/\/\/.*$/gm,''),/cookie|localStorage|sessionStorage|indexedDB/);});

test('share links open the right map, at a race\'s start or a named start',()=>{
 assert.equal(shareUrl(),SITE);assert.equal(shareUrl({race:'lakes-loop'}),'https://gtcopenhagen.com/?race=lakes-loop');
 assert.equal(shareUrl({historic:true,race:'coach-dash'}),'https://gtcopenhagen.com/?city=copenhagen-1760&race=coach-dash');
 assert.equal(shareUrl({historic:true,start:'gammeltorv'}),'https://gtcopenhagen.com/?city=copenhagen-1760&start=gammeltorv');
});
test('sharing uses the share sheet when there is one, else copies the line and the link and says so',async()=>{
 const what={text:'Lakes Loop in 2:01.4 (gold) in Grand Tour Copenhagen. Can you beat it?',url:'https://gtcopenhagen.com/?race=lakes-loop'};let got=null;
 assert.equal(await shareOut(what,{share:async d=>{got=d;}}),'shared');assert.equal(got.text,what.text);assert.equal(got.url,what.url);
 assert.equal(await shareOut(what,{share:async()=>{throw Object.assign(Error('closed'),{name:'AbortError'});}}),'cancelled');
 assert.equal(await shareOut(what,{clipboard:{writeText:async t=>{got=t;}}}),'copied');assert.equal(got,`${what.text} ${what.url}`);
 assert.equal(await shareOut(what,{share:async()=>{throw Error('not allowed');},clipboard:{writeText:async t=>{got='c:'+t;}}}),'copied','a refused sheet falls back to the clipboard');
 assert.equal(await shareOut(what,{},null),'failed');
 assert.equal(shareSaid('copied',what.url),'Link copied.');assert.equal(shareSaid('shared',what.url),'');assert.match(shareSaid('failed',what.url),/race=lakes-loop/);
});
