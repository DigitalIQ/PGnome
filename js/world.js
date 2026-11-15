import * as THREE from 'three';
import { MAP_SIZE, BIOMES, B, YEAR_LENGTH } from './config.js';
import { makeNoise, mulberry32, clamp } from './rng.js';

export const WATER_H = 0.3;
export const SEA = 0.36;
const SEABED = [0x2f5f80, 0x5d9aa0, 0xd3c08c];
const TAU = Math.PI * 2;
const tileGeo = new THREE.BoxGeometry(1, 1, 1);
tileGeo.translate(0, 0.5, 0);

const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const dryColor = new THREE.Color(0x9a8a4e);
const lushColor = new THREE.Color(0x4f9e35);
const berryColor = new THREE.Color(0xe8c547);
const kelpColor = new THREE.Color(0x2e8f6e), kelpPale = new THREE.Color(0x6a8f5a);
// Shallow water grows seaweed. Moonflowers open only at night.
const KELP_CAP = 0.55, KELP_REGROW = 0.008;
const BLOOM_CAP = [0, 0.15, 0.5, 0.3, 0.6, 0, 0];
// Food caps per biome: water, sand, meadow, forest, marsh, rock, lava.
export const FRUIT_CAP = [0, 0.05, 0.18, 0.6, 0.1, 0, 0];
export const NUT_CAP = [0, 0, 0.05, 0.5, 0, 0.28, 0];
export const SHROOM_CAP = [0, 0, 0.08, 0.35, 0.5, 0, 0];
export const ROOT_CAP = [0, 0.3, 0.5, 0.3, 0.4, 0.1, 0];
const fruitColor = new THREE.Color(0xd8343a), toxColor = new THREE.Color(0x8a3fb8);
const shroomColor = new THREE.Color(0xd9c7a3), shroomTox = new THREE.Color(0xe0322a);
const bushTox = new THREE.Color(0x7a4a9a);
const flowerMat = new THREE.MeshBasicMaterial({ color: 0xe4f2ff, fog: false });
const tmpC = new THREE.Color();

function segDist(px, pz, ax, az, bx, bz) {
    const vx = bx - ax, vz = bz - az;
    const t = clamp(((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz), 0, 1);
    return Math.hypot(px - ax - vx * t, pz - az - vz * t);
}

export function isWalkable(t) {
    return !!t && BIOMES[t.biome].walkable;
}

export class World {
    constructor(scene, seed, saved = null, mode = 'classic') {
        this.scene = scene;
        this.seed = seed;
        this.living = mode === 'living';
        this.seaNow = SEA;
        this.evolveAcc = 0;
        this.size = saved ? Math.round(Math.sqrt(saved.length)) : MAP_SIZE;
        this.tiles = [];
        this.meshes = [];
        this.animating = new Set();
        this.group = new THREE.Group();
        scene.add(this.group);

        this.baseColors = BIOMES.map(b => new THREE.Color(b.color));
        this.snowColor = new THREE.Color(0xeef3f6);
        this.iceColor = new THREE.Color(0xb7d3e3);
        this.materials = BIOMES.map((b, i) => new THREE.MeshStandardMaterial({
            color: b.color,
            roughness: i === B.WATER ? 0.35 : 0.92,
            metalness: 0,
            emissive: i === B.LAVA ? 0xff3a00 : 0x000000,
            emissiveIntensity: i === B.LAVA ? 0.9 : 0
        }));
        this.glowT = 0;
        this.slowAcc = 0;
        // The sea is see-through, so the seabed shows how deep the water is.
        const water = this.materials[B.WATER];
        water.transparent = true;
        water.opacity = 0.62;
        water.depthWrite = false;
        this.seabedMats = SEABED.map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 1 }));

        if (saved) this.restore(saved);
        else this.generate();

        const n = this.size * this.size;
        this.bfsDist = new Int16Array(n);
        this.bfsPrev = new Int32Array(n);
        this.bfsStamp = new Uint32Array(n);
        this.bfsGen = 0;
        this.bfsQueue = new Int32Array(n);
        // Heat from lava and fire around each tile, refreshed by the disasters.
        this.heat = new Float32Array(n);

        this.buildMeshes();
        this.buildDecor();
    }

    idx(x, z) { return z * this.size + x; }

    get(x, z) {
        if (x < 0 || z < 0 || x >= this.size || z >= this.size) return null;
        return this.tiles[z * this.size + x];
    }

    tileAt(px, pz) {
        return this.get(Math.round(px), Math.round(pz));
    }

    get center() { return (this.size - 1) / 2; }

    // Raw elevation (e) and wetness (m) per tile, both 0..1. Deterministic per seed.
    // A main island with two or three smaller islands around it. Shallow channels
    // separate them, so only swimmers cross, unless the sea falls on a living island.
    satellites() {
        const rnd = mulberry32(this.seed + 4242);
        const c = (this.size - 1) / 2;
        const n = this.size >= 40 ? 2 + (rnd() < 0.55 ? 1 : 0) : 0;
        const start = rnd() * Math.PI * 2;
        const out = [];
        for (let k = 0; k < n; k++) {
            const a = start + (k / n) * Math.PI * 2 + (rnd() - 0.5) * 0.7;
            const r = 3.4 + rnd() * 1.6;
            const dist = 14.2 + rnd() * 1.2;
            out.push({ x: c + Math.cos(a) * dist, z: c + Math.sin(a) * dist, r, peak: 0.14 + rnd() * 0.08 });
        }
        return out;
    }

    baseFields() {
        const elevation = makeNoise(this.seed);
        const wetness = makeNoise(this.seed + 7919);
        const s = this.size, c = (s - 1) / 2;
        // The main island keeps its old size; bigger maps leave room for the satellites.
        const mainR = Math.min(c, 15.5) * (s >= 40 ? 0.84 : 1);
        const sats = this.satellites();
        const e = new Float32Array(s * s), m = new Float32Array(s * s), cap = new Float32Array(s * s);
        for (let z = 0; z < s; z++) {
            for (let x = 0; x < s; x++) {
                const nx = x / s, nz = z / s;
                const dist = Math.hypot(x - c, z - c);
                const d = dist / mainR;
                const i = z * s + x;
                const noise = elevation(nx * 3.4 * s / 32, nz * 3.4 * s / 32, 4);
                let h = noise * 0.95 + 0.11 - Math.pow(d, 2.6) * 0.45;
                for (const sat of sats) {
                    const ds = Math.hypot(x - sat.x, z - sat.z) / sat.r;
                    h = Math.max(h, SEA + sat.peak * (1 - ds * ds) + (noise - 0.5) * 0.14);
                }
                for (const sat of sats) {
                    const dt = Math.hypot(x - sat.x, z - sat.z);
                    // A ring of shallow water keeps each satellite apart...
                    if (dt > sat.r * 0.95 && dt < sat.r + 2.4) h = clamp(h, SEA - 0.065, SEA - 0.022);
                    // ...and a shallow strait leads to the main island, so swimmers can cross.
                    if (dt > sat.r * 0.95 && segDist(x, z, c, c, sat.x, sat.z) < 2.2 && h < SEA - 0.065) h = SEA - 0.058 + (noise - 0.5) * 0.02;
                }
                e[i] = h;
                m[i] = wetness(nx * 3 + 40, nz * 3 + 40, 3);
                // The map edge always stays sea, also when the land rises.
                cap[i] = 1.2 - Math.max(0, dist / c - 0.86) * 5;
            }
        }
        return { e, m, cap };
    }

    generate() {
        const { e, m, cap } = this.baseFields();
        this.cap = cap;
        const rand = mulberry32(this.seed + 17);
        const toxNoise = makeNoise(this.seed + 313);
        const s = this.size;
        for (let i = 0; i < s * s; i++) {
            const x = i % s, z = (i - x) / s;
            let biome = B.MEADOW;
            if (e[i] < 0.36) biome = B.WATER;
            else if (e[i] < 0.4) biome = B.SAND;
            else if (e[i] > 0.7) biome = B.ROCK;
            else if (m[i] > 0.6 && e[i] < 0.52) biome = B.MARSH;
            else if (m[i] > 0.53) biome = B.FOREST;
            else if (m[i] < 0.36) biome = B.SAND;
            const t = {
                i, x, z, biome, height: 0, rh: 0, food: 0, jitter: rand(),
                elev: e[i], elev0: e[i], wet: m[i], wet0: m[i], veg: clamp((m[i] - 0.3) * 2.4, 0, 1), pend: -1, pendN: 0, trail: 0, fert: 0
            };
            t.height = t.rh = this.heightFor(t, SEA);
            t.food = this.capFor(t) * (0.5 + rand() * 0.5);
            // Some plants start out poisonous, in patches.
            const tn = toxNoise(x / s * 4 + 9, z / s * 4 + 9, 2);
            this.initExtras(t, clamp((tn - 0.5) * 2.2, 0.03, 0.85), rand());
            this.tiles.push(t);
        }
    }

    restore(saved) {
        const { e, m, cap } = this.baseFields();
        this.cap = cap;
        const rand = mulberry32(this.seed + 17);
        saved.forEach((row, i) => {
            const [biome, height, food] = row;
            const x = i % this.size, z = Math.floor(i / this.size);
            const t = {
                i, x, z, biome, height, rh: height, food, jitter: rand(),
                elev: row[3] ?? e[i], wet: row[4] ?? m[i], veg: row[5] ?? clamp((m[i] - 0.3) * 2.4, 0, 1),
                elev0: row[6] ?? e[i], wet0: row[7] ?? m[i], pend: -1, pendN: 0
            };
            if (biome === B.WATER && height >= WATER_H) t.height = t.rh = this.heightFor(t, SEA);
            this.initExtras(t, row[12] ?? 0.05, rand());
            if (row.length > 8) {
                [t.fruit, t.nuts, t.shroom, t.roots, t.tox, t.fert, t.trail, t.burrow, t.work] = row.slice(8, 17).map(v => clamp(v ?? 0, 0, 3));
                t.tox = clamp(t.tox, 0, 1);
            }
            if (biome === B.LAVA) t.lava = 30;
            this.tiles.push(t);
        });
    }

    serialize() {
        const r = v => Math.round(v * 1000) / 1000;
        return this.tiles.map(t => [t.biome, r(t.height), r(t.food), r(t.elev), r(t.wet), r(t.veg), r(t.elev0), r(t.wet0),
            r(t.fruit), r(t.nuts), r(t.shroom), r(t.roots), r(t.tox), r(t.fert), r(t.trail), r(t.burrow), r(t.work)]);
    }

    // The extra food types and the marks Nomes leave on the ground.
    initExtras(t, tox, j) {
        const b = t.biome;
        t.fruit = FRUIT_CAP[b] * j;
        t.nuts = NUT_CAP[b] * 0.5;
        t.shroom = 0;
        t.roots = ROOT_CAP[b];
        t.tox = b === B.WATER ? 0 : tox;
        t.fert = 0;
        t.trail = 0;
        t.burrow = 0;
        t.work = 0;
        t.lava = 0;
        t.fire = 0;
    }

    // Land steps up with elevation. Water tiles are seabed, lower where the sea is deeper.
    heightFor(t, sea) {
        const rel = t.elev - sea;
        if (t.biome === B.WATER) return clamp(WATER_H + rel * 2.6, 0.02, WATER_H - 0.06);
        let h = 0.55 + Math.max(0, Math.round(rel * 12)) * 0.25;
        if (t.biome === B.ROCK) h += 0.25;
        return Math.min(h, 4.3);
    }

    materialFor(t) {
        if (t.biome !== B.WATER) return this.materials[t.biome];

        const h = t.height;
        return this.seabedMats[h < 0.1 ? 0 : h < 0.2 ? 1 : 2];
    }

    buildMeshes() {
        for (const t of this.tiles) {
            const mesh = new THREE.Mesh(tileGeo, this.materialFor(t));
            mesh.position.set(t.x, 0, t.z);
            mesh.scale.y = t.rh;
            mesh.castShadow = t.biome !== B.WATER;
            mesh.receiveShadow = true;
            mesh.userData.tile = t;
            this.group.add(mesh);
            this.meshes[t.i] = mesh;
        }

        // The sea around the island shares the water material, so lakes and sea read as one.
        const sea = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), this.materials[B.WATER]);
        sea.rotation.x = -Math.PI / 2;
        sea.position.set(this.center, WATER_H, this.center);
        sea.receiveShadow = false;
        sea.renderOrder = 2;
        this.group.add(sea);
        this.sea = sea;
        // Deep floor beyond the map, so the edge of the seabed does not show.
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), this.seabedMats[0]);
        floor.rotation.x = -Math.PI / 2;
        floor.position.set(this.center, 0.01, this.center);
        this.group.add(floor);
    }

    buildDecor() {
        const n = this.tiles.length;
        const trunkGeo = new THREE.CylinderGeometry(0.05, 0.07, 0.3, 6);
        trunkGeo.translate(0, 0.15, 0);
        const crownGeo = new THREE.ConeGeometry(0.28, 0.7, 7);
        crownGeo.translate(0, 0.6, 0);
        const rockGeo = new THREE.DodecahedronGeometry(0.2, 0);
        rockGeo.translate(0, 0.08, 0);
        const bushGeo = new THREE.IcosahedronGeometry(0.22, 0);
        bushGeo.translate(0, 0.12, 0);

        this.crownMat = new THREE.MeshStandardMaterial({ color: 0x2f6b34, roughness: 0.85, flatShading: true });
        this.crownBase = new THREE.Color(0x2f6b34);
        const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1 });
        const rockMat = new THREE.MeshStandardMaterial({ color: 0x777b80, roughness: 1, flatShading: true });
        const bushMat = new THREE.MeshStandardMaterial({ roughness: 0.8, flatShading: true });

        const make = (geo, mat) => {
            const im = new THREE.InstancedMesh(geo, mat, n);
            im.castShadow = true;
            im.receiveShadow = true;
            im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            for (let i = 0; i < n; i++) im.setMatrixAt(i, HIDDEN);
            this.group.add(im);
            return im;
        };
        this.trunks = make(trunkGeo, trunkMat);
        this.crowns = make(crownGeo, this.crownMat);
        this.rocks = make(rockGeo, rockMat);
        this.bushes = make(bushGeo, bushMat);
        for (let i = 0; i < n; i++) this.bushes.setColorAt(i, lushColor);
        const flowerGeo = new THREE.OctahedronGeometry(0.09, 0);
        flowerGeo.translate(0, 0.08, 0);
        this.flowers = make(flowerGeo, flowerMat);
        this.flowers.castShadow = false;
        this.bloom = new Float32Array(n);

        const fruitGeo = new THREE.SphereGeometry(0.06, 6, 4);
        fruitGeo.translate(0, 0.3, 0);
        this.fruits = make(fruitGeo, new THREE.MeshStandardMaterial({ roughness: 0.5 }));
        for (let i = 0; i < n; i++) this.fruits.setColorAt(i, fruitColor);
        const nutGeo = new THREE.SphereGeometry(0.05, 5, 4);
        nutGeo.scale(1, 0.8, 1.2);
        nutGeo.translate(0, 0.04, 0);
        this.nutMesh = make(nutGeo, new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.8 }));
        const capGeo = new THREE.SphereGeometry(0.07, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2);
        capGeo.translate(0, 0.08, 0);
        const stemGeo = new THREE.CylinderGeometry(0.02, 0.025, 0.08, 5);
        stemGeo.translate(0, 0.04, 0);
        this.shrooms = make(mergeShroom(capGeo, stemGeo), new THREE.MeshStandardMaterial({ roughness: 0.7 }));
        for (let i = 0; i < n; i++) this.shrooms.setColorAt(i, shroomColor);
        const holeGeo = new THREE.CircleGeometry(0.16, 10);
        holeGeo.rotateX(-Math.PI / 2);
        holeGeo.translate(0, 0.012, 0);
        this.burrows = make(holeGeo, new THREE.MeshBasicMaterial({ color: 0x2a1d12 }));
        this.burrows.castShadow = false;
        const trailGeo = new THREE.PlaneGeometry(1, 1);
        trailGeo.rotateX(-Math.PI / 2);
        trailGeo.translate(0, 0.006, 0);
        this.trailMat = new THREE.MeshStandardMaterial({ color: 0x8b6b45, roughness: 1, transparent: true, opacity: 0.55, depthWrite: false });
        this.trails = make(trailGeo, this.trailMat);
        this.trails.castShadow = false;
        const damGeo = new THREE.BoxGeometry(1, 1, 1);
        damGeo.translate(0, 0.5, 0);
        this.dams = make(damGeo, new THREE.MeshStandardMaterial({ color: 0x7a5a36, roughness: 1, flatShading: true }));

        for (const t of this.tiles) this.updateDecor(t);
        this.updatePlants();
    }

    updateDecor(t) {
        const j = t.jitter;
        const top = t.rh;
        if (t.biome === B.FOREST) {
            const s = 0.8 + j * 0.5;
            tmpP.set(t.x + (j - 0.5) * 0.3, top, t.z + (0.5 - j) * 0.2);
            tmpQ.setFromAxisAngle(UP, j * 6.28);
            tmpS.set(s, s, s);
            tmpM.compose(tmpP, tmpQ, tmpS);
            this.trunks.setMatrixAt(t.i, tmpM);
            this.crowns.setMatrixAt(t.i, tmpM);
        } else {
            this.trunks.setMatrixAt(t.i, HIDDEN);
            this.crowns.setMatrixAt(t.i, HIDDEN);
        }
        if (t.biome === B.ROCK && j > 0.3) {
            const s = 0.7 + j * 0.9;
            tmpP.set(t.x + (0.5 - j) * 0.4, top, t.z + (j - 0.5) * 0.4);
            tmpQ.setFromAxisAngle(UP, j * 12.0);
            tmpS.set(s, s * 0.8, s);
            tmpM.compose(tmpP, tmpQ, tmpS);
            this.rocks.setMatrixAt(t.i, tmpM);
        } else {
            this.rocks.setMatrixAt(t.i, HIDDEN);
        }
        this.trunks.instanceMatrix.needsUpdate = true;
        this.crowns.instanceMatrix.needsUpdate = true;
        this.rocks.instanceMatrix.needsUpdate = true;
        this.setBush(t);
        this.bushes.instanceMatrix.needsUpdate = true;
    }

    // How much food a tile can hold. Shallow water holds seaweed, deep water nothing.
    // Trampled paths hold fewer plants, fertile soil more.
    capFor(t) {
        if (t.biome === B.WATER) return t.height >= 0.12 ? KELP_CAP : 0;
        return BIOMES[t.biome].food * (1 - t.trail * 0.5) * (1 + t.fert * 0.3);
    }

    setBush(t) {
        const cap = this.capFor(t);
        if (cap <= 0 || t.food < 0.04) {
            this.bushes.setMatrixAt(t.i, HIDDEN);
        } else {
            const water = t.biome === B.WATER;
            const full = clamp(t.food / Math.max(cap, 0.3), 0, 2.2);
            const s = 0.35 + Math.min(full, 1) * 0.75 + Math.max(0, full - 1) * 0.35;
            const off = t.biome === B.FOREST ? 0.28 : 0.12;
            tmpP.set(t.x + (0.5 - t.jitter) * off * 2, t.rh, t.z + off);
            tmpQ.setFromAxisAngle(UP, t.jitter * 9);
            // Seaweed grows tall and thin.
            if (water) tmpS.set(s * 0.55, s * 1.7, s * 0.55);
            else tmpS.set(s, s * 0.85, s);
            tmpM.compose(tmpP, tmpQ, tmpS);
            this.bushes.setMatrixAt(t.i, tmpM);
            if (water) tmpC.copy(kelpPale).lerp(kelpColor, Math.min(full, 1));
            else {
                tmpC.copy(dryColor).lerp(lushColor, Math.min(full, 1));
                if (full > 1) tmpC.lerp(berryColor, Math.min(1, (full - 1) * 0.8));
                // Poisonous plants show warning colors.
                if (t.tox > 0.2) tmpC.lerp(bushTox, Math.min(0.75, (t.tox - 0.2) * 1.3));
            }
            this.bushes.setColorAt(t.i, tmpC);
        }
        this.setExtras(t);
        const b = this.bloom ? this.bloom[t.i] : 0;
        if (b > 0.04) {
            const s = 0.8 + b * 2.4;
            tmpP.set(t.x + (t.jitter - 0.5) * 0.5, t.rh, t.z - 0.18 + t.jitter * 0.1);
            tmpQ.setFromAxisAngle(UP, t.jitter * 5);
            tmpS.set(s, s, s);
            tmpM.compose(tmpP, tmpQ, tmpS);
            this.flowers.setMatrixAt(t.i, tmpM);
        } else {
            this.flowers.setMatrixAt(t.i, HIDDEN);
        }
    }

    // Fruit, nuts, mushrooms, burrows, trails and dams.
    setExtras(t) {
        const j = t.jitter, top = t.rh;
        const place = (im, amount, min, x, z, sx, sy, sz, color) => {
            if (amount < min) { im.setMatrixAt(t.i, HIDDEN); return; }
            tmpP.set(t.x + x, top, t.z + z);
            tmpQ.setFromAxisAngle(UP, j * 7);
            tmpS.set(sx, sy, sz);
            tmpM.compose(tmpP, tmpQ, tmpS);
            im.setMatrixAt(t.i, tmpM);
            if (color) im.setColorAt(t.i, color);
        };
        const fs = 0.6 + Math.min(1, t.fruit / 0.4) * 0.8;
        tmpC.copy(fruitColor).lerp(toxColor, clamp(t.tox * 1.3, 0, 1));
        place(this.fruits, t.fruit, 0.05, (0.5 - j) * 0.3, -0.2 + j * 0.1, fs, fs, fs, tmpC);
        const ns = 0.6 + Math.min(1, t.nuts / 0.3) * 0.7;
        place(this.nutMesh, t.nuts, 0.05, 0.22 - j * 0.15, 0.15 + j * 0.15, ns, ns, ns, null);
        const ss = 0.6 + Math.min(1, t.shroom / 0.3) * 0.9;
        tmpC.copy(shroomColor).lerp(shroomTox, clamp(t.tox * 1.4, 0, 1));
        place(this.shrooms, t.shroom, 0.04, -0.25 + j * 0.2, 0.25 - j * 0.1, ss, ss, ss, tmpC);
        const water = t.biome === B.WATER;
        const bs = 0.5 + t.burrow * 0.6;
        place(this.burrows, water ? 0 : t.burrow, 0.15, 0.2 - j * 0.4, -0.1, bs, 1, bs * 0.8, null);
        place(this.trails, water ? 0 : t.trail, 0.18, 0, 0, 0.96, 1, 0.96, null);
        const ds = Math.min(1, t.work);
        place(this.dams, water ? t.work : 0, 0.05, 0, 0, 0.9, 0.2 + ds * (WATER_H - t.rh + 0.05) * 5, 0.9, null);
    }

    updatePlants() {
        for (const t of this.tiles) this.setBush(t);
        for (const im of [this.bushes, this.flowers, this.fruits, this.nutMesh, this.shrooms, this.burrows, this.trails, this.dams]) {
            im.instanceMatrix.needsUpdate = true;
            if (im.instanceColor) im.instanceColor.needsUpdate = true;
        }
    }

    grow(dt, env) {
        const growth = env.growth, night = env.night;
        this.slowAcc += dt;
        if (this.slowAcc >= 1) {
            this.slowTick(this.slowAcc, env);
            this.slowAcc = 0;
        }
        for (const t of this.tiles) {
            const b = BIOMES[t.biome];
            const cap = this.capFor(t);
            // Fertile soil grows back faster, poison costs the plant growth.
            const regrow = (t.biome === B.WATER ? KELP_REGROW : b.regrow) * (1 + t.fert * 1.5) * (1 - t.tox * 0.3);
            if (t.food < cap) {
                t.food = Math.min(cap, t.food + cap * regrow * growth * dt + (cap > 0 ? 0.0004 * growth * dt : 0));
            } else if (t.food > cap) {
                t.food -= (t.food - cap) * 0.015 * dt;
            }
            // Moonflowers open at night and wilt soon after sunrise.
            const bc = BLOOM_CAP[t.biome] * Math.max(0.35, Math.min(1, growth));
            if (night > 0.5) this.bloom[t.i] += (bc - this.bloom[t.i]) * 0.08 * dt;
            else this.bloom[t.i] -= this.bloom[t.i] * 0.3 * dt;
        }
    }

    // Once a second: fruit, nuts, mushrooms and roots, plant poison, and the marks Nomes leave.
    slowTick(step, env) {
        const phase = env.phase, g = Math.max(0.3, env.growth);
        const fruitS = phase < 0.25 ? 0.3 : phase < 0.68 ? 1 : 0;
        const nutS = phase > 0.5 && phase < 0.76 ? 1 : 0;
        const shroomS = env.wet > 3 && env.temp > -6 ? Math.min(1, env.wet / 15) * (phase > 0.5 && phase < 0.8 ? 1.6 : 1) : 0;
        const s = this.size;
        const tox = this.toxSnap || (this.toxSnap = new Float32Array(s * s));
        for (let i = 0; i < s * s; i++) tox[i] = this.tiles[i].tox;
        for (const t of this.tiles) {
            const b = t.biome;
            if (b === B.WATER || b === B.LAVA) {
                t.fruit = t.nuts = t.shroom = 0;
                t.burrow = 0;
                t.trail = 0;
                if (b === B.WATER) t.roots = 0;
                continue;
            }
            const fc = FRUIT_CAP[b] * (1 + t.fert * 0.4);
            if (fruitS > 0 && t.fruit < fc * fruitS) t.fruit = Math.min(fc, t.fruit + fc * 0.012 * g * fruitS * step);
            else t.fruit -= t.fruit * (fruitS ? 0.004 : 0.03) * step;
            const nc = NUT_CAP[b];
            if (nutS && t.nuts < nc) t.nuts = Math.min(nc, t.nuts + nc * 0.016 * step);
            else t.nuts -= t.nuts * 0.0015 * step;
            const sc = SHROOM_CAP[b] * (1 + t.fert * 0.5);
            if (shroomS > 0 && t.shroom < sc) t.shroom = Math.min(sc, t.shroom + sc * 0.025 * shroomS * step);
            else t.shroom -= t.shroom * 0.02 * step;
            const rc = ROOT_CAP[b];
            if (t.roots < rc) t.roots = Math.min(rc, t.roots + rc * 0.004 * step);
            // Poison is costly, so it fades where nobody eats. Seeds spread it to neighbors.
            const x = t.x, z = t.z, i = t.i;
            const avg = (tox[x > 0 ? i - 1 : i] + tox[x < s - 1 ? i + 1 : i] + tox[z > 0 ? i - s : i] + tox[z < s - 1 ? i + s : i]) / 4;
            t.tox = clamp(t.tox + (avg - t.tox) * 0.004 * step - (t.tox - 0.03) * 0.0006 * step, 0, 1);
            t.fert = Math.max(0, t.fert - t.fert * 0.0012 * step);
            t.trail = Math.max(0, t.trail - 0.0008 * (0.3 + env.growth) * step);
            t.burrow = Math.max(0, t.burrow - 0.0006 * step * (env.wet > 25 ? 3 : 1));
        }
    }

    // Grazing makes plants poisonous over time: the bitter ones survive and spread.
    grazed(t, amount) {
        t.tox = Math.min(1, t.tox + amount * 0.06);
    }

    // ---------- Changes made by Nomes ----------

    dig(t, amount) {
        if (!isWalkable(t) || t.biome === B.ROCK) return false;
        t.burrow = Math.min(1, t.burrow + amount);
        t.roots = Math.max(0, t.roots - amount * 0.1);
        if (this.living) { t.elev -= 0.0015; t.veg = Math.max(0, t.veg - 0.03); }
        this.setBush(t);
        this.markDecor();
        return true;
    }

    // Dams fill shallow water until it becomes land. Returns true when it turns to land.
    buildDam(t, amount) {
        if (t.biome !== B.WATER || t.height < 0.15) return false;
        t.work += amount;
        if (t.work >= 1) {
            t.work = 0;
            this.setBiome(t, B.SAND);
            t.fert = 0.2;
            return true;
        }
        this.setBush(t);
        this.markDecor();
        return false;
    }

    // Seeds turn sand into meadow and meadow into forest.
    plant(t, amount) {
        if (t.biome !== B.SAND && t.biome !== B.MEADOW) return false;
        t.fert = Math.min(1, t.fert + amount * 0.4);
        if (this.living) t.veg = Math.min(1, t.veg + amount * 0.5);
        t.work += amount;
        if (t.work >= 1) {
            t.work = 0;
            if (!this.living) this.setBiome(t, t.biome === B.SAND ? B.MEADOW : B.FOREST);
            return true;
        }
        return false;
    }

    // Channels drain a marsh into meadow.
    drain(t, amount) {
        if (t.biome !== B.MARSH) return false;
        if (this.living) { t.wet = Math.max(0, t.wet - amount * 0.5); t.wet0 = Math.max(0, t.wet0 - amount * 0.35); }
        t.work += amount;
        if (t.work >= 1) {
            t.work = 0;
            if (!this.living) this.setBiome(t, B.MEADOW);
            return true;
        }
        return false;
    }

    markDecor() {
        for (const im of [this.burrows, this.trails, this.dams, this.fruits, this.nutMesh, this.shrooms]) {
            im.instanceMatrix.needsUpdate = true;
            if (im.instanceColor) im.instanceColor.needsUpdate = true;
        }
    }

    // ---------- Disasters ----------

    ignite(t) {
        if (!t || t.fire > 0 || t.lava > 0) return false;
        if (t.biome !== B.FOREST && t.biome !== B.MEADOW && !(t.biome === B.MARSH && t.veg > 0.6)) return false;
        t.fire = 5 + Math.random() * 5;
        return true;
    }

    setLava(t, life) {
        if (!t) return false;
        if (this.living) t.elev = Math.max(t.elev, this.seaNow + 0.04);
        t.biome = B.LAVA;
        t.lava = life;
        t.fire = 0;
        t.food = t.fruit = t.nuts = t.shroom = t.roots = 0;
        t.burrow = t.trail = t.work = 0;
        t.pend = -1;
        t.pendN = 0;
        t.height = Math.max(this.living ? this.heightFor(t, this.seaNow) : t.height, 0.7);
        this.applyBiome(t);
        return true;
    }

    // Cooled lava turns into fresh, fertile rock.
    solidify(t) {
        if (this.living) {
            t.elev = Math.max(t.elev, this.seaNow + 0.03);
            t.veg = 0;
        }
        t.biome = B.ROCK;
        t.lava = 0;
        t.fert = Math.max(t.fert, 0.6);
        t.tox = 0.03;
        t.pend = -1;
        t.pendN = 0;
        t.height = this.living ? this.heightFor(t, this.seaNow) : Math.max(0.8, t.height) + 0.1;
        this.applyBiome(t);
    }

    // An earthquake opens the ground and turns it into water.
    crack(t) {
        if (!t || t.biome === B.WATER) return false;
        if (this.living) { t.elev = Math.min(t.elev, this.seaNow - 0.05); t.elev0 = Math.min(t.elev0, this.seaNow - 0.03); }
        t.lava = 0;
        t.fire = 0;
        return this.setBiome(t, B.WATER);
    }

    climate(t, airTemp, wetShift = 0) {
        const b = BIOMES[t.biome];
        const h = t.biome === B.WATER ? 0.8 : t.height;
        return { temp: b.temp - (h - 0.8) * 8 + airTemp + this.heat[t.i] * 45, moisture: clamp(b.moisture + wetShift, 0, 100) };
    }

    setBiome(t, biome) {
        if (!t || t.biome === biome) return false;
        const prev = t.biome;
        if (this.living) {
            this.shapeFor(t, biome);
            t.biome = biome;
            t.height = this.heightFor(t, this.seaNow);
        } else {
            t.biome = biome;
            if (biome === B.WATER) { t.elev = Math.min(t.elev, SEA - 0.05); t.height = this.heightFor(t, SEA); }
            else if (prev === B.WATER) t.height = 0.8;
            if (biome === B.ROCK) t.height = Math.min(t.height + 0.5, 3.3);
            else if (prev === B.ROCK) t.height = Math.max(0.8, t.height - 0.5);
        }
        t.pend = -1;
        t.pendN = 0;
        this.applyBiome(t);
        return true;
    }

    // In a living world, painting reshapes the ground itself, so nature keeps the change.
    shapeFor(t, biome) {
        const sea = this.seaNow;
        const land = (lo, hi) => { t.elev = clamp(t.elev, sea + lo, sea + hi); };
        if (biome === B.WATER) t.elev = Math.min(t.elev, sea - 0.04);
        else if (biome === B.ROCK) t.elev = Math.max(t.elev, sea + 0.37);
        else if (biome === B.SAND) { land(0.03, 0.3); t.veg = 0.08; t.wet = Math.min(t.wet, 0.3); }
        else if (biome === B.MEADOW) { land(0.06, 0.3); t.veg = 0.42; t.wet = clamp(t.wet, 0.4, 0.55); }
        else if (biome === B.FOREST) { land(0.06, 0.3); t.veg = 0.92; t.wet = Math.max(t.wet, 0.6); }
        else if (biome === B.MARSH) { land(0.04, 0.12); t.veg = 0.5; t.wet = 0.82; }
        t.elev0 = t.elev;
        t.wet0 = t.wet;
    }

    applyBiome(t) {
        this.islandCache = null;
        t.food = Math.min(t.food, this.capFor(t) * (this.living ? 0.6 : 0.3));
        if (this.bloom) this.bloom[t.i] = 0;
        const mesh = this.meshes[t.i];
        mesh.material = this.materialFor(t);
        mesh.castShadow = t.biome !== B.WATER && t.biome !== B.LAVA;
        if (t.biome !== B.LAVA) t.lava = 0;
        this.animating.add(t);
        this.updateDecor(t);
    }

    // ---------- Living island ----------

    seaLevel(time) {
        if (!this.living) return SEA;
        const y = YEAR_LENGTH;
        return SEA + 0.04 * Math.sin(TAU * time / (y * 3.3)) + 0.02 * Math.sin(TAU * time / (y * 1.15) + 1.7);
    }

    // A hot spot wanders under the island and pushes the ground up in pulses.
    hotspot(time) {
        const y = YEAR_LENGTH, c = this.center;
        const k = time / (y * 4.5) + this.seed % 97;
        return {
            x: c + Math.sin(k * 1.7) * 6 + Math.sin(k * 0.6 + 2) * 3,
            z: c + Math.cos(k * 1.3) * 6 + Math.sin(k * 0.9) * 3,
            power: 0.0024 * Math.max(0, Math.sin(TAU * time / (y * 2.6) + 0.8))
        };
    }

    classify(t, rel) {
        if (rel < 0) return B.WATER;
        if (rel > 0.34) return B.ROCK;
        if (rel < 0.025) return B.SAND;
        if (t.wet > 0.64 && rel < 0.15) return B.MARSH;
        if (t.veg > 0.6) return B.FOREST;
        if (t.veg < 0.17) return B.SAND;
        return B.MEADOW;
    }

    // Returns the tiles that changed their biome.
    evolve(dt, time, weather) {
        if (!this.living) return null;
        this.evolveAcc += dt;
        if (this.evolveAcc < 0.5) return null;
        const step = this.evolveAcc;
        this.evolveAcc = 0;
        // A downpour floods the coast for a while.
        this.flood = (this.flood || 0) + ((weather.flood || 0) - (this.flood || 0)) * Math.min(1, step * 0.05);
        const sea = this.seaLevel(time) + this.flood * 0.025;
        this.seaNow = sea;
        const hot = this.hotspot(time);
        const s = this.size, n = s * s;
        const snap = this.snap || (this.snap = new Float32Array(n));
        for (let i = 0; i < n; i++) snap[i] = this.tiles[i].elev;
        const rainy = Math.max(0, weather.wet) / 25;
        const dry = Math.max(0, -weather.wet) / 28;
        const changed = [];

        for (let i = 0; i < n; i++) {
            const t = this.tiles[i];
            if (t.biome === B.LAVA) continue;
            const x = t.x, z = t.z;
            // Uplift, pull back to the base shape, and erosion that smooths peaks.
            const d2 = (x - hot.x) ** 2 + (z - hot.z) ** 2;
            let e = snap[i];
            e += hot.power * Math.exp(-d2 / 14) * step;
            e += (t.elev0 - e) * 0.0011 * step;
            const avg = (snap[x > 0 ? i - 1 : i] + snap[x < s - 1 ? i + 1 : i] + snap[z > 0 ? i - s : i] + snap[z < s - 1 ? i + s : i]) / 4;
            const rel0 = e - sea;
            e += (avg - e) * (0.0012 + rainy * 0.002 + (rel0 > 0.3 ? 0.0015 : 0)) * step;
            t.elev = Math.min(e, this.cap[i]);
            const rel = t.elev - sea;

            // Moisture follows the weather. Vegetation follows moisture, slowly.
            t.wet += (clamp(t.wet0 + weather.wet / 100 * 0.6, 0, 1) - t.wet) * 0.02 * step;
            if (rel >= 0) {
                // Fertile soil helps plants, trampled paths kill them.
                const target = clamp((t.wet - 0.3) * 2.4 + t.fert * 0.2, 0, 1) * (rel > 0.25 ? 0.4 : 1) * (1 - t.trail * 0.6);
                t.veg += (target - t.veg) * 0.009 * step;
                const cap = BIOMES[t.biome].food;
                if (cap > 0 && t.food < cap * 0.1) t.veg -= 0.0015 * step;
                t.veg -= dry * 0.002 * step;
                t.veg = clamp(t.veg, 0, 1);
            }

            const want = this.classify(t, rel);
            if (want !== t.biome) {
                if (t.pend === want) t.pendN++;
                else { t.pend = want; t.pendN = 1; }
                if (t.pendN >= 4) {
                    t.biome = want;
                    t.pend = -1;
                    t.pendN = 0;
                    t.height = this.heightFor(t, sea);
                    this.applyBiome(t);
                    changed.push(t);
                    continue;
                }
            } else {
                t.pend = -1;
                t.pendN = 0;
            }
            const h = this.heightFor(t, sea);
            if (Math.abs(h - t.height) > 0.01) {
                t.height = h;
                this.animating.add(t);
                if (t.biome === B.WATER) this.meshes[t.i].material = this.materialFor(t);
            }
        }
        return changed;
    }

    // Lightning sets a forest on fire. It grows back as meadow.
    burn(t) {
        if (!t || t.biome !== B.FOREST) return false;
        t.veg = 0.25;
        t.food *= 0.3;
        t.biome = B.MEADOW;
        t.pend = -1;
        t.pendN = 0;
        this.applyBiome(t);
        return true;
    }

    // Which island every tile belongs to. The biggest island is the main one.
    islands() {
        if (this.islandCache) return this.islandCache;
        const s = this.size, ids = new Int16Array(s * s).fill(-1), sizes = [];
        for (const t of this.tiles) {
            if (!BIOMES[t.biome].walkable || ids[t.i] >= 0) continue;
            const id = sizes.length;
            let n = 0;
            const q = [t.i];
            ids[t.i] = id;
            while (q.length) {
                const i = q.pop();
                n++;
                const x = i % s, z = (i - x) / s;
                for (const [dx, dz] of DIRS4) {
                    const nx = x + dx, nz = z + dz;
                    if (nx < 0 || nz < 0 || nx >= s || nz >= s) continue;
                    const j = nz * s + nx;
                    if (ids[j] < 0 && BIOMES[this.tiles[j].biome].walkable) { ids[j] = id; q.push(j); }
                }
            }
            sizes.push(n);
        }
        const main = sizes.indexOf(Math.max(0, ...sizes));
        this.islandCache = { ids, sizes, main, count: sizes.filter(n => n >= 6).length };
        return this.islandCache;
    }

    stats() {
        let land = 0, peak = 0, deep = 0;
        for (const t of this.tiles) {
            if (t.biome === B.WATER) deep = Math.max(deep, WATER_H - t.height);
            else { land++; peak = Math.max(peak, t.height); }
        }
        return { land, peak, deep };
    }

    feed(t) {
        if (!isWalkable(t)) return false;
        for (let dz = -1; dz <= 1; dz++) {
            for (let dx = -1; dx <= 1; dx++) {
                const n = this.get(t.x + dx, t.z + dz);
                if (!isWalkable(n)) continue;
                const add = dx === 0 && dz === 0 ? 1.4 : 0.5;
                n.food = Math.min(2.5, n.food + add);
                this.setBush(n);
            }
        }
        this.bushes.instanceMatrix.needsUpdate = true;
        if (this.bushes.instanceColor) this.bushes.instanceColor.needsUpdate = true;
        return true;
    }

    animate(dt) {
        this.glowT += dt;
        this.materials[B.LAVA].emissiveIntensity = 0.75 + Math.sin(this.glowT * 2.2) * 0.25;
        for (const t of this.animating) {
            const diff = t.height - t.rh;
            if (Math.abs(diff) < 0.01) {
                t.rh = t.height;
                this.animating.delete(t);
            } else {
                t.rh += diff * Math.min(1, dt * 7);
            }
            this.meshes[t.i].scale.y = t.rh;
            this.updateDecor(t);
        }
    }

    applySeason(snow, ice) {
        this.trailMat.opacity = 0.55 * (1 - snow * 0.8);
        BIOMES.forEach((b, i) => {
            const target = i === B.WATER ? this.iceColor : this.snowColor;
            const amount = i === B.WATER ? ice : snow * b.snow;
            this.materials[i].color.copy(this.baseColors[i]).lerp(target, amount);
        });
        this.crownMat.color.copy(this.crownBase).lerp(this.snowColor, snow * 0.55);
    }

    // Breadth-first search over walkable tiles. The start tile may be water,
    // so a Nome dropped into a lake can still find the shore.
    // Swimmers may cross shallow water. Deep water stops everyone.
    passable(t, swim = false) {
        if (!t) return false;
        if (BIOMES[t.biome].walkable) return true;
        return swim && t.biome === B.WATER && t.height >= 0.12;
    }

    bfs(start, maxDepth, swim = false) {
        const gen = ++this.bfsGen;
        const q = this.bfsQueue;
        let head = 0, tail = 0;
        q[tail++] = start.i;
        this.bfsStamp[start.i] = gen;
        this.bfsDist[start.i] = 0;
        this.bfsPrev[start.i] = -1;
        const s = this.size;
        while (head < tail) {
            const i = q[head++];
            const d = this.bfsDist[i];
            if (d >= maxDepth) continue;
            const x = i % s, z = (i - x) / s;
            for (let k = 0; k < 8; k++) {
                const dx = DIRS[k][0], dz = DIRS[k][1];
                const nx = x + dx, nz = z + dz;
                if (nx < 0 || nz < 0 || nx >= s || nz >= s) continue;
                const ni = nz * s + nx;
                if (this.bfsStamp[ni] === gen) continue;
                if (!this.passable(this.tiles[ni], swim)) continue;
                if (dx !== 0 && dz !== 0) {
                    if (!this.passable(this.tiles[z * s + nx], swim) || !this.passable(this.tiles[nz * s + x], swim)) continue;
                }
                this.bfsStamp[ni] = gen;
                this.bfsDist[ni] = d + 1;
                this.bfsPrev[ni] = i;
                q[tail++] = ni;
            }
        }
        return q.subarray(0, tail);
    }

    reached(i) { return this.bfsStamp[i] === this.bfsGen; }

    pathTo(i) {
        const path = [];
        while (i !== -1 && this.bfsPrev[i] !== -1) {
            path.push(this.tiles[i]);
            i = this.bfsPrev[i];
        }
        return path.reverse();
    }

    dispose() {
        this.scene.remove(this.group);
        this.group.traverse(o => {
            if (o.isInstancedMesh) o.dispose();
            if (o.geometry && o.geometry !== tileGeo) o.geometry.dispose();
        });
        this.materials.forEach(m => m.dispose());
        this.seabedMats.forEach(m => m.dispose());
        this.crownMat.dispose();
    }
}

function mergeShroom(cap, stem) {
    const a = cap.toNonIndexed(), b = stem.toNonIndexed();
    const pos = new Float32Array(a.attributes.position.count * 3 + b.attributes.position.count * 3);
    pos.set(a.attributes.position.array, 0);
    pos.set(b.attributes.position.array, a.attributes.position.count * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.computeVertexNormals();
    return g;
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
