// Split out of main.js: the texts boot writes into the page for the city (map, sources and help dialogs, 1760 wording).
import {hasTerrain} from './terrain.js';
import {english} from './i18n.js';
export function cityDialogs(city,extensions,helsinki,$){
   if(!helsinki){
    document.querySelector('#map-dialog h2').textContent=`${city.name}.`;
    document.querySelector('#map-dialog .dialog-copy').textContent=`${(city.radius/1000).toFixed(1)} km around the centre of ${city.name}. Pick a starting point, then find your own way.`;
    document.querySelector('#map-dialog .map-caption span').textContent=`${(city.radius/1000).toFixed(1)} KM PLAYABLE RADIUS`;
    document.querySelector('#sources-dialog h2').textContent=`${city.name}, from open data.`;
    document.querySelector('#sources-dialog .dialog-copy').textContent=`Everything this city is made from is listed below with its licence. Built with the worldhood city builder; maintained by ${city.maintainers?.length?city.maintainers.join(', '):'the community'}.`;
    document.querySelector('#sources-dialog .help-note').textContent=`An evolving reconstruction of the city. Building heights, facades and street details may be estimated. ${hasTerrain()?'Terrain follows the bundled elevation data.':'Terrain is flattened.'} Traffic and public transport are simulated rather than live services.`;
    document.querySelector('#sources-dialog .attribution').textContent=city.attribution;
    document.querySelector('#map-dialog .map-caption').firstChild.textContent=`${city.name.toUpperCase()} FROM OPEN DATA `;
    document.querySelector('#help-dialog .help-note').textContent=city.era===1760?'Explore this single-player city playground on foot or by coach. Share the streets with other coaches and townsfolk; buildings, ramparts and water constrain movement.':'Explore this single-player city playground on foot, by car, bicycle or scooter. Share the streets with simulated traffic and pedestrians. Available rides start near each starting point; buildings and water constrain movement.';
    $('district-label').textContent=city.name.toUpperCase();
    document.querySelector('#pause-overlay h2').textContent=`${city.name} can wait.`;
    $('sources-btn').firstChild.textContent=`Map data © OpenStreetMap contributors · ODbL${city.furniture&&/Mapillary/i.test(city.attribution||'')?' · Mapillary':''}${/Digiroad/.test(city.attribution)?' · Digiroad CC BY':''}${city.terrain?/National Land Survey/.test(city.terrain.source)?' · NLS elevation CC BY':' · Mapterhorn elevation':''} `;
    document.querySelector('.minimap-caption').firstChild.textContent=`${city.name.toUpperCase()} CENTRE `;
   }
   if(extensions.length){
    const names=extensions.map(e=>e.title).join(' and ');
    document.querySelector('#map-dialog .dialog-copy').textContent=`Two kilometres around the cathedral, plus the ${names} corridor (dashed outline). Pick a starting point, then find your own way.`;
    document.querySelector('#map-dialog .map-caption span').textContent='2 KM RADIUS + EXTENSIONS';
    const note=document.createElement('p');note.className='help-note';
    note.textContent=`Map extensions: ${extensions.map(e=>`${e.title} — ${e.provenance.note||`City of Helsinki data fetched ${e.provenance.fetchedAt} (CC BY 4.0); ${e.counts.inferredForestTrees.toLocaleString('en')} forest trees are inferred inside mapped forest areas`}`).join('; ')}. Route crop outlines © OpenStreetMap contributors (ODbL). Seurasaari is car-free in reality.`;
    $('data-counts').after(note);
   }
}
export function helpTexts(city,touchScreen,finale,$){
   $('world').setAttribute('aria-label',`3D view of ${city.name}, explored ${city.era===1760?'on foot or by coach':'on foot, by car, bike or scooter'}`);
   document.querySelector('#help-dialog .dialog-copy').textContent=city.era===1760?`Explore ${city.name} by coach or on foot. Follow the line: a yellow beam is a pick-up, teal the drop-off, red a saga step, blue a race start. The minimap stays north-up.`:`Explore ${city.name} by car, on foot, by bicycle or on a scooter. Follow the purple line: a yellow beam is a pick-up, teal the drop-off, red a saga step, purple a race start. The minimap stays north-up.`;
   if(city.era===1760)for(const el of document.querySelectorAll('.help-grid span')){const t={'Handbrake / bike or scooter brake':'Rein in','Enter a nearby car / ride':'Board your coach','Recover car':'Recover coach','Get out / get off':'Step down','Accelerate / reverse':'Drive on / back up','Travel to 1760 / back to today':'Back to today'}[english(el)];if(t)el.textContent=t;if(/^(Car horn|Radio: next \/ previous station)$/.test(english(el))){el.nextElementSibling?.remove();el.remove();}} // no horn or radio on a coach // 1760: a coach, no bikes or scooters
   if(touchScreen)document.querySelector('#help-dialog .dialog-copy').textContent=`Steer with the arrow buttons: tap for a little, hold for more (or Thumb or Tilt: Menu > Steering), hold Go, Brake to slow down and reverse. Stopped, the button above the controls gets you out${city.era===1760?' or back on your coach':', onto a bike or into a car'}. Walk up to someone and tap Say hello. Yellow beam: a pick-up. Teal: the drop-off. Red: a saga step. ${city.era===1760?'Blue':'Purple'}: a race start. Menu has the city map, the journal and the camera.`;
   finale.coach=city.era===1760;if(city.era===1760){const n=document.querySelector('#busted-overlay .end-note');if(n)n.textContent='Continue puts you back on the street right here, coach mended and wanted level cleared · Restart returns to your starting point';const h=[...document.querySelectorAll('.controls-hint span')].find(e=>/Recover car/.test(english(e)));if(h)h.lastChild.textContent=' Recover coach';} // 1760 has no car: the BUSTED card said 'car repaired'
   if(city.era===1760)for(const row of document.querySelectorAll('.boot-controls>div')){const dt=row.querySelector('dt'),t=english(dt);if(/radio/i.test(t||'')){row.remove();continue;}const n={'Handbrake':'Rein in','Use a nearby car or ride':'Board your coach','Recover car':'Recover coach','Get out / get off':'Step down','1760 / horn / FPS':'Back to today / FPS'}[t];if(n)dt.textContent=n;if(t==='1760 / horn / FPS')row.querySelector('dd').innerHTML='<kbd>Y</kbd> / <kbd>P</kbd>';} // the 1760 welcome card listed the car, horn and radio
}
