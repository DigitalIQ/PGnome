// Tunables for world, simulation and genetics. Times are simulation seconds.

export const MAP_SIZE = 32;
export const MAX_POP = 150;
export const FOUNDERS = 10;
export const SIM_STEP = 1 / 30;
export const YEAR_LENGTH = 160;
export const MATURITY_AGE = 28;
export const BREED_COOLDOWN = 24;
export const SAVE_KEY = 'pgnome-save-v2';
export const SCORE_KEY = 'pgnome-records-v1';

export const B = { WATER: 0, SAND: 1, MEADOW: 2, FOREST: 3, MARSH: 4, ROCK: 5 };

// temp and moisture are on an abstract 0..100 scale.
// food is the plant capacity of a tile, regrow the share of it that grows back per second.
export const BIOMES = [
    { key: 'water', name: 'Water', color: 0x3f86c4, temp: 50, moisture: 100, food: 0, regrow: 0, speed: 0, walkable: false, snow: 0.35 },
    { key: 'sand', name: 'Sand', color: 0xe2c780, temp: 74, moisture: 12, food: 0.25, regrow: 0.004, speed: 0.9, walkable: true, snow: 0.8 },
    { key: 'meadow', name: 'Meadow', color: 0x83bf55, temp: 56, moisture: 48, food: 1.0, regrow: 0.009, speed: 1.0, walkable: true, snow: 0.85 },
    { key: 'forest', name: 'Forest', color: 0x3d7a3c, temp: 44, moisture: 66, food: 1.3, regrow: 0.007, speed: 0.75, walkable: true, snow: 0.7 },
    { key: 'marsh', name: 'Marsh', color: 0x6f5d3d, temp: 52, moisture: 88, food: 0.7, regrow: 0.008, speed: 0.6, walkable: true, snow: 0.6 },
    { key: 'rock', name: 'Rock', color: 0x8c8f93, temp: 28, moisture: 18, food: 0.08, regrow: 0.002, speed: 0.5, walkable: true, snow: 0.95 }
];

export const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];

export const GENES = {
    hue: { label: 'Color', min: 0, max: 360, wrap: true },
    size: { label: 'Size', min: 0.6, max: 1.6 },
    speed: { label: 'Speed', min: 0.6, max: 2.4 },
    sight: { label: 'Sight', min: 3, max: 10 },
    prefTemp: { label: 'Heat liking', min: 0, max: 100 },
    prefMoisture: { label: 'Wet liking', min: 0, max: 100 },
    sociability: { label: 'Sociability', min: 0, max: 1 },
    lifespan: { label: 'Lifespan', min: 90, max: 220 },
    // Body plan genes. Legs change how a Nome walks, the rest is looks only and drifts freely.
    legs: { label: 'Legs', min: 0, max: 1, body: true },
    bodyLen: { label: 'Body length', min: 0.75, max: 1.6, body: true },
    plump: { label: 'Plumpness', min: 0, max: 1, body: true },
    eyes: { label: 'Eyes', min: 0, max: 1, body: true },
    horns: { label: 'Horns', min: 0, max: 1, body: true },
    tail: { label: 'Tail', min: 0, max: 1, body: true },
    pattern: { label: 'Pattern', min: 0, max: 1, body: true },
    hue2: { label: 'Accent color', min: 0, max: 360, wrap: true, body: true }
};

export const legCount = v => (v < 0.3 ? 2 : v < 0.78 ? 4 : 6);
export const eyeCount = v => (v < 0.12 ? 1 : v > 0.9 ? 3 : 2);
export const patternName = v => (v < 0.4 ? 'plain' : v < 0.7 ? 'spotted' : 'striped');

// Weather. temp shifts the air temperature, wet the moisture, growth multiplies plant growth.
export const WEATHER = {
    clear: { name: 'Clear', temp: 1, wet: -4, growth: 1.0, sight: 1, burn: 0, light: 1, fog: 0 },
    cloudy: { name: 'Cloudy', temp: -2, wet: 3, growth: 0.9, sight: 1, burn: 0, light: 0.75, fog: 0.1 },
    rain: { name: 'Rain', temp: -3, wet: 18, growth: 1.6, sight: 0.85, burn: 0.05, light: 0.6, fog: 0.2, rain: 1 },
    storm: { name: 'Storm', temp: -4, wet: 25, growth: 1.25, sight: 0.7, burn: 0.25, light: 0.4, fog: 0.3, rain: 1.8, wind: 1 },
    fog: { name: 'Fog', temp: -1, wet: 8, growth: 1.0, sight: 0.55, burn: 0, light: 0.7, fog: 1 },
    heat: { name: 'Heat wave', temp: 13, wet: -28, growth: 0.35, sight: 1, burn: 0.12, light: 1.15, fog: 0 },
    snow: { name: 'Snowfall', temp: -5, wet: 6, growth: 0.6, sight: 0.8, burn: 0.06, light: 0.7, fog: 0.25, snow: 1 }
};

// How likely each weather is per season (spring, summer, autumn, winter).
export const WEATHER_ODDS = [
    { clear: 3, cloudy: 2, rain: 3, storm: 0.8, fog: 1.4 },
    { clear: 4, cloudy: 1, rain: 1.2, storm: 1, heat: 2.2 },
    { clear: 2, cloudy: 2.5, rain: 3, storm: 1.5, fog: 2.4 },
    { clear: 2, cloudy: 2.5, snow: 3.5, storm: 0.7, fog: 1.4 }
];

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
    { id: 'pop100', label: 'Grow to 100 Nomes at once' }
];
