import * as THREE from 'three';
import { B, legCount } from './config.js';
import { isWalkable } from './world.js';
import { rand, clamp, lerp } from './rng.js';

// Hawks hunt by day. They circle over open ground and dive on Nomes that are small,
// alone, easy to spot or asleep in the open. Forests and water give cover.

const bodyGeo = new THREE.ConeGeometry(0.15, 0.75, 6);
bodyGeo.rotateX(Math.PI / 2);
const headGeo = new THREE.SphereGeometry(0.11, 8, 6);
const beakGeo = new THREE.ConeGeometry(0.04, 0.12, 4);
beakGeo.rotateX(Math.PI / 2);
const wingGeo = new THREE.BoxGeometry(0.8, 0.025, 0.32);
wingGeo.translate(0.4, 0, 0);
const tailGeo = new THREE.BoxGeometry(0.26, 0.02, 0.26);
const featherMat = new THREE.MeshStandardMaterial({ color: 0x5b4330, roughness: 0.9, flatShading: true });
const bellyMat = new THREE.MeshStandardMaterial({ color: 0xc9b08a, roughness: 0.9, flatShading: true });
const beakMat = new THREE.MeshStandardMaterial({ color: 0xe0a640, roughness: 0.6 });

const CRUISE = 8.5;

export class Hawk {
    constructor(game, from) {
        this.game = game;
        const c = game.world.center;
        this.pos = new THREE.Vector3(from.x, CRUISE + 2, from.z);
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
        this.flap = Math.random() * 10;
        this.tmp = new THREE.Vector3();
        this.tmp2 = new THREE.Vector3();
        this.build();
    }

    build() {
        const g = new THREE.Group();
        const body = new THREE.Mesh(bodyGeo, featherMat);
        body.castShadow = true;
        g.add(body);
        const belly = new THREE.Mesh(headGeo, bellyMat);
        belly.scale.set(1.1, 0.8, 1.6);
        belly.position.set(0, -0.05, 0.05);
        g.add(belly);
        const head = new THREE.Mesh(headGeo, featherMat);
        head.position.set(0, 0.05, 0.38);
        g.add(head);
        const beak = new THREE.Mesh(beakGeo, beakMat);
        beak.position.set(0, 0.02, 0.5);
        g.add(beak);
        const tail = new THREE.Mesh(tailGeo, featherMat);
        tail.position.set(0, 0, -0.42);
        tail.castShadow = true;
        g.add(tail);
        this.wings = [];
        for (const side of [-1, 1]) {
            const w = new THREE.Mesh(wingGeo, featherMat);
            w.scale.x = side;
            w.position.set(side * 0.06, 0.02, 0.02);
            w.castShadow = true;
            g.add(w);
            this.wings.push(w);
        }
        this.mesh = g;
        this.game.scene.add(g);
    }

    get canHunt() {
        const g = this.game, w = g.weather.now;
        return g.hawksOn && g.sunHeight > -0.05 && w.fog < 0.7 && (w.rain || 0) < 1.5 && (w.snow || 0) < 1.5 && (w.wind || 0) < 0.85 && (w.dust || 0) < 0.5;
    }

    // ---------- Simulation ----------

    step(dt) {
        const g = this.game;
        if (this.leaving || (!this.canHunt && this.state !== 'dive')) {
            this.flyAway(dt);
            return;
        }
        if (this.away) {
            // Coming back after night or bad weather.
            this.away = false;
            this.state = 'circle';
        }
        if (this.state === 'circle') {
            this.angle += dt * 0.45;
            const goal = this.tmp || (this.tmp = new THREE.Vector3());
            goal.set(this.circle.x + Math.cos(this.angle) * this.radius, CRUISE, this.circle.z + Math.sin(this.angle) * this.radius);
            this.steer(goal, 5, dt);
            this.cool -= dt;
            if (this.cool <= 0) this.hunt();
        } else if (this.state === 'dive') {
            this.diveT += dt;
            const t = this.target;
            if (!t || t.dead) { this.endDive(false); return; }
            const goal = this.tmp.set(t.x, t.y + 0.35, t.z);
            this.steer(goal, 10, dt);
            if (this.pos.distanceTo(goal) < 0.45 || this.diveT > 3.2) this.strike();
        } else if (this.state === 'climb') {
            const goal = this.tmp.set(this.pos.x + this.vel.x, CRUISE, this.pos.z + this.vel.z);
            this.steer(goal, 5, dt);
            if (this.pos.y > CRUISE - 0.5) this.state = 'circle';
        }
    }

    steer(goal, speed, dt) {
        const d = goal.clone().sub(this.pos);
        const len = d.length();
        if (len > 0.001) d.multiplyScalar(speed / len);
        this.vel.lerp(d, Math.min(1, dt * 2.5));
        this.pos.addScaledVector(this.vel, dt);
    }

    flyAway(dt) {
        const c = this.game.world.center;
        const dir = this.tmp || (this.tmp = new THREE.Vector3());
        dir.set(this.pos.x - c, 0, this.pos.z - c);
        if (dir.lengthSq() < 0.01) dir.set(1, 0, 0);
        dir.normalize().multiplyScalar(60).add(new THREE.Vector3(c, CRUISE + 4, c));
        this.steer(dir, 7, dt);
        this.state = 'circle';
        this.target = null;
        if (Math.hypot(this.pos.x - c, this.pos.z - c) > 45) {
            if (this.leaving) this.gone = true;
            else this.away = true;
        }
    }

    // Picks prey near the circle. Small, lone, colorful and sleeping Nomes are easier to see.
    hunt() {
        const g = this.game, world = g.world;
        let best = null, bestW = 0, total = 0;
        const options = [];
        for (const c of g.creatures) {
            if (c.dead || c.dragged) continue;
            const tile = world.tileAt(c.x, c.z);
            if (!tile || !isWalkable(tile) || tile.biome === B.FOREST) continue;
            const d = Math.hypot(c.x - this.pos.x, c.z - this.pos.z);
            if (d > 11) continue;
            const grown = Math.min(1, c.age / c.maturity);
            const size = c.genes.size * (0.45 + 0.55 * grown);
            let w = clamp(1.6 - size * 0.7, 0.2, 1.4);
            if (c.genes.pattern >= 0.4) w *= 1.4;
            if (c.genes.pigment > 0.7 && tile.biome !== B.SAND) w *= 1.25;
            if (c.huddle === 0) w *= 1.5;
            if (c.status === 'Sleeping') w *= 1.6;
            w *= 1 - d / 14;
            options.push([c, w]);
            total += w;
        }
        if (!options.length) {
            // Nothing in reach: drift towards a random Nome on open ground.
            const open = g.creatures.filter(c => { const t = world.tileAt(c.x, c.z); return t && isWalkable(t) && t.biome !== B.FOREST; });
            if (open.length) {
                const c = open[Math.floor(Math.random() * open.length)];
                this.circle.set(c.x, CRUISE, c.z);
            }
            this.cool = rand(3, 6);
            return;
        }
        let r = Math.random() * total;
        for (const [c, w] of options) { r -= w; if (r <= 0) { best = c; bestW = w; break; } }
        best = best || options[0][0];
        this.target = best;
        g.stats.hawk.dives++;
        this.state = 'dive';
        this.diveT = 0;
        this.circle.set(best.x, CRUISE, best.z);

        // Will the Nome notice in time? Good eyes, extra eyes and company help.
        const c = best, ge = c.genes;
        const asleep = c.status === 'Sleeping';
        const notice = clamp(0.08 + (c.sightNow / 10) * 0.32 + (c.t.eyes - 2) * 0.1 + Math.min(3, c.huddle) * 0.08 * (0.5 + ge.sociability)
            - (asleep ? 0.25 : 0), 0.05, 0.92);
        if (Math.random() < notice) c.flee();
    }

    strike() {
        const g = this.game, c = this.target;
        let caught = false;
        if (c && !c.dead) {
            const tile = g.world.tileAt(c.x, c.z);
            const covered = !tile || tile.biome === B.FOREST || (tile.biome === B.WATER && c.t.swimmer);
            if (!covered) {
                const grown = Math.min(1, c.age / c.maturity);
                const size = c.genes.size * (0.45 + 0.55 * grown);
                let chance = 0.8 * clamp(1.35 - size * 0.45, 0.4, 1.2);
                if (c.genes.horns > 0.6) chance *= 0.55;
                if (c.fleeTimer > 0) chance *= 0.55;
                if (legCount(c.genes.legs) === 6) chance *= 0.9;
                if (c.huddle >= 2) chance *= 0.8;
                caught = Math.random() < chance;
            }
            if (caught) g.stats.hawk.catches++;
            else if (!c.dead) g.stats.hawk.escapes++;
            if (caught) {
                g.burst(c.x, c.y + 0.4, c.z, 'spark', 0x8a6a48, 8);
                g.kill(c, 'was caught by a hawk');
            } else if (!c.dead) {
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
            const look = this.tmp2 || (this.tmp2 = new THREE.Vector3());
            look.copy(this.pos).add(this.vel);
            m.lookAt(look);
        }
        // Bank into turns while circling.
        if (this.state === 'circle') m.rotateZ(-0.35);
        const diving = this.state === 'dive';
        this.flap += dt * (this.state === 'climb' ? 14 : 5);
        const a = diving ? -0.9 : Math.sin(this.flap) * (this.state === 'climb' ? 0.6 : 0.18);
        this.wings[0].rotation.z = a;
        this.wings[1].rotation.z = -a;
    }

    dispose() {
        this.game.scene.remove(this.mesh);
    }
}
