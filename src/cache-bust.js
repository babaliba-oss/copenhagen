// Every deploy gets its own data URLs (?v=<build id>), so a browser never mixes a new game with
// city files it cached from an older build (the cause of "old map, Y does nothing" after deploys).
const BUILD=typeof __BUILD_ID__!=='undefined'?__BUILD_ID__:'dev';
const DATA=/^\/(cities|data|models|materials)\//;
const native=globalThis.fetch.bind(globalThis);
globalThis.fetch=(input,init)=>{
 if(typeof input==='string'&&DATA.test(input)&&BUILD!=='dev')input+=(input.includes('?')?'&':'?')+'v='+BUILD;
 return native(input,init);
};
