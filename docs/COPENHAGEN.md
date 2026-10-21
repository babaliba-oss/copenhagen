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
python3 scripts/kk-collision.py copenhagen        # footprints for the model's own houses (no OSM footprint): kk-footprints.json,
                                                  # added to the collision set at load, so the car stops at them
node scripts/road-walls.mjs copenhagen            # after kk-collision and collision-trim: the model's walls standing on
                                                  # the roads as solid strips (road-walls.json); traffic routes round them
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
python3 scripts/surface-fill.py copenhagen          # after fit-colliders, and again after any surface-dissolve.mjs: paving for the
                                                    # unmapped strips between the streets and the houses (below)
node scripts/furniture-ground.mjs copenhagen        # after surface-fill and mapillary-features: flags the furniture with no
                                                    # surface under it, set down onto the bare ground or lawn (main.js)
node scripts/indoor-items.mjs copenhagen            # after furniture-ground, kk-collision and collision-trim: drops furniture
                                                    # inside the model's drawn houses, lists such trees (indoor-trees.json)
```

Most of today's pavements are not mapped as areas (OpenStreetMap draws them as lines or not at all), so the rendered
ground stopped at the carriageway's edge. Beside it lay the bare terrain, half a metre below street level
(terrain-mesh.js): a sunken grey-green strip with a dark trench at the foot of the houses, and the ground under each
building (its mapped outline at 8.5 cm, surfaceChunks) as a pale line beyond it, at the base of every Nyhavn facade in the
trailer's first shot. Walkers on it stood in the air. scripts/surface-fill.py paves whatever lies within 5 m of a road and
is covered by no surface, building or water: 3.4 km², appended to the surface chunks at 4.5 cm (the ground shader's
pavement band, under the mapped pavement). It drops its own earlier fill first, so it can be rerun. 1760 keeps its
cobbles and the bare-ground pavements (main.js); `--dry` reports what it would add (0.12 km² there).

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
raises the ground under every drawn deck, terrain.js `raiseBridgeDecks`) and `scripts/ground-crease-sweep.mjs <city>
[--raw]` (steps and spikes in the ground under streets and pavements, which showed as crumpled paving). The ground fixes
at load (terrain.js) never lift a sample above the dry ground around it (`raiseDryHollows`: a pond or canal level spread
over a square had lifted single samples 2 m out of Højbro Plads and Gråbrødretorv), and a bank deeper than `maxRaise` is
raised by that much with nothing ending above the ground one step inland (`levelBanks`: no cliff where the raise
stopped, no ridge on the ramparts).

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
  and a tricorne, seated; `coachman.py`), `nisse.glb.gz` (Daniel's pick, "Gnome (Female) (Pig Tails)" by David Wigforss, textured: the hidden
  nisser and Nissefar; `nisse.py`. CC BY-NC 4.0, so fine while the game is free; the earlier scan's licence did not allow
  redistribution). All gzipped (unzipped in the browser). Missing files fall back to the Blender coach and horse.
- `radio.js`: the car radio (L, Shift+L back, or click/tap the now-playing card at the top right; the last station is
  remembered, station 1 on the first drive): stations from `radio-stations.json` stream public-domain / CC0 / CC BY
  recordings from the library that hosts them; each station loops on its own clock like a broadcast.
- `landmarks.js`: Vor Frelsers stair, Børsen spire, Tivoli rides, statues, flags, 1760 windmills.
- `parked-cars.js`, `boats.js`, `rails.js`, `trains.js`, `city-cyclists.js`, `cafes.js`: street life.
- `boats.js` in 1760: among the big moorings, the merchant schooner and Amphion, then Daniel's frigate (Svjatoi Nikolai,
  furled sails) and weathered galleon, about 50 m bow to bowsprit: picked by a hash of the mooring's position, and only
  where no neighbour's hull overlaps theirs and the whole hull is open water clear of bridges (`bridge(x,z)` from main.js:
  the city's road and footway areas). Models: `public/models/boats/frigate.glb`, `galleon.glb`.
- `street-food.js`: five hot-dog stands today (Rådhuspladsen twice, Kongens Nytorv, Amagertorv, Torvehallerne), spots
  picked on open pavement, the counter to the square; drawn and solid as mapped furniture (`hotdog-stand`). Cargo bikes:
  `mapped-furniture.js` puts one at a third of the racks left without bicycles (`furniture/cargo-bike.glb`). The bins are
  Daniel's "City Trash Can" (`furniture/bin.glb`, in place of the one `scripts/blender/furniture.py` made).
- `harbour-bath.js`: Havnebadet Islands Brygge (decks, diving tower, bathers); `inHarbourBath()` keeps boats out.
- `pant.js` (today): empty cans by the benches, bins, bus shelters and hot-dog stands, worth their deposit (1 kr each) to
  whoever picks them up, as plenty of Copenhageners do: about a quarter of the benches, a third of the bins, nearly half
  the shelters and two at every stand, picked by a hash of the spot (the same spots every visit), never on a road, in a
  house or in the water; walk, ride or drive within 1.9 m. A can picked up is back after five minutes. Only the cans
  within 90 m are drawn (one instanced mesh, refilled four times a second), with a slow glint; the count shows next to
  the money and titles come at 10, 50, 150 and 400 cans (game.js). Can: the regular can of Daniel's "Cans!" pack (Tiago Oliveira, CC BY
  4.0) as a clean lathe of its measured profile, painted like a lemon-lime soda (green, a white wave over a thin lemon
  line, no name or logo): `scripts/models/can.py <scene.gltf> public/models/props/can.glb`, drawn half as big again.
- `park-geese.js`: flocks of three to seven geese on the lawns of the biggest parks (14 today, 6 in 1760; not the
  cemeteries), most within 25 m of a lake or moat, grazing about their spot and waddling off when someone comes within
  5 m. Model: Daniel's goose ("Goose Low Poly" by Atlas, CC BY 4.0), also the 1760 squares' geese (`animals/goose.glb`):
  `scripts/models/plain_model.py <scene.gltf> public/models/animals/goose.glb height=0.62 yaw=132` (its body points 42
  degrees off its axes; turned to face +X like the other animals).
- Dogs on leads (`person-model.js`): Daniel's Labrador ("dog" by neighbor, CC BY 4.0) in place of the capsule dog where
  it loads: `flatten_model.py <scene.gltf> /tmp/dog_flat.glb tris=1800 k=6 length=0.8 yaw=180`, then
  `scripts/models/dog.py /tmp/dog_flat.glb public/models/animals/dog.glb` cuts it into a body and four legs (pivots and the
  collar in the extras) and greys the coat; the legs swing in diagonal pairs at the walker's trot and each dog's coat
  takes its colour from the palette; a rigged or baked walker with a dog gets the model dog at heel (`drawLooseDog`).
  Walkers with a pram stay procedural figures.
- Halloween pumpkins (`src/copenhagen/seasons.js`, `pumpkinPools`): Daniel's three models in place of the procedural
  pumpkin, shared 45/35/20 across the doorsteps and café tables: A, "Halloween pumpkin" by monsieurmo (its grin and eyes
  painted on to glow); B, "Halloween pumpkin" by Nick Kotik, and C, "Halloween Pumpkin" by Charlie Tinley (both carved
  through and hollow: the inside walls glow as if a candle burned in them), all CC BY 4.0.
  `npm i --no-save meshoptimizer@0.22.0`, then `scripts/models/pumpkins.py public/models/props/pumpkins.glb A=<dir> B=<dir>
  C=<dir>` (each the unzipped Sketchfab folder) writes `<model><level>_<body|glow>` meshes with vertex colours sampled
  from the textures: level 0 (1,500-1,900 triangles) is meshoptimizer's attribute-aware simplification
  (`scripts/models/simplify.mjs`), so body and glow share their seam; level 1 (about 200) is a sphere shrink-wrapped onto
  the model by rays from its middle, the carving closed over and glowing. Within 40 m of the player the pumpkins are
  level 0, out to 260 m level 1: one instanced pool per model, level and part, refilled four times a second.
- Trees (`src/tree-species.js`, `src/ez-trees.js`): within 95 m of the player the broadleaf trees are Daniel's tree models
  (`public/models/trees/linden.glb`, "Realistic Tree": limes, maples, ash, chestnuts and the smaller street trees;
  `oak.glb`, "Tree GN" without its vines: oaks, elms, willows), one BatchedMesh per model and part, scaled per tree to the
  register's height and the family's crown width. Birches and conifers keep the procedural EZ-Tree crowns, as does every
  family when the models do not load (`?car=classic`; `?eztrees` keeps EZ-Tree for all, to compare). `spaceTrees`
  keeps trees at least 3.5 m apart (the register lists some twice, 1-2 m apart: Rådhuspladsen's cherry grove, 77 trees
  within 40 m, read as one wall; 29 stay, 4% fewer trees in all) and caps each crown at 1.8 times the distance to its nearest neighbour. Build: `python3 scripts/models/tree_build.py <scene.gltf> <out.glb>
  leaves=<leaf materials> bark=<bark materials> [drop=] keep= grow= twigs= bark_tris= bark_tex= leaf_tex=` (Blender):
  a share of the leaf cards kept and grown so the crown stays closed, twig pieces dropped and the bark decimated, the
  textures cut to 512 px (leaf materials packed into one atlas), the trunk base at the origin. linden: `leaves=normal_leaves
  bark=trunk keep=0.24 grow=1.42 twigs=6 bark_tris=1500 leaf_tex=256` (4.4k triangles); oak: `leaves=ClusterB,ClusterB2
  bark=BarkB drop=VinesB,PruneB,CortexB keep=0.5 grow=1.22 bark_tris=1800 leaf_tex=1024` (4.9k).
- Frederik V at Amalienborg (`statues/frederik-v.glb`): `scripts/models/frederik_v.py` colours alexabhisak's untextured CC BY
  upload by zone (green bronze rider, pale stone plinth, black railing), 12k triangles.
- `period-life.js`: 1760 crowds on squares, quays and gates, carts and animals; the quays' cargo uses Daniel's barrel and
  crate (`props/barrel.glb`, `crate.glb`), and the squares get his night watchman (half of them) and a spinner at her
  distaff (most), placed from each square's position so the rest keeps its layout. Pigs and hens are his too
  (`animals/pig.glb`, `hen.glb`, in place of the `scripts/blender/animals.py` ones, which would overwrite them; head along
  +X), and the market stalls his food stand (`props/market-stall.glb`, passed to `stalls.js` as `model`; the old stall
  with its coloured awnings is the fallback). `soundscape.js`: engine, tyres, bells, hooves,
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
- Nor into a sign, lamp post or tree trunk: `near()` in main.js (world.objects, indexed between shots) keeps the lens
  0.9 m from them, a side/wheel/pass camera picks the side of the car with fewer of them within 2 m over the whole shot
  (`pickSide`), and the pass camera stands where none is within 2 m. A chase camera still swings across the inside of
  a sharp corner (a camera on the car's path behind it was tried: it ended up beside the car, looking at its flank), so
  the drive shots avoid sharp turns. The car's own heading is the road's over 2.5 m either side of it and a lane-offset
  change is eased over 14 m, so it never snaps at a junction.
- Order in the frame: the trailer moves the car before the car model and the camera are placed for the frame. Placed
  after, the model trailed the camera by a frame and shook whenever frame times varied (Daniel's first recording).
- Shots can set the sky (`sky:'night'`), switch today's seasonal decorations mid-run (`season:'halloween'|'christmas'`,
  Christmas comes last so the snow stays), follow a character live (`orbit.follow:'hca'|'nisse'`), or show part of the
  interface: `hud:'radio'` (the now-playing card tuning through the stations) and `hud:'quest'` (a saga starting: banner,
  red beam and route; game.js `trailer` shows it without touching the save).

### Rigged people (src/skinned-people.js)

The ten walkers nearest the camera within 45 m (five within 30 m on phones) and the player on foot are low-poly characters by Quaternius (CC0),
one skinned mesh each with the material colours in its vertex colours. The walkers beyond them, out to 140 m (70 m on
phones), are the same characters baked (`createBakedCrowd`): each model's Walk clip is sampled at 12 frames (plus one
Idle frame) into absolute morph targets, and one InstancedMesh per model blends the two frames either side of each
walker's phase through a per-instance morph texture, so a crowd of 80 costs a dozen draw calls and no skinning. The
models bake one at a time after load (30 ms apart), so the first frames are not held up. Anyone with a pose (phone,
chat, bike), a fall, a suitcase, a pram, running or in a conversation stays the procedural instanced figure
(person-model.js), as does everyone beyond the baked range. Riding, falling and carrying, the player is the procedural
figure too. `?procedural` turns the rigged and baked ones off.
- The other crowds are the characters as well: the cyclists (cyclists.js, set `ride`: 8 frames round the crank, two
  blended at each rider's crank angle, out to 140 m) and every crowd made by `createInstancedPeople` (market-life.js:
  the café guests, seated, set `sit`; the squares, the market, the game's people and the 1760 crowd, walking or
  standing, set `walk`; out to 90 m, 45 m on phones). The fallen, the far and the tiny keep the procedural figure.
- The seated and cycling poses (src/people-poses.js) are made from each model's Idle pose by turning bones in world
  space, so one description serves both rigs: hips onto the saddle or chair, a lean in the back, two-bone IK for the
  legs (the pedals round the crank, or the feet under the table) and the arms (the bike's swept-back grips, or the
  table top). `node scripts/people/pose-preview.mjs <name> <out.json>` writes the posed vertices for a software render;
  tests/baked-people.test.mjs checks the feet stay on the pedals all the way round, for both rigs.
- The player rides as the rigged character too: on the bike, the ladcykel and the e-scooter, the Idle pose is put back
  each frame and posed on the ride's own anchors (player-ride-models.js; `rideSpec`, `standSpec`), the feet going round
  on the drawn pedals. The bike's cranks now turn forward (the top pedal moving ahead, as the wheels' tops do), and the
  procedural rider's feet with them.
- Far versions: each baked model also gets a version with about a third of its triangles (meshoptimizer's `simplify`,
  which keeps the vertices it uses, so the frames and colours are shared), drawn for the baked people beyond 32 m.
- Files: `public/models/people/<name>.glb.gz` (gzipped GLB, unzipped in the browser: Cloudflare serves .glb uncompressed).
  Today uses twelve characters (with Daniel's cool-man, pmariano and a woman in a party dress); 1760 his Victorian woman, the merchant's wife and
  `W_Medieval` for the women, his costumes for the men in town and the ship boy and six sailors (below); the player is
  `M_Casual_Hoodie` today and `R_Coat_Blue` in 1760 (main.js, where the street life is created).
- Two rigs: the men (M_*) and the women (W_*) share bone names, but the women's bones are turned differently, so each
  has its own copy of the 9 clips (Walk, Run, Idle, Idle_Neutral, Wave, Interact, Punch_Right, HitRecieve, Death):
  `anims.glb.gz` for M_*, `anims_w.glb.gz` for W_* (retargeted, feet planted). Clips play in place (Root never moves).
- R_* (Daniel's models): `R_CoolMan` today (cool-man.zip, a Ready Player Me avatar on a Mixamo skeleton) and in 1760
  `R_Coat_Red`, `R_Domostroj` (his 18th-century costumes, Man's #1 and #3, dressed on the cool-man's skeleton: the
  avatar's head and hands with powdered hair and a tricorne, the costume's skin weights from the nearest avatar vertex with
  the arms first lowered to the costume's pose, inner clothes taking the weights of the coat over them so they do not poke
  through). Clips: the Quaternius set retargeted onto that skeleton (`anims_r.glb.gz`: world rotation deltas from the
  Quaternius bind applied to the avatar's bind turned into the same T-pose; the spine keeps the avatar's own rest).
  Build: `python3 scripts/people/rpm_build.py scripts/people <dhana.gltf> <anims.glb unzipped> <out>` (R_CoolMan + anims_r),
  then `costume_build.py scripts/people <dhana.gltf> <costume .glb (FBX2glTF) or scene.usdc> <textures dir> <R_name> <out>
  [collar=1.30 neckz=-0.065 for the red coat] [coat= vest= drawers= hose= shoes= cravat=#hex] [hat=top] [hair=keep]
  [detail=2.5]`, gzip -9 -n into public/models/people. `R_Coat_Blue` (the 1760 player), `R_Coat_Brown`, `R_Coat_Green` are
  the red coat recoloured (blue with a buff waistcoat: `coat=#26365e vest=#cdbf98`; brown: `coat=#5b4330 vest=#8a7a5c
  drawers=#4a3a2c`; green: `coat=#33473a vest=#d8d0bc`). `R_HCA` is H.C. Andersen at Nyhavn (main.js draws him rigged in
  place of his generic figure): the red coat in black with dark trousers, a white cravat, a top hat and his own hair
  (`coat=#17181f vest=#3b3430 drawers=#1b1b21 hose=#1b1b21 shoes=#141414 cravat=#ece9e2 hat=top hair=keep detail=2.5`). Another Ready Player Me
  avatar (same skeleton) can go through rpm_build.py the same way. Mix: `TODAY_MIX` / `PERIOD_MIX` in main.js.
  `R_Mysli` (Man's #4) is built from Moskvin's CC BY "Textiles: Man's costume #4" (the earlier upload is CC BY-NC-ND):
  `costume_build.py scripts/people <dhana.gltf> <its scene.gltf> <its textures> R_Mysli <out> parts=Farn_shoe,Man_hose,blouse,coat,trousers`. Ready Player Me avatars (the cool-man, pmariano)
  come with Ready Player Me's terms, which allow non-commercial use: fine while the game is free.
- Figures without a skeleton of their own (a scan or sculpt in one pose) go onto the Quaternius rigs with
  `scripts/people/figure_build.py <template M_/W_ .glb, gunzipped> <figure> <out.glb> name=M_X [arm=deg] [hips=f] [crop=x0:x1]`:
  the figure is stretched onto the template's heights and arm span, the template's arms lowered to the figure's (`arm`,
  degrees below horizontal) and its skin weights copied from the nearest template vertex facing the same way, then the
  figure is turned back into the template's T-pose by inverse skinning. Colours: the texture per triangle, k flat colours
  in the vertex colours. It keeps the template's skeleton, so the M_/W_ clips play on it unchanged. Built this way:
  `W_Victorian` (template W_Medieval, arm=72), `W_Merchant` (the merchant's wife, W_Medieval, arm=80), `M_Shipboy` (the
  Royal Navy ship boy, M_Suit, T-pose, `skip=Gun_low,Sword_`), `M_Sailor1`–`6` (the pirate crew, M_Suit, one `crop` per
  figure, arm 66–85, `hips=0.5`) for 1760, and `M_Pmariano` (M_Casual_2, arm=67) and `W_Dress` ("Woman Dress 2", W_Formal, arm=48,
  `skip=eye_,eyelash_,tooth`) today. Check a build by posing it with
  a clip before shipping it (hands, hips): a wrong arm angle bends the arms, a wrong hip height the legs.
- Static models (ships, props, standing figures) go through `scripts/models/flatten_model.py <in> <out.glb> [tris=]
  [k=] [length=|height=|scale=] [yaw=] [base=] [thin=] [minpart=] [tex=|matex=|colors=] [predecimate=]`: texture
  colours per triangle, k flat colours, simplified, one mesh per colour for `loadColouredModel(s)` (it keeps position and
  normal only, so every vertex needs a normal). Shared reader: `scripts/models/model_io.py` (Blender as a Python module,
  `pip install bpy`). Sketchfab "source" downloads carry no licence file: check the model's page before using it (the
  repo is public: CC0 or CC BY only), and credit it in the era's `attribution` in `public/cities/index.json`.
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
