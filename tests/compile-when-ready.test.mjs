import test from 'node:test';
import assert from 'node:assert/strict';
import {compileWhenReady} from '../src/render-stability.js';

// A stand-in renderer: compile() hands out the materials, each program reports ready after a few checks, and a
// disposed material loses its entry (three's properties.remove), so its currentProgram is gone.
function fakeRenderer(parallel){
 const props=new Map(),checks=new Map();
 return {props,extensions:{get:n=>n==='KHR_parallel_shader_compile'&&parallel?{}:null},
  properties:{get:m=>{if(!props.has(m))props.set(m,{});return props.get(m);}},
  compile(obj){const s=new Set(obj.materials);for(const m of s){checks.set(m,0);props.set(m,{currentProgram:{isReady:()=>(checks.set(m,checks.get(m)+1),checks.get(m)>3)}});}return s;}};
}
test('a material disposed while its shader compiles does not throw from the timer, and the compile still finishes',async()=>{
 for(const parallel of [true,false]){
  const r=fakeRenderer(parallel),a={},b={},obj={materials:[a,b]},errors=[],onError=e=>errors.push(e);process.on('uncaughtException',onError);
  const done=compileWhenReady(r,obj,null);r.props.delete(b); /* b disposed straight away */
  const out=await Promise.race([done,new Promise(res=>setTimeout(()=>res('timeout'),1000))]);process.off('uncaughtException',onError);
  assert.equal(out,obj,'resolves with the object');assert.equal(errors.length,0);
 }
});
test('the compile waits until every remaining program is ready',async()=>{
 const r=fakeRenderer(true),a={},obj={materials:[a]};let resolved=false;const p=compileWhenReady(r,obj,null).then(()=>{resolved=true;});
 await new Promise(res=>setTimeout(res,15));assert.equal(resolved,false,'not ready after two checks');await p;assert.equal(resolved,true);
});
