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
python3 scripts/kk-buildings.py bymodel3dkobenhavnbygningerdxf.zip copenhagen   # municipal LOD2 buildings, split into houses (see below)
node scripts/surface-dissolve.mjs copenhagen      # street surfaces layered by road class, trimmed at the water; cycle
                                                  # tracks tagged on roads (cycleway=track) drawn beside them, with a
                                                  # painted bicycle every 40 m (cycle-marks.json)
node scripts/mapillary-features.mjs copenhagen                       # needs MAPILLARY_TOKEN in .env.local
rm -rf data/raw/cities/copenhagen/kk-street-backup
python3 scripts/kk-street.py <kk data dir> copenhagen                # lamps, wires, trees, racks, bollards
python3 scripts/add-starts.py copenhagen
python3 scripts/prune-mobility.py copenhagen        # keep the main road/footpath network (no one stuck on islands)
python3 scripts/fill-greenery.py copenhagen
python3 scripts/parked-cars.py copenhagen                    # after the buildings: tested against the drawn 3D roofs
python3 scripts/boats.py copenhagen
python3 scripts/havnebus.py copenhagen                   # harbour bus route (after boats.py)
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
node scripts/surface-dissolve.mjs copenhagen-1760
python3 scripts/add-starts.py copenhagen-1760
python3 scripts/prune-mobility.py copenhagen-1760
python3 scripts/fill-greenery.py copenhagen-1760
python3 scripts/boats.py copenhagen-1760 --era
python3 scripts/anchors.py copenhagen-1760          # also restores era.json (windmills)
python3 scripts/lanterns-1760.py
python3 scripts/district-styles.py copenhagen-1760
python3 scripts/market-1760.py
python3 scripts/landmark-colours.py                       # both eras, after the building indexes
node scripts/building-duplicates.mjs copenhagen && node scripts/building-duplicates.mjs copenhagen-1760   # stray copies only:
echo '[]' > public/cities/copenhagen/insets.json && echo '{}' > public/cities/copenhagen/recolour.json             # the clean split shares no walls
echo '[]' > public/cities/copenhagen-1760/insets.json && echo '{}' > public/cities/copenhagen-1760/recolour.json
```

### How the municipal model becomes houses (scripts/kk-buildings.py)

A city block in the model is one closed mesh, mostly single 3DFACE triangles. The script merges coplanar neighbours into
facets (a wall rectangle is one facet even when its two triangles are a little out of plane), gives each roof plane to
the OpenStreetMap footprint under it and cuts a plane that runs over several houses exactly along the footprint edge,
and lets every wall follow the roof just inside its top edge (a facade belongs to the house behind it, a step wall to
the taller house); a facade running past several houses is cut vertically where their roofs meet. Roof edges and
wall bottoms left hanging in the air (a neighbour the era leaves out, a gap in the model) get a wall down to the next
surface or the ground, unless another wall stands just behind or in front (a bay window, an overhang over a recessed
ground floor). Floor faces high over the ground are kept as ceilings (a passage, under an overhang), so a facade over
a passage does not end in the air. A few houses the model has only as roof and eaves on one side (a hall whose glass
walls were never modelled) get walls along their OpenStreetMap outline where no wall stands within 2.5 m; passages
(a road or pavement running in under the house) and houses open on most of their outline (sheds, canopies) are left
open. Small model-only structures standing in a road or pavement (metro lifts, vent shafts, kiosks) are left out.
An OpenStreetMap house is kept wherever the model's roofs cover less than half its footprint (they are the game's
colliders, so a dropped one stood in the street as an invisible wall).
Houses keep the model's surveyed heights (`abs: 1` in the index): they sit on the game terrain
within ~0.2 m, so neighbours' walls meet exactly; the foot of every wall reaches half a metre into the ground.
In 1760, today's street furniture on the period footprints (station entrances, kiosks, toilets) and statues modelled
in detail are left out, and the ramparts are rebuilt as one smooth earthwork per stretch (`embankment: 1`).
Pass `--faces <file>` (written once with `--save-faces <file>`) to skip re-reading the DXF on reruns.
Checks: `scripts/building-sweep.mjs` (rays from inside every house at a third of its height; a ray that gets out into
the street - open sky joined to the map edge - without crossing a wall means you can see into the house).

`<kk data dir>` holds the City of Copenhagen registers (CC BY 4.0): `wires.gpkg`, `masts.gpkg`,
`streettrees.json`, `furniture_p.json`, `bikeracks.json` and `save.json` (WFS `k101:fredede_bygninger_save`).

Notes:
- Vite caches the list of public files at start-up: restart the dev server after a rebuild.
- File names must not contain commas (Cloudflare's asset server redirect-loops on them).
- Data requests carry `?v=<build id>` (src/cache-bust.js), so a deploy never mixes with cached city files.

## Game layer (src/copenhagen)

- `game.js`: delivery jobs, sagas, journal (J), treasure map (K), hidden nisser, the morning paper, GPS line.
- `characters.js` / `data.js`: authored characters and their dialogue, for both eras.
- `carriage.js`: the 1760 coach (player) and NPC coaches (the horses' legs swing with each coach's pace; traffic
  spaces them by their 6.6 m length, `COACH_HALF_LENGTH`, not as cars).
- `radio.js`: the car radio (L, Shift+L back): stations from `radio-stations.json` stream public-domain / CC0 / CC BY
  recordings from the library that hosts them; each station loops on its own clock like a broadcast.
- `landmarks.js`: Vor Frelsers stair, Børsen spire, Tivoli rides, statues, flags, 1760 windmills.
- `parked-cars.js`, `boats.js`, `rails.js`, `trains.js`, `city-cyclists.js`, `cafes.js`: street life.
- `harbour-bath.js`: Havnebadet Islands Brygge (decks, diving tower, bathers); `inHarbourBath()` keeps boats out.
- `period-life.js`: 1760 crowds on squares, quays and gates, carts and animals. `soundscape.js`: engine, tyres, bells, hooves,
  and generative Danish folk tunes (fiddle over accordion oom-pah-pah; a cittern in 1760) as background music (U).
- `big-map.js`: the full-screen map (M) with click-to-travel.

## Performance knobs

- `?quality=low` (or `?quality=1..3`) starts with the quality governor's steps applied: AO off, then bloom off
  and a 1024 shadow map, then no MSAA. On weak GPUs the governor (src/quality-governor.js) takes the same steps
  by itself once the lowest render scale (.75) is still too slow.
- Near tiles draw waiting buildings from the merged shell with a per-part mask (src/tile-lod.js); a tile holds at
  most 256 parts for that to work.
- Dev helpers (vite dev only): `openCityDrive.pick(nx,ny)` names what is under a screen point,
  `openCityDrive.inspectCamera({eye,target})` freezes a reference view, `getState().quality` shows the governor level.

Shared changes: `facade-grain.js` (brick, plaster, roof courses, window grid on far shells),
`night-windows.js` and the Night look in `weather.js`, lamp light in `mapped-furniture.js`,
the relaxed police mode in `police.js`, 1760 clothes in `person-model.js`.
