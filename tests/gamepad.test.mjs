// Gamepad: pad state -> the keys set and keys.tilt the keyboard and touch controls feed.
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {axis,padInput,createGamepad,keyLabel,swapPadLabels,BUTTONS,DEAD} from '../src/gamepad.js';
const pad=({axes=[0,0,0,0],down=[],values={}}={})=>({connected:true,mapping:'standard',axes,buttons:BUTTONS.map(n=>({pressed:down.includes(n),value:values[n]??(down.includes(n)?1:0)}))});

test('dead zone: a stick resting off centre steers nothing, and the rest of the travel runs 0…1',()=>{
 assert.equal(axis(.1),0);assert.equal(axis(-DEAD),0);assert.equal(axis(1),1);assert.equal(axis(-1),-1);assert.equal(axis(NaN),0);assert.equal(axis(3),1);
 assert.ok(Math.abs(axis(.59)-.5)<1e-9);assert.ok(axis(.2)>0&&axis(.2)<.05,'no jump at the edge of the dead zone');
});
test('driving: right trigger accelerates, left trigger brakes, the left stick steers (left positive), A is the handbrake',()=>{
 assert.deepEqual(padInput(pad()),{held:[],tilt:0,pressed:[],active:false});
 assert.deepEqual(padInput(pad({values:{RT:.6}})).held,['KeyW']);assert.deepEqual(padInput(pad({values:{LT:1}})).held,['KeyS']);
 assert.deepEqual(padInput(pad({values:{RT:.05}})).held,[],'a trigger barely touched');
 assert.equal(padInput(pad({axes:[-1,0,0,0]})).tilt,1);assert.ok(Math.abs(padInput(pad({axes:[.59,0,0,0]})).tilt+.5)<1e-9,'analog');assert.equal(padInput(pad({axes:[.1,0,0,0]})).tilt,0);
 assert.deepEqual(padInput(pad({axes:[0,-1,0,0]})).held,[],'the stick does not drive a car: the triggers do');
 assert.deepEqual(padInput(pad({down:['A']})).held,['Space']);
});
test('on foot: the left stick walks, A held runs; bumpers or the right stick look left and right',()=>{
 assert.deepEqual(padInput(pad({axes:[0,-1,0,0]}),{walk:true}).held,['KeyW']);assert.deepEqual(padInput(pad({axes:[0,1,0,0]}),{walk:true}).held,['KeyS']);
 assert.deepEqual(padInput(pad({axes:[0,-1,0,0],down:['A']}),{walk:true}).held,['KeyW','ShiftLeft']);
 assert.deepEqual(padInput(pad({down:['LB']})).held,['KeyQ']);assert.deepEqual(padInput(pad({axes:[0,0,.9,0]})).held,['KeyE']);
 assert.deepEqual(padInput(pad({down:['Y','Start']})).pressed,['Y','Start']);
});
test('nothing is polled until a pad connects; held keys and steering are let go when the game is not in play',()=>{
 const listeners={},win={addEventListener:(t,f)=>listeners[t]=f};let polls=0,state=pad(),active=true;const taps=[],keys=new Set(),uses=[];
 const g=createGamepad({keys,win,nav:{getGamepads:()=>{polls++;return [state];}},active:()=>active,tap:n=>taps.push(n),use:v=>uses.push(v)});
 g.poll();assert.equal(polls,0);assert.equal(keys.tilt,undefined,'no effect at all without a pad');
 listeners.gamepadconnected();g.poll();assert.equal(polls,1);assert.deepEqual(uses,[],'connected but untouched: the hints stay as they were');
 state=pad({axes:[-1,0,0,0],values:{RT:1},down:['Y']});g.poll();g.poll();assert.deepEqual([...keys],['KeyW']);assert.equal(keys.tilt,1);assert.deepEqual(taps,['Y','RT'],'a held button taps once');assert.equal(uses[0],true);
 keys.add('KeyD');state=pad();g.poll();assert.deepEqual([...keys],['KeyD'],'only its own keys are released');assert.equal(keys.tilt,0);
 state=pad({values:{RT:1},axes:[1,0,0,0]});g.poll();active=false;g.poll();assert.deepEqual([...keys],['KeyD']);assert.equal(keys.tilt,0,'paused: let go');
 keys.tilt=.4;g.poll();assert.equal(keys.tilt,.4,'a phone\'s own steering is left alone while the stick is centred or the game paused');
});
test('hints name pad buttons while a pad is in use',()=>{
 const doc=on=>({body:{classList:{contains:c=>on&&c==='gamepad'}}});
 assert.equal(keyLabel('F',doc(false)),'F');assert.equal(keyLabel('F',doc(true)),'Y');assert.equal(keyLabel('G',doc(true)),'X');assert.equal(keyLabel('T',doc(true)),'T','no pad button: the key');
 const span={tagName:'SPAN',innerHTML:'<kbd>W</kbd> <kbd>S</kbd>',dataset:{pad:'RT LT'}},kbd={tagName:'KBD',innerHTML:'M',dataset:{pad:'D-pad_↑'},set textContent(v){this.innerHTML=v;}},root={querySelectorAll:()=>[span,kbd]};
 swapPadLabels(root,true);swapPadLabels(root,true);assert.equal(span.innerHTML,'<kbd>RT</kbd> <kbd>LT</kbd>');assert.equal(kbd.innerHTML,'D-pad ↑');
 swapPadLabels(root,false);assert.equal(span.innerHTML,'<kbd>W</kbd> <kbd>S</kbd>');assert.equal(kbd.innerHTML,'M');
});
test('the help dialog is three groups, and every pad binding in it is one main.js acts on',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'),grid=html.slice(html.indexOf('<div class="help-grid">'),html.indexOf('<p class="help-note">'));
 assert.deepEqual([...grid.matchAll(/class="eyebrow">([^<]+)</g)].map(m=>m[1]),['MOVE','DO','LOOK AND MENUS']);
 assert.equal((grid.match(/<(span|kbd)[ >]/g).length-grid.match(/<kbd>/g).length)%2,0,'label and value pairs: an odd child would flip the columns');
 for(const [,p] of grid.matchAll(/data-pad="([^"]+)"/g))for(const b of p.split(' '))assert.ok(['RT','LT','Left_stick','A','R3','Y','X','B','D-pad_←','D-pad_→','D-pad_↓','D-pad_↑','LB','RB','Back','Start','–'].includes(b),b); // –: no pad button (the horn's B and the race's X are other things on a pad)
});
