// Cities this build can load, and URL selection of city and starting point:
//   ?city=helsinki&start=seurasaari-bridge
// A city entry names its data root (all runtime files under it) and its
// geographic origin. Helsinki-specific scenery modules only run for Helsinki;
// see docs/ADDING_A_CITY.md for what a new city needs.
export const CITIES={
 helsinki:{id:'helsinki',name:'Helsinki',dataRoot:'/data',origin:[24.9522,60.1701],projection:'EPSG:3879',radius:2000,defaultStart:'olympia-terminal',scenery:'helsinki',
  attribution:'City of Helsinki and HSL open data, CC BY 4.0'}
};
export const DEFAULT_CITY='helsinki';
// This fork's site opens on Copenhagen when no ?city= is given (falls back to Helsinki if it isn't built).
export const SITE_CITY='copenhagen';

// Cities built with `npm run city:build` are listed in public/cities/index.json.
export function registerCities(list=[]){for(const c of list)if(c?.id&&!CITIES[c.id])CITIES[c.id]={radius:1500,...c};return CITIES;}

// Every runtime data URL goes through dataUrl so a city's files live under its own root.
let dataRoot=CITIES[DEFAULT_CITY].dataRoot;
export const dataUrl=path=>`${dataRoot}/${path}`;
export function useCity(city){dataRoot=city.dataRoot;return city;}

// "Töölö (National Opera)" → "toolo-national-opera"
export function slug(text){
 return String(text).replace(/[øØ]/g,'o').replace(/[æÆ]/g,'ae').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
}

export function selectCity(search=''){
 const id=slug(new URLSearchParams(search).get('city')||(CITIES[SITE_CITY]?SITE_CITY:DEFAULT_CITY));
 const city=CITIES[id];
 if(!city)throw Error(`City “${id}” is not in this build yet. Available: ${Object.values(CITIES).map(c=>c.name).join(', ')}.`);
 return city;
}

// Exact slug first, then a start whose slug begins with or contains the request
// (so ?start=seurasaari finds "Seurasaari bridge"). Null when nothing matches.
export function pickStart(starts,request){
 if(!request)return null;
 const want=slug(request);if(!want)return null;
 const named=starts.map(s=>({s,id:slug(s.id||s.name)}));
 return (named.find(n=>n.id===want)||named.find(n=>n.id.startsWith(want))||named.find(n=>n.id.includes(want)))?.s||null;
}

// A start shown under another name (1760: no Little Mermaid yet) keeps its old name as its key, so ?start= links still work.
export function renameStarts(starts,names){for(const s of starts||[]){const to=names[s.name];if(to){s.id??=slug(s.name);s.name=to;}}return starts;}

// Keep the address bar shareable: it always names the current city and start.
export function startUrl(location,city,start){
 const url=new URL(location.href);url.searchParams.set('city',city.id);url.searchParams.set('start',slug(start.id||start.name));
 return url.pathname+url.search+url.hash;
}
