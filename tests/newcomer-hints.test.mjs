// First-minutes hints a newcomer needs (read from the source: they live inside main.js and game.js).
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const main=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8'),game=fs.readFileSync(new URL('../src/copenhagen/game.js',import.meta.url),'utf8');
test('the start hint on a keyboard says how to drive and where to go, and stays up long enough to be read',()=>{
 const s=main.slice(main.indexOf('function start()'));const t=s.slice(s.indexOf('toast('),s.indexOf('$(\'world\').focus()'));
 assert.match(t,/WASD or arrow keys to drive/);assert.match(t,/line to the beam: your first job/);const ms=+/ms:(\d+)/.exec(t)?.[1];assert.ok(ms>=8000,'shown '+ms+' ms');
