import * as THREE from 'three';
import { GENES, BIOMES, B, MATURITY_AGE, MAX_POP, legCount } from './config.js';
import { rand, clamp, lerp, gauss, randomName } from './rng.js';
import { isWalkable, WATER_H } from './world.js';
import { emoteMaterials } from './icons.js';
import { buildBody, baseColor } from './body.js';

// Fallbacks for genes that older saves do not have yet.
const BODY_DEFAULTS = { legs: 0.5, bodyLen: 1, plump: 0.5, eyes: 0.5, horns: 0.25, tail: 0.5, pattern: 0.2 };

let nextId = 1;
export const setNextId = n => { nextId = Math.max(nextId, n); };
export const getNextId = () => nextId;

// A species template per island keeps the founders related, so later change is visible.
export function speciesTemplate(rnd) {
    const r = (a, b) => a + rnd() * (b - a);
    return {
        hue: r(0, 360), hue2: r(0, 360), legs: r(0.32, 0.7), bodyLen: r(0.85, 1.25), plump: r(0.2, 0.8),
        eyes: r(0.2, 0.8), horns: r(0, 0.6), tail: r(0.1, 0.9), pattern: r(0, 1)
    };
}

export function fillGenes(g, template) {
    for (const [k, def] of Object.entries(GENES)) {
        if (typeof g[k] === 'number' && !Number.isNaN(g[k])) continue;
        if (k === 'hue2') g[k] = ((g.hue ?? 0) + 140) % 360;
        else if (template && k in template) g[k] = template[k];
        else if (k in BODY_DEFAULTS) g[k] = BODY_DEFAULTS[k];
        else g[k] = (def.min + def.max) / 2;
    }
    return g;
}

export function randomGenes(climate, template) {
    const g = {};
    for (const [k, def] of Object.entries(GENES)) g[k] = rand(def.min, def.max);
    if (template) {
        for (const [k, v] of Object.entries(template)) {
            const def = GENES[k];
            const spread = (def.max - def.min) * (def.wrap ? 0.05 : 0.09);
            const x = v + gauss() * spread;
            g[k] = def.wrap ? ((x % 360) + 360) % 360 : clamp(x, def.min, def.max);
        }
    }
    g.size = rand(0.85, 1.15);
    g.speed = rand(1.0, 1.5);
    g.sight = rand(4.5, 7);
    g.lifespan = rand(130, 170);
    g.sociability = rand(0.2, 0.8);
    if (climate) {
        g.prefTemp = clamp(climate.temp + rand(-10, 10), 0, 100);
        g.prefMoisture = clamp(climate.moisture + rand(-15, 15), 0, 100);
    }
    return g;
}

export function mixGenes(a, b, rate) {
    const g = {};
    for (const [k, def] of Object.entries(GENES)) {
        let v;
        if (def.wrap || Math.random() < 0.5) {
            v = Math.random() < 0.5 ? a[k] : b[k];
        } else {
            const t = Math.random();
            v = a[k] * t + b[k] * (1 - t);
        }
        v += gauss() * (def.max - def.min) * 0.06 * rate;
        g[k] = def.wrap ? ((v % 360) + 360) % 360 : clamp(v, def.min, def.max);
    }
    // Rarely a body gene jumps to a new value. This is how new body plans appear.
    if (Math.random() < 0.05 * rate) {
        const keys = Object.keys(GENES).filter(k => GENES[k].body);
        const k = keys[Math.floor(Math.random() * keys.length)];
        g[k] = rand(GENES[k].min, GENES[k].max);
    }
    return g;
}

export class Creature {
    constructor(game, x, z, genes, opts = {}) {
        this.game = game;
        this.id = opts.id ?? nextId++;
        setNextId(this.id + 1);
        this.name = opts.name || randomName();
        this.x = x;
        this.z = z;
        this.y = opts.y ?? 0;
        this.genes = fillGenes(genes, game.template);
        this.generation = opts.generation || 1;
        this.parents = opts.parents || null;
        this.age = opts.age ?? 0;
        this.energy = opts.energy ?? 70;
        this.health = opts.health ?? 100;
        this.cooldown = opts.cooldown ?? 8;
        this.children = opts.children || 0;
        this.mood = 70;
        this.discomfort = 0;
        this.coldSide = false;
        this.lonely = false;
        this.crowded = false;

        this.action = 'idle';
        this.status = 'Looking around';
        this.purpose = null;
        this.path = [];
        this.partner = null;
        this.mateTimer = 0;
        this.mateGiveUp = 0;
        this.thinkTimer = Math.random() * 0.6;
        this.restTimer = 0;
        this.moving = false;
        this.ox = rand(-0.22, 0.22);
        this.oz = rand(-0.22, 0.22);

        this.dead = false;
        this.cause = null;
        this.deathTimer = 0;
        this.dragged = false;
        this.heading = Math.random() * Math.PI * 2;
        this.walkPhase = Math.random() * 10;
        this.buildMesh();
    }

    get adult() { return this.age >= MATURITY_AGE; }

    get ready() {
        return this.adult && !this.dead && this.cooldown <= 0 && this.energy > 60 && this.health > 50
            && this.age < this.genes.lifespan * 0.9;
    }

    get lifeStage() {
        if (!this.adult) return 'Child';
        if (this.age > this.genes.lifespan * 0.8) return 'Elder';
        return 'Adult';
    }

    get color() {
        return baseColor(this.genes);
    }

    buildMesh() {
        const parts = buildBody(this.genes, this.id * 7919 + 13);
        this.parts = parts;
        this.material = parts.limbMat;
        this.legs = parts.legs;
        this.legLen = parts.legLen;
        this.pivot = parts.pivot;
        this.body = parts.body;
        this.tail = parts.tail;
        this.hit = parts.hit;
        const root = parts.root;
        root.userData.creature = this;
        this.hit.userData.creature = this;

        this.emote = new THREE.Sprite(emoteMaterials().love);
        this.emote.scale.set(0.42, 0.42, 1);
        this.emote.position.y = 1.05;
        this.emote.visible = false;
        this.emote.renderOrder = 10;
        root.add(this.emote);

        this.root = root;
        this.game.scene.add(root);
    }

    // ---------- Simulation ----------

    step(dt) {
        if (this.dead || this.dragged) return;
        const game = this.game, world = game.world, g = this.genes;
        this.age += dt;
        this.cooldown -= dt;

        const tile = world.tileAt(this.x, this.z);
        if (!tile) { game.kill(this, 'got lost'); return; }
        const climate = game.climate(tile);
        const dT = climate.temp - g.prefTemp;
        // Big bodies keep warm (Bergmann's rule), small ones shed heat.
        const tdiff = dT < 0 ? -dT / g.size : dT * (0.55 + 0.45 * g.size);
        const d = Math.max(0, tdiff - 12) / 32 + Math.max(0, Math.abs(climate.moisture - g.prefMoisture) - 20) / 90;
        this.discomfort = d;
        this.coldSide = dT < 0;
        const inWater = !isWalkable(tile);

        const extraLegs = (legCount(g.legs) - 2) / 2;
        let burn = 0.45 + 0.5 * Math.pow(g.size, 1.5) + 0.03 * g.sight + (g.lifespan - 90) * 0.0015 + d * 1.1
            + extraLegs * 0.05 + game.weatherBurn * (this.sheltered(tile) ? 0.4 : 1);
        if (this.moving) burn += 0.2 * g.speed * g.speed;
        if (!this.adult) burn *= 0.7;
        this.energy -= burn * dt;
        if (this.energy <= 0) {
            this.energy = 0;
            this.health -= 5 * dt;
        }
        if (d > 0.8) this.health -= (d - 0.8) * 10 * dt;
        if (inWater) this.health -= 8 * dt;
        if (this.energy > 35 && d < 0.8 && !inWater) this.health = Math.min(100, this.health + 1.5 * dt);

        const hungerPenalty = this.energy < 30 ? 30 - this.energy : 0;
        this.mood = clamp(100 - d * 55 - hungerPenalty - (this.lonely ? 15 : 0) - (this.crowded ? 10 : 0), 0, 100);

        if (this.health <= 0) {
            const cause = this.energy <= 0 ? 'starved' : inWater ? 'drowned' : this.coldSide ? 'froze' : 'overheated';
            game.kill(this, cause);
            return;
        }
        if (this.age >= g.lifespan) {
            game.kill(this, 'died of old age');
            return;
        }
        this.energy = Math.min(100, this.energy);

        this.thinkTimer -= dt;
        switch (this.action) {
            case 'eat': this.eat(dt, tile); break;
            case 'rest':
                this.moving = false;
                this.restTimer -= dt;
                if (this.restTimer <= 0 || this.energy < 40) this.action = 'idle';
                break;
            case 'mate': this.court(dt); break;
            case 'walk':
                if (this.moveAlong(dt)) {
                    if (this.purpose === 'food') {
                        this.action = 'eat';
                    } else {
                        this.action = 'idle';
                        this.thinkTimer = rand(0.1, 0.8);
                    }
                }
                break;
            default:
                this.moving = false;
        }

        const canRethink = this.action === 'idle' || (this.action === 'walk' && this.purpose !== 'food' && this.purpose !== 'escape');
        if (this.thinkTimer <= 0 && canRethink) this.think();
    }

    think() {
        const game = this.game, world = game.world, g = this.genes;
        this.thinkTimer = rand(1.0, 1.6);
        const start = world.tileAt(this.x, this.z);
        this.newOffset();

        // Company check, used for mood and social wandering.
        let near = 0, friend = null, friendD = Infinity;
        for (const o of game.creatures) {
            if (o === this) continue;
            const dd = Math.hypot(o.x - this.x, o.z - this.z);
            if (dd < 5) near++;
            if (dd > 1.2 && dd < friendD && dd < g.sight * game.sightMul + 2) { friendD = dd; friend = o; }
        }
        this.lonely = g.sociability > 0.6 && near === 0;
        this.crowded = g.sociability < 0.3 && near > 4;

        if (!isWalkable(start)) {
            const visited = world.bfs(start, 8);
            for (const i of visited) {
                if (i !== start.i) { this.walkTo(world.pathTo(i), 'escape', 'Swimming to shore'); return; }
            }
            this.status = 'Stranded in the water';
            return;
        }

        const hungry = this.energy < 55;
        if (!hungry && this.ready && game.creatures.length < MAX_POP) {
            const p = game.findPartner(this);
            if (p) {
                this.startCourting(p);
                p.startCourting(this);
                return;
            }
        }

        if (hungry || (this.energy < 85 && start.food > 0.35)) {
            const visited = world.bfs(start, Math.ceil(g.sight * game.sightMul));
            let best = null, bestScore = -Infinity, far = null;
            for (const i of visited) {
                const t = world.tiles[i];
                far = i;
                if (t.food < 0.15) continue;
                const score = Math.min(t.food, 1.6) - world.bfsDist[i] * 0.12 + t.jitter * 0.05;
                if (score > bestScore) { bestScore = score; best = t; }
            }
            if (best === start) {
                this.action = 'eat';
                this.status = 'Eating';
            } else if (best) {
                this.walkTo(world.pathTo(best.i), 'food', 'Heading to food');
            } else {
                const pick = visited[Math.floor(visited.length * (0.6 + Math.random() * 0.4)) % visited.length] ?? far;
                this.walkTo(world.pathTo(pick), 'explore', 'Searching for food');
            }
            return;
        }

        if (this.action === 'idle' && Math.random() < 0.25) {
            this.action = 'rest';
            this.restTimer = rand(1.2, 3.5);
            this.status = 'Resting';
            this.moving = false;
            return;
        }
        if (this.action === 'walk') return;

        const visited = world.bfs(start, 4);
        let best = null, bestScore = -Infinity;
        for (let k = 0; k < 7; k++) {
            const i = visited[Math.floor(Math.random() * visited.length)];
            const t = world.tiles[i];
            const c = game.climate(t);
            const dT = Math.abs(c.temp - g.prefTemp);
            let score = -dT / 25 - Math.abs(c.moisture - g.prefMoisture) / 80 + Math.random() * 0.3 + Math.min(t.food, 1) * 0.2;
            if (friend) {
                const fd = Math.hypot(friend.x - t.x, friend.z - t.z);
                score += (g.sociability - 0.4) * (1 - Math.min(fd, 8) / 8) * 1.2;
            }
            if (score > bestScore) { bestScore = score; best = t; }
        }
        if (!best || best === start) {
            this.action = 'idle';
            this.status = 'Looking around';
            return;
        }
        const label = this.discomfort > 0.5 ? (this.coldSide ? 'Looking for warmth' : 'Looking for shade')
            : friend && g.sociability > 0.6 ? 'Joining friends' : 'Wandering';
        this.walkTo(world.pathTo(best.i), 'wander', label);
    }

    newOffset() {
        this.ox = rand(-0.22, 0.22);
        this.oz = rand(-0.22, 0.22);
    }

    walkTo(path, purpose, status) {
        this.path = path;
        this.purpose = purpose;
        this.status = status;
        this.action = path.length ? 'walk' : 'idle';
    }

    moveAlong(dt) {
        if (!this.path.length) { this.moving = false; return true; }
        const next = this.path[0];
        if (!isWalkable(next)) {
            this.path = [];
            this.action = 'idle';
            this.thinkTimer = 0;
            this.moving = false;
            return false;
        }
        const last = this.path.length === 1;
        const tx = next.x + (last ? this.ox : 0), tz = next.z + (last ? this.oz : 0);
        this.stepToward(tx, tz, dt);
        if (Math.hypot(tx - this.x, tz - this.z) < 0.02) this.path.shift();
        return this.path.length === 0;
    }

    stepToward(tx, tz, dt) {
        const dx = tx - this.x, dz = tz - this.z;
        const dist = Math.hypot(dx, dz);
        const here = this.game.world.tileAt(this.x, this.z);
        // More legs handle rough ground better but are a little slower on the flat.
        const legs = legCount(this.genes.legs);
        const grip = legs === 2 ? 0 : legs === 4 ? 0.3 : 0.55;
        const flat = legs === 2 ? 1.06 : legs === 4 ? 1 : 0.92;
        const base = here && isWalkable(here) ? BIOMES[here.biome].speed : 0.45;
        const terrain = (base + (1 - base) * grip) * flat * this.game.windSlow;
        const sp = this.genes.speed * terrain * (this.adult ? 1 : 0.75) * dt;
        if (dist <= sp) { this.x = tx; this.z = tz; }
        else { this.x += dx / dist * sp; this.z += dz / dist * sp; }
        if (dist > 0.001) this.heading = Math.atan2(dx, dz);
        this.moving = true;
    }

    eat(dt, tile) {
        this.moving = false;
        if (tile.food < 0.03 || this.energy >= 98) {
            this.action = 'idle';
            this.thinkTimer = rand(0.2, 0.6);
            return;
        }
        const take = Math.min(tile.food, 0.35 * this.genes.size * dt);
        tile.food -= take;
        this.energy += take * 80;
        this.status = 'Eating';
    }

    startCourting(p) {
        this.action = 'mate';
        this.partner = p;
        this.path = [];
        this.mateTimer = 0;
        this.mateGiveUp = 14;
        this.status = `Courting ${p.name}`;
    }

    stopCourting() {
        const p = this.partner;
        this.partner = null;
        this.action = 'idle';
        this.thinkTimer = rand(0.3, 1);
        if (p && p.partner === this) {
            p.partner = null;
            p.action = 'idle';
            p.thinkTimer = rand(0.3, 1);
        }
    }

    court(dt) {
        const p = this.partner;
        this.mateGiveUp -= dt;
        if (!p || p.dead || p.partner !== this || this.energy < 45 || this.mateGiveUp <= 0) {
            this.stopCourting();
            return;
        }
        const d = Math.hypot(p.x - this.x, p.z - this.z);
        if (d < 0.7) {
            this.moving = false;
            if (this.id < p.id) this.game.breed(this, p);
            return;
        }
        if (d < 1.6) {
            this.path = [];
            this.stepToward(p.x, p.z, dt);
            return;
        }
        this.mateTimer -= dt;
        if (this.mateTimer <= 0 || !this.path.length) {
            this.mateTimer = 0.8;
            const world = this.game.world;
            const start = world.tileAt(this.x, this.z);
            const goal = world.tileAt(p.x, p.z);
            world.bfs(start, Math.ceil(this.genes.sight) + 4);
            if (!goal || !world.reached(goal.i)) { this.stopCourting(); return; }
            this.path = world.pathTo(goal.i);
        }
        if (this.path.length) {
            const next = this.path[0];
            this.stepToward(next.x, next.z, dt);
            if (Math.hypot(next.x - this.x, next.z - this.z) < 0.02) this.path.shift();
        }
    }

    // Forests shelter from storms.
    sheltered(tile) {
        return !!tile && tile.biome === B.FOREST;
    }

    cancelPlans() {
        if (this.partner) this.stopCourting();
        this.path = [];
        this.action = 'idle';
        this.thinkTimer = 0;
        this.moving = false;
    }

    // ---------- Rendering ----------

    render(dt, time) {
        const world = this.game.world;
        const tile = world.tileAt(this.x, this.z);
        let ground = tile ? (isWalkable(tile) ? tile.rh : WATER_H - 0.18) : 0;
        if (this.dragged) ground = Math.max(ground, 1) + 1.2;
        this.y = lerp(this.y, ground, Math.min(1, dt * (this.dragged ? 18 : 12)));
        this.root.position.set(this.x, this.y, this.z);

        let diff = this.heading - this.root.rotation.y;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        this.root.rotation.y += diff * Math.min(1, dt * 10);

        const growth = 0.45 + 0.55 * Math.min(1, this.age / MATURITY_AGE);
        let scale = this.genes.size * growth;

        if (this.dead) {
            this.deathTimer += dt;
            const k = Math.min(1, this.deathTimer / 1.2);
            scale *= 1 - k * 0.9;
            this.root.rotation.z = k * 1.4;
            this.emote.visible = false;
            this.root.scale.setScalar(Math.max(0.001, scale));
            return k >= 1;
        }
        this.root.scale.setScalar(scale);

        const anim = this.game.paused ? 0 : 1;
        if (this.moving && !this.dragged) {
            this.walkPhase += dt * anim * (6 + this.genes.speed * 5);
            const s = Math.sin(this.walkPhase);
            for (const l of this.legs) l.hip.rotation.x = Math.sin(this.walkPhase + l.phase) * 0.7;
            this.pivot.position.y = this.legLen + Math.abs(s) * 0.06;
            this.pivot.rotation.x = 0.08;
        } else {
            for (const l of this.legs) l.hip.rotation.x *= 0.8;
            this.pivot.position.y = this.legLen;
            this.pivot.rotation.x = this.action === 'eat' ? 0.3 + Math.sin(time * 12) * 0.12 : 0;
        }
        const squash = this.action === 'rest' ? 0.86 : 1 + Math.sin(time * 2 + this.id) * 0.015;
        this.body.scale.set(1 / Math.sqrt(squash), 0.92 * squash, 1 / Math.sqrt(squash));
        if (this.dragged) {
            for (const l of this.legs) l.hip.rotation.x = Math.sin(time * 14 + l.phase) * 0.9;
        }
        // Happy Nomes wag their tail.
        const wag = this.mood > 60 ? 0.45 : 0.12;
        this.tail.rotation.y = Math.sin(time * (this.mood > 60 ? 9 : 3) + this.id) * wag * anim;

        const mats = emoteMaterials();
        let emote = null;
        if (this.action === 'mate') emote = mats.love;
        else if (this.health < 35) emote = mats.sick;
        else if (this.discomfort > 0.8) emote = this.coldSide ? mats.cold : mats.hot;
        else if (this.energy < 25 && this.action !== 'eat') emote = mats.hungry;
        else if (this.action === 'rest' && this.restTimer > 1.5) emote = mats.sleep;
        this.emote.visible = !!emote;
        if (emote) {
            this.emote.material = emote;
            this.emote.position.y = 1.05 + Math.sin(time * 3 + this.id) * 0.05;
        }
        return false;
    }

    dispose() {
        this.game.scene.remove(this.root);
        this.parts.dispose();
    }

    serialize() {
        const r = v => Math.round(v * 1000) / 1000;
        const genes = {};
        for (const k in this.genes) genes[k] = r(this.genes[k]);
        return {
            id: this.id, name: this.name, x: r(this.x), z: r(this.z), genes,
            generation: this.generation, parents: this.parents, age: r(this.age),
            energy: r(this.energy), health: r(this.health), cooldown: r(this.cooldown), children: this.children
        };
    }
}
