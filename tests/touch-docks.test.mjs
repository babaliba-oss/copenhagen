import test from 'node:test';
import assert from 'node:assert/strict';
import {stack,GAP} from '../src/touch-docks.js';
import {readFileSync} from 'node:fs';
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
test('the phone minimap is an obstacle: the stars go below it, not over it',async()=>{
 const {createTouchDocks}=await import('../src/touch-docks.js');
 const mk=(r,cls=[])=>{const c=new Set(cls);return {hidden:false,style:{top:'',bottom:''},offsetHeight:r.bottom-r.top,classList:{add:x=>c.add(x),remove:x=>c.delete(x),contains:x=>c.has(x)},getClientRects:()=>[1],getBoundingClientRect:()=>({...r,width:r.right-r.left,height:r.bottom-r.top})};};
 const menu=mk({left:300,right:400,top:12,bottom:56}),minimap=mk({left:262,right:374,top:68,bottom:152}),wanted=mk({left:250,right:400,top:65,bottom:110}),body=mk({left:0,right:0,top:0,bottom:0},['touch']);
 const doc={body,querySelector:s=>({'#touch-aux':menu,'#app>.minimap-card':minimap,'#wanted':wanted})[s]||null};
 const win={innerHeight:900,getComputedStyle:()=>({visibility:'visible'})};
 createTouchDocks(doc,win).update(1000);assert.equal(wanted.style.top,(152+GAP)+'px');
});
test('a tucked card docks where it will be when it comes out, not by its tab',async()=>{
 const {createTouchDocks}=await import('../src/touch-docks.js');
 const mk=(r,cls=[],dx=0)=>{const c=new Set(cls);const el={dx,hidden:false,style:{top:'',bottom:''},offsetHeight:r.bottom-r.top,classList:{add:x=>c.add(x),remove:x=>c.delete(x),contains:x=>c.has(x)},getClientRects:()=>[1],getBoundingClientRect:()=>({...r,left:r.left+el.dx,right:r.right+el.dx,width:r.right-r.left,height:r.bottom-r.top})};return el;};
 const minimap=mk({left:262,right:374,top:68,bottom:152}),radio=mk({left:160,right:400,top:64,bottom:114},['tuckable','tucked'],230),body=mk({left:0,right:0,top:0,bottom:0},['touch']);
 const doc={body,querySelector:s=>({'#app>.minimap-card':minimap,'#radio-now':radio})[s]||null};
 const win={innerHeight:900,getComputedStyle:el=>({visibility:'visible',position:'fixed',transform:el.dx?`matrix(1, 0, 0, 1, ${el.dx}, 0)`:'none'})};
 const docks=createTouchDocks(doc,win);docks.update(1000);assert.equal(radio.style.top,(152+GAP)+'px','tucked: below the minimap already');
 radio.dx=0;docks.update(2000);assert.equal(radio.style.top,(152+GAP)+'px','out: the same place');
});
test('a conversation too tall for a landscape phone scrolls in the free gap instead of waiting hidden',()=>{
 const minimap={left:16,right:128,top:226,bottom:310},steer={left:16,right:170,top:318,bottom:402},menu={left:813,right:899,top:8,bottom:52};
 const heights=[];const [chat,hud]=stack([{left:16,right:536,height:249,min:120},{left:12,right:372,height:94}],[menu,minimap,steer],8,404,heights);
 assert.equal(chat,8);assert.equal(heights[0],226-GAP-8,'down to the minimap');assert.equal(hud,null,'the job card waits');
 const h2=[];assert.deepEqual(stack([{left:16,right:536,height:249}],[menu,minimap,steer],8,404,h2),[null],'without min it still waits');
 const h3=[];assert.deepEqual(stack([{left:16,right:536,height:249,min:240}],[menu,minimap,steer],8,404,h3),[null],'no gap tall enough');
 const h4=[];assert.deepEqual(stack([{left:16,right:336,height:300,min:120}],[],8,800,h4),[8]);assert.equal(h4[0],null,'it fits: no cap');
});
test('phone landscape: Say hello goes under Menu, so the money, job and saga keep their place above the minimap',()=>{
 /* measured at 915x412: Menu 813-899 x 8-52, minimap 16-128 x 226-310, controls from 310; the HUD 360 x 168, the prompt 110 x 44 */
 const fixed=[{left:813,right:899,top:8,bottom:52},{left:16,right:128,top:226,bottom:310},{left:16,right:899,top:310,bottom:402}],hud={left:16,right:376,height:168};
 assert.deepEqual(stack([{left:16,right:126,height:44},hud],fixed,8,404),[8,null],'over the HUD in the left column, the HUD waited: 158 px left of the 168 it needs');
 assert.deepEqual(stack([{left:789,right:899,height:44},hud],fixed,8,404),[60,8],'in the right-hand column, both are shown');
 const css=readFileSync(new URL('../src/mobile-controls.css',import.meta.url),'utf8');
 assert.match(css,/max-height:500px\)\{[^@]*#people-interaction:not\(:has\(#people-chat:not\(\[hidden\]\)\)\)\{left:auto;right:/,'landscape anchors the prompt right');
 /* 740x360: minimap from 174, so 158 px for the HUD (the cards' padding: 168 -> 154) */
 assert.equal(stack([{...hud,height:168}],[{left:16,right:128,top:174,bottom:258}],8,352)[0],null);assert.equal(stack([{...hud,height:154}],[{left:16,right:128,top:174,bottom:258}],8,352)[0],8);
 assert.match(css,/max-height:380px\)\{body\.touch #cph-hud\{gap:4px\}body\.touch #cph-hud \.cph-card\{padding:3px 10px\}/);
});
