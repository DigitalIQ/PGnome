# PGNome: Island Evolution

PGNome is a small evolution sandbox in the browser. A handful of creatures, the Nomes, live on a generated island. They eat plants, look for partners and try to stay comfortable. Every child inherits a mix of its parents' genes with small mutations. Seasons, food and terrain decide which genes survive. You shape the island, but you never control a Nome directly.

## How it plays

- **Genes with trade-offs.** Size, speed, sight, heat liking, wet liking, sociability and lifespan. Big Nomes keep warm in winter but need more food. Fast Nomes reach food first but burn more energy. Long lives cost energy too.
- **Seasons.** Spring and summer are rich, winter is lean and cold. Populations boom and crash, and the survivors shape the next generation.
- **Generated bodies.** Every Nome body is built from its genes: torso length and shape, two, four or six legs, one to three eyes, horns, tail, spots or stripes and an accent color. Heat lovers grow big ears, cold lovers a fur tuft. More legs grip better on marsh and rock but cost energy. Rare jumps in body genes create new body plans.
- **Weather.** Clear skies, clouds, rain, storms with lightning, fog, heat waves and snowfall. Rain makes plants grow, fog shortens sight, storms drain energy unless a Nome hides in a forest.
- **Two island types.** A classic island stays as you shape it. A living island changes on its own: the sea rises and falls, a wandering hot spot pushes mountains up, rain wears them down, and forests spread or retreat with moisture and grazing.
- **Island records.** Each seed has a fixed island name. Runs are scored by years survived, generations, peak population and goals, and the best runs show up on a records board per island and overall.
- **Your tools.** Inspect, carry Nomes, scatter food and paint terrain: meadow, forest, water, sand, marsh and rock. Water blocks paths, rock raises the ground and is cold.
- **Read-outs.** Population graph with season bands (plus land area on living islands), gene pool ranges, body plan shares, island size and height, a log, and nine goals.
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

Then open http://localhost:8000. Three.js 0.160 loads from jsDelivr, so the first start needs an internet connection.

## Code layout

| File | Purpose |
| --- | --- |
| `js/config.js` | Biomes, genes, goals and balance numbers |
| `js/world.js` | Island generation, living terrain, plants, path search |
| `js/creature.js` | Nome genes and behaviour |
| `js/body.js` | Generated Nome bodies and skin patterns |
| `js/weather.js` | Weather spells and their effects |
| `js/sky.js` | Rain, snow and fog rendering |
| `js/scores.js` | Island names, scores and the records board |
| `js/game.js` | Simulation loop, seasons, breeding, goals, saving |
| `js/ui.js` | Panels, graph, log and overlays |
| `js/input.js` | Mouse, touch and keyboard |
| `js/main.js` | Renderer, camera, lights and the frame loop |

## License

MIT, see [LICENSE](LICENSE).
