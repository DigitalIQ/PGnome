import * as THREE from 'three';
import { GENES, BIOMES, B, MATURITY_AGE, MAX_POP, FOODS, legCount, eyeCount } from './config.js';
import { rand, clamp, lerp, gauss, randomName } from './rng.js';
import { isWalkable, WATER_H } from './world.js';
import { emoteMaterials } from './icons.js';
import { buildBody, baseColor } from './body.js';

// Fallbacks for genes that older saves do not have yet.
const DEFAULTS = {
    legs: 0.5, bodyLen: 1, plump: 0.5, eyes: 0.5, horns: 0.25, tail: 0.5, pattern: 0.2,
    metabolism: 0.5, fur: 0.3, pigment: 0.5, nocturnal: 0.15, webbing: 0.15, curiosity: 0.4, litter: 0.2, pickiness: 0.3,
    jaw: 0.3, claws: 0.25, toxinRes: 0.2, palate: 0.3, vigilance: 0.3, care: 0.3, builder: 0.2, immunity: 0.3
};
// What each job is called while a Nome does it.
const JOB_TEXT = { burrow: 'Digging a burrow', dam: 'Building a dam', plant: 'Planting seeds', drain: 'Digging a ditch' };
const JOB_GO = { burrow: 'Looking for a place to dig', dam: 'Heading to the shore to build', plant: 'Carrying seeds', drain: 'Heading into the marsh to dig' };

let nextId = 1;
export const setNextId = n => { nextId = Math.max(nextId, n); };
export const getNextId = () => nextId;

export const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

// A species template per island keeps the founders related, so later change is visible.
export function speciesTemplate(rnd) {
    const r = (a, b) => a + rnd() * (b - a);
    return {
        hue: r(0, 360), hue2: r(0, 360), legs: r(0.32, 0.7), bodyLen: r(0.85, 1.25), plump: r(0.2, 0.8),
        eyes: r(0.2, 0.8), horns: r(0, 0.6), tail: r(0.1, 0.9), pattern: r(0, 1),
        metabolism: r(0.3, 0.7), fur: r(0.1, 0.6), pigment: r(0.2, 0.8), nocturnal: r(0.05, 0.4),
        webbing: r(0.1, 0.5), curiosity: r(0.2, 0.7), litter: r(0.05, 0.4), pickiness: r(0.1, 0.5),
        jaw: r(0.1, 0.6), claws: r(0.05, 0.55), toxinRes: r(0.05, 0.4), palate: r(0.1, 0.6), vigilance: r(0.1, 0.6),
        care: r(0.1, 0.6), builder: r(0.05, 0.5), immunity: r(0.1, 0.5)
    };
}

export function fillGenes(g, template) {
    for (const [k, def] of Object.entries(GENES)) {
        if (typeof g[k] === 'number' && !Number.isNaN(g[k])) continue;
        if (k === 'hue2') g[k] = ((g.hue ?? 0) + 140) % 360;
        else if (template && k in template) g[k] = template[k];
        else if (k in DEFAULTS) g[k] = DEFAULTS[k];
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
            if (!def) continue;
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
        this.computeTraits();
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
        this.huddle = 0;
        this.sharing = 0;
        this.fleeTimer = 0;
        this.sightNow = this.genes.sight;
        this.poison = opts.poison ?? 0;
        this.plague = opts.plague ?? 0;
        this.immuneT = opts.immuneT ?? 0;
        this.seeds = 0;
        this.meal = null;
        this.job = null;
        this.pendingJob = null;
        this.careChild = null;
        this.careT = 0;
        this.guardian = null;
        this.courtT = 0;
        this.courtNeed = 2;
        this.avoid = new Map();
        this.lastHarm = null;

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

    // Values that follow from the genes and never change during a life.
    computeTraits() {
        const g = this.genes;
        const lenN = (g.bodyLen - 0.75) / 0.85;
        const legs = legCount(g.legs), eyes = eyeCount(g.eyes);
        this.t = {
            legs, eyes, lenN,
            maxEnergy: 85 + lenN * 45,
            maturity: MATURITY_AGE * (1.3 - 0.6 * g.metabolism),
            lifespan: g.lifespan * (1.12 - 0.24 * g.metabolism),
            burnMul: 0.78 + 0.44 * g.metabolism,
            heal: 0.7 + 0.8 * g.metabolism,
            swimmer: g.webbing > 0.45,
            fogEye: eyes === 1 ? 1.35 : eyes === 3 ? 0.45 : 1,
            nightEye: eyes === 3 ? 1.15 : 1,
            attract: (g.pattern >= 0.4 ? 0.5 : 0) + Math.max(0, g.horns - 0.5) * 1.4 + Math.max(0, lenN - 0.6) * 0.3,
            baseBurn: 0.45 + 0.5 * Math.pow(g.size, 1.5) + 0.03 * g.sight + (g.lifespan - 90) * 0.0015
                + (legs - 2) / 2 * 0.05 + (eyes - 2) * 0.03 + Math.max(0, g.horns - 0.5) * 0.2 + lenN * 0.12
                + (g.pattern >= 0.4 ? 0.03 : 0) + g.fur * 0.04
                + g.jaw * 0.05 + g.claws * 0.03 + g.toxinRes * 0.08 + g.immunity * 0.07 + g.vigilance * 0.02 + g.palate * 0.02
        };
    }

    get maturity() { return this.t.maturity; }
    get maxEnergy() { return this.t.maxEnergy; }
    get adult() { return this.age >= this.t.maturity; }

    get ready() {
        return this.adult && !this.dead && this.cooldown <= 0 && this.energy > this.t.maxEnergy * 0.6 && this.health > 50
            && this.age < this.t.lifespan * 0.9 && this.poison < 0.3 && this.plague <= 0 && this.action !== 'care';
    }

    // How absorbed this Nome is in what it does. Absorbed Nomes notice predators late.
    get distraction() {
        const a = this.action;
        const base = a === 'eat' ? 0.6 : a === 'work' ? 0.85 : a === 'mate' ? 0.7 : a === 'care' ? 0.3
            : a === 'rest' ? (this.status === 'Sleeping' ? 1 : 0.4) : 0.15;
        return base * (1 - this.genes.vigilance * 0.7);
    }

    // Seconds left of the current task, for the info panel.
    get busyLeft() {
        if (this.action === 'eat' && this.meal) return this.meal.t;
        if (this.action === 'work' && this.job) return this.job.t;
        if (this.action === 'care') return this.careT;
        if (this.action === 'rest') return this.restTimer;
        if (this.action === 'mate' && this.courtT > 0) return Math.max(0, this.courtNeed - this.courtT);
        return 0;
    }

    get lifeStage() {
        if (!this.adult) return 'Child';
        if (this.age > this.t.lifespan * 0.8) return 'Elder';
        return 'Adult';
    }

    get color() {
        return baseColor(this.genes);
    }

    accepts(o) {
        return hueDist(this.genes.hue, o.genes.hue) <= 30 + 150 * (1 - this.genes.pickiness);
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

    // How far this Nome sees right now: fog, darkness and its eyes all count.
    sightFactor() {
        const game = this.game, g = this.genes, t = this.t;
        const fog = clamp(1 - (1 - game.sightMul) * t.fogEye, 0.25, 1.1);
        const night = game.night;
        const dark = (1 - night) * (1 - 0.2 * g.nocturnal) + night * (0.5 + 0.55 * g.nocturnal) * t.nightEye;
        return fog * dark;
    }

    // Forests shelter from storms and hail, rocks from hail.
    sheltered(tile) {
        return !!tile && (tile.biome === B.FOREST || tile.burrow > 0.35 || (tile.biome === B.ROCK && this.game.weather.now.hail > 0.3));
    }

    step(dt) {
        if (this.dead || this.dragged) return;
        const game = this.game, world = game.world, g = this.genes, t = this.t;
        const w = game.weather.now;
        this.age += dt;
        this.cooldown -= dt;

        const tile = world.tileAt(this.x, this.z);
        if (!tile) { game.kill(this, 'got lost'); return; }
        if (tile.biome === B.LAVA) { game.kill(this, 'was caught by lava'); return; }
        if (tile.fire > 0) this.health -= 28 * (1 - g.fur * 0.2) * dt;
        // Fire and lava nearby interrupt whatever the Nome is doing.
        if ((tile.fire > 0 || world.heat[tile.i] > 0.5) && this.purpose !== 'escape' && this.action !== 'walk') this.cancelPlans();
        const inWater = !isWalkable(tile);
        const shelter = this.sheltered(tile);
        const climate = game.climate(tile);

        // Dark skin warms up in the sun, light skin stays cool.
        const temp = climate.temp + (0.5 - g.pigment) * 14 * game.sunshine;
        const dT = temp - g.prefTemp;
        // Fur warms, unless it is soaked by rain or water.
        const soaked = inWater ? 0.7 : Math.min(1, w.rain) * 0.6;
        const furWarm = g.fur * 14 * (1 - soaked);
        const huddle = Math.min(3, this.huddle) * 3.5 * g.sociability + (this.action === 'rest' && tile.burrow > 0.35 ? 8 : 0);
        // Big bodies keep warm (Bergmann's rule), small ones shed heat.
        const cold = Math.max(0, -dT - furWarm - g.plump * 6 - huddle) / g.size;
        const heat = Math.max(0, dT + g.fur * 9 + g.plump * 6 - g.tail * 4) * (0.55 + 0.45 * g.size);
        const d = Math.max(0, Math.max(cold, heat) - 12) / 32 + Math.max(0, Math.abs(climate.moisture - g.prefMoisture) - 20) / 90;
        this.discomfort = d;
        this.coldSide = cold > heat;

        let burn = (t.baseBurn + d * 1.1) * t.burnMul;
        burn += game.weatherBurn * (shelter ? 0.4 : 1) * (1 - g.tail * 0.3) * (1.15 - 0.15 * g.size);
        if (this.moving) burn += 0.2 * g.speed * g.speed * (1 + g.plump * 0.3) + g.curiosity * 0.08;
        if (this.action === 'work') burn += 0.3;
        if (this.plague > 0) burn += 0.35 * (1 - g.immunity * 0.85);
        if (!this.adult) burn *= 0.7;
        if (this.action === 'rest') {
            burn *= this.status === 'Sleeping' ? 0.7 : 0.8;
            // Droppings make the soil fertile where Nomes rest.
            tile.fert = Math.min(1, tile.fert + 0.0025 * dt);
        }
        this.energy -= burn * dt;
        if (this.energy <= 0) {
            this.energy = 0;
            // Fat buys time when food runs out.
            this.health -= 5 * (1 - g.plump * 0.5) * dt;
        }
        if (d > 0.8) this.health -= (d - 0.8) * 10 * dt;
        // Webbed feet turn water from deadly into a place to feed.
        const drown = inWater ? 8 * Math.pow(clamp((0.85 - g.webbing) / 0.85, 0, 1), 1.5) * (1 - g.tail * 0.15) : 0;
        if (inWater) this.health -= drown * dt;
        if (w.hail > 0.3 && !shelter) this.health -= 1.2 * w.hail * (1 - g.plump * 0.3) * dt;
        // Poison wears off with a fast metabolism and a strong liver.
        if (this.poison > 0) {
            this.health -= this.poison * 7 * dt;
            this.poison = Math.max(0, this.poison - (0.04 + g.metabolism * 0.06 + g.toxinRes * 0.1) * dt);
        }
        if (this.plague > 0) {
            this.health -= (1 - g.immunity * 0.85) * 2.2 * dt;
            this.plague -= dt * (0.6 + g.metabolism * 0.6);
            if (this.plague <= 0) { this.plague = 0; this.immuneT = 240; }
        }
        if (this.immuneT > 0) this.immuneT -= dt;
        const ill = this.poison > 0.2 || this.plague > 0;
        if (this.energy > 35 && d < 0.8 && drown < 0.2 && !ill && tile.fire <= 0) this.health = Math.min(100, this.health + 1.5 * t.heal * dt);
        if (this.fleeTimer > 0) this.fleeTimer -= dt;

        const hungerPenalty = this.energy < 30 ? 30 - this.energy : 0;
        this.mood = clamp(100 - d * 55 - hungerPenalty - (this.lonely ? 15 : 0) - (this.crowded ? 10 : 0) + (w.mood || 0), 0, 100);

        if (this.health <= 0) {
            const cause = tile.fire > 0 ? 'burned in a wildfire' : this.energy <= 0 ? 'starved' : inWater && drown > 0.2 ? 'drowned'
                : this.poison > 0.03 ? 'was poisoned' : this.plague > 0 ? 'died of plague'
                    : d > 0.8 ? (this.coldSide ? 'froze' : 'overheated') : w.hail > 0.3 && !shelter ? 'was hit by hail'
                        : this.lastHarm || 'died of wounds';
            game.kill(this, cause);
            return;
        }
        if (this.age >= t.lifespan) {
            game.kill(this, 'died of old age');
            return;
        }
        this.energy = Math.min(t.maxEnergy, this.energy);

        this.thinkTimer -= dt;
        switch (this.action) {
            case 'eat': this.eat(dt, tile); break;
            case 'rest':
                this.moving = false;
                this.restTimer -= dt;
                if (this.restTimer <= 0 || this.energy < t.maxEnergy * 0.35) this.action = 'idle';
                break;
            case 'mate': this.court(dt); break;
            case 'work': this.work(dt); break;
            case 'care': this.tend(dt); break;
            case 'walk':
                if (this.moveAlong(dt)) {
                    if (this.purpose === 'food') {
                        this.action = 'eat';
                    } else if (this.purpose === 'work' && this.pendingJob) {
                        this.startJob();
                    } else {
                        this.action = 'idle';
                        this.thinkTimer = rand(0.1, 0.8);
                    }
                }
                break;
            default:
                this.moving = false;
        }

        const canRethink = this.action === 'idle' || (this.action === 'walk' && this.purpose !== 'food' && this.purpose !== 'escape' && this.purpose !== 'work');
        if (this.thinkTimer <= 0 && canRethink) this.think();
    }

    think() {
        const game = this.game, world = game.world, g = this.genes, t = this.t;
        this.thinkTimer = rand(1.0, 1.6);
        const start = world.tileAt(this.x, this.z);
        const swim = t.swimmer;
        this.newOffset();
        this.sightNow = g.sight * this.sightFactor();
        const sight = this.sightNow;

        // Company check, used for mood, huddling and social wandering.
        let near = 0, huddle = 0, sharing = 0, friend = null, friendD = Infinity;
        for (const o of game.creatures) {
            if (o === this) continue;
            const dd = Math.hypot(o.x - this.x, o.z - this.z);
            if (dd < 5) near++;
            if (dd < 1.5) huddle++;
            if (dd < 0.6) sharing++;
            if (dd > 1.2 && dd < friendD && dd < sight + 2) { friendD = dd; friend = o; }
        }
        this.huddle = huddle;
        this.sharing = sharing;
        this.lonely = g.sociability > 0.6 && near === 0;
        this.crowded = g.sociability < 0.3 && near > 4;

        // Forget poison spots after a while.
        if (this.avoid.size) for (const [i, until] of this.avoid) if (until < game.time) this.avoid.delete(i);

        // Run from lava and fire.
        if (world.heat[start.i] > 0.3 || start.fire > 0) {
            const near = world.bfs(start, 6, swim);
            for (const i of near) {
                if (world.heat[i] < 0.1 && world.tiles[i].fire <= 0 && isWalkable(world.tiles[i])) { this.walkTo(world.pathTo(i), 'escape', 'Fleeing the heat'); return; }
            }
        }

        if (!isWalkable(start)) {
            const swimming = swim && start.biome === B.WATER && start.height >= 0.12 && this.health > 55;
            if (!swimming) {
                const visited = world.bfs(start, 8, false);
                for (const i of visited) {
                    if (i !== start.i) { this.walkTo(world.pathTo(i), 'escape', 'Swimming to shore'); return; }
                }
                this.status = 'Stranded in the water';
                return;
            }
        }

        const hungry = this.energy < t.maxEnergy * 0.55;
        // Nomes breed less when food per head runs short or the island is crowded,
        // so booms flatten before the winter hits.
        const crowd = game.creatures.length / MAX_POP;
        const chance = clamp(game.foodPerNome / 2.5, 0.08, 1) * (1 - crowd * crowd * 0.85);
        if (!hungry && this.ready && game.creatures.length < MAX_POP && Math.random() < chance) {
            const p = game.findPartner(this);
            if (p) {
                this.startCourting(p);
                p.startCourting(this);
                return;
            }
        }

        if (hungry || (this.energy < t.maxEnergy * 0.85 && this.tileValue(start) > 0.35)) {
            const visited = world.bfs(start, Math.max(1, Math.ceil(sight)), swim);
            let best = null, bestScore = -Infinity, far = null;
            for (const i of visited) {
                const tl = world.tiles[i];
                far = i;
                const f = this.tileValue(tl);
                if (f < 0.15) continue;
                // Lurkers learned about by others keep wary Nomes away.
                const score = Math.min(f, 1.8) - world.bfsDist[i] * 0.12 + tl.jitter * 0.05;
                if (score > bestScore) { bestScore = score; best = tl; }
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

        // Day Nomes sleep at night, night Nomes by day.
        const night = game.night;
        const sleepy = night * (1 - g.nocturnal) + (1 - night) * g.nocturnal * 0.7;
        if (this.action === 'idle' && Math.random() < 0.25 + sleepy * 0.5) {
            const asleep = sleepy > 0.45;
            // Sleeping by day out in the open is dangerous. Look for a forest first.
            const cosy = tl => tl.biome === B.FOREST || tl.burrow > 0.35;
            if (asleep && (night < 0.5 || game.seasonIndex === 3) && !cosy(start)) {
                const near = world.bfs(start, 5, swim);
                for (const i of near) {
                    if (cosy(world.tiles[i])) { this.walkTo(world.pathTo(i), 'shelter', world.tiles[i].burrow > 0.35 ? 'Crawling into a burrow' : 'Looking for a place to sleep'); return; }
                }
            }
            this.action = 'rest';
            // A slow metabolism needs longer sleep.
            this.restTimer = (asleep ? rand(3, 6) : rand(1.2, 3.5)) * (1.3 - g.metabolism * 0.6);
            this.status = asleep ? 'Sleeping' : 'Resting';
            this.moving = false;
            return;
        }
        if (this.action === 'walk') return;

        // Builders and diggers sometimes pick a job instead of wandering.
        const winterish = game.seasonIndex >= 2 ? 0.08 : 0;
        const urge = (g.builder * 0.3 + g.claws * (0.12 + winterish + (game.hawks.length ? 0.06 : 0))) * (this.energy > t.maxEnergy * 0.6 ? 1 : 0.15);
        if (this.adult && Math.random() < urge && this.planWork(start)) return;

        // Curious Nomes look further and like far places.
        const visited = world.bfs(start, 4 + Math.round(g.curiosity * 6), swim);
        let best = null, bestScore = -Infinity;
        for (let k = 0; k < 7; k++) {
            const i = visited[Math.floor(Math.random() * visited.length)];
            const tl = world.tiles[i];
            if (!isWalkable(tl)) continue;
            const c = game.climate(tl);
            const dT = Math.abs(c.temp - g.prefTemp);
            let score = -dT / 25 - Math.abs(c.moisture - g.prefMoisture) / 80 + Math.random() * 0.3 + Math.min(tl.food, 1) * 0.2
                + world.bfsDist[i] * g.curiosity * 0.09;
            if (friend) {
                const fd = Math.hypot(friend.x - tl.x, friend.z - tl.z);
                score += (g.sociability - 0.4) * (1 - Math.min(fd, 8) / 8) * 1.2;
            }
            if (game.weatherBurn > 0.15 && tl.biome === B.FOREST) score += 0.6;
            if (score > bestScore) { bestScore = score; best = tl; }
        }
        if (!best || best === start) {
            this.action = 'idle';
            this.status = 'Looking around';
            return;
        }
        const label = game.weatherBurn > 0.15 && best.biome === B.FOREST ? 'Seeking shelter'
            : this.discomfort > 0.5 ? (this.coldSide ? 'Looking for warmth' : 'Looking for shade')
                : friend && g.sociability > 0.6 ? 'Joining friends' : g.curiosity > 0.65 ? 'Exploring' : 'Wandering';
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
        if (!this.game.world.passable(next, this.t.swimmer)) {
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
        const g = this.genes, game = this.game;
        const here = game.world.tileAt(this.x, this.z);
        let terrain;
        if (here && isWalkable(here)) {
            // More legs handle rough ground better but are a little slower on the flat.
            const legs = this.t.legs;
            const grip = legs === 2 ? 0 : legs === 4 ? 0.3 : 0.55;
            const flat = legs === 2 ? 1.06 : legs === 4 ? 1 : 0.92;
            const base = BIOMES[here.biome].speed;
            // Trampled paths are quick to walk. Claws are clumsy on the flat.
            terrain = (base + (1 - base) * grip) * flat * (1 - g.webbing * 0.1) * (1 + here.trail * 0.3) * (1 - g.claws * 0.12);
            here.trail = Math.min(1, here.trail + dt * 0.012 * (0.5 + g.size * 0.5) * (legs / 4));
        } else {
            terrain = 0.3 + g.webbing * 0.6 + g.tail * 0.15;
        }
        const wind = 1 - 0.15 * game.weather.now.wind * (1.25 - g.size * 0.25 - g.tail * 0.4);
        const panic = this.fleeTimer > 0 ? 1.4 : 1;
        const sick = 1 - Math.min(0.5, this.poison * 0.3) - (this.plague > 0 ? 0.25 : 0);
        const sp = sick * g.speed * terrain * (1 - g.plump * 0.12) * wind * panic * (this.adult ? 1 : 0.75) * dt;
        if (dist <= sp) { this.x = tx; this.z = tz; }
        else { this.x += dx / dist * sp; this.z += dz / dist * sp; }
        if (dist > 0.001) this.heading = Math.atan2(dx, dz);
        this.moving = true;
    }

    // Food this Nome could eat on a tile, as a rough energy value. Wary Nomes see warning colors.
    tileValue(tl) {
        if (this.avoid.has(tl.i)) return 0;
        const g = this.genes;
        if (tl.tox > 0.3 && g.palate > 0.45 && tl.tox - g.toxinRes * 0.8 > 0.15) return 0;
        const bloom = this.game.world.bloom[tl.i];
        if (tl.biome === B.WATER) return tl.food * (0.6 + g.webbing * 0.5) + bloom;
        let v = tl.food + bloom * 1.4 + tl.fruit * 1.5 + tl.shroom * 1.2 + tl.nuts * (0.6 + g.jaw * 1.8);
        if (g.claws > 0.3) v += tl.roots * (0.3 + g.claws);
        return v;
    }

    // Seconds one portion takes. Jaws crack nuts, claws dig roots, alert Nomes keep looking up.
    handleTime(kind) {
        const g = this.genes;
        let h = FOODS[kind].handle * 0.34;
        if (kind === 'nuts') h *= 1.5 - g.jaw * 1.2;
        else if (kind === 'roots') h *= 1.6 - g.claws * 1.3;
        else if (kind === 'seaweed') h *= 1.3 - g.webbing * 0.5;
        else h *= 1 + g.jaw * 0.15;
        return h * (1 + g.vigilance * 0.6);
    }

    amountOf(tile, kind) {
        if (kind === 'nectar') return this.game.world.bloom[tile.i];
        if (kind === 'greens' || kind === 'seaweed') return tile.food;
        return tile[kind];
    }

    chooseFood(tile) {
        const water = tile.biome === B.WATER;
        const kinds = water ? ['nectar', 'seaweed'] : ['nectar', 'fruit', 'nuts', 'shroom', 'greens', 'roots'];
        let best = null, bestV = 0;
        for (const k of kinds) {
            if (k === 'roots' && this.genes.claws < 0.3) continue;
            const a = this.amountOf(tile, k);
            if (a < 0.03) continue;
            const v = FOODS[k].energy * Math.min(a, 0.15) / this.handleTime(k);
            if (v > bestV) { bestV = v; best = k; }
        }
        return best;
    }

    // Eating comes in portions. Each takes time, and the Nome is distracted meanwhile.
    eat(dt, tile) {
        this.moving = false;
        const g = this.genes, game = this.game;
        if (this.energy >= this.t.maxEnergy - 2) { this.meal = null; this.action = 'idle'; this.thinkTimer = rand(0.2, 0.6); return; }
        if (!this.meal) {
            const kind = this.chooseFood(tile);
            if (!kind) { this.action = 'idle'; this.thinkTimer = rand(0.2, 0.6); return; }
            // A good taste catches poison before it is swallowed.
            const dose = tile.tox * FOODS[kind].tox;
            if (dose > 0.12 + g.toxinRes * 0.7 && Math.random() < g.palate * 0.85) {
                this.avoid.set(tile.i, game.time + 60);
                game.stats.poison.spat++;
                this.status = `Spat out bitter ${FOODS[kind].name.toLowerCase()}`;
                this.action = 'idle';
                this.thinkTimer = rand(0.3, 0.8);
                return;
            }
            const h = this.handleTime(kind);
            this.meal = { kind, t: h, total: h };
        }
        const kind = this.meal.kind;
        this.status = FOODS[kind].verb + (this.sharing > 0 && g.horns > 0.5 ? ', pushing others away' : g.vigilance > 0.6 ? ', looking around' : '');
        this.meal.t -= dt;
        if (this.meal.t > 0) return;
        this.meal = null;
        // When the patch is shared, horns win the food fight.
        const share = this.sharing > 0 ? 0.6 + g.horns * 0.8 : 1;
        const want = 0.12 * g.size * share;
        const got = Math.min(want, this.amountOf(tile, kind));
        if (got <= 0) return;
        if (kind === 'nectar') game.world.bloom[tile.i] -= got;
        else if (kind === 'greens' || kind === 'seaweed') tile.food -= got;
        else tile[kind] -= got;
        this.energy += got * FOODS[kind].energy;
        game.stats.food[kind] = (game.stats.food[kind] || 0) + got;
        if (kind === 'fruit') this.seeds = Math.min(1, this.seeds + got * 2);
        if (kind === 'greens' || kind === 'fruit' || kind === 'shroom') game.world.grazed(tile, got);
        const dose = tile.tox * FOODS[kind].tox;
        const harm = got * Math.max(0, dose - g.toxinRes) * 5;
        if (harm > 0.01) {
            if (this.poison < 0.2 && this.poison + harm >= 0.2) game.stats.poison.cases++;
            this.poison = Math.min(3, this.poison + harm);
            this.status = 'Feeling sick';
            if (this.poison > 0.25) this.avoid.set(tile.i, game.time + 90);
        }
    }

    // ---------- Work: burrows, dams, seeds and ditches ----------

    planWork(start) {
        const g = this.genes, world = this.game.world, game = this.game;
        const near = Array.from(world.bfs(start, 4, false));
        const dist = near.map(i => world.bfsDist[i]);
        let best = null, bestS = 0.12;
        near.forEach((i, k) => {
            const tl = world.tiles[i];
            if (!isWalkable(tl) || tl.fire > 0 || world.heat[i] > 0.2) return;
            const d = dist[k] * 0.06;
            const consider = (kind, target, score) => { if (score - d > bestS) { bestS = score - d; best = { kind, stand: tl, target }; } };
            if (g.claws > 0.25 && tl.biome !== B.ROCK && tl.biome !== B.MARSH && tl.burrow < 0.6) {
                consider('burrow', tl, g.claws * (1 - tl.burrow) * (game.seasonIndex >= 2 || game.hawks.length ? 0.9 : 0.5));
            }
            if (g.claws > 0.45 && tl.biome === B.MARSH) consider('drain', tl, g.claws * 0.5);
            if (this.seeds > 0.1 && g.builder > 0.2 && (tl.biome === B.SAND || (tl.biome === B.MEADOW && tl.food < 0.6))) {
                consider('plant', tl, g.builder * this.seeds * (tl.biome === B.SAND ? 1 : 0.7));
            }
            if (g.builder > 0.35) {
                for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                    const w = world.get(tl.x + dx, tl.z + dz);
                    if (w && w.biome === B.WATER && w.height >= 0.18) consider('dam', w, g.builder * (0.6 + w.work * 0.8));
                }
            }
        });
        if (!best) return false;
        this.pendingJob = best;
        if (best.stand === start) { this.startJob(); return true; }
        world.bfs(start, 5, false);
        this.walkTo(world.pathTo(best.stand.i), 'work', JOB_GO[best.kind]);
        return true;
    }

    startJob() {
        const j = this.pendingJob, g = this.genes;
        this.pendingJob = null;
        if (!j) { this.action = 'idle'; return; }
        const dur = j.kind === 'burrow' ? 7 / (0.4 + g.claws * 1.2) : j.kind === 'dam' ? 9 / (0.4 + g.builder * 1.1)
            : j.kind === 'plant' ? 4 / (0.4 + g.builder) : 8 / (0.4 + g.claws);
        this.job = { ...j, t: dur, total: dur };
        this.action = 'work';
        this.path = [];
        this.moving = false;
        this.status = JOB_TEXT[j.kind];
        if (j.target !== j.stand) this.heading = Math.atan2(j.target.x - this.x, j.target.z - this.z);
    }

    work(dt) {
        const j = this.job, g = this.genes, game = this.game, world = game.world;
        this.moving = false;
        if (!j || this.energy < this.t.maxEnergy * 0.3) { this.job = null; this.action = 'idle'; return; }
        j.t -= dt;
        this.status = JOB_TEXT[j.kind];
        if (j.t > 0) return;
        this.job = null;
        this.action = 'idle';
        this.thinkTimer = rand(0.3, 1);
        let changed = false, done = false;
        const t = j.target;
        if (j.kind === 'burrow') done = world.dig(t, 0.5);
        else if (j.kind === 'drain') changed = done = world.drain(t, 0.1 + g.claws * 0.12);
        else if (j.kind === 'plant') { changed = done = world.plant(t, 0.2 + g.builder * 0.15); this.seeds = Math.max(0, this.seeds - 0.3); }
        else if (j.kind === 'dam') changed = done = world.buildDam(t, 0.06 + g.builder * 0.08);
        const w = game.stats.work;
        if (j.kind === 'burrow' && done) w.burrows++;
        if (changed) {
            w[j.kind === 'dam' ? 'dams' : j.kind === 'plant' ? 'planted' : 'drained']++;
            game.onWork(j.kind, t, this);
        }
    }

    // ---------- Parents ----------

    tend(dt) {
        const ch = this.careChild;
        this.careT -= dt;
        const d = ch ? Math.hypot(ch.x - this.x, ch.z - this.z) : 99;
        if (!ch || ch.dead || ch.adult || this.careT <= 0 || this.energy < this.t.maxEnergy * 0.3 || d > 7) {
            if (ch && ch.guardian === this) ch.guardian = null;
            this.careChild = null;
            this.action = 'idle';
            this.thinkTimer = rand(0.3, 1);
            return;
        }
        this.status = `Caring for ${ch.name}`;
        if (d > 0.9) {
            const goal = this.game.world.tileAt(ch.x, ch.z);
            if (goal && isWalkable(goal)) this.stepToward(ch.x, ch.z, dt);
            else this.moving = false;
            return;
        }
        this.moving = false;
        // Parents pass on food to their young.
        const give = Math.min(this.energy - this.t.maxEnergy * 0.4, 2.5 * this.genes.care * dt);
        if (give > 0 && ch.energy < ch.t.maxEnergy - 2) {
            this.energy -= give;
            ch.energy += give * 0.9;
        }
    }

    // Runs for cover when a hawk dives. Swimmers may dive into water.
    flee() {
        const world = this.game.world;
        const start = world.tileAt(this.x, this.z);
        if (!start || this.dead || this.dragged) return;
        if (this.partner) this.stopCourting();
        this.fleeTimer = 3;
        this.meal = null;
        if (this.job) { this.job = null; }
        if (start.biome === B.FOREST) { this.status = 'Hiding under the trees'; return; }
        if (start.burrow > 0.35) { this.status = 'Hiding in a burrow'; return; }
        const near = world.bfs(start, 2, this.t.swimmer);
        for (const i of near) {
            const tl = world.tiles[i];
            if (tl.biome === B.FOREST || tl.burrow > 0.35 || (this.t.swimmer && tl.biome === B.WATER)) {
                this.walkTo(world.pathTo(i), 'escape', 'Fleeing from a hawk');
                return;
            }
        }
        this.status = 'Ducking from a hawk';
    }

    startCourting(p) {
        this.action = 'mate';
        this.partner = p;
        this.path = [];
        this.mateTimer = 0;
        this.mateGiveUp = 14;
        this.courtT = 0;
        // Picky Nomes court longer, attractive partners win them over faster.
        this.courtNeed = Math.max(0.6, 1.2 + this.genes.pickiness * 2.2 - p.t.attract * 0.6);
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
            this.courtT += dt;
            this.status = `Dancing for ${p.name}`;
            if (this.id < p.id && this.courtT >= this.courtNeed && p.courtT >= p.courtNeed * 0.5) this.game.breed(this, p);
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
            world.bfs(start, Math.ceil(this.sightNow) + 4, this.t.swimmer);
            if (!goal || !world.reached(goal.i)) { this.stopCourting(); return; }
            this.path = world.pathTo(goal.i);
        }
        if (this.path.length) {
            const next = this.path[0];
            this.stepToward(next.x, next.z, dt);
            if (Math.hypot(next.x - this.x, next.z - this.z) < 0.02) this.path.shift();
        }
    }

    cancelPlans() {
        if (this.partner) this.stopCourting();
        this.job = null;
        this.pendingJob = null;
        this.meal = null;
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

        const growth = 0.45 + 0.55 * Math.min(1, this.age / this.t.maturity);
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
            this.pivot.rotation.x = this.action === 'eat' ? 0.3 + Math.sin(time * (12 - this.genes.jaw * 4)) * 0.12
                : this.action === 'work' ? 0.45 + Math.sin(time * 16) * 0.25 : 0;
            if (this.action === 'work') for (const l of this.legs) l.hip.rotation.x = Math.sin(time * 16 + l.phase) * 0.5;
        }
        // Fast metabolism breathes faster.
        const breath = 2 + this.genes.metabolism * 4;
        const squash = this.action === 'rest' ? 0.86 : 1 + Math.sin(time * breath + this.id) * 0.02;
        this.body.scale.set(1 / Math.sqrt(squash), 0.92 * squash, 1 / Math.sqrt(squash));
        if (this.dragged) {
            for (const l of this.legs) l.hip.rotation.x = Math.sin(time * 14 + l.phase) * 0.9;
        }
        // Happy Nomes wag their tail.
        const wag = this.mood > 60 ? 0.45 : 0.12;
        this.tail.rotation.y = Math.sin(time * (this.mood > 60 ? 9 : 3) + this.id) * wag * anim;
        if (this.parts.antennae) this.parts.antennae.rotation.z = Math.sin(time * 3 + this.id) * 0.15;

        const mats = emoteMaterials();
        let emote = null;
        if (this.action === 'mate') emote = mats.love;
        else if (this.health < 35 || this.poison > 0.3 || this.plague > 0) emote = mats.sick;
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
            energy: r(this.energy), health: r(this.health), cooldown: r(this.cooldown), children: this.children,
            poison: r(this.poison), plague: r(this.plague), immuneT: r(this.immuneT)
        };
    }
}
