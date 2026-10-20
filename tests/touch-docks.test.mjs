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
