// Analytics hooks, provider-agnostic: track(event, props). The events are listed in docs/COPENHAGEN.md (Analytics).
// One config, <meta name="analytics" content="…"> in index.html:
//   none                                              the default: no network calls at all
//   goatcounter https://CODE.goatcounter.com/count    GoatCounter's count endpoint
//   plausible gtcopenhagen.com                        Plausible's events API (a third word: another API URL, self-hosted)
// Sent: an event name and a few game values (era, race id, medal). No cookies, no stored ids, nothing typed by the
// player, no position. Do Not Track / Global Privacy Control turn it off; so do localhost and ?cinematic.
const clean=props=>{const out={};for(const [k,v] of Object.entries(props||{}))if(['string','number','boolean'].includes(typeof v))out[k]=typeof v==='string'?v.slice(0,40):v;return out;};
export const bucket=s=>s<5?'under 5 s':s<10?'5-10 s':s<20?'10-20 s':s<40?'20-40 s':s<80?'40-80 s':'over 80 s';

export function createTracker({config='none',nav=null,loc=null,doc=null,fetch:f=null}={}){
 const [provider,a,b]=String(config||'none').trim().split(/\s+/);
 if(!['goatcounter','plausible'].includes(provider)||!a)return ()=>false;
 const off=()=>nav?.doNotTrack==='1'||nav?.doNotTrack==='yes'||nav?.globalPrivacyControl===true||/^(localhost$|127\.|\[::1\]|$)/.test(loc?.hostname||'')||/[?&]cinematic\b/.test(loc?.search||'');
 // The page as counted: the path and the map (?city=), nothing else from the address.
 const page=()=>{const c=new URLSearchParams(loc.search).get('city');return loc.pathname+(c?`?city=${encodeURIComponent(c)}`:'');};
 const post=(url,body)=>{const p=f?.(url,{method:'POST',keepalive:true,...(body?{headers:{'Content-Type':'text/plain'},body}:{mode:'no-cors'})});p?.catch?.(()=>{});};
 return (event,props)=>{try{
  if(off())return false;const p=clean(props);
  if(provider==='goatcounter'){ // no properties there: an event is counted as "name/value/value"; the page view carries the map in its path
   const q=new URLSearchParams(event==='pageview'?{p:page(),t:doc?.title||'',r:doc?.referrer||''}:{p:[event,...Object.values(p)].join('/'),t:event,e:'true'});q.set('rnd',Math.random().toString(36).slice(2,8));
   const url=`${a}?${q}`;if(!nav?.sendBeacon?.(url))post(url);
  }else post(b||'https://plausible.io/api/event',JSON.stringify({name:event,url:loc.origin+page(),domain:a,...(event==='pageview'?{referrer:doc?.referrer||null}:{}),props:p}));
  return true;
 }catch{return false;}};
}

let tracker=null;
export function track(event,props){
 try{tracker??=typeof document==='undefined'||typeof location==='undefined'?()=>false:createTracker({config:document.querySelector('meta[name="analytics"]')?.content,nav:globalThis.navigator,loc:location,doc:document,fetch:globalThis.fetch?.bind(globalThis)});return tracker(event,props);}catch{return false;}
}
