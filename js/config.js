// Tunables for world, simulation and genetics. Times are simulation seconds.

export const MAP_SIZE = 40;
export const MAX_POP = 150;
export const FOUNDERS = 10;
export const SIM_STEP = 1 / 30;
export const YEAR_LENGTH = 160;
export const MATURITY_AGE = 28;
export const BREED_COOLDOWN = 24;
export const SAVE_KEY = 'pgnome-save-v2';
export const SCORE_KEY = 'pgnome-records-v1';

export const B = { WATER: 0, SAND: 1, MEADOW: 2, FOREST: 3, MARSH: 4, ROCK: 5, LAVA: 6 };

// temp and moisture are on an abstract 0..100 scale.
// food is the plant capacity of a tile, regrow the share of it that grows back per second.
export const BIOMES = [
    { key: 'water', name: 'Water', color: 0x3f86c4, temp: 50, moisture: 100, food: 0, regrow: 0, speed: 0, walkable: false, snow: 0.35 },
    { key: 'sand', name: 'Sand', color: 0xe2c780, temp: 74, moisture: 12, food: 0.25, regrow: 0.004, speed: 0.9, walkable: true, snow: 0.8 },
    { key: 'meadow', name: 'Meadow', color: 0x83bf55, temp: 56, moisture: 48, food: 1.0, regrow: 0.009, speed: 1.0, walkable: true, snow: 0.85 },
    { key: 'forest', name: 'Forest', color: 0x3d7a3c, temp: 44, moisture: 66, food: 1.3, regrow: 0.007, speed: 0.75, walkable: true, snow: 0.7 },
    { key: 'marsh', name: 'Marsh', color: 0x6f5d3d, temp: 52, moisture: 88, food: 0.7, regrow: 0.008, speed: 0.6, walkable: true, snow: 0.6 },
    { key: 'rock', name: 'Rock', color: 0x8c8f93, temp: 28, moisture: 18, food: 0.08, regrow: 0.002, speed: 0.5, walkable: true, snow: 0.95 },
    { key: 'lava', name: 'Lava', color: 0xff5a1f, temp: 100, moisture: 0, food: 0, regrow: 0, speed: 0, walkable: false, snow: 0 }
];

// Food types. energy is per food unit, handle the seconds a portion takes before genes.
// tox scales how much of a tile's plant poison ends up in this food.
export const FOODS = {
    greens: { name: 'Greens', verb: 'Grazing', energy: 80, handle: 1, tox: 0.45 },
    fruit: { name: 'Fruit', verb: 'Eating fruit', energy: 125, handle: 1.3, tox: 1 },
    nuts: { name: 'Nuts', verb: 'Cracking nuts', energy: 175, handle: 3.2, tox: 0.15 },
    shroom: { name: 'Mushrooms', verb: 'Eating mushrooms', energy: 105, handle: 0.9, tox: 1.4 },
    roots: { name: 'Roots', verb: 'Digging up roots', energy: 95, handle: 2.4, tox: 0.3 },
    seaweed: { name: 'Seaweed', verb: 'Grazing seaweed', energy: 80, handle: 1.1, tox: 0 },
    nectar: { name: 'Moonflower nectar', verb: 'Drinking moonflower nectar', energy: 110, handle: 0.7, tox: 0 }
};

// Predators evolve too. Each hawk and lurker carries these genes and passes them on.
export const HAWK_GENES = {
    dive: { label: 'Dive speed', min: 0.7, max: 1.6 },
    eyes: { label: 'Sharp eyes', min: 0.6, max: 1.5 },
    size: { label: 'Size', min: 0.7, max: 1.5 },
    night: { label: 'Night hunting', min: 0, max: 1 },
    stealth: { label: 'Stealth', min: 0, max: 1 }
};
export const LURKER_GENES = {
    camo: { label: 'Camouflage', min: 0, max: 1 },
    strike: { label: 'Strike speed', min: 0.6, max: 1.5 },
    venom: { label: 'Venom', min: 0, max: 1 },
    size: { label: 'Size', min: 0.7, max: 1.4 },
    habitat: { label: 'Forest liking', min: 0, max: 1 }
};

export const DISASTERS = {
    quake: { name: 'Earthquake' },
    volcano: { name: 'Volcano' },
    tsunami: { name: 'Tsunami' },
    wildfire: { name: 'Wildfire' },
    plague: { name: 'Plague' }
};

export const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];

// Every gene has a benefit and a cost. How much each matters depends on season, weather,
// time of day and terrain, so no single value is best everywhere.
export const GENES = {
    hue: { label: 'Color', min: 0, max: 360, wrap: true, effect: 'Picky Nomes only pair with similar colors. Over time this can split a population.' },
    size: { label: 'Size', min: 0.6, max: 1.6, effect: 'Keeps warm, resists wind and is too big for most hawks. Needs much more food.' },
    speed: { label: 'Speed', min: 0.6, max: 2.4, effect: 'Reaches food first. Burns energy fast while moving.' },
    sight: { label: 'Sight', min: 3, max: 10, effect: 'Finds food and partners further away and spots hawks early. Costs a little energy.' },
    prefTemp: { label: 'Heat liking', min: 0, max: 100, effect: 'The temperature this Nome feels best at. Heat lovers grow big ears.' },
    prefMoisture: { label: 'Wet liking', min: 0, max: 100, effect: 'The moisture this Nome feels best at.' },
    sociability: { label: 'Sociability', min: 0, max: 1, effect: 'Social Nomes huddle for warmth and watch out for hawks together. Loners hate crowds.' },
    lifespan: { label: 'Lifespan', min: 90, max: 220, effect: 'Lives longer and breeds more often. Costs energy every second.' },
    metabolism: { label: 'Metabolism', min: 0, max: 1, effect: 'Fast: grows up and heals quickly. Slow: lives longer on less food.' },
    fur: { label: 'Fur', min: 0, max: 1, effect: 'Warm in cold and snow. Hot in summer, and wet fur in rain stops warming.' },
    pigment: { label: 'Skin tone', min: 0, max: 1, effect: 'Dark skin soaks up sunshine, light skin reflects it but stands out to hawks on green ground.' },
    nocturnal: { label: 'Night life', min: 0, max: 1, effect: 'Night Nomes see in the dark, drink moonflower nectar, dodge the midday heat and the hawks. They sleep by day.' },
    webbing: { label: 'Webbed feet', min: 0, max: 1, effect: 'Swims to other islands, grazes seaweed and dives away from hawks. A little slower on land.' },
    curiosity: { label: 'Curiosity', min: 0, max: 1, effect: 'Roams far and finds new food. Wastes energy walking.' },
    litter: { label: 'Twins', min: 0, max: 1, effect: 'Chance of twins. Each birth costs the parents more, children start weaker.' },
    pickiness: { label: 'Pickiness', min: 0, max: 1, effect: 'Only pairs with similar colors, but raises stronger children.' },
    legs: { label: 'Legs', min: 0, max: 1, body: true, effect: 'More legs grip on marsh and rock but are slower on flat ground and cost energy.' },
    bodyLen: { label: 'Body length', min: 0.75, max: 1.6, body: true, effect: 'A long body stores more food. It costs more to carry.' },
    plump: { label: 'Plumpness', min: 0, max: 1, body: true, effect: 'Fat keeps warm and helps survive hunger. Slow and hot in summer.' },
    eyes: { label: 'Eyes', min: 0, max: 1, body: true, effect: 'Three eyes see through fog and dark and spot hawks. One eye is cheap but nearly blind in fog.' },
    horns: { label: 'Horns', min: 0, max: 1, body: true, effect: 'Horns win food fights, attract partners and scare off hawks. Lightning likes them.' },
    tail: { label: 'Tail', min: 0, max: 1, body: true, effect: 'Balances in storms, steers when swimming and sheds a little heat.' },
    pattern: { label: 'Pattern', min: 0, max: 1, body: true, effect: 'Spots and stripes attract partners, but hawks see them too.' },
    hue2: { label: 'Accent color', min: 0, max: 360, wrap: true, body: true, effect: 'Color of spots, stripes and crest. Pure looks.' },
    jaw: { label: 'Jaw', min: 0, max: 1, effect: 'Cracks nuts fast, the best winter food. A heavy head costs energy and slows grazing a little.' },
    claws: { label: 'Claws', min: 0, max: 1, effect: 'Digs burrows, roots and drains marshes. Clumsy and slow on flat ground.' },
    toxinRes: { label: 'Poison tolerance', min: 0, max: 1, effect: 'Eats poisonous plants and survives lurker venom. A strong liver burns energy all the time.' },
    palate: { label: 'Taste', min: 0, max: 1, effect: 'Tastes poison and spits it out, avoids warning colors. Wary eaters also skip some good food.' },
    vigilance: { label: 'Alertness', min: 0, max: 1, effect: 'Looks up while eating and spots hawks and lurkers. Every meal takes longer.' },
    care: { label: 'Parental care', min: 0, max: 1, effect: 'Parents guard and feed their young. Children start strong, parents lose time and food.' },
    builder: { label: 'Building drive', min: 0, max: 1, effect: 'Builds dams into shallow water and plants seeds. Work takes time away from eating.' },
    immunity: { label: 'Immunity', min: 0, max: 1, effect: 'Shrugs off plague. A strong immune system costs energy.' }
};

export const legCount = v => (v < 0.3 ? 2 : v < 0.78 ? 4 : 6);
export const eyeCount = v => (v < 0.12 ? 1 : v > 0.9 ? 3 : 2);
export const patternName = v => (v < 0.4 ? 'plain' : v < 0.7 ? 'spotted' : 'striped');

// Weather. temp shifts the air temperature, wet the moisture, growth multiplies plant growth.
// The other fields drive effects and visuals: rain, snow, hail and dust are particle amounts,
// cloud is the sky cover, flood raises the sea on living islands, mood lifts spirits.
export const WEATHER = {
    clear: { name: 'Clear', temp: 1, wet: -4, growth: 1.0, sight: 1, burn: 0, light: 1, fog: 0, cloud: 0.12 },
    cloudy: { name: 'Cloudy', temp: -2, wet: 3, growth: 0.9, sight: 1, burn: 0, light: 0.75, fog: 0.1, cloud: 0.8 },
    windy: { name: 'Windy', temp: -2, wet: -6, growth: 0.95, sight: 0.95, burn: 0.08, light: 0.9, fog: 0, cloud: 0.4, wind: 0.7, leaves: 1 },
    drizzle: { name: 'Drizzle', temp: -2, wet: 10, growth: 1.25, sight: 0.9, burn: 0, light: 0.7, fog: 0.15, cloud: 0.7, rain: 0.4 },
    rain: { name: 'Rain', temp: -3, wet: 18, growth: 1.6, sight: 0.85, burn: 0.05, light: 0.6, fog: 0.2, cloud: 0.9, rain: 1 },
    downpour: { name: 'Downpour', temp: -4, wet: 32, growth: 1.4, sight: 0.6, burn: 0.12, light: 0.4, fog: 0.4, cloud: 1, rain: 2.6, flood: 1 },
    storm: { name: 'Thunderstorm', temp: -4, wet: 25, growth: 1.25, sight: 0.7, burn: 0.25, light: 0.4, fog: 0.3, cloud: 1, rain: 1.8, wind: 1, lightning: 1 },
    hail: { name: 'Hail', temp: -6, wet: 8, growth: 0.6, sight: 0.8, burn: 0.1, light: 0.55, fog: 0.15, cloud: 0.9, hail: 1 },
    fog: { name: 'Fog', temp: -1, wet: 8, growth: 1.0, sight: 0.55, burn: 0, light: 0.7, fog: 1, cloud: 0.2 },
    heat: { name: 'Heat wave', temp: 13, wet: -28, growth: 0.35, sight: 1, burn: 0.12, light: 1.15, fog: 0.25, cloud: 0, haze: 1 },
    sandstorm: { name: 'Sandstorm', temp: 6, wet: -22, growth: 0.5, sight: 0.4, burn: 0.2, light: 0.65, fog: 0.6, cloud: 0.3, wind: 1, dust: 1 },
    snow: { name: 'Snowfall', temp: -5, wet: 6, growth: 0.6, sight: 0.8, burn: 0.06, light: 0.7, fog: 0.25, cloud: 0.8, snow: 1 },
    blizzard: { name: 'Blizzard', temp: -10, wet: 8, growth: 0.4, sight: 0.4, burn: 0.25, light: 0.45, fog: 0.6, cloud: 1, snow: 2, wind: 1 },
    frost: { name: 'Frost', temp: -7, wet: -2, growth: 0.5, sight: 1, burn: 0.05, light: 1, fog: 0.05, cloud: 0.05, frost: 1 },
    rainbow: { name: 'Rainbow', temp: 0, wet: 8, growth: 1.15, sight: 1, burn: 0, light: 0.95, fog: 0, cloud: 0.4, rainbow: 1, mood: 12 },
    aurora: { name: 'Northern lights', temp: -4, wet: 0, growth: 0.8, sight: 1, burn: 0, light: 0.9, fog: 0, cloud: 0.05, aurora: 1, mood: 12 }
};

// How likely each weather is per season (spring, summer, autumn, winter).
// A rainbow can only follow rain, so it is not listed here.
export const WEATHER_ODDS = [
    { clear: 3, cloudy: 2, windy: 1, drizzle: 2, rain: 2.5, downpour: 0.6, storm: 0.7, hail: 0.6, fog: 1.2, frost: 0.5 },
    { clear: 4, cloudy: 1, windy: 0.8, drizzle: 0.8, rain: 1, downpour: 0.6, storm: 1.1, heat: 2, sandstorm: 0.8, hail: 0.4 },
    { clear: 2, cloudy: 2.5, windy: 2, drizzle: 2, rain: 2.5, downpour: 1, storm: 1.4, fog: 2.2, frost: 0.8 },
    { clear: 2, cloudy: 2.3, windy: 0.8, snow: 3, blizzard: 1, frost: 1.8, fog: 1.2, storm: 0.5, aurora: 1 }
];

export const DAY_LENGTH = 32;

export const MODES = {
    classic: { name: 'Classic island', bonus: 1 },
    living: { name: 'Living island', bonus: 1.25 }
};

export const GOALS = [
    { id: 'birth', label: 'Witness the first birth' },
    { id: 'gen5', label: 'Reach generation 5' },
    { id: 'pop40', label: 'Grow to 40 Nomes at once' },
    { id: 'winter', label: 'Get 30 Nomes through a winter' },
    { id: 'biomes', label: 'Settle all five land biomes at once' },
    { id: 'extreme', label: 'Breed a heat liking below 20 or above 80' },
    { id: 'gen10', label: 'Reach generation 12' },
    { id: 'sixlegs', label: 'Evolve a six-legged Nome' },
    { id: 'swimmer', label: 'Evolve a swimmer (webbed feet over 70%)' },
    { id: 'night', label: 'Evolve a night walker (night life over 70%)' },
    { id: 'pop100', label: 'Grow to 100 Nomes at once' },
    { id: 'poison', label: 'Evolve poison tolerance over 70%' },
    { id: 'dam', label: 'Let the Nomes build land from the sea' },
    { id: 'disaster', label: 'Keep 20 Nomes alive through a disaster' }
];
