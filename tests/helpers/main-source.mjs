// src/main.js and the modules split out of it (src/main-*.js) as one text, for the tests that read main.js as source.
import {readFileSync,readdirSync} from 'node:fs';
const dir=new URL('../../src/',import.meta.url);
export const mainSource=['main.js',...readdirSync(dir).filter(f=>/^main-.*\.js$/.test(f)).sort()].map(f=>readFileSync(new URL(f,dir),'utf8')).join('\n');
