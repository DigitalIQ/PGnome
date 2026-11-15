import { GENES, GOALS, MODES, WEATHER, MAX_POP, BIOMES, HAWK_GENES, LURKER_GENES, PROWLER_GENES, DISASTERS } from './config.js';

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
export const NAME = /^[A-Za-z]{1,24}$/;

function cleanGenes(g) {
    const out = {};
    if (!isObj(g)) return out;
    for (const [k, def] of Object.entries(GENES)) {
        if (typeof g[k] === 'number' && Number.isFinite(g[k])) out[k] = num(g[k], def.min, def.max);
    }
    return out;
}

function cleanTable(table, g) {
    const out = {};
    if (!isObj(g)) return null;
    for (const [k, def] of Object.entries(table)) out[k] = num(g[k], def.min, def.max, (def.min + def.max) / 2);
    return out;
}

const sub = (o, keys, max = 1e9) => {
    const src = isObj(o) ? o : {}, out = {};
    for (const k of keys) out[k] = num(src[k], 0, max, 0);
    return out;
};

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

export function cleanLongHistory(list, max = 1000) {
    return Array.isArray(list) ? list.slice(-max).filter(isObj).map(h => ({
        t: num(h.t, 0, 1e9), pop: int(h.pop, 0, MAX_POP), land: int(h.land, 0, 4096), hawks: int(h.hawks, 0, 20),
        sat: int(h.sat, 0, MAX_POP), water: int(h.water, 0, MAX_POP), far: int(h.far, 0, MAX_POP), rem: int(h.rem, 0, MAX_POP),
        g: Array.isArray(h.g) ? h.g.slice(0, 40).map(v => (v === null ? null : num(v, -1, 400, 0))) : [],
        lurkers: int(h.lurkers, 0, 20), tox: num(h.tox, 0, 1, 0), burrows: int(h.burrows, 0, 4096), stress: num(h.stress, 0, 1.5, 0),
        hg: Array.isArray(h.hg) ? h.hg.slice(0, 8).map(v => num(v, 0, 2000, 0)) : null,
        lg: Array.isArray(h.lg) ? h.lg.slice(0, 8).map(v => num(v, 0, 2000, 0)) : null,
        pg: Array.isArray(h.pg) ? h.pg.slice(0, 8).map(v => num(v, 0, 2000, 0)) : null,
        prowlers: int(h.prowlers, 0, 20), species: int(h.species, 0, 100)
    })) : [];
}

export function cleanStats(s) {
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
        hawk: sub(hawk, ['dives', 'catches', 'escapes', 'born', 'died']),
        lurker: sub(s.lurker, ['strikes', 'catches', 'escapes', 'born', 'died']),
        prowler: sub(s.prowler, ['chases', 'catches', 'escapes', 'born', 'died']),
        alarms: int(s.alarms, 0, 1e9), speciesSeen: int(s.speciesSeen, 1, 1e6, 1),
        food: sub(food, ['plants', 'greens', 'fruit', 'nuts', 'shroom', 'roots', 'seaweed', 'nectar', 'fed']),
        poison: sub(s.poison, ['cases', 'spat']), plague: sub(s.plague, ['cases']),
        work: sub(s.work, ['burrows', 'dams', 'planted', 'drained']),
        landMade: int(s.landMade, 0, 1e9), fights: int(s.fights, 0, 1e9), drift: sub(s.drift, ['out', 'landed']),
        disasters: Array.isArray(s.disasters) ? s.disasters.slice(-60).filter(e => isObj(e) && DISASTERS[e.kind]).map(e => ({
            y: int(e.y, 1, 1e6, 1), kind: e.kind, before: int(e.before, 0, MAX_POP), after: e.after == null ? null : int(e.after, 0, MAX_POP)
        })) : [],
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
        for (let k = 3; k < Math.min(row.length, 17); k++) r.push(num(row[k], -2, 3, k < 8 ? 0.4 : 0));
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
        cooldown: num(c.cooldown, -1e5, 1e5, 8), children: int(c.children, 0, 1e6),
        poison: num(c.poison, 0, 3, 0), plague: num(c.plague, 0, 60, 0), immuneT: num(c.immuneT, 0, 1e4, 0), stress: num(c.stress, 0, 1.5, 0), speciesId: int(c.speciesId, 0, 1e6, 0)
    }));
    if (!creatures.length) return null;
    const goals = {};
    if (isObj(d.goals)) for (const [k, v] of Object.entries(d.goals)) if (goalIds.has(k)) goals[k] = num(v, 0, 1e9);
    const history = Array.isArray(d.history) ? d.history.slice(-240).filter(isObj).map(h => ({
        t: num(h.t, 0, 1e9), pop: int(h.pop, 0, MAX_POP), s: int(h.s, 0, 3), land: int(h.land, 0, 4096)
    })) : [];
    const longHistory = cleanLongHistory(d.longHistory);
    const predators = Array.isArray(d.predators) ? d.predators.slice(0, 20).filter(isObj).map(p => {
        const table = p.kind === 'hawk' ? HAWK_GENES : p.kind === 'lurker' ? LURKER_GENES : p.kind === 'prowler' ? PROWLER_GENES : null;
        if (!table) return null;
        return { kind: p.kind, genes: cleanTable(table, p.genes), energy: num(p.energy, -10, 300, 60), age: num(p.age, 0, 1e5), gen: int(p.gen, 1, 1e6, 1),
            x: num(p.x, 0, side - 1, side / 2), z: num(p.z, 0, side - 1, side / 2) };
    }).filter(p => p && p.genes) : [];
    const pool = isObj(d.predatorPool) ? d.predatorPool : {};
    const predatorPool = {};
    if (cleanTable(HAWK_GENES, pool.hawk)) predatorPool.hawk = cleanTable(HAWK_GENES, pool.hawk);
    if (cleanTable(LURKER_GENES, pool.lurker)) predatorPool.lurker = cleanTable(LURKER_GENES, pool.lurker);
    if (cleanTable(PROWLER_GENES, pool.prowler)) predatorPool.prowler = cleanTable(PROWLER_GENES, pool.prowler);
    const species = Array.isArray(d.species) ? d.species.slice(0, 50).filter(isObj).map(sp => ({
        id: int(sp.id, 0, 1e6, 0), name: str(sp.name, 30, /^[A-Za-z]{1,30}$/) || 'Nomes', since: int(sp.since, 1, 1e6, 1),
        from: str(sp.from, 30, /^[A-Za-z]{1,30}$/) || null, n: int(sp.n, 0, MAX_POP), hue: int(sp.hue, 0, 360)
    })) : [];
    const dis = isObj(d.disasters) ? { next: num(d.disasters.next, 0, 1e6, 200), ash: num(d.disasters.ash, 0, 1, 0) } : null;
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
        disastersOn: d.disastersOn !== false,
        disasters: dis,
        predators, predatorPool, species,
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
