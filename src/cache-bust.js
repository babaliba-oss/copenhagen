// Every deploy gets its own data URLs (?v=<build id>), so a browser never mixes a new game with
// city files it cached from an older build (the cause of "old map, Y does nothing" after deploys).
const BUILD=typeof __BUILD_ID__!=='undefined'?__BUILD_ID__:'dev';
const DATA=/^\/(cities|data|models|materials)\//;
const native=globalThis.fetch.bind(globalThis);
const HASHES=typeof __DATA_HASHES__!=='undefined'?__DATA_HASHES__:null;
// Version: the content hash of the file (or of its tile folder), else the build id.
function version(url){if(!HASHES)return BUILD;const p=url.split('?')[0].replace(/^\//,''),parts=p.split('/');
 const key=parts[0]==='cities'&&parts.length>3?parts.slice(0,3).join('/')+'/':parts[0]==='data'&&parts.length>2?parts.slice(0,2).join('/')+'/':p;
 return HASHES[key]||BUILD;}
globalThis.fetch=(input,init)=>{
 if(typeof input==='string'&&DATA.test(input)&&BUILD!=='dev')input+=(input.includes('?')?'&':'?')+'v='+version(input);
 return native(input,init);
};
