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
node scripts/building-sweep.mjs copenhagen-1760 --hide     # 1760: shells you see straight through join duplicates.json
python3 scripts/fit-colliders.py copenhagen && python3 scripts/fit-colliders.py copenhagen-1760   # last: footprints = the houses you see
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

### Footprints are the houses you see (scripts/fit-colliders.py)

The car, walkers, parked cars and street furniture take the city's footprints (`city.pack` buildings) as the solid houses;
what you see is the model. Run last, after the building duplicates: every footprint gets `cover`, the share of it under
the visible roofs. 1760 drops the ones mostly not covered (today's Opera, BLOX, the Black Diamond and 140 others were walls
in open squares). Today keeps them as plain houses where the model has nothing (`cover` < 0.15: main.js draws a box) and cuts a
partly covered one (a courtyard or back lot taken in) to the part you see. Houses no footprint covers get their own
(`kind: 'model'`, the roof plan 0.3 m in from the eaves, minus the carriageway), so Nyboder's rows and thousands of back houses
are no longer drive-through. Checks: `scripts/collider-sweep.mjs <city>` (walls you hit but cannot see, houses you can drive
through) and `scripts/bridge-sweep.mjs <city> [--fix]` (bridge decks drawn over water with no ground under them; the game
raises the ground under every drawn deck, terrain.js `raiseBridgeDecks`).

`<kk data dir>` holds the City of Copenhagen registers (CC BY 4.0): `wires.gpkg`, `masts.gpkg`,
`streettrees.json`, `furniture_p.json`, `bikeracks.json` and `save.json` (WFS `k101:fredede_bygninger_save`).

Notes:
- Vite caches the list of public files at start-up: restart the dev server after a rebuild.
- File names must not contain commas (Cloudflare's asset server redirect-loops on them).
- Data requests carry `?v=<build id>` (src/cache-bust.js), so a deploy never mixes with cached city files.

## Game layer (src/copenhagen)

- `game.js`: delivery jobs, sagas, journal (J), treasure map (K), hidden nisser, the morning paper, GPS line.
- `characters.js` / `data.js`: authored characters and their dialogue, for both eras.
- `carriage.js` + `gait.js`: the 1760 coach (player) and NPC coaches (traffic spaces them by their 6.6 m length,
  `COACH_HALF_LENGTH`, not as cars). With the models below loaded, a coach and its pair are one merged geometry animated
  in the vertex shader (`gait.js`): per-vertex `anim`/`pivot` mark the horses' legs (swing about the shoulder/hip, the knee
  folds while a leg swings forward, diagonal pairs in a trot) and the wheels (turn about their axles), one per-instance
  `motion` (gait phase, swing, distance rolled) drives them; shadows use the same patch. Models (Daniel's downloads, his
  licences; scripts in `scripts/models/`): `carriage/brougham.glb.gz` + `brougham.jpg` (19th-century-carriage.zip, the
  black coach with the crown; `brougham.py`, wheels and box seat in the mesh extras), `carriage/armored-horse.glb.gz`
  (armored-horse.zip; `armored_horse.py` bakes the textures into vertex colours and writes the `_leg` weights),
  `carriage/coachman.glb.gz` (the 18th-century costume from mans-1-costume…zip with the cool-man's head, powdered hair
  and a tricorne, seated; `coachman.py`), `nisse.glb.gz` (art/nisse.zip, a scanned felt nisse: the hidden nisser and
  Nissefar; `nisse.py`). All gzipped (unzipped in the browser). Missing files fall back to the Blender coach and horse.
- `radio.js`: the car radio (L, Shift+L back, or click/tap the now-playing card at the top right; the last station is
  remembered, station 1 on the first drive): stations from `radio-stations.json` stream public-domain / CC0 / CC BY
  recordings from the library that hosts them; each station loops on its own clock like a broadcast.
- `landmarks.js`: Vor Frelsers stair, Børsen spire, Tivoli rides, statues, flags, 1760 windmills.
- `parked-cars.js`, `boats.js`, `rails.js`, `trains.js`, `city-cyclists.js`, `cafes.js`: street life.
- `harbour-bath.js`: Havnebadet Islands Brygge (decks, diving tower, bathers); `inHarbourBath()` keeps boats out.
- `period-life.js`: 1760 crowds on squares, quays and gates, carts and animals. `soundscape.js`: engine, tyres, bells, hooves,
  and generative Danish folk tunes (fiddle over accordion oom-pah-pah; a cittern in 1760) as background music (U).
- `big-map.js`: the full-screen map (M) with click-to-travel.

### Trailer footage (src/cinematic.js, src/cine-drive.js)

`?cinematic` runs the trailer shots by themselves with the interface hidden and no music. Most shots follow the
player's car (the coach in 1760), which drives itself along the road graph towards a target with a tracking camera
(chase, bumper, front, side, wheel, helicopter, from above, pass-by). The same routes run in both eras, so the two
recordings cut together mid-drive. The screen goes black between shots while the next place loads.
- Record on a machine with a real GPU: open `?cinematic` (and `?city=copenhagen-1760&cinematic`) full screen and record
  the screen until it stays black. `?shots=Nyhavn,Bredgade` (name prefixes or indices) runs only those shots;
  `?dur=2.4` shortens every shot.
- `?fixed=30` steps each shot frame by frame for a capture script (`window.__cineFrame()`, the dev server's
  `window.__renderer`) at full quality; without a GPU (SwiftShader) that costs 10–18 s a frame. `__cineFrame(n, false)`
  steps without drawing (checks), `__cine.hold(i, u)` parks on shot i at fraction u (contact sheets).
- The self-driving car keeps behind whatever is on its route ahead (traffic, buses, a coach crossing at a junction,
  parked rides, people within 7 m): `cineObstacles()` in main.js, `blocked()` in cine-drive.js. Buses and trams do not
  push it (`car.cinematic`), and the body does not rumble on setts.
- The camera never goes into a house: `clearEye()` walks from the subject out to the planned eye and stops short of the
  first wall in the way, with a metre of air around the lens (`solid()`: footprint and height of the mapped buildings).
- Shots can set the sky (`sky:'night'`), switch today's seasonal decorations mid-run (`season:'halloween'|'christmas'`,
  Christmas comes last so the snow stays), follow a character live (`orbit.follow:'hca'|'nisse'`), or show part of the
  interface: `hud:'radio'` (the now-playing card tuning through the stations) and `hud:'quest'` (a saga starting: banner,
  red beam and route; game.js `trailer` shows it without touching the save).

### Rigged people (src/skinned-people.js)

The ten walkers nearest the camera within 45 m (five within 30 m on phones) and the player on foot are low-poly characters by Quaternius (CC0),
one skinned mesh each with the material colours in its vertex colours; everyone further away, and anyone with a pose
(phone, chat, bike), a fall, a suitcase or in a conversation, stays the procedural instanced figure (person-model.js).
Riding, falling and carrying, the player is the procedural figure too. `?procedural` turns the rigged ones off.
- Files: `public/models/people/<name>.glb.gz` (gzipped GLB, unzipped in the browser: Cloudflare serves .glb uncompressed).
  Today uses nine characters (1.3 MB), 1760 `M_Farmer`, `W_Medieval` and now and then `M_King`; the player is
  `M_Casual_Hoodie` today, `M_Farmer` in 1760 (main.js, where the street life is created).
- Two rigs: the men (M_*) and the women (W_*) share bone names, but the women's bones are turned differently, so each
  has its own copy of the 9 clips (Walk, Run, Idle, Idle_Neutral, Wave, Interact, Punch_Right, HitRecieve, Death):
  `anims.glb.gz` for M_*, `anims_w.glb.gz` for W_* (retargeted, feet planted). Clips play in place (Root never moves).
- R_* (Daniel's models): `R_CoolMan` today (cool-man.zip, a Ready Player Me avatar on a Mixamo skeleton) and in 1760
  `R_Coat_Red`, `R_Domostroj`, `R_Mysli` (his three 18th-century costumes dressed on the cool-man's skeleton: the
  avatar's head and hands with powdered hair and a tricorne, the costume's skin weights from the nearest avatar vertex with
  the arms first lowered to the costume's pose, inner clothes taking the weights of the coat over them so they do not poke
  through). Clips: the Quaternius set retargeted onto that skeleton (`anims_r.glb.gz`: world rotation deltas from the
  Quaternius bind applied to the avatar's bind turned into the same T-pose; the spine keeps the avatar's own rest).
  Build: `python3 scripts/people/rpm_build.py scripts/people <dhana.gltf> <anims.glb unzipped> <out>` (R_CoolMan + anims_r),
  then `costume_build.py scripts/people <dhana.gltf> <costume .glb (FBX2glTF) or scene.usdc> <textures dir> <R_name> <out>
  [collar=1.30 neckz=-0.065 for the red coat] [coat=#hex]`, gzip -9 -n into public/models/people. Another Ready Player Me
  avatar (same skeleton) can go through rpm_build.py the same way. Mix: `TODAY_MIX` / `PERIOD_MIX` in main.js.
- Rebuild from the Quaternius sources (the grand-theft-ladcykel assets: M_*.glb, W_*.glb, anims_h.glb):
  `python3 scripts/people/ppl_build.py scripts/people <assets> <out>` (numpy only), check with `ppl_verify.py`, then
  `gzip -9 -n` each output into public/models/people. The rest pose is rebuilt as the true T-pose (the sources store an
  animation frame), Root on the ground between the feet, facing +Z; hand-held weapons go to `<out>/props` (not used).

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
