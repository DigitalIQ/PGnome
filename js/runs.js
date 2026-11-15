import { GENES, GOALS, MODES, MAX_POP, BIOMES, FOODS, HAWK_GENES, LURKER_GENES, PROWLER_GENES, SEASONS, YEAR_LENGTH } from './config.js';
import { clamp } from './rng.js';
import { swimDepth } from './creature.js';
import { cleanStats, cleanLongHistory, NAME } from './validate.js';
import { NOTABLES } from './stats.js';

// Archived runs for the record board. Each record keeps a compact copy of its statistics,
// so the statistics window can show any run later, also after the island is gone.
// Everything is read back through cleanRun, like saves and records.

const RUNS_KEY = 'pgnome-runs-v1';
const KEEP_RUNS = 15;
const SAMPLE = 120;
const HISTORY = 120;
const GK = Object.keys(GENES);
const goalIds = new Set(GOALS.map(g => g.id));
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v, min, max, def = min) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def);
const int = (v, min, max, def = min) => Math.round(num(v, min, max, def));
const r3 = v => Math.round(v * 1000) / 1000;

// Genes are stored as 0..100 of their range, which keeps a run small.
const q = (k, v) => Math.round((v - GENES[k].min) / (GENES[k].max - GENES[k].min) * 100);
const dq = (k, n) => GENES[k].min + clamp(n, 0, 100) / 100 * (GENES[k].max - GENES[k].min);

function readAll() {
    try {
        const all = JSON.parse(localStorage.getItem(RUNS_KEY) || '{}');
        return isObj(all) ? all : {};
    } catch (e) {
        return {};
    }
}

// The record holders always make it into the sample, the rest is picked at random.
function sample(list) {
    const pick = new Set();
    if (list.length) {
        for (const [, f, dir] of NOTABLES) pick.add(list.reduce((a, c) => (f(c) * dir > f(a) * dir ? c : a), list[0]));
    }
    const rest = list.filter(c => !pick.has(c));
    for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    for (const c of rest) { if (pick.size >= SAMPLE) break; pick.add(c); }
    return [...pick];
}

function thin(list, max) {
    if (list.length <= max) return list.slice();
    return Array.from({ length: max }, (_, i) => list[Math.round(i * (list.length - 1) / (max - 1))]);
}

export function snapshotRun(game) {
    const geneRow = (table, list) => list.map(p => Object.keys(table).map(k => r3(p.genes[k])));
    const stats = JSON.parse(JSON.stringify(game.stats));
    stats.years = stats.years.slice(-40);
    stats.disasters = stats.disasters.slice(-40);
    return {
        v: 1,
        id: game.run.id,
        savedAt: Date.now(),
        ended: !!game.extinct,
        seed: game.seed,
        mode: game.mode,
        islandName: game.islandName,
        time: Math.round(game.time),
        runStart: Math.round(game.run.start),
        runPeak: game.runPeak || 0,
        goals: Object.keys(game.goals),
        meanStress: r3(game.meanStress || 0),
        stats,
        longHistory: thin(game.longHistory, HISTORY),
        sampleOf: game.creatures.length,
        creatures: sample(game.creatures).map(c => [c.id, c.name, Math.round(c.age), c.generation, c.children,
            c.color.getHexString(), Math.round(c.t.lifespan), ...GK.map(k => q(k, c.genes[k]))]),
        species: game.species.filter(sp => sp.n > 0).map(sp => ({ name: sp.name, n: sp.n, since: sp.since, from: sp.from || null })),
        where: game.whereNomesLive(),
        biomes: game.biomeCounts(),
        world: game.worldNow(),
        food: game.foodNow(),
        hawks: geneRow(HAWK_GENES, game.hawks.filter(h => !h.leaving)),
        lurkers: geneRow(LURKER_GENES, game.lurkers),
        prowlers: geneRow(PROWLER_GENES, game.prowlers)
    };
}

// Stores the run and drops archived runs that are no longer among the best records.
export function saveRun(snap, recordIds) {
    const all = readAll();
    // When the last Nome is gone, keep the Nomes from the previous save of this run.
    const prev = all[snap.id];
    if (!snap.creatures.length && prev && Array.isArray(prev.creatures)) {
        snap.creatures = prev.creatures;
        snap.sampleOf = prev.sampleOf;
    }
    all[snap.id] = snap;
    const keep = new Set(recordIds.slice(0, KEEP_RUNS));
    keep.add(snap.id);
    for (const id of Object.keys(all)) if (!keep.has(id)) delete all[id];
    for (let tries = 0; tries < 4; tries++) {
        try {
            localStorage.setItem(RUNS_KEY, JSON.stringify(all));
            return true;
        } catch (e) {
            // Storage full: give up the oldest other runs first.
            const others = Object.keys(all).filter(id => id !== snap.id).sort((a, b) => (all[a].savedAt || 0) - (all[b].savedAt || 0));
            if (!others.length) return false;
            for (const id of others.slice(0, Math.ceil(others.length / 2))) delete all[id];
        }
    }
    return false;
}

export function storedRunIds() {
    return new Set(Object.keys(readAll()));
}

export function loadRun(id) {
    const raw = readAll()[id];
    return raw ? cleanRun(raw) : null;
}

export function clearRuns() {
    try { localStorage.removeItem(RUNS_KEY); } catch (e) { /* storage blocked */ }
}

function geneList(table, rows) {
    if (!Array.isArray(rows)) return [];
    const keys = Object.keys(table);
    return rows.slice(0, 12).filter(Array.isArray).map(row => {
        const genes = {};
        keys.forEach((k, i) => { genes[k] = num(row[i], table[k].min, table[k].max, (table[k].min + table[k].max) / 2); });
        return { genes, leaving: false };
    });
}

function cleanRun(d) {
    if (!isObj(d) || d.v !== 1 || !isObj(d.stats)) return null;
    const creatures = (Array.isArray(d.creatures) ? d.creatures : []).slice(0, 300).filter(Array.isArray).map(row => {
        const [id, name, age, gen, children, hex, lifespan] = row;
        const genes = {};
        GK.forEach((k, i) => { genes[k] = dq(k, num(row[7 + i], 0, 100, 50)); });
        const color = /^[0-9a-f]{6}$/.test(hex) ? hex : '888888';
        return {
            id: int(id, 1, 1e9, 1), name: NAME.test(name || '') ? name : 'Nome', age: num(age, 0, 1e5), generation: int(gen, 1, 1e6, 1),
            children: int(children, 0, 1e6), genes, color: { getHexString: () => color },
            t: { swimmer: swimDepth(genes), lifespan: num(lifespan, 1, 1e5, 120) }
        };
    });
    const where = isObj(d.where) ? d.where : {};
    const world = isObj(d.world) ? d.world : {};
    const food = isObj(d.food) ? d.food : {};
    const avail = {};
    for (const k of Object.keys(FOODS)) avail[k] = num(isObj(food.avail) ? food.avail[k] : 0, 0, 1e6, 0);
    const out = new ArchivedRun();
    Object.assign(out, {
        id: typeof d.id === 'string' && /^[a-z0-9]{1,40}$/.test(d.id) ? d.id : '',
        savedAt: num(d.savedAt, 0, 8.64e15, 0),
        ended: d.ended === true,
        seed: int(d.seed, 0, 1e9),
        mode: MODES[d.mode] ? d.mode : 'classic',
        islandName: typeof d.islandName === 'string' && /^[A-Za-z ]{1,40}$/.test(d.islandName) ? d.islandName : 'Unknown island',
        time: num(d.time, 0, 1e9),
        run: { start: num(d.runStart, 0, 1e9) },
        runPeak: int(d.runPeak, 0, MAX_POP),
        goals: Object.fromEntries((Array.isArray(d.goals) ? d.goals : []).filter(k => goalIds.has(k)).map(k => [k, 1])),
        meanStress: num(d.meanStress, 0, 1.5, 0),
        stats: cleanStats(d.stats),
        longHistory: cleanLongHistory(d.longHistory, HISTORY),
        sampleOf: int(d.sampleOf, 0, MAX_POP),
        creatures,
        species: (Array.isArray(d.species) ? d.species : []).slice(0, 50).filter(isObj).map(sp => ({
            name: typeof sp.name === 'string' && /^[A-Za-z]{1,30}$/.test(sp.name) ? sp.name : 'Nomes',
            n: int(sp.n, 0, MAX_POP), since: int(sp.since, 1, 1e6, 1),
            from: typeof sp.from === 'string' && /^[A-Za-z]{1,30}$/.test(sp.from) ? sp.from : null
        })),
        where: Object.fromEntries(['main', 'satellite', 'water', 'near', 'far', 'remote', 'other'].map(k => [k, int(where[k], 0, MAX_POP)])),
        biomes: BIOMES.map((_, i) => int(Array.isArray(d.biomes) ? d.biomes[i] : 0, 0, MAX_POP)),
        world: {
            land: int(world.land, 0, 4096), peak: num(world.peak, 0, 10), deep: num(world.deep, 0, 1),
            scoured: int(world.scoured, 0, 4096), islands: int(world.islands, 0, 100), sea: num(world.sea, 0, 1, 0.36)
        },
        food: { avail, tox: num(food.tox, 0, 1), toxic: int(food.toxic, 0, 4096) },
        hawks: geneList(HAWK_GENES, d.hawks),
        lurkers: geneList(LURKER_GENES, d.lurkers),
        prowlers: geneList(PROWLER_GENES, d.prowlers)
    });
    if (out.sampleOf <= out.creatures.length) out.sampleOf = 0;
    return out.id ? out : null;
}

// Offers the same fields the statistics window reads from the running game.
class ArchivedRun {
    get archived() { return true; }
    get year() { return Math.floor(this.time / YEAR_LENGTH) + 1; }
    get seasonName() { return SEASONS[Math.floor((this.time % YEAR_LENGTH) / YEAR_LENGTH * 4) % 4]; }
    biomeCounts() { return this.biomes; }
    worldNow() { return this.world; }
    foodNow() { return this.food; }
    whereNomesLive() { return this.where; }
}
