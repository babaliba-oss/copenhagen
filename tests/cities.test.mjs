import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {selectCity,pickStart,renameStarts,slug,startUrl,dataUrl,useCity,CITIES} from '../src/cities.js';

const starts=[{name:'Olympia Terminal'},{name:'Töölö (National Opera)'},{name:'Seurasaari bridge'},{name:'Senate Square'}];
test('start names become accent-free URL slugs',()=>{
 assert.equal(slug('Töölö (National Opera)'),'toolo-national-opera');assert.equal(slug('  Senate  Square '),'senate-square');
});
test('?start= finds exact, prefix and partial matches, or nothing',()=>{
 assert.equal(pickStart(starts,'seurasaari-bridge').name,'Seurasaari bridge');
 assert.equal(pickStart(starts,'seurasaari').name,'Seurasaari bridge');
 assert.equal(pickStart(starts,'Töölö').name,'Töölö (National Opera)');
 assert.equal(pickStart(starts,'opera').name,'Töölö (National Opera)');
 assert.equal(pickStart(starts,'tampere'),null);assert.equal(pickStart(starts,''),null);
});
test('?city= defaults to Helsinki and rejects cities not in the build',()=>{
 assert.equal(selectCity('').id,'helsinki');assert.equal(selectCity('?city=Helsinki').id,'helsinki');
 assert.throws(()=>selectCity('?city=tampere'),/not in this build yet/);
});
test('the address bar keeps city and start shareable; data stays under the city root',()=>{
 assert.equal(startUrl(new URL('http://x/?foo=1'),CITIES.helsinki,starts[2]),'/?foo=1&city=helsinki&start=seurasaari-bridge');
 useCity(CITIES.helsinki);assert.equal(dataUrl('city.pack'),'/data/city.pack');
});
test('every shipped city includes a JSON extension catalog even when it has no regions',()=>{
 const registry=JSON.parse(readFileSync('public/cities/index.json','utf8'));
 for(const city of [CITIES.helsinki,...registry.cities]){
  const file=path.join('public',city.dataRoot,'extensions/index.json');
  const catalog=JSON.parse(readFileSync(file,'utf8'));
  assert.ok(Array.isArray(catalog.extensions),`${city.id} needs an extension catalog; missing files can return the host's HTML fallback`);
 }
});
test('a start renamed for another era keeps its ?start= key',()=>{
 const starts=renameStarts([{name:'Nyhavn'},{name:'Little Mermaid'}],{'Little Mermaid':'Langelinie'});
 assert.equal(starts[1].name,'Langelinie');assert.equal(pickStart(starts,'little-mermaid'),starts[1]);assert.equal(startUrl({href:'https://x.dk/?city=copenhagen-1760'},{id:'copenhagen-1760'},starts[1]),'/?city=copenhagen-1760&start=little-mermaid');
 assert.equal(starts[0].id,undefined,'other starts untouched');
});
