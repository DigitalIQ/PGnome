import { GENES, GOALS, MODES, WEATHER, MAX_POP, BIOMES } from './config.js';

// Everything read back from localStorage passes through here. Other pages on the same
// origin (all GitHub Pages sites of one account share it) or a hand-edited save can put
// anything there, so the game rebuilds clean objects from known fields only.

const num = (v, min, max, def = min) => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const int = (v, min, max, def = min) => Math.round(num(v, min, max, def));
const str = (v, max, re = /^[\w .,'&-]*$/) => (typeof v === 'string' && v.length <= max && re.test(v) ? v : '');
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const goalIds = new Set(GOALS.map(g => g.id));
const NAME = /^[A-Za-z]{1,24}$/;

function cleanGenes(g) {
    const out = {};
    if (!isObj(g)) return out;
    for (const [k, def] of Object.entries(GENES)) {
        if (typeof g[k] === 'number' && Number.isFinite(g[k])) out[k] = num(g[k], def.min, def.max);
    }
    return out;
}

function cleanNumberMap(m, maxKeys = 40, maxVal = 1e9) {
    const out = {};
    if (!isObj(m)) return out;
    let n = 0;
    for (const [k, v] of Object.entries(m)) {
        if (n++ >= maxKeys || !/^[\w .-]{1,40}$/.test(k)) continue;
        out[k] = num(v, 0, maxVal, 0);
    }
    return out;
}

function cleanStats(s) {
    if (!isObj(s)) return {};
    const years = Array.isArray(s.years) ? s.years.slice(-200).filter(isObj).map(e => ({
        y: int(e.y, 1, 1e6, 1), births: int(e.births, 0, 1e7), deaths: int(e.deaths, 0, 1e7),
        peak: int(e.peak, 0, MAX_POP), low: int(e.low, 0, MAX_POP)
    })) : [];
    const hawk = isObj(s.hawk) ? s.hawk : {}, food = isObj(s.food) ? s.food : {}, age = isObj(s.deathAge) ? s.deathAge : {};
    return {
        births: int(s.births, 0, 1e9), deaths: int(s.deaths, 0, 1e9), maxGen: int(s.maxGen, 1, 1e6, 1),
        peakPop: int(s.peakPop, 0, MAX_POP), twins: int(s.twins, 0, 1e9), strikes: int(s.strikes, 0, 1e9),
        burned: int(s.burned, 0, 1e9), causes: cleanNumberMap(s.causes), plans: cleanNumberMap(s.plans, 10),
        weather: cleanNumberMap(s.weather, Object.keys(WEATHER).length),
        hawk: { dives: int(hawk.dives, 0, 1e9), catches: int(hawk.catches, 0, 1e9), escapes: int(hawk.escapes, 0, 1e9) },
        food: { plants: num(food.plants, 0, 1e9), seaweed: num(food.seaweed, 0, 1e9), nectar: num(food.nectar, 0, 1e9), fed: int(food.fed, 0, 1e9) },
        deathAge: { sum: num(age.sum, 0, 1e12), n: int(age.n, 0, 1e9) },
        years
    };
}

export function cleanSave(d) {
    if (!isObj(d) || d.v !== 2) return null;
    const tiles = Array.isArray(d.tiles) ? d.tiles : null;
    const side = tiles ? Math.round(Math.sqrt(tiles.length)) : 0;
    if (!tiles || side < 16 || side > 64 || side * side !== tiles.length) return null;
    const cleanTiles = [];
    for (const row of tiles) {
        if (!Array.isArray(row) || row.length < 3) return null;
        const r = [int(row[0], 0, BIOMES.length - 1), num(row[1], 0.01, 6, 0.8), num(row[2], 0, 3, 0)];
        for (let k = 3; k < Math.min(row.length, 8); k++) r.push(num(row[k], -2, 3, 0.4));
        cleanTiles.push(r);
    }
    if (!Array.isArray(d.creatures) || !d.creatures.length) return null;
    const creatures = d.creatures.slice(0, MAX_POP).filter(isObj).map(c => ({
        id: int(c.id, 1, 1e9, 1),
        name: NAME.test(c.name || '') ? c.name : undefined,
        x: num(c.x, 0, side - 1, side / 2), z: num(c.z, 0, side - 1, side / 2),
        genes: cleanGenes(c.genes),
        generation: int(c.generation, 1, 1e6, 1),
        parents: Array.isArray(c.parents) && c.parents.length === 2 && c.parents.every(p => NAME.test(p || '')) ? [c.parents[0], c.parents[1]] : null,
        age: num(c.age, 0, 1e5), energy: num(c.energy, 0, 200, 70), health: num(c.health, 0, 100, 100),
        cooldown: num(c.cooldown, -1e5, 1e5, 8), children: int(c.children, 0, 1e6)
    }));
    if (!creatures.length) return null;
    const goals = {};
    if (isObj(d.goals)) for (const [k, v] of Object.entries(d.goals)) if (goalIds.has(k)) goals[k] = num(v, 0, 1e9);
    const history = Array.isArray(d.history) ? d.history.slice(-240).filter(isObj).map(h => ({
        t: num(h.t, 0, 1e9), pop: int(h.pop, 0, MAX_POP), s: int(h.s, 0, 3), land: int(h.land, 0, 4096)
    })) : [];
    const longHistory = Array.isArray(d.longHistory) ? d.longHistory.slice(-1000).filter(isObj).map(h => ({
        t: num(h.t, 0, 1e9), pop: int(h.pop, 0, MAX_POP), land: int(h.land, 0, 4096), hawks: int(h.hawks, 0, 20),
        sat: int(h.sat, 0, MAX_POP), water: int(h.water, 0, MAX_POP),
        g: Array.isArray(h.g) ? h.g.slice(0, 40).map(v => (v === null ? null : num(v, -1, 400, 0))) : []
    })) : [];
    const template = isObj(d.template) ? cleanGenes(d.template) : null;
    const weather = isObj(d.weather) && WEATHER[d.weather.key] ? { key: d.weather.key, timer: num(d.weather.timer, 0, 120, 20) } : null;
    const run = isObj(d.run) ? { id: str(d.run.id, 40, /^[a-z0-9]{1,40}$/) || undefined, start: num(d.run.start, 0, 1e9), startGoals: int(d.run.startGoals, 0, 100) } : null;
    return {
        v: 2,
        seed: int(d.seed, 0, 1e9),
        time: num(d.time, 0, 1e9),
        tiles: cleanTiles,
        creatures,
        stats: cleanStats(d.stats),
        history, longHistory, goals,
        mutationRate: num(d.mutationRate, 0, 3, 1),
        hawksOn: d.hawksOn !== false,
        mode: MODES[d.mode] ? d.mode : 'classic',
        template: template && Object.keys(template).length ? template : null,
        weather,
        run: run && run.id ? run : null,
        runPeak: int(d.runPeak, 0, MAX_POP),
        nextId: int(d.nextId, 1, 1e9, 1)
    };
}

export function cleanRecord(r) {
    if (!isObj(r)) return null;
    const id = str(r.id, 40, /^[a-z0-9]{1,40}$/);
    if (!id) return null;
    return {
        id,
        seed: int(r.seed, 0, 1e9),
        name: str(r.name, 40, /^[A-Za-z ]{1,40}$/) || 'Unknown island',
        mode: MODES[r.mode] ? r.mode : 'classic',
        years: num(r.years, 0, 1e6),
        peak: int(r.peak, 0, MAX_POP),
        gen: int(r.gen, 1, 1e6, 1),
        births: int(r.births, 0, 1e9),
        goals: int(r.goals, 0, GOALS.length),
        ended: r.ended === true,
        alive: int(r.alive, 0, MAX_POP),
        date: num(r.date, 0, 8.64e15, 0),
        score: int(r.score, 0, 1e9)
    };
}
