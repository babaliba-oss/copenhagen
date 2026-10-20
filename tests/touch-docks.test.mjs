import test from 'node:test';
import assert from 'node:assert/strict';
import {stack,GAP} from '../src/touch-docks.js';
test('popups stack without overlapping, keep their side, and wait when there is no room',()=>{
 const controls={left:0,right:400,top:560,bottom:650},getOut={left:150,right:240,top:480,bottom:530};
 const wanted={left:250,right:380,height:45},hud={left:12,right:292,height:200},radio={left:150,right:380,height:40},invite={left:100,right:300,height:220};
 const [a,b,c,d]=stack([wanted,hud,radio,invite],[controls,getOut],60,650);
 assert.equal(a,60);assert.equal(b,60+45+GAP,'the hud overlaps the stars sideways, so it goes below them');
 assert.equal(c,b+200+GAP,'the radio below both');assert.equal(d,null,'no room left for the invite');
 const [x,y]=stack([{left:500,right:640,height:45},{left:12,right:292,height:200}],[],60,380);
 assert.equal(x,60);assert.equal(y,60,'side by side in landscape: both at the top');
});
test('an element that leaves the stack gets its own position back',async()=>{
 const {createTouchDocks}=await import('../src/touch-docks.js');
 const mk=(id,cls=[])=>{const c=new Set(cls),st={top:'',bottom:''};return {id,hidden:false,style:st,offsetHeight:40,offsetParent:null,classList:{add:x=>c.add(x),remove:x=>c.delete(x),contains:x=>c.has(x)},has:c,getClientRects:()=>[1],getBoundingClientRect:()=>({left:300,right:600,top:60,bottom:100,width:300,height:40})};};
 const toast=mk('toast',['important','visible']),body=mk('body',['touch']);
 const doc={body,querySelector:s=>s==='#toast.important.visible'&&toast.has.has('important')?toast:null};
 const win={innerHeight:400,getComputedStyle:()=>({visibility:'visible',position:'fixed'})};
 const docks=createTouchDocks(doc,win);docks.update(1000);assert.equal(toast.style.top,'8px','docked');
 toast.has.delete('important');docks.update(2000);assert.equal(toast.style.top,'');assert.equal(toast.style.bottom,'');assert.ok(!toast.has.has('dock-wait'),'an ordinary toast is back at its own spot');
});
