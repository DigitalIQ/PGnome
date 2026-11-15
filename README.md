# PGNome: Island Evolution

**Play it:** https://digitaliq.github.io/PGnome/

PGNome is a small evolution sandbox in the browser. A handful of creatures, the Nomes, live on a generated island. They eat plants, look for partners and try to stay comfortable. Every child inherits a mix of its parents' genes with small mutations. Seasons, food and terrain decide which genes survive. You shape the island, but you never control a Nome directly.

## How it plays

- **32 genes, all with trade-offs.** Size, speed, sight, heat and wet liking, sociability, lifespan, metabolism, fur, skin tone, night life, webbed feet, curiosity, twins, pickiness, legs, body length, plumpness, eyes, horns, tail, pattern, colors, jaw, claws, poison tolerance, taste, alertness, parental care, building drive and immunity. Every gene helps somewhere and costs something, and how much depends on season, weather, time of day and terrain. Fur warms in snow but soaks in rain. Dark skin soaks up sunshine, but only by day. Webbed feet cross shallow water. Three eyes see through fog. Horns win food fights but draw lightning. Picky Nomes only pair with similar colors, which can split a population.
- **Everything takes time.** Eating comes in portions: greens are quick, nuts take long unless the jaw is strong, roots need claws. Alert Nomes look up between bites and eat slower. Courting, caring for young, digging and building all take seconds that are missing elsewhere, and a busy Nome notices predators late.
- **Seven kinds of food.** Greens, fruit in summer, nuts in autumn that last into winter, mushrooms after rain, roots for diggers, seaweed for swimmers and moonflower nectar at night.
- **The poison race.** Plants that get eaten a lot turn bitter, show warning colors and spread their poison to neighbors. Poison costs them growth, so it fades where nobody grazes. Nomes answer with poison tolerance or a good taste that spits bitter food out.
- **Nomes change the island.** Walking wears trails into the ground, which are quick to walk but grow less food. Diggers make burrows that shelter from hawks, hail and cold. Builders dam shallow water into new land and plant seeds that turn sand into meadow and meadow into forest. Diggers drain marshes. Droppings and the dead make soil fertile.
- **Crowding has consequences.** There is no fixed population cap. Where too many Nomes live close together they get stressed: they burn more energy, age faster, breed less, raise weaker young, fight over food and catch diseases more easily. Crowds can start a plague on their own. Stressed Nomes leave for quieter places, swimmers cross to other islands, and more prey feeds more predators. Social Nomes stand crowds better than loners.
- **Seasons.** Spring and summer are rich, winter is lean and cold. Populations boom and crash, and the survivors shape the next generation.
- **Generated bodies.** Every Nome body is built from its genes: torso length and shape, two, four or six legs, one to three eyes, horns, tail, spots or stripes, fur spikes, webbed feet, feelers, a crest, glowing night eyes and skin tone. Rare jumps in body genes create new body plans.
- **Day, night and 16 kinds of weather.** Clear, cloudy, windy, drizzle, rain, downpour, thunderstorm, hail, fog, heat wave, sandstorm, snow, blizzard, frost, rainbow and northern lights. Each one changes temperature, moisture, plant growth, sight or energy use. Night is cold and dark, day Nomes sleep while night Nomes forage.
- **Things to watch.** Drifting clouds with shadows, rain streaks, snow, hail, dust, autumn leaves, fireflies on summer nights, lightning bolts, burning forests, a rainbow after rain and northern lights in winter.
- **An archipelago.** A main island and two or three smaller ones, separated by shallow straits. Only swimmers cross, so populations on the islands drift apart. On a living island, low sea levels open land bridges.
- **Niches.** Seaweed grows in shallow water and only swimmers can graze it. Moonflowers open at night and wilt at dawn, so night Nomes get food the day Nomes sleep through. Middays are hot, which pushes day Nomes into the shade.
- **Predators that evolve.** Hawks hunt from the air and pick small, lone, colorful, busy or sleeping Nomes on open ground. Lurkers lie in wait in marsh, forest and meadow and strike at Nomes that do not see them. Both carry genes (dive speed, sharp eyes, size, night hunting and stealth for hawks; camouflage, strike speed, venom, size and habitat for lurkers), live from what they catch and raise young when well fed. So the hunters follow the Nomes: night Nomes breed owl-like night hawks, alert Nomes breed better camouflage. Forests, burrows and water give cover, alertness and company spot danger early, caring parents guard their young.
- **Disasters.** Earthquakes open rifts of water and push up rock. Volcanoes pour lava downhill, cover the sky in ash for months, turn the soil fertile and build new land where lava meets the sea. Tsunamis flood low coasts. Wildfires race through dry forests and leave fertile meadow. Plague spreads where Nomes crowd. Disasters come now and then, can be switched off, or unleashed from the settings.
- **Two island types.** A classic island stays as you shape it. A living island changes on its own: the sea rises and falls, a wandering hot spot pushes mountains up, rain wears them down, and forests spread or retreat with moisture and grazing.
- **Island records.** Each seed has a fixed island name. Runs are scored by years survived, generations, peak population and goals, and the best runs show up on a records board per island and overall.
- **Your tools.** Inspect, carry Nomes, scatter food and paint terrain: meadow, forest, water, sand, marsh and rock. Water blocks paths, rock raises the ground and is cold.
- **Read-outs.** Population graph with season bands (plus land area on living islands), gene pool ranges, body plan shares, island size and height, a log, and fourteen goals.
- **Statistics.** A statistics window with nine tabs: overview and a year table, population, land and predators over time, the spread and drift of every gene, body plans, food and the poison race, predators and how their genes evolve, disasters, causes of death, weather and the marks Nomes leave on the land, and notable Nomes you can jump to.
- **Light on the computer.** The island is drawn with a few instanced meshes, Nome bodies are merged per material, and the game draws at most 60 frames a second (30 in the background or while paused). A battery saver in the world settings drops to 30 frames, normal resolution and no shadows.
- **Saves itself.** The game autosaves to the browser and offers "Continue" on the next visit.

## Controls

| Input | Action |
| --- | --- |
| Left click / drag | Use the current tool |
| Right drag | Rotate the view |
| Shift + drag, middle drag, WASD or arrow keys | Move the view |
| Scroll or pinch | Zoom |
| 1 to 9 | Pick a tool |
| Space | Pause |
| F | Follow the selected Nome |
| Esc | Clear the selection |

## Run it

The game uses ES modules, so it needs a web server. Opening `index.html` from the file system does not work.

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000. Everything is self-hosted, so the game also runs offline.

## Security

The game is a static page with no backend, no accounts and no secrets.

- Three.js 0.160.0 is vendored in `vendor/three/`, copied unchanged from the npm tarball whose sha512 matches the registry (see `vendor/three/SOURCE.txt`). Fonts are self-hosted in `fonts/`. The page makes no third-party requests.
- A Content Security Policy in `index.html` only allows scripts from the site itself plus the hashed import map. If you edit the import map, update its `sha256-` hash.
- Saves and records come from `localStorage`, which every GitHub Pages site of the same account shares. `js/validate.js` rebuilds them from known fields and value ranges before the game uses them.

## Code layout

| File | Purpose |
| --- | --- |
| `js/config.js` | Biomes, genes, foods, predator genes, goals and balance numbers |
| `js/world.js` | Island generation, living terrain, plants, path search |
| `js/creature.js` | Nome genes and behaviour |
| `js/body.js` | Generated Nome bodies and skin patterns |
| `js/weather.js` | Weather spells and their effects |
| `js/sky.js` | Rain, snow and fog rendering |
| `js/scores.js` | Island names, scores and the records board |
| `js/stats.js` | The statistics window and its charts |
| `js/predator.js` | Hawks and lurkers, their genes and hunting |
| `js/disasters.js` | Earthquakes, volcanoes, tsunamis, wildfires, plague, lava and heat |
| `js/validate.js` | Cleans saves and records read from localStorage |
| `js/game.js` | Simulation loop, seasons, breeding, goals, saving |
| `js/ui.js` | Panels, graph, log and overlays |
| `js/input.js` | Mouse, touch and keyboard |
| `js/main.js` | Renderer, camera, lights and the frame loop |

## License

MIT, see [LICENSE](LICENSE).
