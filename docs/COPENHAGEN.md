# Copenhagen (and Copenhagen 1760)

This fork's site opens on Copenhagen. Press **Y** in the game (or the ⌛ button) to switch between today and
1760 at the same spot.

## Rebuilding the data

The public Overpass servers were unreliable, so OpenStreetMap comes from a local extract
(BBBike: `https://download.bbbike.org/osm/bbbike/Copenhagen/Copenhagen.osm.pbf`).

Today:

```sh
python3 scripts/pbf-to-overpass.py Copenhagen.osm.pbf copenhagen   # raw cache in data/raw/cities/copenhagen
node scripts/city-build.mjs copenhagen                               # move .env.local aside to skip Mapillary here
python3 scripts/kk-buildings.py bymodel3dkobenhavnbygningerdxf.zip copenhagen   # municipal LOD2 buildings
node scripts/mapillary-features.mjs copenhagen                       # needs MAPILLARY_TOKEN in .env.local
rm -rf data/raw/cities/copenhagen/kk-street-backup
python3 scripts/kk-street.py <kk data dir> copenhagen                # lamps, wires, trees, racks, bollards
python3 scripts/add-starts.py copenhagen
python3 scripts/fill-greenery.py copenhagen
python3 scripts/parked-cars.py copenhagen
python3 scripts/boats.py copenhagen
python3 scripts/rails.py Copenhagen.osm.pbf copenhagen
python3 scripts/cafes.py copenhagen
python3 scripts/anchors.py copenhagen
python3 scripts/district-styles.py copenhagen
python3 scripts/save-years.py <kk data dir>/save.json copenhagen   # period window styles (today only)
python3 scripts/nyhavn-facades.py && node scripts/facades.mjs copenhagen
```

1760 (built from today's raw cache):

```sh
python3 scripts/era-1760.py <kk data dir>/save.json
node scripts/city-build.mjs copenhagen-1760
python3 scripts/kk-buildings.py bymodel3dkobenhavnbygningerdxf.zip copenhagen-1760 --era 1760
python3 scripts/add-starts.py copenhagen-1760
python3 scripts/fill-greenery.py copenhagen-1760
python3 scripts/boats.py copenhagen-1760 --era
python3 scripts/anchors.py copenhagen-1760          # also restores era.json (windmills)
python3 scripts/lanterns-1760.py
python3 scripts/district-styles.py copenhagen-1760
```

`<kk data dir>` holds the City of Copenhagen registers (CC BY 4.0): `wires.gpkg`, `masts.gpkg`,
`streettrees.json`, `furniture_p.json`, `bikeracks.json` and `save.json` (WFS `k101:fredede_bygninger_save`).

Notes:
- Vite caches the list of public files at start-up: restart the dev server after a rebuild.
- File names must not contain commas (Cloudflare's asset server redirect-loops on them).

## Game layer (src/copenhagen)

- `game.js`: delivery jobs, sagas, journal (J), treasure map (K), hidden nisser, the morning paper, GPS line.
- `characters.js` / `data.js`: authored characters and their dialogue, for both eras.
- `carriage.js`: the 1760 coach (player) and NPC coaches.
- `landmarks.js`: Vor Frelsers stair, Børsen spire, Tivoli rides, statues, flags, 1760 windmills.
- `parked-cars.js`, `boats.js`, `rails.js`, `trains.js`, `city-cyclists.js`, `cafes.js`: street life.

Shared changes: `facade-grain.js` (brick, plaster, roof courses, window grid on far shells),
`night-windows.js` and the Night look in `weather.js`, lamp light in `mapped-furniture.js`,
the relaxed police mode in `police.js`, 1760 clothes in `person-model.js`.
