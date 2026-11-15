import * as THREE from 'three';
import { GENES, B, BIOMES, FOUNDERS, MAX_POP, YEAR_LENGTH, BREED_COOLDOWN, SEASONS, GOALS, SAVE_KEY, MODES, DAY_LENGTH, legCount, HAWK_GENES, LURKER_GENES } from './config.js';
import { World, isWalkable } from './world.js';
import { Creature, randomGenes, mixGenes, getNextId, setNextId, speciesTemplate } from './creature.js';
import { heartTexture, sparkTexture } from './icons.js';
import { rand, mulberry32, clamp } from './rng.js';
import { Weather } from './weather.js';
import { Hawk, Lurker, mixPredator, randomPredator } from './predator.js';
import { Disasters } from './disasters.js';
import { islandName, submitRecord } from './scores.js';
import { cleanSave } from './validate.js';

export const STAT_GENES = Object.keys(GENES).filter(k => k !== 'hue' && k !== 'hue2');

export class Game {
    constructor(scene) {
        this.scene = scene;
        this.listeners = {};
        this.world = null;
        this.creatures = [];
        this.dying = [];
        this.effects = [];
        this.paused = false;
        this.speed = 1;
        this.mutationRate = 1;
        this.selected = null;
        this.follow = false;
        this.renderTime = 0;
        this.mode = 'classic';
        this.weather = new Weather();
        this.hawks = [];
        this.lurkers = [];
        this.hawksOn = true;
        this.disastersOn = true;
        this.shake = 0;
        this.ash = 0;
    }

    on(name, fn) { (this.listeners[name] ||= []).push(fn); }
    emit(name, data) { (this.listeners[name] || []).forEach(fn => fn(data)); }

    // ---------- Lifecycle ----------

    reset() {
        this.creatures.forEach(c => c.dispose());
        this.dying.forEach(c => c.dispose());
        this.effects.forEach(e => { this.scene.remove(e.sprite); e.sprite.material.dispose(); });
        (this.hawks || []).forEach(h => h.dispose());
        (this.lurkers || []).forEach(l => l.dispose());
        if (this.disasters) this.disasters.dispose();
        this.hawks = [];
        this.lurkers = [];
        this.predatorPool = {};
        this.shake = 0;
        this.hawkTimer = 4;
        this.hawkSeen = false;
        if (this.world) this.world.dispose();
        this.creatures = [];
        this.dying = [];
        this.effects = [];
        this.selected = null;
        this.follow = false;
        this.time = YEAR_LENGTH * 0.12;
        this.stats = Game.emptyStats();
        this.history = [];
        this.longHistory = [];
        this.longTimer = 0;
        this.events = [];
        this.eventId = 0;
        this.goals = {};
        this.extinct = false;
        this.lastSeason = this.seasonIndex;
        this.sampleTimer = 0;
        this.goalTimer = 0;
        this.weather = new Weather();
        this.disasters = new Disasters(this);
        this.strikeTimer = 3;
        this.strike = null;
        this.foodPerNome = 10;
        this.flash = 0;
        this.landRef = 0;
        this.peakRef = 0;
        this.rising = false;
        this.lastRecord = null;
    }

    get islandName() { return islandName(this.seed); }

    static emptyStats() {
        return {
            births: 0, deaths: 0, maxGen: 1, peakPop: 0, causes: {}, twins: 0, plans: {},
            weather: {}, strikes: 0, burned: 0, hawk: { dives: 0, catches: 0, escapes: 0, born: 0, died: 0 },
            lurker: { strikes: 0, catches: 0, escapes: 0, born: 0, died: 0 },
            food: { plants: 0, greens: 0, fruit: 0, nuts: 0, shroom: 0, roots: 0, seaweed: 0, nectar: 0, fed: 0 },
            poison: { cases: 0, spat: 0 }, plague: { cases: 0 }, work: { burrows: 0, dams: 0, planted: 0, drained: 0 },
            disasters: [], landMade: 0, deathAge: { sum: 0, n: 0 }, years: []
        };
    }

    // Births, deaths and the population range per year, for the statistics.
    yearEntry() {
        const y = this.year, list = this.stats.years;
        let e = list[list.length - 1];
        if (!e || e.y !== y) {
            e = { y, births: 0, deaths: 0, peak: this.creatures.length, low: this.creatures.length };
            list.push(e);
            if (list.length > 200) list.shift();
        }
        return e;
    }

    startRun() {
        this.run = { id: Date.now().toString(36) + Math.floor(Math.random() * 1e4), start: this.time, startGoals: Object.keys(this.goals).length };
        this.runPeak = this.creatures.length;
        this.runGen = this.stats.maxGen;
    }

    // Writes the current run into the records and remembers its rank.
    record(ended = false) {
        if (!this.world || !this.run) return null;
        const years = Math.max(0, (this.time - this.run.start) / YEAR_LENGTH);
        const entry = {
            id: this.run.id, seed: this.seed, name: this.islandName, mode: this.mode,
            years: Math.round(years * 10) / 10, peak: this.runPeak || 0, gen: this.stats.maxGen,
            births: this.stats.births, goals: Object.keys(this.goals).length,
            ended, alive: this.creatures.length, date: Date.now()
        };
        if (years < 0.1 && entry.births === 0) return null;
        this.lastRecord = { ...submitRecord(entry), entry };
        return this.lastRecord;
    }

    newWorld(seed, mode = 'classic') {
        this.reset();
        this.seed = seed;
        this.mode = MODES[mode] ? mode : 'classic';
        this.template = speciesTemplate(mulberry32(seed + 99));
        this.world = new World(this.scene, seed, null, this.mode);
        this.spawnFounders(FOUNDERS);
        this.startRun();
        this.landRef = this.world.stats().land;
        this.log(`${this.islandName} rises from the sea. ${this.mode === 'living' ? 'This island is alive and will change.' : `Seed ${seed}.`}`, 'world');
        this.emit('reset');
    }

    load(data) {
        this.reset();
        this.seed = data.seed;
        this.mode = MODES[data.mode] ? data.mode : 'classic';
        this.template = data.template || speciesTemplate(mulberry32(data.seed + 99));
        this.world = new World(this.scene, data.seed, data.tiles, this.mode);
        this.weather = new Weather(data.weather);
        this.time = data.time;
        const empty = Game.emptyStats(), st = data.stats || {};
        this.stats = { ...empty, ...st };
        for (const k of ['hawk', 'lurker', 'food', 'poison', 'plague', 'work']) this.stats[k] = { ...empty[k], ...(st[k] || {}) };
        this.disasters = new Disasters(this, data.disasters);
        this.disastersOn = data.disastersOn ?? true;
        this.predatorPool = data.predatorPool || {};
        this.history = data.history || [];
        this.longHistory = data.longHistory || [];
        this.goals = data.goals || {};
        this.mutationRate = data.mutationRate ?? 1;
        this.hawksOn = data.hawksOn ?? true;
        setNextId(data.nextId || 1);
        for (const s of data.creatures) {
            const c = new Creature(this, s.x, s.z, s.genes, s);
            this.creatures.push(c);
        }
        const c0 = this.world.center;
        for (const p of data.predators || []) {
            if (p.kind === 'hawk') this.hawks.push(new Hawk(this, { x: c0 + 30, z: c0 + 30 }, p.genes, p));
            else if (p.kind === 'lurker') {
                const t = this.world.tileAt(p.x, p.z);
                if (t && isWalkable(t)) this.lurkers.push(new Lurker(this, t, p.genes, p));
            }
        }
        this.lastSeason = this.seasonIndex;
        this.world.seaNow = this.world.seaLevel(this.time);
        this.run = data.run || null;
        if (!this.run) this.startRun();
        this.runPeak = data.runPeak ?? this.stats.peakPop;
        this.landRef = this.world.stats().land;
        this.log(`Welcome back to ${this.islandName}. Year ${this.year}, ${this.seasonName.toLowerCase()}.`, 'world');
        this.emit('reset');
    }

    serialize() {
        return {
            v: 2,
            seed: this.seed,
            time: Math.round(this.time * 100) / 100,
            tiles: this.world.serialize(),
            creatures: this.creatures.map(c => c.serialize()),
            stats: this.stats,
            history: this.history,
            longHistory: this.longHistory,
            goals: this.goals,
            mutationRate: this.mutationRate,
            mode: this.mode,
            hawksOn: this.hawksOn,
            disastersOn: this.disastersOn,
            disasters: this.disasters.serialize(),
            predators: [...this.hawks.filter(h => !h.leaving).map(h => h.serialize()), ...this.lurkers.map(l => l.serialize())],
            predatorPool: this.predatorPool,
            template: this.template,
            weather: this.weather.serialize(),
            run: this.run,
            runPeak: this.runPeak,
            nextId: getNextId(),
            savedAt: Date.now()
        };
    }

    save() {
        if (!this.world || this.extinct) return false;
        this.record(false);
        try {
            localStorage.setItem(SAVE_KEY, JSON.stringify(this.serialize()));
            return true;
        } catch (e) {
            return false;
        }
    }

    static loadSaved() {
        try {
            const raw = localStorage.getItem(SAVE_KEY);
            if (!raw) return null;
            return cleanSave(JSON.parse(raw));
        } catch (e) {
            return null;
        }
    }

    static clearSaved() {
        try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* storage blocked */ }
    }

    // ---------- Time and seasons ----------

    get yearPhase() { return (this.time % YEAR_LENGTH) / YEAR_LENGTH; }
    get seasonIndex() { return Math.floor(this.yearPhase * 4) % 4; }
    get seasonName() { return SEASONS[this.seasonIndex]; }
    get seasonProgress() { return (this.yearPhase * 4) % 1; }
    get year() { return Math.floor(this.time / YEAR_LENGTH) + 1; }
    // Warmest in mid summer (+18), coldest in mid winter (-24).
    get seasonTemp() { return 21 * Math.cos(2 * Math.PI * (this.yearPhase - 0.375)) - 3; }
    get growth() { return Math.max(0.08, 0.55 + 0.5 * Math.cos(2 * Math.PI * (this.yearPhase - 0.3))) * this.weather.now.growth; }

    // Day and night. dayPhase 0 is midnight, 0.5 is noon.
    get dayPhase() { return ((this.time / DAY_LENGTH) % 1 + 1) % 1; }
    get sunHeight() { return -Math.cos(this.dayPhase * Math.PI * 2); }
    get night() { return Math.min(1, Math.max(0, (0.15 - this.sunHeight) / 0.35)); }
    get isNight() { return this.night > 0.5; }
    // How much direct sun reaches the ground.
    get sunshine() { return Math.max(0, this.sunHeight) * (1 - this.weather.now.cloud * 0.8); }

    // Air temperature and moisture shift with the weather and cool down at night.
    // Middays are hot, nights cool. Summer middays push day Nomes into the shade.
    get airTemp() { return this.seasonTemp + this.weather.now.temp + 5 * this.sunshine - 3 * this.night; }
    get sightMul() { return this.weather.now.sight; }
    get weatherBurn() { return this.weather.now.burn; }
    get windSlow() { return 1 - 0.15 * this.weather.now.wind; }

    climate(t) {
        return this.world.climate(t, this.airTemp, this.weather.now.wet);
    }

    // ---------- Population ----------

    landNear(cx, cz, depth = 7) {
        const w = this.world;
        let start = w.tileAt(cx, cz);
        if (!isWalkable(start)) {
            let best = null, bd = Infinity;
            for (const t of w.tiles) {
                if (!isWalkable(t)) continue;
                const d = Math.hypot(t.x - cx, t.z - cz);
                if (d < bd) { bd = d; best = t; }
            }
            start = best;
        }
        if (!start) return [];
        return Array.from(w.bfs(start, depth)).map(i => w.tiles[i]);
    }

    spawnFounders(n, cx, cz) {
        const w = this.world;
        const land = this.landNear(cx ?? w.center, cz ?? w.center);
        if (!land.length) return 0;
        const good = land.filter(t => t.biome === B.MEADOW || t.biome === B.FOREST);
        const pool = good.length >= 3 ? good : land;
        const meanTemp = this.seasonTemp * 0.3 - 3;
        for (let k = 0; k < n; k++) {
            if (this.creatures.length >= MAX_POP) break;
            const t = pool[Math.floor(Math.random() * pool.length)];
            const c = w.climate(t, meanTemp);
            const cr = new Creature(this, t.x + rand(-0.25, 0.25), t.z + rand(-0.25, 0.25), randomGenes(c, this.template), {
                age: rand(24, 40), energy: rand(70, 90), cooldown: rand(4, 12), y: t.rh + 2
            });
            this.creatures.push(cr);
            this.burst(cr.x, t.rh + 0.5, cr.z, 'spark', 0xfff3c4, 5);
        }
        return n;
    }

    // Both sides must accept the other's color. Patterns, horns and length attract.
    findPartner(c) {
        // In a small population Nomes call for partners over long distances.
        const few = Math.max(0, 1 - this.creatures.length / 20);
        const range = c.sightNow + 1 + few * 12;
        let best = null, bestScore = Infinity;
        for (const o of this.creatures) {
            if (o === c || !o.ready || (o.partner && o.partner !== c)) continue;
            if (o.action === 'mate' && o.partner !== c) continue;
            const d = Math.hypot(o.x - c.x, o.z - c.z);
            if (d > range || !c.accepts(o) || !o.accepts(c)) continue;
            const score = d - o.t.attract * 2.5;
            if (score < bestScore) { bestScore = score; best = o; }
        }
        return best;
    }

    breed(a, b) {
        if (this.creatures.length >= MAX_POP) { a.stopCourting(); return; }
        const gen = Math.max(a.generation, b.generation) + 1;
        // Twins are possible. Picky parents raise stronger children.
        const litter = (a.genes.litter + b.genes.litter) / 2;
        const picky = (a.genes.pickiness + b.genes.pickiness) / 2;
        const fed = a.energy > a.maxEnergy * 0.75 && b.energy > b.maxEnergy * 0.75;
        const care = (a.genes.care + b.genes.care) / 2;
        // Stressed parents raise weaker young.
        const stress = Math.min(1, (a.stress + b.stress) / 2);
        const count = fed && Math.random() < litter * 0.6 && this.creatures.length < MAX_POP - 1 ? 2 : 1;
        let child = null;
        for (let k = 0; k < count; k++) {
            const genes = mixGenes(a.genes, b.genes, this.mutationRate);
            child = new Creature(this, (a.x + b.x) / 2 + k * 0.2, (a.z + b.z) / 2, genes, {
                generation: gen, parents: [a.name, b.name], energy: 45 - (count - 1) * 12 + picky * 20 + care * 22 - stress * 15, cooldown: 0, y: a.y
            });
            this.creatures.push(child);
        }
        if (count === 2) this.stats.twins = (this.stats.twins || 0) + 1;
        if (count === 2 && this.stats.twins === 1) this.log(`Twins! ${a.name} and ${b.name} have two children at once.`, 'birth');
        for (const p of [a, b]) {
            p.energy -= 22 + litter * 10 + (count - 1) * 8 + care * 8;
            // The pause until the next young depends on metabolism, litter size, care,
            // stress and how much food there is.
            const pg = p.genes;
            p.cooldown = BREED_COOLDOWN * (1.25 - 0.5 * pg.metabolism) * (1 + pg.litter * 0.3) * (1 + pg.care * 0.4)
                * (1 + p.stress * 0.6) * clamp(1.4 - this.foodPerNome / 5, 0.8, 1.4) * rand(0.9, 1.1);
            p.children++;
            p.partner = null;
            p.action = 'idle';
            p.thinkTimer = rand(0.5, 1.5);
        }
        // Caring parents stay with their young for a while.
        for (const p of [a, b]) {
            if (p.genes.care > 0.3) {
                p.action = 'care';
                p.careChild = child;
                p.careT = p.genes.care * 16;
            }
        }
        const guard = a.genes.care >= b.genes.care ? a : b;
        if (guard.genes.care > 0.3) child.guardian = guard;
        this.stats.births += count;
        this.yearEntry().births += count;
        const legs = legCount(child.genes.legs);
        const plans = this.stats.plans || (this.stats.plans = {});
        if (!plans[legs]) {
            plans[legs] = 1;
            if (this.stats.births > 1) this.log(`${child.name} is the first Nome with ${legs} legs.`, 'birth');
        }
        this.burst(child.x, child.y + 0.8, child.z, 'heart', 0xff6b8a, 4);
        if (this.stats.births === 1) this.log(`${child.name} is born, the first child of ${a.name} and ${b.name}.`, 'birth');
        if (gen > this.stats.maxGen) {
            this.stats.maxGen = gen;
            if (gen > 2) this.log(`${child.name} starts generation ${gen}.`, 'birth');
        }

    }

    kill(c, cause) {
        if (c.dead) return;
        c.dead = true;
        c.cause = cause;
        if (c.partner) c.stopCourting();
        const i = this.creatures.indexOf(c);
        if (i >= 0) this.creatures.splice(i, 1);
        this.dying.push(c);
        this.stats.deaths++;
        this.stats.causes[cause] = (this.stats.causes[cause] || 0) + 1;
        this.stats.deathAge.sum += c.age;
        this.stats.deathAge.n++;
        this.yearEntry().deaths++;
        const ct = this.world.tileAt(c.x, c.z);
        if (ct) ct.fert = Math.min(1, ct.fert + 0.25);
        this.burst(c.x, c.y + 0.4, c.z, 'spark', 0xcfd8dc, 4);
        if (this.selected && this.selected.creature === c) {
            this.log(`${c.name} ${cause} at age ${Math.floor(c.age)}.`, 'death');
            this.emit('selected-died', c);
        }
        if (this.creatures.length === 0 && !this.extinct) {
            this.extinct = true;
            this.paused = true;
            this.record(true);
            this.run = null;
            Game.clearSaved();
            this.log('The last Nome is gone.', 'death');
            this.emit('extinct');
        }
    }

    // ---------- Player actions ----------

    paint(tile, biome) {
        if (!this.world.setBiome(tile, biome)) return false;
        for (const c of this.creatures) {
            if (c.path.includes(tile) || this.world.tileAt(c.x, c.z) === tile) c.cancelPlans();
        }
        return true;
    }

    feed(tile) {
        if (!this.world.feed(tile)) return false;
        this.stats.food.fed++;
        this.burst(tile.x, tile.rh + 0.3, tile.z, 'spark', 0xa6e36b, 7);
        return true;
    }

    // ---------- Loop ----------

    step(dt) {
        if (!this.world || this.extinct) return;
        this.time += dt;
        const season = this.seasonIndex;
        if (season !== this.lastSeason) this.onSeason(season, this.lastSeason);
        this.lastSeason = season;

        const w = this.weather.update(dt, season);
        // Volcanic ash darkens and cools the sky for months.
        if (this.ash > 0.01) {
            const now = this.weather.now, a = this.ash;
            now.temp -= a * 5;
            now.growth *= 1 - a * 0.45;
            now.sight *= 1 - a * 0.25;
            now.light *= 1 - a * 0.35;
            now.fog = Math.max(now.fog, a * 0.45);
            now.cloud = Math.max(now.cloud, a * 0.7);
        }
        const wk = this.weather.key;
        this.stats.weather[wk] = (this.stats.weather[wk] || 0) + dt;
        if (w) this.onWeather(w);
        this.world.weatherNow = this.weather.now;
        this.world.grow(dt, { growth: this.growth, night: this.night, phase: this.yearPhase, wet: this.weather.now.wet, temp: this.airTemp });
        const changed = this.world.evolve(dt, this.time, this.weather.now);
        if (changed && changed.length) this.onTerrain(changed);
        if (this.weather.now.lightning > 0.6) this.storm(dt);
        this.disasters.step(dt);
        this.stepPredators(dt);
        for (let i = this.creatures.length - 1; i >= 0; i--) {
            const c = this.creatures[i];
            if (c) c.step(dt);
        }
        this.crowdTimer = (this.crowdTimer || 0) + dt;
        if (this.crowdTimer >= 10) { this.crowdTimer = 0; this.checkCrowding(); }
        if (this.creatures.length > this.stats.peakPop) this.stats.peakPop = this.creatures.length;
        if (this.creatures.length > (this.runPeak || 0)) this.runPeak = this.creatures.length;

        this.sampleTimer += dt;
        if (this.sampleTimer >= 2) {
            this.sampleTimer = 0;
            let food = 0;
            for (const t of this.world.tiles) food += t.food;
            this.foodPerNome = food / Math.max(1, this.creatures.length);
            const ws = this.world.stats();
            this.history.push({ t: Math.round(this.time), pop: this.creatures.length, s: season, land: ws.land });
            if (this.world.living) this.watchIsland(ws);
            if (this.history.length > 240) this.history.shift();
            this.stats.peakPop = Math.max(this.stats.peakPop, this.creatures.length);
            const ye = this.yearEntry();
            ye.peak = Math.max(ye.peak, this.creatures.length);
            ye.low = Math.min(ye.low, this.creatures.length);
        }
        this.longTimer += dt;
        if (this.longTimer >= 10) {
            this.longTimer = 0;
            this.sampleLong();
        }
        this.goalTimer += dt;
        if (this.goalTimer >= 1) {
            this.goalTimer = 0;
            this.checkGoals();
        }
    }

    onSeason(season, prev) {
        const msgs = [
            'Spring. Plants grow back fast.',
            'Summer. Warm days, heat lovers thrive.',
            'Autumn. Growth slows down. Fatten up.',
            'Winter. Almost nothing grows. Cold hurts small Nomes most.'
        ];
        this.log(msgs[season], 'season');
        if (season === 0 && prev === 3 && this.creatures.length >= 30) this.completeGoal('winter');
    }

    // A slow sample every 10 seconds for the long-term statistics: population, land,
    // hawks, where the Nomes live and the average of every gene.
    sampleLong() {
        const n = this.creatures.length;
        const where = this.whereNomesLive();
        const g = STAT_GENES.map(k => {
            if (!n) return null;
            let s = 0;
            for (const c of this.creatures) s += c.genes[k];
            return Math.round(s / n * 1000) / 1000;
        });
        let tox = 0, toxN = 0, burrows = 0;
        for (const t of this.world.tiles) {
            if (!isWalkable(t)) continue;
            tox += t.tox; toxN++;
            if (t.burrow > 0.35) burrows++;
        }
        const active = this.hawks.filter(h => !h.leaving);
        const r3 = v => Math.round(v * 1000) / 1000;
        const avg = (list, table) => list.length ? Object.values(averageGenes(list, table)).map(r3) : null;
        this.longHistory.push({
            t: Math.round(this.time), pop: n, land: this.world.stats().land,
            hawks: this.hawks.filter(h => !h.leaving && !h.away).length, sat: where.satellite, water: where.water, g,
            lurkers: this.lurkers.length, tox: r3(tox / Math.max(1, toxN)), burrows,
            stress: n ? r3(this.creatures.reduce((a, c) => a + c.stress, 0) / n) : 0,
            hg: avg(active, HAWK_GENES), lg: avg(this.lurkers, LURKER_GENES)
        });
        if (this.longHistory.length > 1000) this.longHistory.shift();
    }

    whereNomesLive() {
        const { ids, main } = this.world.islands();
        const out = { main: 0, satellite: 0, water: 0 };
        for (const c of this.creatures) {
            const t = this.world.tileAt(c.x, c.z);
            if (!t) continue;
            if (!isWalkable(t)) out.water++;
            else if (ids[t.i] === main) out.main++;
            else out.satellite++;
        }
        return out;
    }

    onWeather(key) {
        const msgs = {
            clear: 'The sky clears up.',
            cloudy: 'Clouds roll in.',
            windy: 'A strong wind blows. Small Nomes struggle to walk.',
            drizzle: 'A light drizzle. Plants like it.',
            rain: 'Rain. Plants grow fast now, but fur gets soaked.',
            downpour: 'A downpour. The sea creeps up the beaches.',
            storm: 'A thunderstorm hits. Forests give shelter, horns attract lightning.',
            hail: 'Hail! Nomes out in the open get hurt. Forests and rocks protect.',
            fog: 'Thick fog. Nomes with few eyes can barely see.',
            heat: 'A heat wave. Plants dry out. Light skin and thin fur help now.',
            sandstorm: 'A sandstorm. Hard to see, hard to breathe.',
            snow: 'Snow is falling. Fur and fat pay off.',
            blizzard: 'A blizzard. Huddle together or freeze.',
            frost: 'Frost. Plants stop growing for a while.',
            rainbow: 'A rainbow over the island. The Nomes cheer up.',
            aurora: 'Northern lights dance in the sky. The Nomes cheer up.'
        };
        this.log(msgs[key], 'weather');
        this.emit('weather', key);
    }

    // Lightning strikes now and then during a storm.
    storm(dt) {
        this.strikeTimer -= dt;
        if (this.strikeTimer > 0) return;
        // Hot, heavy storms flash more often.
        const power = this.weather.now.lightning * (1 + Math.max(0, this.airTemp - 12) / 20);
        this.strikeTimer = Math.max(1.5, 9 - 5 * power) * rand(0.6, 1.4);
        const land = this.world.tiles.filter(t => isWalkable(t));
        if (!land.length) return;
        const forests = land.filter(t => t.biome === B.FOREST);
        // Horned Nomes draw lightning.
        const horned = this.creatures.filter(c => c.genes.horns > 0.6);
        let t;
        if (horned.length && Math.random() < 0.3) {
            const c = horned[Math.floor(Math.random() * horned.length)];
            t = this.world.tileAt(c.x, c.z) || land[0];
        } else {
            t = forests.length && Math.random() < 0.5 ? forests[Math.floor(Math.random() * forests.length)] : land[Math.floor(Math.random() * land.length)];
        }
        this.flash = 1;
        this.stats.strikes++;
        this.strike = { x: t.x, y: t.rh, z: t.z, age: 0 };
        this.burst(t.x, t.rh + 0.4, t.z, 'spark', 0xfff6a8, 10);
        // Lightning can start a fire. Rain usually puts it out again.
        if (Math.random() < 0.6 && this.world.ignite(t)) {
            this.burst(t.x, t.rh + 0.6, t.z, 'spark', 0xff7a3c, 8);
            this.burst(t.x, t.rh + 0.5, t.z, 'smoke', 0x6b6b6b, 6);
        }
        for (const c of [...this.creatures]) {
            if (Math.hypot(c.x - t.x, c.z - t.z) < 0.7) {
                c.health -= 45;
                c.lastHarm = 'was struck by lightning';
                if (c.health <= 0) this.kill(c, 'was struck by lightning');
            }
        }
    }

    // Predators live from Nomes. Well-fed ones breed and pass on their genes, hungry ones
    // die. A few newcomers arrive when there is prey, so hunters never vanish for good.
    stepPredators(dt) {
        const n = this.creatures.length, c = this.world.center;
        // Plenty of prey feeds more hunters.
        const hawkCap = this.hawksOn && n >= 12 ? Math.min(10, 1 + Math.floor((n - 12) / 16)) : 0;
        const lurkCap = this.hawksOn && n >= 20 ? Math.min(8, Math.floor(n / 25)) : 0;
        this.hawkTimer -= dt;
        if (this.hawkTimer <= 0) {
            this.hawkTimer = 10;
            const active = this.hawks.filter(h => !h.leaving);
            if (active.length) this.predatorPool.hawk = averageGenes(active, HAWK_GENES);
            if (this.lurkers.length) this.predatorPool.lurker = averageGenes(this.lurkers, LURKER_GENES);
            if (active.length < Math.max(hawkCap ? 1 : 0, Math.ceil(hawkCap / 3)) && Math.random() < Math.min(1, n / 50)) {
                const a = Math.random() * Math.PI * 2;
                this.hawks.push(new Hawk(this, { x: c + Math.cos(a) * 40, z: c + Math.sin(a) * 40 }, randomPredator(HAWK_GENES, this.predatorPool.hawk)));
                if (!this.hawkSeen) {
                    this.hawkSeen = true;
                    this.log('A hawk circles over the island. It hunts by sight. Forests, burrows and water give cover.', 'death');
                }
            } else if (active.length > hawkCap) {
                active.sort((p, q) => p.energy - q.energy)[0].leaving = true;
            }
            if (this.lurkers.length < Math.ceil(lurkCap / 2) && Math.random() < Math.min(1, n / 70)) {
                const homes = this.world.tiles.filter(t => (t.biome === B.MARSH || t.biome === B.FOREST) && t.fire <= 0);
                if (homes.length) {
                    const t = homes[Math.floor(Math.random() * homes.length)];
                    this.lurkers.push(new Lurker(this, t, randomPredator(LURKER_GENES, this.predatorPool.lurker)));
                    if (!this.lurkerSeen) {
                        this.lurkerSeen = true;
                        this.log('Something lurks in the undergrowth. Lurkers ambush Nomes that do not see them coming.', 'death');
                    }
                }
            }
        }
        const hawksNow = this.hawks.filter(h => !h.leaving).length;
        for (let i = this.hawks.length - 1; i >= 0; i--) {
            const h = this.hawks[i];
            h.step(dt);
            if (!h.leaving && h.energy > 125 && hawksNow < hawkCap && this.hawks.length < 9) {
                h.energy -= 60;
                const child = new Hawk(this, { x: h.pos.x, y: h.pos.y, z: h.pos.z }, mixPredator(HAWK_GENES, h.genes, null, this.mutationRate), { gen: h.gen + 1, energy: 60 });
                this.hawks.push(child);
                this.stats.hawk.born++;
                if (this.stats.hawk.born === 1) this.log('A hawk raised a chick. Hawks that hunt well pass on their genes.', 'death');
            }
            if (!h.leaving && (h.energy <= 0 || h.age > h.genes.lifespan)) { h.leaving = true; this.stats.hawk.died++; }
            if (h.gone) { h.dispose(); this.hawks.splice(i, 1); }
        }
        for (let i = this.lurkers.length - 1; i >= 0; i--) {
            const l = this.lurkers[i];
            l.step(dt);
            if (l.energy > 115 && this.lurkers.length < lurkCap) {
                l.energy -= 55;
                const t = this.world.tileAt(l.x, l.z);
                if (t && isWalkable(t)) {
                    this.lurkers.push(new Lurker(this, t, mixPredator(LURKER_GENES, l.genes, null, this.mutationRate), { gen: l.gen + 1, energy: 60 }));
                    this.stats.lurker.born++;
                }
            }
            if (l.energy <= 0 || l.age > l.genes.lifespan || (!this.hawksOn && Math.random() < dt * 0.1)) {
                l.dispose();
                this.lurkers.splice(i, 1);
                this.stats.lurker.died++;
            }
        }
    }

    // Crowding has consequences: stress, fights and, where it gets bad, disease.
    checkCrowding() {
        const list = this.creatures, n = list.length;
        if (!n) return;
        let sum = 0, worst = null;
        for (const c of list) { sum += c.stress; if (!worst || c.stress > worst.stress) worst = c; }
        const mean = sum / n;
        this.meanStress = mean;
        if (mean > 0.25 && !this.crowdWarned) {
            this.crowdWarned = true;
            this.log('The island is getting crowded. Stressed Nomes fight, breed less, age faster and catch diseases.', 'world');
        }
        if (mean < 0.1) this.crowdWarned = false;
        const sick = list.some(c => c.plague > 0);
        if (!sick && worst.stress > 0.6 && Math.random() < mean * 0.5) {
            this.disasters.plague({ creature: worst, natural: true });
        }
    }

    // Nome work that changes the island: dams, planted forests, drained marshes.
    onWork(kind, tile, nome) {
        const w = this.stats.work;
        if (kind === 'dam') {
            this.completeGoal('dam');
            if (w.dams === 1) this.log(`${nome.name} finished a dam. The sea becomes land.`, 'world');
        } else if (kind === 'plant' && w.planted === 1) {
            this.log(`${nome.name} planted seeds. New plants spread where builders work.`, 'world');
        } else if (kind === 'drain' && w.drained === 1) {
            this.log(`${nome.name} dug a ditch. A marsh dries up into meadow.`, 'world');
        }
        this.onTerrain([tile]);
    }

    onTerrain(tiles) {
        const set = new Set(tiles);
        for (const c of this.creatures) {
            if (set.has(this.world.tileAt(c.x, c.z)) || c.path.some(t => set.has(t))) c.cancelPlans();
        }
    }

    // Tells the player when the living island grows, shrinks or builds a mountain.
    watchIsland(ws) {
        if (!this.landRef) this.landRef = ws.land;
        const diff = ws.land - this.landRef;
        if (Math.abs(diff) >= Math.max(12, this.landRef * 0.12)) {
            this.log(diff > 0 ? `The sea falls back. ${this.islandName} grows to ${ws.land} tiles of land.`
                : `The sea rises. ${this.islandName} shrinks to ${ws.land} tiles of land.`, 'world');
            this.landRef = ws.land;
        }
        const rising = this.world.hotspot(this.time).power > 0.0004;
        if (rising && !this.rising) this.log('The ground rumbles. Somewhere a mountain starts to rise.', 'world');
        if (!rising && this.rising) this.log('The ground is calm again. Rain wears the peaks down.', 'world');
        this.rising = rising;
    }

    checkGoals() {
        const s = this.stats, n = this.creatures.length;
        if (s.births >= 1) this.completeGoal('birth');
        if (s.maxGen >= 5) this.completeGoal('gen5');
        if (s.maxGen >= 12) this.completeGoal('gen10');
        if (n >= 40) this.completeGoal('pop40');
        if (n >= 100) this.completeGoal('pop100');
        const biomes = new Set();
        let extreme = false;
        for (const c of this.creatures) {
            const t = this.world.tileAt(c.x, c.z);
            if (t) biomes.add(t.biome);
            if (c.generation > 1 && (c.genes.prefTemp < 20 || c.genes.prefTemp > 80)) extreme = true;
            if (c.generation > 1 && legCount(c.genes.legs) === 6) this.completeGoal('sixlegs');
            if (c.generation > 1 && c.genes.webbing > 0.7) this.completeGoal('swimmer');
            if (c.generation > 1 && c.genes.nocturnal > 0.7) this.completeGoal('night');
            if (c.generation > 1 && c.genes.toxinRes > 0.7) this.completeGoal('poison');
        }
        if ([B.SAND, B.MEADOW, B.FOREST, B.MARSH, B.ROCK].every(b => biomes.has(b))) this.completeGoal('biomes');
        if (extreme) this.completeGoal('extreme');
    }

    completeGoal(id) {
        if (this.goals[id]) return;
        this.goals[id] = Math.round(this.time);
        const goal = GOALS.find(g => g.id === id);
        this.log(`Goal reached: ${goal.label}.`, 'goal');
        this.emit('goal', goal);
    }

    log(text, kind = 'info') {
        const e = { id: ++this.eventId, text, kind, year: this.year, season: this.seasonName };
        this.events.push(e);
        if (this.events.length > 60) this.events.shift();
        this.emit('log', e);
    }

    // ---------- Visuals ----------

    burst(x, y, z, kind, color, count) {
        const tex = kind === 'heart' ? heartTexture() : sparkTexture();
        const smoke = kind === 'smoke';
        for (let k = 0; k < count; k++) {
            const mat = new THREE.SpriteMaterial({ map: tex, color, transparent: true, depthWrite: false });
            const sprite = new THREE.Sprite(mat);
            const s = kind === 'heart' ? 0.32 : smoke ? 0.6 : 0.22;
            sprite.scale.set(s, s, 1);
            sprite.position.set(x + rand(-0.25, 0.25), y + rand(0, 0.2), z + rand(-0.25, 0.25));
            sprite.renderOrder = 11;
            this.scene.add(sprite);
            this.effects.push({ sprite, life: 0, max: smoke ? rand(2.2, 3.2) : rand(0.9, 1.4), vy: smoke ? rand(0.3, 0.6) : rand(0.6, 1.2), vx: rand(-0.3, 0.3), vz: rand(-0.3, 0.3), grow: smoke ? 0.5 : 0 });
        }
    }

    animate(dt) {
        if (!this.world) return;
        this.renderTime += dt;
        this.world.animate(dt);
        for (const c of this.creatures) c.render(dt, this.renderTime);
        for (const h of this.hawks) h.render(dt);
        for (const l of this.lurkers) l.render(dt);
        for (let i = this.dying.length - 1; i >= 0; i--) {
            if (this.dying[i].render(dt, this.renderTime)) {
                this.dying[i].dispose();
                this.dying.splice(i, 1);
            }
        }
        for (let i = this.effects.length - 1; i >= 0; i--) {
            const e = this.effects[i];
            e.life += dt;
            e.sprite.position.y += e.vy * dt;
            e.sprite.position.x += e.vx * dt;
            e.sprite.position.z += e.vz * dt;
            e.sprite.material.opacity = 1 - e.life / e.max;
            if (e.grow) e.sprite.scale.multiplyScalar(1 + e.grow * dt);
            if (e.life >= e.max) {
                this.scene.remove(e.sprite);
                e.sprite.material.dispose();
                this.effects.splice(i, 1);
            }
        }
    }

    // ---------- Read-outs for the UI ----------

    genePool() {
        const out = {};
        const keys = Object.keys(GENES).filter(k => k !== 'hue' && k !== 'hue2');
        for (const k of keys) out[k] = { min: Infinity, max: -Infinity, avg: 0 };
        for (const c of this.creatures) {
            for (const k of keys) {
                const v = c.genes[k], o = out[k];
                o.avg += v;
                if (v < o.min) o.min = v;
                if (v > o.max) o.max = v;
            }
        }
        const n = this.creatures.length || 1;
        for (const k of keys) out[k].avg /= n;
        return out;
    }

    biomeCounts() {
        const counts = BIOMES.map(() => 0);
        for (const c of this.creatures) {
            const t = this.world.tileAt(c.x, c.z);
            if (t) counts[t.biome]++;
        }
        return counts;
    }
}

function averageGenes(list, table) {
    const out = {};
    for (const k of Object.keys(table)) {
        let sum = 0;
        for (const p of list) sum += p.genes[k];
        out[k] = sum / list.length;
    }
    return out;
}
