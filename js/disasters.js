import * as THREE from 'three';
import { B, YEAR_LENGTH, DISASTERS } from './config.js';
import { isWalkable } from './world.js';
import { rand, clamp } from './rng.js';

// Earthquakes, volcanoes, tsunamis, wildfires and plague. They come rarely, change the
// island for good and hit some Nomes harder than others: swimmers survive tsunamis,
// diggers lose their burrows in quakes, crowded social Nomes catch the plague first.

const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const waveGeo = new THREE.BoxGeometry(1, 1, 1);

export class Disasters {
    constructor(game, saved) {
        this.game = game;
        this.next = saved?.next ?? YEAR_LENGTH * rand(1.3, 2);
        this.acc = 0;
        this.plagueAcc = 0;
        this.eruption = null;
        this.wave = null;
        this.queue = [];
        this.watches = [];
        game.ash = saved?.ash ?? 0;
    }

    serialize() {
        return { next: Math.round(this.next), ash: Math.round(this.game.ash * 1000) / 1000 };
    }

    get busy() { return !!(this.eruption || this.wave); }

    step(dt) {
        const g = this.game;
        g.ash = Math.max(0, g.ash - dt / (YEAR_LENGTH * 0.8));
        if (g.disastersOn && !this.busy) {
            this.next -= dt;
            if (this.next <= 0) {
                // Nature gives a small population time to recover.
                if (g.creatures.length < 30) this.next = 30;
                else {
                    this.trigger(this.pick());
                    this.next = this.interval();
                }
            }
        }
        for (let i = this.queue.length - 1; i >= 0; i--) {
            const q = this.queue[i];
            q.t -= dt;
            if (q.t <= 0) { this.queue.splice(i, 1); this.trigger(q.kind, q.opts); }
        }
        if (this.wave) this.stepWave(dt);
        this.acc += dt;
        if (this.acc >= 0.5) {
            this.tick(this.acc);
            this.acc = 0;
        }
        this.plagueAcc += dt;
        if (this.plagueAcc >= 1) {
            this.spreadPlague(this.plagueAcc);
            this.plagueAcc = 0;
        }
        for (let i = this.watches.length - 1; i >= 0; i--) {
            const w = this.watches[i];
            w.t -= dt;
            if (w.t > 0) continue;
            w.entry.after = g.creatures.length;
            if (w.entry.after >= 20) g.completeGoal('disaster');
            this.watches.splice(i, 1);
        }
    }

    // Time until the next disaster. A restless living island strikes more often,
    // a dense population draws disease sooner, a quiet classic island waits longer.
    interval() {
        const g = this.game;
        let f = rand(0.9, 1.7);
        if (g.world.living) f *= g.world.hotspot(g.time).power > 0.0004 ? 0.65 : 0.9;
        else f *= 1.1;
        f *= 1.15 - Math.min(0.3, (g.meanStress || 0) * 0.6);
        return YEAR_LENGTH * f;
    }

    // Which disaster fits the moment.
    pick() {
        const g = this.game, w = g.weather.now, n = g.creatures.length;
        const hotspot = g.world.living && g.world.hotspot(g.time).power > 0.0004;
        const forests = g.world.tiles.some(t => t.biome === B.FOREST);
        const dry = w.wet < -5 || g.seasonIndex === 1;
        const odds = {
            quake: 3,
            volcano: hotspot ? 3 : 1.2,
            tsunami: 1,
            wildfire: forests ? (dry ? 3 : 0.6) : 0,
            plague: n > 50 ? 1.5 + n / 50 : n > 20 ? 0.4 : 0
        };
        let total = 0;
        for (const v of Object.values(odds)) total += v;
        let r = Math.random() * total;
        for (const [k, v] of Object.entries(odds)) { r -= v; if (r <= 0) return k; }
        return 'quake';
    }

    trigger(kind, opts = {}) {
        if (!DISASTERS[kind] || !this.game.world) return false;
        const g = this.game;
        const before = g.creatures.length;
        const ok = this[kind](opts);
        if (!ok) return false;
        const entry = { y: g.year, kind, before, after: null };
        g.stats.disasters.push(entry);
        if (g.stats.disasters.length > 60) g.stats.disasters.shift();
        this.watches.push({ t: 60, entry });
        g.emit('disaster', kind);
        return true;
    }

    // ---------- Earthquake ----------

    quake(opts) {
        const g = this.game, world = g.world;
        const land = world.tiles.filter(t => isWalkable(t));
        if (!land.length) return false;
        const c = world.center;
        // Quakes start near the middle more often, where they do the most damage.
        const epi = opts.tile || land.reduce((best, t) => {
            const s = Math.random() * 10 - Math.hypot(t.x - c, t.z - c) * 0.25;
            return s > best.s ? { s, t } : best;
        }, { s: -Infinity, t: land[0] }).t;
        const a = Math.random() * Math.PI;
        const len = 7 + Math.random() * 9;
        const line = new Set();
        const bend = Math.random() * 2;
        for (let s = -len / 2; s <= len / 2; s += 0.4) {
            const off = Math.sin(s * 0.5 + bend) * 0.9;
            const x = epi.x + Math.cos(a) * s - Math.sin(a) * off;
            const z = epi.z + Math.sin(a) * s + Math.cos(a) * off;
            const t = world.tileAt(x, z);
            if (t) line.add(t);
        }
        const changed = [];
        for (const t of line) {
            if (isWalkable(t) && Math.random() < 0.85 && world.crack(t)) changed.push(t);
            g.burst(t.x, t.rh + 0.3, t.z, 'smoke', 0x9a8a70, 2);
        }
        // The ground on one side of the fault is pushed up into rock.
        const nx = -Math.sin(a), nz = Math.cos(a);
        for (const t of world.tiles) {
            const d = Math.hypot(t.x - epi.x, t.z - epi.z);
            if (d > len / 2 + 2) continue;
            const side = (t.x - epi.x) * nx + (t.z - epi.z) * nz;
            if (Math.abs(side) < 3) t.burrow = 0;
            if (side > 0.6 && side < 2.4 && isWalkable(t) && !line.has(t) && Math.random() < 0.18) {
                if (world.setBiome(t, B.ROCK)) changed.push(t);
            }
        }
        for (const cr of [...g.creatures]) {
            const t = world.tileAt(cr.x, cr.z);
            if (t && line.has(t) && !cr.t.swimmer) {
                cr.health -= 75;
                if (cr.health <= 0) { g.kill(cr, 'fell into a rift'); continue; }
            }
            const d = Math.hypot(cr.x - epi.x, cr.z - epi.z);
            if (d < 6) { cr.health -= 8 * (1 - d / 6); cr.fleeTimer = 2; cr.cancelPlans(); cr.lastHarm = 'fell into a rift'; }
            if (cr.health <= 0) g.kill(cr, 'fell into a rift');
        }
        if (changed.length) g.onTerrain(changed);
        g.shake = 1.6;
        g.log(`An earthquake! A rift of ${changed.length} tiles opens across ${g.islandName}.`, 'death');
        // A long rift near the coast is likely to send a wave. The wave arrives later when the quake was far inland.
        let coast = 99;
        for (const t of world.tiles) if (t.biome === B.WATER && t.height < 0.2) coast = Math.min(coast, Math.hypot(t.x - epi.x, t.z - epi.z));
        if (Math.random() < clamp(0.05 + len / 30 - coast * 0.03, 0.03, 0.75)) this.queue.push({ kind: 'tsunami', t: 2 + coast * 0.8, opts: {} });
        return true;
    }

    // ---------- Volcano ----------

    volcano(opts) {
        const g = this.game, world = g.world;
        let vent = opts.tile;
        if (!vent) {
            const land = world.tiles.filter(t => isWalkable(t));
            if (!land.length) return false;
            if (world.living) {
                const h = world.hotspot(g.time);
                vent = land.reduce((b, t) => (Math.hypot(t.x - h.x, t.z - h.z) - t.height < Math.hypot(b.x - h.x, b.z - h.z) - b.height ? t : b), land[0]);
            } else {
                land.sort((p, q) => q.height - p.height);
                vent = land[Math.floor(Math.random() * Math.min(8, land.length))];
            }
        }
        // Each eruption has its own strength: a hot spot under a living island makes it stronger.
        const strength = clamp(rand(0.3, 1) + (world.living ? world.hotspot(g.time).power * 150 : 0), 0.3, 1.4);
        world.setLava(vent, 90 + strength * 60);
        this.eruption = { vent, strength, t: 12 + strength * 22, spawn: 0, fronts: [] };
        g.ash = Math.min(1, g.ash + 0.25 + strength * 0.35);
        g.shake = 1.1;
        g.onTerrain([vent]);
        g.log('A volcano erupts! Lava flows downhill, ash darkens the sky. Lava that reaches the sea becomes new land.', 'death');
        return true;
    }

    flow(front) {
        const g = this.game, world = g.world;
        const t = front.tile;
        let best = null, bestS = Infinity;
        for (const [dx, dz] of DIRS4) {
            const n = world.get(t.x + dx, t.z + dz);
            if (!n || n.biome === B.LAVA) continue;
            const s = n.height + Math.random() * 0.35 + (n.biome === B.ROCK ? 0.1 : 0);
            if (s < bestS) { bestS = s; best = n; }
        }
        if (!best || best.height > t.height + 0.3) { front.n = 0; return null; }
        if (best.biome === B.WATER) {
            // Lava meets the sea: steam, and new land.
            world.setLava(best, 5);
            g.stats.landMade = (g.stats.landMade || 0) + 1;
            g.burst(best.x, 0.6, best.z, 'smoke', 0xf2f2f2, 4);
            front.n -= 2;
        } else {
            const st = this.eruption ? this.eruption.strength : 0.6;
            world.setLava(best, (30 + st * 45) * rand(0.8, 1.2));
            front.n--;
        }
        front.tile = best;
        for (const [dx, dz] of DIRS4) world.ignite(world.get(best.x + dx, best.z + dz));
        return best;
    }

    // ---------- Tsunami ----------

    tsunami(opts) {
        const g = this.game, world = g.world;
        const a = Math.random() * Math.PI * 2;
        const dx = Math.cos(a), dz = Math.sin(a), c = world.center, R = world.size * 0.75;
        // Low land near the coast on the side the wave comes from.
        const hit = [];
        for (const t of world.tiles) {
            if (!isWalkable(t) || t.height > 1.35) continue;
            const proj = (t.x - c) * dx + (t.z - c) * dz;
            if (proj > world.size * 0.12) continue;
            let coast = false;
            for (let oz = -2; oz <= 2 && !coast; oz++) for (let ox = -2; ox <= 2; ox++) {
                const n = world.get(t.x + ox, t.z + oz);
                if (n && n.biome === B.WATER) { coast = true; break; }
            }
            if (coast) hit.push({ t, proj });
        }
        const mat = new THREE.MeshStandardMaterial({ color: 0xdff2fb, transparent: true, opacity: 0.7, roughness: 0.3 });
        const mesh = new THREE.Mesh(waveGeo, mat);
        mesh.scale.set(R * 2.4, 1.6, 1.4);
        mesh.rotation.y = -a + Math.PI / 2;
        g.scene.add(mesh);
        this.wave = { dx, dz, c, p: -R, R, hit, mesh, mat, done: new Set() };
        g.log('A tsunami rolls in! Low coasts get flooded. Swimmers and Nomes on high ground are safe.', 'death');
        return true;
    }

    stepWave(dt) {
        const g = this.game, world = g.world, w = this.wave;
        w.p += dt * 7;
        w.mesh.position.set(w.c + w.dx * w.p, 0.5, w.c + w.dz * w.p);
        const changed = [];
        for (const h of w.hit) {
            if (w.done.has(h.t) || h.proj > w.p) continue;
            w.done.add(h.t);
            const t = h.t;
            t.food *= 0.1;
            t.fruit = t.shroom = 0;
            t.burrow = 0;
            t.trail = 0;
            if ((t.biome === B.MEADOW || t.biome === B.FOREST) && Math.random() < 0.3 && world.setBiome(t, B.SAND)) changed.push(t);
            world.setBush(t);
            g.burst(t.x, t.rh + 0.4, t.z, 'smoke', 0xe8f4fa, 1);
        }
        for (const cr of [...g.creatures]) {
            const t = world.tileAt(cr.x, cr.z);
            if (!t || !w.done.has(t) || cr.washed === w) continue;
            cr.washed = w;
            cr.cancelPlans();
            cr.health -= 65 * (1 - cr.genes.webbing * 0.85) * (1.2 - cr.genes.size * 0.3);
            cr.lastHarm = 'was swept away by a tsunami';
            const nx = cr.x + w.dx * 1.5, nz = cr.z + w.dz * 1.5;
            const dest = world.tileAt(nx, nz);
            if (dest && isWalkable(dest)) { cr.x = nx; cr.z = nz; }
            if (cr.health <= 0) g.kill(cr, 'was swept away by a tsunami');
        }
        world.markDecor();
        if (changed.length) g.onTerrain(changed);
        if (w.p > w.R) {
            g.scene.remove(w.mesh);
            w.mat.dispose();
            this.wave = null;
        }
    }

    // ---------- Wildfire ----------

    wildfire(opts) {
        const g = this.game, world = g.world;
        const forests = world.tiles.filter(t => t.biome === B.FOREST && t.fire <= 0);
        const start = opts.tile || forests[Math.floor(Math.random() * forests.length)];
        if (!start || !world.ignite(start)) return false;
        for (const [dx, dz] of DIRS4) world.ignite(world.get(start.x + dx, start.z + dz));
        g.log('A wildfire breaks out! Fire races through dry forests. Rain puts it out, burned land grows back fertile.', 'death');
        return true;
    }

    // ---------- Plague ----------

    plague(opts) {
        const g = this.game;
        const list = g.creatures.filter(c => c.plague <= 0 && c.immuneT <= 0);
        if (!list.length) return false;
        const first = opts.creature || list[Math.floor(Math.random() * list.length)];
        let n = 0;
        for (const c of list) {
            if (c === first || (Math.hypot(c.x - first.x, c.z - first.z) < 1.6 && n < 3)) { this.infect(c); n++; }
        }
        g.log(opts.natural ? `Crowding breeds disease. A plague breaks out near ${first.name}.`
            : `A plague breaks out near ${first.name}. It spreads where Nomes crowd together. Immune Nomes shrug it off.`, 'death');
        return true;
    }

    infect(c) {
        // Strong immunity and calm Nomes get over it faster.
        c.plague = (14 + 22 * (1 - c.genes.immunity)) * (1 + c.stress * 0.5) * rand(0.85, 1.15);
        this.game.stats.plague.cases++;
    }

    spreadPlague(step) {
        const list = this.game.creatures;
        const sick = list.filter(c => c.plague > 0);
        if (!sick.length) return;
        for (const s of sick) {
            for (const o of list) {
                if (o.plague > 0 || o.immuneT > 0) continue;
                const d = Math.abs(o.x - s.x) + Math.abs(o.z - s.z);
                if (d > 1.6) continue;
                // Stress weakens the immune system.
                if (Math.random() < 0.07 * step * (1 - o.genes.immunity * 0.9) * (1 + o.stress)) this.infect(o);
            }
        }
    }

    // ---------- Lava, fire and heat, twice a second ----------

    tick(step) {
        const g = this.game, world = g.world, w = g.weather.now;
        const changed = [];
        const e = this.eruption;
        if (e) {
            e.t -= step;
            e.spawn -= step;
            if (e.spawn <= 0 && e.t > 0) { e.fronts.push({ tile: e.vent, n: (4 + Math.random() * 6) * (0.6 + e.strength) }); e.spawn = (4 - e.strength * 2) * rand(0.8, 1.2); }
            for (const f of e.fronts) { const t = this.flow(f); if (t) changed.push(t); }
            e.fronts = e.fronts.filter(f => f.n > 0);
            g.burst(e.vent.x, e.vent.rh + 0.8, e.vent.z, 'smoke', 0x3a3633, 2);
            g.burst(e.vent.x, e.vent.rh + 0.5, e.vent.z, 'spark', 0xff7a2a, 3);
            // Ash falls around the volcano and makes the soil fertile.
            for (const t of world.tiles) {
                const d = Math.hypot(t.x - e.vent.x, t.z - e.vent.z);
                if (d < 9 && isWalkable(t)) t.fert = Math.min(1, t.fert + 0.03 * step * (1 - d / 9));
            }
            if (e.t <= 0 && !e.fronts.length) this.eruption = null;
        }
        const dry = clamp(1 - w.wet / 15, 0.15, 3) * (1 + (w.wind || 0) * 0.8);
        const raining = (w.rain || 0) > 0.3 || (w.snow || 0) > 0.3;
        const heat = world.heat;
        heat.fill(0);
        const s = world.size;
        const warm = (i, v) => { if (heat[i] < v) heat[i] = v; };
        let fires = 0;
        for (const t of world.tiles) {
            if (t.biome === B.LAVA) {
                // Rain and snow cool lava faster.
                t.lava -= step * (1 + (w.rain || 0) * 0.8 + (w.snow || 0) * 0.5);
                if (t.lava <= 0) { world.solidify(t); changed.push(t); continue; }
                for (let oz = -2; oz <= 2; oz++) for (let ox = -2; ox <= 2; ox++) {
                    const x = t.x + ox, z = t.z + oz;
                    if (x < 0 || z < 0 || x >= s || z >= s) continue;
                    const d = Math.max(Math.abs(ox), Math.abs(oz));
                    warm(z * s + x, d === 0 ? 1 : d === 1 ? 0.55 : 0.25);
                }
            } else if (t.fire > 0) {
                fires++;
                t.fire -= step * (raining ? 4 : 1);
                t.food *= 0.6;
                t.fruit = t.nuts = 0;
                warm(t.i, 1);
                for (const [dx, dz] of DIRS4) {
                    const n = world.get(t.x + dx, t.z + dz);
                    if (!n) continue;
                    warm(n.i, 0.45);
                    const base = n.biome === B.FOREST ? 0.2 : n.biome === B.MEADOW ? 0.06 : n.biome === B.MARSH ? 0.015 : 0;
                    if (base && n.fire <= 0 && Math.random() < base * dry * step * (raining ? 0.1 : 1)) world.ignite(n);
                }
                if (fires < 30 && Math.random() < 0.6) g.burst(t.x, t.rh + 0.5, t.z, 'spark', Math.random() < 0.5 ? 0xff8a2a : 0xffc23a, 2);
                if (fires < 30 && Math.random() < 0.25) g.burst(t.x, t.rh + 0.8, t.z, 'smoke', 0x5a5a5a, 1);
                if (t.fire <= 0) {
                    t.fire = 0;
                    t.fert = Math.min(1, t.fert + 0.4);
                    t.burrow *= 0.5;
                    g.stats.burned++;
                    if (world.burn(t)) changed.push(t);
                    else { t.food = 0; world.setBush(t); }
                }
            }
        }
        if (changed.length) {
            world.markDecor();
            g.onTerrain(changed);
        }
    }

    dispose() {
        if (this.wave) {
            this.game.scene.remove(this.wave.mesh);
            this.wave.mat.dispose();
        }
    }
}
