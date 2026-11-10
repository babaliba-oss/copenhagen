// The page as it arrives (index.html) is Copenhagen's: nothing from Helsinki shows before the game's code runs,
// or to a crawler. Helsinki puts its own text back when it loads (src/helsinki-scenery.js).
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
const html=read('../index.html'),main=read('../src/main.js'),scenery=read('../src/helsinki-scenery.js');
const city=JSON.parse(read('../public/cities/index.json')).cities.find(c=>c.id==='copenhagen');
test('index.html carries no Helsinki text',()=>{assert.doesNotMatch(html,/helsinki|helsingin|HSL|Olympia|Kauppatori|Aleksanterinkatu|SENAATINTORI/i);});
test('the static dialogs say what main.js writes for Copenhagen today',()=>{
 const km=(city.radius/1000).toFixed(1);
 assert.ok(html.includes(`<h2>${city.name}.</h2>`));assert.ok(html.includes(`${km} km around the centre of ${city.name}. Pick a starting point, then find your own way.`));
 assert.ok(html.includes(`${city.name.toUpperCase()} FROM OPEN DATA <span>${km} KM PLAYABLE RADIUS</span>`));assert.ok(html.includes(`<h2>${city.name}, from open data.</h2>`));
 assert.ok(html.includes(`maintained by ${city.maintainers.join(', ')}.`));assert.ok(html.includes(`<h2 id="pause-title">${city.name} can wait.</h2>`));
 assert.ok(html.includes(`<span id="boot-place-label">Your starting point in ${city.name}</span>`));assert.ok(html.includes(`${city.name.toUpperCase()} CENTRE <span>`));
 assert.ok(html.includes(`Explore ${city.name} by car, on foot, by bicycle or on a scooter. Follow the purple line:`));assert.match(html,/class="primary-btn dialog-drive">Keep exploring <span>/);
 assert.match(html,/id="cathedral-label" hidden><\/div>/);assert.match(html,/<p class="attribution"><\/p>/,'the long credit line comes from index.json at run time');
 assert.match(main,/'#sources-dialog \.attribution'\)\.textContent=city\.attribution/);});
test('Helsinki\'s own scenery modules load with Helsinki only, and it restores its page text',()=>{
 const mods=[...scenery.matchAll(/from '\.\/([\w-]+)\.js'/g)].map(m=>m[1]);assert.ok(mods.length>=20);
 for(const m of mods)assert.ok(!main.includes(`from './${m}.js'`),`${m} is imported by main.js again: it would ship to every city`);
 assert.match(main,/await import\('\.\/helsinki-scenery\.js'\);helsinkiPage\(\);/);
 assert.match(scenery,/set\('#pause-title','Helsinki can wait\.'\)/);assert.match(scenery,/set\('#sources-dialog \.attribution','Geometry, photographic textures and maps © City of Helsinki/);});
