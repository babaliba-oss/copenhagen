// The loading art (src/boot-art.js) on a stand-in page: which picture files it asks for as the screen turns.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {register} from 'node:module';
register('data:text/javascript,'+encodeURIComponent("export async function load(u,c,n){return u.endsWith('.css')?{format:'module',source:'',shortCircuit:true}:n(u,c);}"));
class El{constructor(){this.style={setProperty(){}};this.dataset={};this.classList={add(){},remove(){},contains:()=>true};}append(){}prepend(){}setAttribute(){}addEventListener(){}}
const asked=[];let tick=null;
globalThis.window=globalThis;globalThis.location={search:''};globalThis.sessionStorage={getItem:()=>null};
globalThis.document={body:new El(),createElement:()=>new El(),querySelector:()=>new El(),getElementById:()=>null};
globalThis.Image=class{set src(v){asked.push(v);const ok=fs.existsSync('public'+v);queueMicrotask(()=>ok?this.onload?.():this.onerror?.());}};
globalThis.setInterval=f=>{tick=f;return 1;};globalThis.requestAnimationFrame=()=>{};
const {installBootArt}=await import('../src/boot-art.js');

test('a phone turned on its side while loading asks only for pictures that exist',async()=>{
 globalThis.innerWidth=400;globalThis.innerHeight=860;const random=Math.random;Math.random=()=>0;
 try{installBootArt();}finally{Math.random=random;}
 globalThis.innerWidth=860;globalThis.innerHeight=400; // turned: the upright-only title picture has no 16:9 file
 for(let i=0;i<12;i++){tick();await new Promise(r=>setTimeout(r,0));}
 const missing=[...new Set(asked.filter(v=>!fs.existsSync('public'+v)&&!/-portrait/.test(v)))];
 assert.deepEqual(missing,[],'every wide picture asked for is in public/art');
});
