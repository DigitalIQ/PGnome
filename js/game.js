import * as THREE from 'three';
import { GENES, B, BIOMES, FOUNDERS, MAX_POP, YEAR_LENGTH, BREED_COOLDOWN, SEASONS, GOALS, SAVE_KEY, MODES, DAY_LENGTH, legCount } from './config.js';
import { World, isWalkable } from './world.js';
import { Creature, randomGenes, mixGenes, getNextId, setNextId, speciesTemplate } from './creature.js';
import { heartTexture, sparkTexture } from './icons.js';
import { rand, mulberry32 } from './rng.js';
import { Weather } from './weather.js';
import { islandName, submitRecord } from './scores.js';

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
    }

    on(name, fn) { (this.listeners[name] ||= []).push(fn); }
    emit(name, data) { (this.listeners[name] || []).forEach(fn => fn(data)); }

    // ---------- Lifecycle ----------

    reset() {
        this.creatures.forEach(c => c.dispose());
        this.dying.forEach(c => c.dispose());
        this.effects.forEach(e => { this.scene.remove(e.sprite); e.sprite.material.dispose(); });
        if (this.world) this.world.dispose();
        this.creatures = [];
        this.dying = [];
        this.effects = [];
        this.selected = null;
        this.follow = false;
        this.time = YEAR_LENGTH * 0.12;
        this.stats = { births: 0, deaths: 0, maxGen: 1, peakPop: 0, causes: {} };
        this.history = [];
        this.events = [];
        this.eventId = 0;
        this.goals = {};
        this.extinct = false;
        this.lastSeason = this.seasonIndex;
        this.sampleTimer = 0;
        this.goalTimer = 0;
        this.weather = new Weather();
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
        this.stats = { ...this.stats, ...data.stats };
        this.history = data.history || [];
        this.goals = data.goals || {};
        this.mutationRate = data.mutationRate ?? 1;
        setNextId(data.nextId || 1);
        for (const s of data.creatures) {
            const c = new Creature(this, s.x, s.z, s.genes, s);
            this.creatures.push(c);
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
            goals: this.goals,
            mutationRate: this.mutationRate,
            mode: this.mode,
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
            const data = JSON.parse(raw);
            return data && data.v === 2 && data.creatures?.length ? data : null;
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
    get airTemp() { return this.seasonTemp + this.weather.now.temp - 3 * this.night; }
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
        const count = fed && Math.random() < litter * 0.6 && this.creatures.length < MAX_POP - 1 ? 2 : 1;
        let child = null;
        for (let k = 0; k < count; k++) {
            const genes = mixGenes(a.genes, b.genes, this.mutationRate);
            child = new Creature(this, (a.x + b.x) / 2 + k * 0.2, (a.z + b.z) / 2, genes, {
                generation: gen, parents: [a.name, b.name], energy: 45 - (count - 1) * 12 + picky * 20, cooldown: 0, y: a.y
            });
            this.creatures.push(child);
        }
        if (count === 2) this.stats.twins = (this.stats.twins || 0) + 1;
        if (count === 2 && this.stats.twins === 1) this.log(`Twins! ${a.name} and ${b.name} have two children at once.`, 'birth');
        for (const p of [a, b]) {
            p.energy -= 22 + litter * 10 + (count - 1) * 8;
            p.cooldown = BREED_COOLDOWN * rand(0.85, 1.2);
            p.children++;
            p.partner = null;
            p.action = 'idle';
            p.thinkTimer = rand(0.5, 1.5);
        }
        this.stats.births += count;
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
        if (this.creatures.length >= MAX_POP && !this.capWarned) {
            this.capWarned = true;
            this.log(`The island is full at ${MAX_POP} Nomes. Births pause until there is room.`, 'world');
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
        if (w) this.onWeather(w);
        this.world.grow(dt, this.growth);
        const changed = this.world.evolve(dt, this.time, this.weather.now);
        if (changed && changed.length) this.onTerrain(changed);
        if (this.weather.now.lightning > 0.6) this.storm(dt);
        for (let i = this.creatures.length - 1; i >= 0; i--) {
            const c = this.creatures[i];
            if (c) c.step(dt);
        }
        if (this.creatures.length < MAX_POP - 10) this.capWarned = false;
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
        this.strikeTimer = rand(4, 9);
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
        this.strike = { x: t.x, y: t.rh, z: t.z, age: 0 };
        this.burst(t.x, t.rh + 0.4, t.z, 'spark', 0xfff6a8, 10);
        if (this.world.living && this.world.burn(t)) {
            this.onTerrain([t]);
            this.burst(t.x, t.rh + 0.6, t.z, 'spark', 0xff7a3c, 8);
            this.burst(t.x, t.rh + 0.5, t.z, 'smoke', 0x6b6b6b, 6);
        }
        for (const c of [...this.creatures]) {
            if (Math.hypot(c.x - t.x, c.z - t.z) < 0.7) {
                c.health -= 45;
                if (c.health <= 0) this.kill(c, 'was struck by lightning');
            }
        }
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
