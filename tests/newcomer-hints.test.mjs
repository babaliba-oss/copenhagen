// First-minutes hints a newcomer needs (read from the source: they live inside main.js and game.js).
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const main=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8'),game=fs.readFileSync(new URL('../src/copenhagen/game.js',import.meta.url),'utf8');
test('the start hint on a keyboard says how to drive and where to go, and stays up long enough to be read',()=>{
 const s=main.slice(main.indexOf('function start()'));const t=s.slice(s.indexOf('toast('),s.indexOf('$(\'world\').focus()'));
 assert.match(t,/WASD or arrow keys to drive/);assert.match(t,/line to the beam: your first job/);const ms=+/ms:(\d+)/.exec(t)?.[1];assert.ok(ms>=8000,'shown '+ms+' ms');
 assert.match(main,/function toast\(message,\{important=false,ms=0\}=\{\}\)/);assert.match(main,/ms\|\|\(important\?5000:2800\)/);});
test('the first can of pant says what pant is',()=>{assert.match(game,/if\(!before\)toast\(`Empty can: \+\$\{PANT_KR\} kr pant/);});
test('the first wanted stars ever say what they mean and how to lose them, once',()=>{
 const s=main.slice(main.indexOf('police.level&&!wantedHinted'));assert.match(s.slice(0,600),/localStorage\.getItem\('wanted-hint'\)/);assert.match(s.slice(0,600),/the police are after you\. Get out of their sight to lose them\./);
 assert.match(fs.readFileSync(new URL('../src/police.js',import.meta.url),'utf8'),/this\.escape=\(!this\.seen/,'stars clear out of sight (police.js)');});
test('travelling in time during a delivery, race or timed saga asks for a second press first',()=>{
 const s=main.slice(main.indexOf('function eraJump()'),main.indexOf('function showEraCard'));assert.match(s,/cph\?\.timed\?\.\(\)/);assert.match(s,/Travelling in time drops your \$\{drop\}/);assert.match(s,/again to go anyway/);});
test('How to play on the welcome card lists Space for the handbrake',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'),box=html.slice(html.indexOf('class="boot-controls"'),html.indexOf('</dl>',html.indexOf('class="boot-controls"')));assert.match(box,/<dt>Handbrake<\/dt><dd><kbd>SPACE<\/kbd><\/dd>/);});
