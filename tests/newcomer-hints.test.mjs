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
test('the loading card shows the first thing to do and the core controls, for keys and for touch',()=>{
 const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'),a=html.indexOf('id="boot-loader"'),b=html.indexOf('id="boot-launch"'),box=html.slice(a,b);
 assert.ok(a>0&&b>a);assert.match(box,/class="boot-first">First job: follow the purple line to the beam\./);
 assert.match(box,/class="boot-touch">Hold <b>Go<\/b> to drive\./);const keys=box.slice(box.indexOf('class="boot-controls"'),box.indexOf('</dl>'));
 assert.equal((keys.match(/<dt>/g)||[]).length,4);assert.match(keys,/W A S D/);assert.match(keys,/SPACE/);assert.match(keys,/<kbd>M<\/kbd>/);
 assert.match(main,/querySelector\('\.boot-first'\);if\(f\)f\.textContent='First job: follow the gold line to the beam\.'/,'1760: the line is gold');
 const css=fs.readFileSync(new URL('../src/loading-screen.css',import.meta.url),'utf8');assert.match(css,/#intro\.failed \.boot-tips\{display:none\}/);});
test('what the first street does not need waits for the start button: two statues, Andersen, the nisse; pumpkins for their season',()=>{
 assert.match(main,/loadingScreen\.ready\(startPoint\.name\);readyOpen\(\);/);assert.match(main,/readyGate\.then\(load\)\.then\(s=>\{if\(landmarks===lm\)lm\.addStatues\(s\);\}\)/);
 assert.match(main,/readyGate\.then\(\(\)=>loadPeopleModels\('\/models\/people\/',\['R_HCA'\]\)\)/);assert.match(main,/readyGate\.then\(\(\)=>loadOneMesh\('\/models\/nisse\.glb\.gz'\)\)/);
 assert.equal((main.match(/==='halloween'\?await blenderLoads\.pumpkins\(\):null/g)||[]).length,2);
 assert.ok((main.match(/^   await breathe\(\);$/gm)||[]).length>=10,'boot() yields between its long stretches');});
