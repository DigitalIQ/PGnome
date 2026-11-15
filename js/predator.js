import * as THREE from 'three';
import { B, legCount, HAWK_GENES, LURKER_GENES, BIOMES } from './config.js';
import { isWalkable } from './world.js';
import { rand, clamp, gauss } from './rng.js';

// Predators evolve. Every hawk and lurker carries genes, needs prey to stay alive and
// breeds when it is well fed. Good hunters leave more young, so the hunters adapt to
// whatever the Nomes become: night hawks follow night Nomes, sharp eyes follow camouflage.

export function mixPredator(table, a, b, rate = 1) {
    const g = {};
    for (const [k, def] of Object.entries(table)) {
        const base = b ? (Math.random() < 0.5 ? a[k] : b[k]) : a[k];
        g[k] = clamp(base + gauss() * (def.max - def.min) * 0.08 * rate, def.min, def.max);
    }
    return g;
}

export function randomPredator(table, around) {
    const g = {};
    for (const [k, def] of Object.entries(table)) {
        const mid = around && typeof around[k] === 'number' ? around[k] : def.min + (def.max - def.min) * (k === 'night' || k === 'stealth' || k === 'camo' || k === 'venom' ? 0.15 : 0.45);
        g[k] = clamp(mid + gauss() * (def.max - def.min) * 0.12, def.min, def.max);
    }
    return g;
}

function cleanPredator(table, g) {
    if (!g) return null;
    const out = {};
    for (const [k, def] of Object.entries(table)) out[k] = clamp(typeof g[k] === 'number' ? g[k] : (def.min + def.max) / 2, def.min, def.max);
    return out;
}

// ---------- Hawks ----------

const bodyGeo = new THREE.ConeGeometry(0.15, 0.75, 6);
bodyGeo.rotateX(Math.PI / 2);
const headGeo = new THREE.SphereGeometry(0.11, 8, 6);
const beakGeo = new THREE.ConeGeometry(0.04, 0.12, 4);
beakGeo.rotateX(Math.PI / 2);
const wingGeo = new THREE.BoxGeometry(0.8, 0.025, 0.32);
wingGeo.translate(0.4, 0, 0);
const tailGeo = new THREE.BoxGeometry(0.26, 0.02, 0.26);
const beakMat = new THREE.MeshStandardMaterial({ color: 0xe0a640, roughness: 0.6 });
const dayFeather = new THREE.Color(0x5b4330), nightFeather = new THREE.Color(0x8d8f99), stealthFeather = new THREE.Color(0x9a8a6a);
const dayBelly = new THREE.Color(0xc9b08a), nightBelly = new THREE.Color(0xe8e6e0);

const CRUISE = 8.5;

export class Hawk {
    constructor(game, from, genes, opts = {}) {
        this.game = game;
        this.kind = 'hawk';
        this.genes = cleanPredator(HAWK_GENES, genes) || randomPredator(HAWK_GENES);
        const c = game.world.center;
        this.pos = new THREE.Vector3(from.x, from.y ?? CRUISE + 2, from.z);
        this.vel = new THREE.Vector3();
        this.circle = new THREE.Vector3(c, CRUISE, c);
        this.angle = Math.random() * Math.PI * 2;
        this.radius = rand(4, 7);
        this.state = 'circle';
        this.cool = rand(4, 8);
        this.target = null;
        this.diveT = 0;
        this.leaving = false;
        this.gone = false;
        this.energy = opts.energy ?? 70;
        this.age = opts.age ?? 0;
        this.gen = opts.gen ?? 1;
        this.flap = Math.random() * 10;
        this.tmp = new THREE.Vector3();
        this.tmp2 = new THREE.Vector3();
        this.build();
    }

    build() {
        const ge = this.genes;
        this.featherMat = new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true });
        this.featherMat.color.copy(dayFeather).lerp(nightFeather, ge.night).lerp(stealthFeather, ge.stealth * 0.4);
        this.bellyMat = new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true });
        this.bellyMat.color.copy(dayBelly).lerp(nightBelly, ge.night);
        const g = new THREE.Group();
        const body = new THREE.Mesh(bodyGeo, this.featherMat);
        body.castShadow = true;
        g.add(body);
        const belly = new THREE.Mesh(headGeo, this.bellyMat);
        belly.scale.set(1.1, 0.8, 1.6);
        belly.position.set(0, -0.05, 0.05);
        g.add(belly);
        // Night hunters grow a round owl head with big eyes.
        const head = new THREE.Mesh(headGeo, this.featherMat);
        head.position.set(0, 0.05, 0.38);
        head.scale.setScalar(1 + ge.night * 0.5);
        g.add(head);
        const beak = new THREE.Mesh(beakGeo, beakMat);
        beak.position.set(0, 0.02, 0.5 + ge.night * 0.04);
        g.add(beak);
        const tail = new THREE.Mesh(tailGeo, this.featherMat);
        tail.position.set(0, 0, -0.42);
        tail.castShadow = true;
        g.add(tail);
        this.wings = [];
        // Fast divers have narrow wings, stealthy gliders broad ones.
        const span = 0.85 + ge.stealth * 0.35 - (ge.dive - 1) * 0.3;
        for (const side of [-1, 1]) {
            const w = new THREE.Mesh(wingGeo, this.featherMat);
            w.scale.set(side * span, 1, 1 + ge.stealth * 0.3);
            w.position.set(side * 0.06, 0.02, 0.02);
            w.castShadow = true;
            g.add(w);
            this.wings.push(w);
        }
        g.scale.setScalar(0.75 + ge.size * 0.3);
        this.mesh = g;
        this.game.scene.add(g);
    }

    // Day hunters see by daylight, night hunters by moonlight.
    get vision() {
        const g = this.game, ge = this.genes, light = 1 - g.night;
        const eyesNow = light * (1 - ge.night * 0.55) + g.night * (0.15 + ge.night * 0.95);
        return ge.eyes * eyesNow * g.sightMul;
    }

    get canHunt() {
        const g = this.game, w = g.weather.now;
        return g.hawksOn && this.vision > 0.4 && w.fog < 0.75 && (w.rain || 0) < 1.5 && (w.snow || 0) < 1.5 && (w.wind || 0) < 0.85 && (w.dust || 0) < 0.5;
    }

    // ---------- Simulation ----------

    step(dt) {
        const g = this.game, ge = this.genes;
        this.age += dt;
        // Bigger and faster birds need more food.
        this.energy -= (0.3 + ge.size * 0.18 + (ge.dive - 1) * 0.12 + ge.night * 0.04) * dt;
        if (this.leaving || (!this.canHunt && this.state !== 'dive')) {
            this.flyAway(dt);
            return;
        }
        if (this.away) {
            this.away = false;
            this.state = 'circle';
        }
        if (this.state === 'circle') {
            this.angle += dt * (0.45 - ge.stealth * 0.12);
            const goal = this.tmp.set(this.circle.x + Math.cos(this.angle) * this.radius, CRUISE, this.circle.z + Math.sin(this.angle) * this.radius);
            this.steer(goal, 5, dt);
            this.cool -= dt;
            if (this.cool <= 0) this.hunt();
        } else if (this.state === 'dive') {
            this.diveT += dt;
            const t = this.target;
            if (!t || t.dead) { this.endDive(false); return; }
            const goal = this.tmp.set(t.x, t.y + 0.35, t.z);
            this.steer(goal, 10 * ge.dive, dt);
            if (this.pos.distanceTo(goal) < 0.45 || this.diveT > 3.2) this.strike();
        } else if (this.state === 'climb') {
            const goal = this.tmp.set(this.pos.x + this.vel.x, CRUISE, this.pos.z + this.vel.z);
            this.steer(goal, 5, dt);
            if (this.pos.y > CRUISE - 0.5) this.state = 'circle';
        }
    }

    steer(goal, speed, dt) {
        const d = this.tmp2.copy(goal).sub(this.pos);
        const len = d.length();
        if (len > 0.001) d.multiplyScalar(speed / len);
        this.vel.lerp(d, Math.min(1, dt * 2.5));
        this.pos.addScaledVector(this.vel, dt);
    }

    flyAway(dt) {
        const c = this.game.world.center;
        const dir = this.tmp.set(this.pos.x - c, 0, this.pos.z - c);
        if (dir.lengthSq() < 0.01) dir.set(1, 0, 0);
        dir.normalize().multiplyScalar(60);
        dir.x += c;
        dir.z += c;
        dir.y = CRUISE + 4;
        this.steer(dir, 7, dt);
        this.state = 'circle';
        this.target = null;
        if (Math.hypot(this.pos.x - c, this.pos.z - c) > 45) {
            if (this.leaving) this.gone = true;
            else this.away = true;
        }
    }

    // Picks prey near the circle. Small, lone, colorful, busy and sleeping Nomes are easier.
    hunt() {
        const g = this.game, world = g.world, ge = this.genes;
        const range = 7 + this.vision * 4;
        let total = 0;
        const options = [];
        for (const c of g.creatures) {
            if (c.dead || c.dragged) continue;
            const tile = world.tileAt(c.x, c.z);
            if (!tile || !isWalkable(tile) || tile.biome === B.FOREST || tile.burrow > 0.35) continue;
            const d = Math.hypot(c.x - this.pos.x, c.z - this.pos.z);
            if (d > range) continue;
            const grown = Math.min(1, c.age / c.maturity);
            const size = c.genes.size * (0.45 + 0.55 * grown);
            // Big hawks dare to take bigger Nomes.
            let w = clamp(1.6 - size * 0.7 + (ge.size - 1) * 0.6, 0.15, 1.6);
            if (c.genes.pattern >= 0.4) w *= 1.4;
            if (c.genes.pigment > 0.7 && tile.biome !== B.SAND) w *= 1.25;
            if (c.huddle === 0) w *= 1.5;
            w *= 1 + c.distraction * 0.6;
            if (c.guardian && !c.guardian.dead && Math.hypot(c.guardian.x - c.x, c.guardian.z - c.z) < 1.5) w *= 0.5;
            w *= 1 - d / (range + 3);
            options.push([c, w]);
            total += w;
        }
        if (!options.length) {
            const open = g.creatures.filter(c => { const t = world.tileAt(c.x, c.z); return t && isWalkable(t) && t.biome !== B.FOREST; });
            if (open.length) {
                const c = open[Math.floor(Math.random() * open.length)];
                this.circle.set(c.x, CRUISE, c.z);
            }
            this.cool = rand(3, 6);
            return;
        }
        let best = null, r = Math.random() * total;
        for (const [c, w] of options) { r -= w; if (r <= 0) { best = c; break; } }
        best = best || options[0][0];
        this.target = best;
        g.stats.hawk.dives++;
        this.state = 'dive';
        this.diveT = 0;
        this.circle.set(best.x, CRUISE, best.z);

        // Will the Nome notice in time? Eyes, alertness and company help. Busy Nomes notice late.
        const c = best, cg = c.genes;
        const notice = clamp((0.08 + (c.sightNow / 10) * 0.32 + (c.t.eyes - 2) * 0.1 + Math.min(3, c.huddle) * 0.08 * (0.5 + cg.sociability)
            + cg.vigilance * 0.25) * (1 - c.distraction * 0.6) * (1 - ge.stealth * 0.45), 0.03, 0.92);
        if (Math.random() < notice) c.flee();
    }

    strike() {
        const g = this.game, c = this.target, ge = this.genes;
        let caught = false;
        if (c && !c.dead) {
            const tile = g.world.tileAt(c.x, c.z);
            const covered = !tile || tile.biome === B.FOREST || tile.burrow > 0.35 || (tile.biome === B.WATER && c.t.swimmer);
            if (!covered) {
                const grown = Math.min(1, c.age / c.maturity);
                const size = c.genes.size * (0.45 + 0.55 * grown);
                let chance = 0.8 * clamp(1.35 - size * 0.45 + (ge.size - 1) * 0.4, 0.3, 1.2);
                // Horns scare small hawks, big hawks less so.
                if (c.genes.horns > 0.6) chance *= clamp(0.55 + (ge.size - 1) * 0.5, 0.4, 0.9);
                // A fleeing Nome has a head start, unless the dive is very fast.
                if (c.fleeTimer > 0) chance *= clamp(0.55 + (ge.dive - 1) * 0.5, 0.4, 0.85);
                if (legCount(c.genes.legs) === 6) chance *= 0.9;
                if (c.huddle >= 2) chance *= 0.8;
                if (c.guardian && !c.guardian.dead && Math.hypot(c.guardian.x - c.x, c.guardian.z - c.z) < 1.5) chance *= c.guardian.genes.horns > 0.5 ? 0.45 : 0.7;
                caught = Math.random() < chance;
            }
            if (caught) {
                g.stats.hawk.catches++;
                this.energy += 35 + c.genes.size * 25;
                g.burst(c.x, c.y + 0.4, c.z, 'spark', 0x8a6a48, 8);
                g.kill(c, 'was caught by a hawk');
            } else if (!c.dead) {
                g.stats.hawk.escapes++;
                c.status = covered ? 'Safe in cover' : 'Escaped a hawk';
                g.burst(this.pos.x, this.pos.y, this.pos.z, 'spark', 0xd8c8a8, 4);
            }
        }
        this.endDive(caught);
    }

    endDive(fed) {
        this.state = 'climb';
        this.target = null;
        this.cool = fed ? rand(14, 22) : rand(2, 4);
    }

    // ---------- Rendering ----------

    render(dt) {
        const m = this.mesh;
        m.visible = !this.gone;
        m.position.copy(this.pos);
        if (this.vel.lengthSq() > 0.01) {
            this.tmp2.copy(this.pos).add(this.vel);
            m.lookAt(this.tmp2);
        }
        if (this.state === 'circle') m.rotateZ(-0.35);
        const diving = this.state === 'dive';
        this.flap += dt * (this.state === 'climb' ? 14 : 5);
        const a = diving ? -0.9 : Math.sin(this.flap) * (this.state === 'climb' ? 0.6 : 0.18);
        this.wings[0].rotation.z = a;
        this.wings[1].rotation.z = -a;
    }

    dispose() {
        this.game.scene.remove(this.mesh);
        this.featherMat.dispose();
        this.bellyMat.dispose();
    }

    serialize() {
        const r = v => Math.round(v * 1000) / 1000;
        const genes = {};
        for (const k in this.genes) genes[k] = r(this.genes[k]);
        return { kind: 'hawk', genes, energy: r(this.energy), age: r(this.age), gen: this.gen };
    }
}

// ---------- Lurkers ----------
// Snake-like ambush hunters. They lie still in marsh, forest or meadow and strike at
// Nomes that walk by without noticing them. Forests hide Nomes from hawks, but not from these.

const segGeo = new THREE.SphereGeometry(0.1, 8, 6);
const eyeGeo = new THREE.SphereGeometry(0.022, 6, 4);
const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffd23a });
const SEGS = 7;
const lurkBase = new THREE.Color(0x4a6b2a);

export class Lurker {
    constructor(game, tile, genes, opts = {}) {
        this.game = game;
        this.kind = 'lurker';
        this.genes = cleanPredator(LURKER_GENES, genes) || randomPredator(LURKER_GENES);
        this.x = tile.x;
        this.z = tile.z;
        this.y = tile.rh;
        this.energy = opts.energy ?? 70;
        this.age = opts.age ?? 0;
        this.gen = opts.gen ?? 1;
        this.idle = 0;
        this.path = [];
        this.state = 'wait';
        this.strikeT = 0;
        this.cool = 3;
        this.heading = Math.random() * Math.PI * 2;
        this.gone = false;
        this.phase = Math.random() * 10;
        this.build();
    }

    build() {
        this.mat = new THREE.MeshStandardMaterial({ color: lurkBase, roughness: 0.8, flatShading: true });
        const g = new THREE.Group();
        this.segs = [];
        for (let k = 0; k < SEGS; k++) {
            const m = new THREE.Mesh(segGeo, this.mat);
            const s = (k === 0 ? 1.15 : 1 - k * 0.08) * (0.7 + this.genes.size * 0.35);
            m.scale.set(s, s * 0.7, s * 1.2);
            m.castShadow = true;
            g.add(m);
            this.segs.push(m);
        }
        for (const side of [-1, 1]) {
            const e = new THREE.Mesh(eyeGeo, eyeMat);
            e.position.set(side * 0.06, 0.05, 0.08);
            this.segs[0].add(e);
        }
        this.mesh = g;
        this.game.scene.add(g);
    }

    get habitatOk() {
        const t = this.game.world.tileAt(this.x, this.z);
        return t && isWalkable(t) && t.biome !== B.SAND && t.biome !== B.ROCK;
    }

    // How well this lurker suits a tile: marsh lovers or forest lovers.
    likes(t) {
        if (!isWalkable(t) || t.lava > 0 || t.fire > 0) return -1;
        const f = this.genes.habitat;
        return t.biome === B.MARSH ? 1 - f : t.biome === B.FOREST ? 0.3 + f * 0.7 : t.biome === B.MEADOW ? 0.35 : 0.05;
    }

    step(dt) {
        const g = this.game, world = g.world, ge = this.genes;
        this.age += dt;
        // Cold-blooded: lurkers burn little, but winter slows them down.
        const cold = g.seasonIndex === 3 ? 0.5 : 1;
        this.energy -= (0.13 + ge.size * 0.07 + ge.venom * 0.04) * dt * cold;
        const here = world.tileAt(this.x, this.z);
        if (!here || here.biome === B.LAVA || here.fire > 0 || !isWalkable(here)) {
            if (here && (here.biome === B.LAVA || here.fire > 0)) { this.energy = -1; return; }
            this.relocate(true);
        }
        if (this.state === 'move') {
            const next = this.path[0];
            if (!next || !isWalkable(next)) { this.state = 'wait'; this.path = []; return; }
            const dx = next.x - this.x, dz = next.z - this.z, d = Math.hypot(dx, dz);
            const sp = 0.6 * ge.strike * cold * dt;
            if (d <= sp) { this.x = next.x; this.z = next.z; this.path.shift(); }
            else { this.x += dx / d * sp; this.z += dz / d * sp; }
            if (d > 0.001) this.heading = Math.atan2(dx, dz);
            if (!this.path.length) this.state = 'wait';
            return;
        }
        if (this.state === 'strike') {
            this.strikeT += dt;
            if (this.strikeT > 0.6) { this.state = 'wait'; this.strikeT = 0; }
            return;
        }
        this.cool -= dt;
        this.idle += dt;
        if (this.cool <= 0 && g.hawksOn) this.ambush();
        if (this.idle > 35 || this.likes(here) < 0.2) this.relocate(false);
    }

    ambush() {
        const g = this.game, ge = this.genes;
        const reach = 0.7 + ge.strike * 0.3;
        for (const c of g.creatures) {
            if (c.dead || c.dragged) continue;
            const d = Math.hypot(c.x - this.x, c.z - this.z);
            if (d > reach) continue;
            this.cool = 2.5;
            this.idle = 0;
            this.state = 'strike';
            this.strikeT = 0;
            this.heading = Math.atan2(c.x - this.x, c.z - this.z);
            g.stats.lurker.strikes++;
            // Did the Nome see it? Camouflage against eyes and alertness.
            const cg = c.genes;
            const notice = clamp(0.12 + cg.vigilance * 0.45 + (c.t.eyes - 2) * 0.1 + (c.sightNow / 10) * 0.2 - ge.camo * 0.45, 0.03, 0.9)
                * (1 - c.distraction * 0.5);
            if (Math.random() < notice) {
                g.stats.lurker.escapes++;
                c.status = 'Jumped away from a lurker';
                c.flee();
                return;
            }
            const grown = Math.min(1, c.age / c.maturity);
            const size = cg.size * (0.45 + 0.55 * grown);
            let chance = clamp(0.38 * ge.strike - (size - ge.size) * 0.4, 0.05, 0.75);
            if (cg.horns > 0.6) chance *= 0.7;
            if (legCount(cg.legs) === 6) chance *= 0.85;
            if (c.guardian && !c.guardian.dead && Math.hypot(c.guardian.x - c.x, c.guardian.z - c.z) < 1.5) chance *= 0.6;
            if (Math.random() < chance) {
                g.stats.lurker.catches++;
                this.energy += 30 + size * 25;
                // A full lurker digests for a long while.
                this.cool = rand(25, 40);
                g.burst(c.x, c.y + 0.3, c.z, 'spark', 0x6b8a3a, 7);
                g.kill(c, 'was caught by a lurker');
                return;
            }
            // A bite that does not kill still poisons, unless the Nome tolerates venom.
            const venom = ge.venom * (1 - cg.toxinRes * 0.8);
            c.health -= 10 + venom * 25;
            c.lastHarm = 'died of a lurker bite';
            c.poison = Math.min(3, c.poison + venom * 0.8);
            g.stats.lurker.escapes++;
            c.status = venom > 0.2 ? 'Bitten by a lurker, feeling sick' : 'Shook off a lurker';
            c.flee();
            if (c.health <= 0) g.kill(c, 'was caught by a lurker');
            return;
        }
        this.cool = 0.5;
    }

    // Moves to a better spot, closer to where Nomes walk.
    relocate(force) {
        const world = this.game.world;
        const start = world.tileAt(this.x, this.z);
        if (!start) return;
        const visited = Array.from(world.bfs(start, 6, false));
        let best = null, bestS = force ? -Infinity : this.likes(start) + 0.15;
        for (let k = 0; k < 12 && visited.length; k++) {
            const i = visited[Math.floor(Math.random() * visited.length)];
            const t = world.tiles[i];
            let s = this.likes(t) + t.trail * 0.4 + Math.random() * 0.2;
            for (const c of this.game.creatures) if (Math.abs(c.x - t.x) < 2 && Math.abs(c.z - t.z) < 2) s += 0.08;
            if (s > bestS) { bestS = s; best = t; }
        }
        this.idle = 0;
        if (!best) return;
        world.bfs(start, 6, false);
        this.path = world.pathTo(best.i);
        if (this.path.length) this.state = 'move';
    }

    render(dt) {
        const world = this.game.world;
        const t = world.tileAt(this.x, this.z);
        if (t) this.y += ((isWalkable(t) ? t.rh : 0.3) - this.y) * Math.min(1, dt * 8);
        this.phase += dt;
        // Camouflage blends the skin into the ground it lies on.
        if (t) this.mat.color.copy(lurkBase).lerp(world.materials[t.biome].color, this.genes.camo * 0.75);
        const moving = this.state === 'move', striking = this.state === 'strike';
        const lunge = striking ? Math.sin(Math.min(1, this.strikeT / 0.3) * Math.PI) * 0.45 : 0;
        const sin = Math.sin(this.heading), cos = Math.cos(this.heading);
        for (let k = 0; k < SEGS; k++) {
            const back = k * 0.13 - lunge * (1 - k / SEGS);
            const wiggle = Math.sin(this.phase * (moving ? 8 : 1.2) - k * 0.9) * (moving ? 0.08 : 0.03);
            const s = this.segs[k];
            s.position.set(this.x - sin * back + cos * wiggle, this.y + 0.06 + (k === 0 ? 0.04 + lunge * 0.3 : 0), this.z - cos * back - sin * wiggle);
            s.rotation.y = this.heading;
        }
    }

    dispose() {
        this.game.scene.remove(this.mesh);
        this.mat.dispose();
    }

    serialize() {
        const r = v => Math.round(v * 1000) / 1000;
        const genes = {};
        for (const k in this.genes) genes[k] = r(this.genes[k]);
        return { kind: 'lurker', genes, energy: r(this.energy), age: r(this.age), gen: this.gen, x: r(this.x), z: r(this.z) };
    }
}

export const LURKER_HOME = [B.MARSH, B.FOREST, B.MEADOW];
export { BIOMES };
