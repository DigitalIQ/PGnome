import * as THREE from 'three';
import { GENES, BIOMES, MATURITY_AGE, MAX_POP } from './config.js';
import { rand, clamp, lerp, gauss, randomName } from './rng.js';
import { isWalkable } from './world.js';
import { emoteMaterials } from './icons.js';

const legGeo = new THREE.CylinderGeometry(0.05, 0.045, 1, 6);
legGeo.translate(0, -0.5, 0);
const geo = {
    body: new THREE.SphereGeometry(0.32, 20, 14),
    eye: new THREE.SphereGeometry(1, 12, 8),
    ear: new THREE.ConeGeometry(1, 1, 6),
    tail: new THREE.SphereGeometry(1, 8, 6),
    leg: legGeo,
    hit: new THREE.SphereGeometry(0.6, 8, 6)
};
const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25 });
const pupilMat = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });

let nextId = 1;
export const setNextId = n => { nextId = Math.max(nextId, n); };
export const getNextId = () => nextId;

export function randomGenes(climate) {
    const g = {};
    for (const [k, def] of Object.entries(GENES)) g[k] = rand(def.min, def.max);
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
        this.genes = genes;
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
        const cold = this.genes.prefTemp < 35;
        return new THREE.Color().setHSL(this.genes.hue / 360, cold ? 0.32 : 0.55, cold ? 0.7 : 0.56);
    }

    buildMesh() {
        const g = this.genes;
        this.material = new THREE.MeshStandardMaterial({ color: this.color, roughness: g.prefTemp < 35 ? 1 : 0.55 });
        const root = new THREE.Group();
        root.userData.creature = this;

        this.legLen = 0.06 + g.speed * 0.07;
        this.legs = [];
        for (const side of [-1, 1]) {
            const hip = new THREE.Group();
            hip.position.set(side * 0.12, this.legLen + 0.06, 0.02);
            const leg = new THREE.Mesh(geo.leg, this.material);
            leg.scale.y = this.legLen + 0.06;
            leg.castShadow = true;
            hip.add(leg);
            root.add(hip);
            this.legs.push(hip);
        }

        const pivot = new THREE.Group();
        pivot.position.y = this.legLen;
        root.add(pivot);
        this.pivot = pivot;

        const body = new THREE.Mesh(geo.body, this.material);
        body.position.y = 0.3;
        body.scale.set(1, 0.92, 1.05);
        body.castShadow = true;
        pivot.add(body);
        this.body = body;

        const eyeSize = 0.05 + ((g.sight - 3) / 7) * 0.045;
        for (const side of [-1, 1]) {
            const eye = new THREE.Mesh(geo.eye, eyeMat);
            eye.scale.setScalar(eyeSize);
            eye.position.set(side * 0.12, 0.38, 0.26);
            const pupil = new THREE.Mesh(geo.eye, pupilMat);
            pupil.scale.setScalar(0.55);
            pupil.position.set(0, 0, 0.6);
            eye.add(pupil);
            pivot.add(eye);
        }

        // Heat lovers grow big ears, cold lovers small round ones.
        const heat = g.prefTemp / 100;
        const earLen = 0.07 + heat * 0.28;
        const earW = 0.05 + heat * 0.04;
        for (const side of [-1, 1]) {
            const ear = new THREE.Mesh(geo.ear, this.material);
            ear.scale.set(earW, earLen, earW * 0.6);
            ear.position.set(side * 0.16, 0.55 + earLen * 0.4, -0.02);
            ear.rotation.z = -side * 0.4;
            ear.castShadow = true;
            pivot.add(ear);
        }

        const tail = new THREE.Mesh(geo.tail, this.material);
        tail.scale.setScalar(0.07 + g.sociability * 0.05);
        tail.position.set(0, 0.24, -0.32);
        pivot.add(tail);

        const hit = new THREE.Mesh(geo.hit, hitMat);
        hit.position.y = 0.35;
        hit.userData.creature = this;
        root.add(hit);
        this.hit = hit;

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
        const climate = world.climate(tile, game.seasonTemp);
        const dT = climate.temp - g.prefTemp;
        // Big bodies keep warm (Bergmann's rule), small ones shed heat.
        const tdiff = dT < 0 ? -dT / g.size : dT * (0.55 + 0.45 * g.size);
        const d = Math.max(0, tdiff - 12) / 32 + Math.max(0, Math.abs(climate.moisture - g.prefMoisture) - 20) / 90;
        this.discomfort = d;
        this.coldSide = dT < 0;
        const inWater = !isWalkable(tile);

        let burn = 0.45 + 0.5 * Math.pow(g.size, 1.5) + 0.03 * g.sight + (g.lifespan - 90) * 0.0015 + d * 1.1;
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
            if (dd > 1.2 && dd < friendD && dd < g.sight + 2) { friendD = dd; friend = o; }
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
            const visited = world.bfs(start, Math.ceil(g.sight));
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
            const c = world.climate(t, game.seasonTemp);
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
        const terrain = here && isWalkable(here) ? BIOMES[here.biome].speed : 0.45;
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
        let ground = tile ? (isWalkable(tile) ? tile.rh : tile.rh - 0.18) : 0;
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
            this.legs[0].rotation.x = s * 0.7;
            this.legs[1].rotation.x = -s * 0.7;
            this.pivot.position.y = this.legLen + Math.abs(s) * 0.06;
            this.pivot.rotation.x = 0.08;
        } else {
            this.legs[0].rotation.x *= 0.8;
            this.legs[1].rotation.x *= 0.8;
            this.pivot.position.y = this.legLen;
            this.pivot.rotation.x = this.action === 'eat' ? 0.3 + Math.sin(time * 12) * 0.12 : 0;
        }
        const squash = this.action === 'rest' ? 0.86 : 1 + Math.sin(time * 2 + this.id) * 0.015;
        this.body.scale.set(1 / Math.sqrt(squash), 0.92 * squash, 1.05 / Math.sqrt(squash));
        if (this.dragged) {
            this.legs[0].rotation.x = Math.sin(time * 14) * 0.9;
            this.legs[1].rotation.x = -Math.sin(time * 14) * 0.9;
        }

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
        this.material.dispose();
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
