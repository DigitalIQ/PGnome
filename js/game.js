import * as THREE from 'three';
import { B, BIOMES, FOUNDERS, MAX_POP, YEAR_LENGTH, BREED_COOLDOWN, SEASONS, GOALS, SAVE_KEY } from './config.js';
import { World, isWalkable } from './world.js';
import { Creature, randomGenes, mixGenes, getNextId, setNextId } from './creature.js';
import { heartTexture, sparkTexture } from './icons.js';
import { rand } from './rng.js';

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
    }

    newWorld(seed) {
        this.reset();
        this.seed = seed;
        this.world = new World(this.scene, seed);
        this.spawnFounders(FOUNDERS);
        this.log(`A new island rises from the sea. Seed ${seed}.`, 'world');
        this.emit('reset');
    }

    load(data) {
        this.reset();
        this.seed = data.seed;
        this.world = new World(this.scene, data.seed, data.tiles);
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
        this.log(`Welcome back. Year ${this.year}, ${this.seasonName.toLowerCase()}.`, 'world');
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
            nextId: getNextId(),
            savedAt: Date.now()
        };
    }

    save() {
        if (!this.world || this.extinct) return false;
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
    get growth() { return Math.max(0.04, 0.55 + 0.5 * Math.cos(2 * Math.PI * (this.yearPhase - 0.3))); }

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
            const cr = new Creature(this, t.x + rand(-0.25, 0.25), t.z + rand(-0.25, 0.25), randomGenes(c), {
                age: rand(24, 40), energy: rand(70, 90), cooldown: rand(4, 12), y: t.rh + 2
            });
            this.creatures.push(cr);
            this.burst(cr.x, t.rh + 0.5, cr.z, 'spark', 0xfff3c4, 5);
        }
        return n;
    }

    findPartner(c) {
        let best = null, bd = c.genes.sight + 1;
        for (const o of this.creatures) {
            if (o === c || !o.ready || (o.partner && o.partner !== c)) continue;
            if (o.action === 'mate' && o.partner !== c) continue;
            const d = Math.hypot(o.x - c.x, o.z - c.z);
            if (d < bd) { bd = d; best = o; }
        }
        return best;
    }

    breed(a, b) {
        const genes = mixGenes(a.genes, b.genes, this.mutationRate);
        const gen = Math.max(a.generation, b.generation) + 1;
        const child = new Creature(this, (a.x + b.x) / 2, (a.z + b.z) / 2, genes, {
            generation: gen, parents: [a.name, b.name], energy: 45, cooldown: 0, y: a.y
        });
        this.creatures.push(child);
        for (const p of [a, b]) {
            p.energy -= 22;
            p.cooldown = BREED_COOLDOWN * rand(0.85, 1.2);
            p.children++;
            p.partner = null;
            p.action = 'idle';
            p.thinkTimer = rand(0.5, 1.5);
        }
        this.stats.births++;
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

        this.world.grow(dt, this.growth);
        for (let i = this.creatures.length - 1; i >= 0; i--) {
            const c = this.creatures[i];
            if (c) c.step(dt);
        }
        if (this.creatures.length < MAX_POP - 10) this.capWarned = false;
        if (this.creatures.length > this.stats.peakPop) this.stats.peakPop = this.creatures.length;

        this.sampleTimer += dt;
        if (this.sampleTimer >= 2) {
            this.sampleTimer = 0;
            this.history.push({ t: Math.round(this.time), pop: this.creatures.length, s: season });
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
        for (let k = 0; k < count; k++) {
            const mat = new THREE.SpriteMaterial({ map: tex, color, transparent: true, depthWrite: false });
            const sprite = new THREE.Sprite(mat);
            const s = kind === 'heart' ? 0.32 : 0.22;
            sprite.scale.set(s, s, 1);
            sprite.position.set(x + rand(-0.25, 0.25), y + rand(0, 0.2), z + rand(-0.25, 0.25));
            sprite.renderOrder = 11;
            this.scene.add(sprite);
            this.effects.push({ sprite, life: 0, max: rand(0.9, 1.4), vy: rand(0.6, 1.2), vx: rand(-0.3, 0.3), vz: rand(-0.3, 0.3) });
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
        const keys = ['size', 'speed', 'sight', 'prefTemp', 'prefMoisture', 'sociability', 'lifespan'];
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
