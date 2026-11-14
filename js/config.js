// Tunables for world, simulation and genetics. Times are simulation seconds.

export const MAP_SIZE = 32;
export const MAX_POP = 150;
export const FOUNDERS = 10;
export const SIM_STEP = 1 / 30;
export const YEAR_LENGTH = 160;
export const MATURITY_AGE = 28;
export const BREED_COOLDOWN = 24;
export const SAVE_KEY = 'pgnome-save-v2';

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
    lifespan: { label: 'Lifespan', min: 90, max: 220 }
};

export const GOALS = [
    { id: 'birth', label: 'Witness the first birth' },
    { id: 'gen5', label: 'Reach generation 5' },
    { id: 'pop40', label: 'Grow to 40 Nomes at once' },
    { id: 'winter', label: 'Get 30 Nomes through a winter' },
    { id: 'biomes', label: 'Settle all five land biomes at once' },
    { id: 'extreme', label: 'Breed a heat liking below 20 or above 80' },
    { id: 'gen10', label: 'Reach generation 12' },
    { id: 'pop100', label: 'Grow to 100 Nomes at once' }
];
