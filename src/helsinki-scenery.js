// Scenery modules only Helsinki uses (main.js buildHelsinkiScenery). Imported on demand, so the other cities
// don't download them. A module main.js also needs elsewhere stays a normal import there.
export {createKauppatori} from './kauppatori.js';
export {createHarbour} from './harbour.js';
export {createBindAds} from './bind-ads.js';
export {createLasipalatsiStops} from './lasipalatsi-stop.js';
export {createKauppatoriTramStops} from './kauppatori-tram-stops.js';
export {createStationStreetLife} from './station-street-life.js';
export {createStationStatues} from './station-statues.js';
export {createStationBuildingDetails} from './station-building.js';
export {createWaterfrontLandmarks} from './waterfront-landmarks.js';
export {createStreetNameSigns} from './street-name-signs.js';
export {createPalaceLife} from './palace-life.js';
export {createRouteDirectionSigns} from './route-direction-signs.js';
export {createCityHallFlag} from './city-hall-flag.js';
export {createLaivasillankatuSigns} from './laivasillankatu-signs.js';
export {createKauppatoriFingerpost} from './kauppatori-fingerpost.js';
export {createSofiankatuSigns} from './sofiankatu-signs.js';
export {createRouteCrossingSigns} from './route-crossing-signs.js';
export {createEtelarantaGantry} from './etelaranta-gantry.js';
export {createSenateStreetProps} from './senate-street-props.js';
export {createUniversityLife} from './university-life.js';
export {createKauppatoriRoadworks} from './kauppatori-roadworks.js';
export {createMannerheimintieGantry} from './mannerheimintie-gantry.js';
export {createKaivokatuDetails} from './kaivokatu-details.js';
export {createKamppiChapel} from './kamppi-chapel.js';
export {createTerminalLife} from './terminal-life.js';

// The page's static text is Copenhagen's (index.html); Helsinki puts its own back when it loads.
export function helsinkiPage(doc=document){
 const set=(sel,html)=>{const el=doc.querySelector(sel);if(el)el.innerHTML=html;};
 set('#cathedral-label','<span class="landmark-dot"></span><span>HELSINGIN TUOMIOKIRKKO<small>Helsinki Cathedral · 1852</small></span>');{const l=doc.querySelector('#cathedral-label');if(l)l.hidden=false;}
 set('#boot-place-label','Your starting point');
 set('#sources-btn','City © Helsinki · Routes © HSL 2026 · CC BY 4.0 <span>↗</span>');
 set('#map-dialog h2','Around the cathedral.');
 set('#map-dialog .dialog-copy','Two kilometres in every direction. Pick a starting point, then find your own way.');
 set('#map-dialog .map-caption','REAL HELSINKI GEOMETRY <span>2 KM PLAYABLE RADIUS</span>');
 set('#help-dialog .help-note','Share the streets with moving cars and pedestrians. Traffic follows mapped road directions, with simulated signals and following distances. Buildings, water and other cars stop your car. Harbour details are photo-guided approximations; see the <a href="/models/harbour-sources.json" target="_blank">harbour reference ledger</a>. This is a single-player city playground. Marked bicycles and scooters are available near each starting point.');
 set('#sources-dialog h2','Helsinki, from Helsinki.');
 set('#sources-dialog .dialog-copy','Streets follow surveyed polygons. Most buildings retain municipal 3D geometry and photographic façade textures; the cathedral, its pavilions, Government Palace frontage and five key Kauppatori building frontages have photo-guided geometric reconstructions. Kauppatori uses mapped paving and photo-positioned market canopies. Trams follow a dated HSL route snapshot, including shared streets and crossings.');
 set('#sources-dialog .help-note','A prototype, not a survey-exact digital twin. Street terrain is flattened; landmark stair heights, ornaments, landscape inference and some façades remain approximate. Market monuments are simplified silhouettes; rear façades and some source texture gaps remain. Tram rails follow route shapes, not surveyed rail centres. Switches, overhead wires, stop matching, traffic priorities and timings are simplified; this is not live HSL tracking.');
 set('#sources-dialog .source-links','<a href="https://www.hel.fi/en/decision-making/information-on-helsinki/maps-and-geospatial-data/helsinki-3d" target="_blank" rel="noreferrer">Helsinki 3D ↗</a><a href="https://www.hsl.fi/en/hsl/open-data" target="_blank" rel="noreferrer">HSL open data ↗</a><a href="/models/senate-sources.json" target="_blank">Senate references ↗</a><a href="/models/kauppatori-sources.json" target="_blank">Kauppatori references ↗</a><a href="/models/tram-sources.json" target="_blank">Tram references ↗</a><a href="/data/provenance.json" target="_blank">Data provenance ↗</a><a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0 ↗</a>');
 set('#sources-dialog .attribution','Geometry, photographic textures and maps © City of Helsinki, City Survey Services and Urban Environment Division. Routes and stops © HSL 2026 (16 September snapshot). Adapted under CC BY 4.0. Granite Tile 03 material by Poly Haven, CC0. Reference photographs are credited in the architecture manifests and are not embedded in the landmark models.');
 set('#pause-title','Helsinki can wait.');
}
